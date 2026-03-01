// =============================================
// database/token.service.js
// Semua operasi database untuk token, sesi, dan log
// Dipakai oleh middleware dan admin routes
// =============================================
const { pool } = require("./db");
const { v4: uuidv4 } = require("uuid");

// ─────────────────────────────────────────────
// TOKEN QUERIES
// ─────────────────────────────────────────────

/**
 * Cari token dari database beserta info expired & aktif
 * @returns row token atau null jika tidak ditemukan
 */
async function findToken(token) {
    const [rows] = await pool.query(
        `SELECT id, token, client_name, role, is_active, expired_at
         FROM tokens WHERE token = ? LIMIT 1`,
        [token]
    );
    return rows[0] || null;
}

/**
 * List semua token (untuk admin)
 */
async function listTokens() {
    const [rows] = await pool.query(
        `SELECT t.id, t.token, t.client_name, t.role, t.is_active, t.expired_at,
                t.created_at,
                GROUP_CONCAT(ts.session_name ORDER BY ts.session_name SEPARATOR ', ') AS sessions
         FROM tokens t
         LEFT JOIN token_sessions ts ON ts.token_id = t.id
         GROUP BY t.id
         ORDER BY t.created_at DESC`
    );
    return rows;
}

/**
 * Buat token baru
 * @param {object} data - { client_name, role, expired_at }
 * @returns row token yang baru dibuat
 */
async function createToken({ client_name, role = "client", expired_at = null }) {
    const token = `bm_${uuidv4().replace(/-/g, "")}`; // prefix bm_ = botmeta

    await pool.query(
        `INSERT INTO tokens (token, client_name, role, is_active, expired_at)
         VALUES (?, ?, ?, 1, ?)`,
        [token, client_name, role, expired_at]
    );

    return findToken(token);
}

/**
 * Update token: aktif/nonaktif, perpanjang expired, ganti nama
 * @param {number} id - token id
 * @param {object} updates - { is_active, expired_at, client_name }
 */
async function updateToken(id, updates) {
    const allowed = ["is_active", "expired_at", "client_name"];
    const fields = [];
    const values = [];

    for (const key of allowed) {
        if (updates[key] !== undefined) {
            fields.push(`${key} = ?`);
            values.push(updates[key]);
        }
    }

    if (fields.length === 0) return null;

    values.push(id);
    await pool.query(`UPDATE tokens SET ${fields.join(", ")} WHERE id = ?`, values);

    const [rows] = await pool.query(`SELECT * FROM tokens WHERE id = ?`, [id]);
    return rows[0] || null;
}

/**
 * Hapus token beserta semua sesi yang di-assign (cascade otomatis via FK)
 */
async function deleteToken(id) {
    const [result] = await pool.query(`DELETE FROM tokens WHERE id = ?`, [id]);
    return result.affectedRows > 0;
}

// ─────────────────────────────────────────────
// SESSION ASSIGNMENT QUERIES
// ─────────────────────────────────────────────

/**
 * Assign satu atau beberapa sesi ke token
 * @param {number} tokenId
 * @param {string[]} sessionNames - array nama sesi
 * @returns { added: number, skipped: number }
 */
async function assignSessions(tokenId, sessionNames) {
    let added = 0, skipped = 0;

    for (const sessionName of sessionNames) {
        try {
            await pool.query(
                `INSERT INTO token_sessions (token_id, session_name) VALUES (?, ?)`,
                [tokenId, sessionName]
            );
            added++;
        } catch (err) {
            if (err.code === "ER_DUP_ENTRY") skipped++; // sudah ada, lewati
            else throw err;
        }
    }

    return { added, skipped };
}

/**
 * Cabut akses sesi dari token
 * @param {number} tokenId
 * @param {string[]} sessionNames
 * @returns jumlah sesi yang berhasil dicabut
 */
async function revokeSessions(tokenId, sessionNames) {
    const [result] = await pool.query(
        `DELETE FROM token_sessions WHERE token_id = ? AND session_name IN (?)`,
        [tokenId, sessionNames]
    );
    return result.affectedRows;
}

/**
 * Ambil semua sesi yang di-assign ke token tertentu
 */
async function getTokenSessions(tokenId) {
    const [rows] = await pool.query(
        `SELECT session_name, created_at FROM token_sessions WHERE token_id = ? ORDER BY session_name`,
        [tokenId]
    );
    return rows;
}

/**
 * Cek apakah token boleh mengakses sesi tertentu
 * Admin bisa akses semua sesi tanpa perlu di-assign
 */
async function canAccessSession(tokenId, role, sessionName) {
    if (role === "admin") return true;

    const [rows] = await pool.query(
        `SELECT id FROM token_sessions WHERE token_id = ? AND session_name = ? LIMIT 1`,
        [tokenId, sessionName]
    );
    return rows.length > 0;
}

// ─────────────────────────────────────────────
// ACCESS LOG QUERIES
// ─────────────────────────────────────────────

/**
 * Simpan log request ke database (permanen)
 * @param {object} log - { token_id, client_name, method, endpoint, session_name, status_code, message, ip_address }
 */
async function writeLog(log) {
    await pool.query(
        `INSERT INTO access_logs
         (token_id, client_name, method, endpoint, session_name, status_code, message, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            log.token_id    || null,
            log.client_name || null,
            log.method,
            log.endpoint,
            log.session_name || null,
            log.status_code,
            log.message      || null,
            log.ip_address   || null,
        ]
    );
}

/**
 * Ambil log dengan filter opsional (untuk admin dashboard nanti)
 * @param {object} filters - { token_id, endpoint, status_code, date_from, date_to, limit, offset }
 */
async function getLogs({ token_id, endpoint, status_code, date_from, date_to, limit = 100, offset = 0 } = {}) {
    const conditions = [];
    const values = [];

    if (token_id)    { conditions.push("token_id = ?");         values.push(token_id); }
    if (endpoint)    { conditions.push("endpoint LIKE ?");       values.push(`%${endpoint}%`); }
    if (status_code) { conditions.push("status_code = ?");       values.push(status_code); }
    if (date_from)   { conditions.push("created_at >= ?");       values.push(date_from); }
    if (date_to)     { conditions.push("created_at <= ?");       values.push(date_to); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [rows] = await pool.query(
        `SELECT * FROM access_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [...values, limit, offset]
    );

    const [[{ total }]] = await pool.query(
        `SELECT COUNT(*) AS total FROM access_logs ${where}`,
        values
    );

    return { total, data: rows };
}

module.exports = {
    findToken,
    listTokens,
    createToken,
    updateToken,
    deleteToken,
    assignSessions,
    revokeSessions,
    getTokenSessions,
    canAccessSession,
    writeLog,
    getLogs,
};