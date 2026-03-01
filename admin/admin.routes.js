// =============================================
// admin/admin.routes.js
// Endpoint khusus admin untuk manage token & sesi
//
// Semua route di sini butuh:
//   - Bearer token valid (authMiddleware)
//   - Role admin (adminGuard)
//
// POST   /admin/tokens                     → Buat token baru
// GET    /admin/tokens                     → List semua token
// GET    /admin/tokens/:id                 → Detail 1 token
// PATCH  /admin/tokens/:id                 → Edit token (aktif/nonaktif, expired, nama)
// DELETE /admin/tokens/:id                 → Hapus token
// POST   /admin/tokens/:id/sessions        → Assign sesi ke token
// DELETE /admin/tokens/:id/sessions        → Cabut sesi dari token
// GET    /admin/tokens/:id/sessions        → List sesi milik token
// GET    /admin/logs                       → Lihat access log
// =============================================
const express = require("express");
const router = express.Router();

const {
    listTokens,
    createToken,
    updateToken,
    deleteToken,
    assignSessions,
    revokeSessions,
    getTokenSessions,
    getLogs,
    findToken,
} = require("../database/token.service");

// ─────────────────────────────────────────────
// POST /admin/tokens → Buat token baru
// Body: { "client_name": "Reseller A", "role": "client", "expired_at": "2026-12-31 23:59:59" }
// ─────────────────────────────────────────────
router.post("/tokens", async (req, res) => {
    const { client_name, role = "client", expired_at = null } = req.body;

    if (!client_name?.trim()) {
        return res.status(400).json({ status: "Error", message: "'client_name' wajib diisi." });
    }

    if (!["client", "admin"].includes(role)) {
        return res.status(400).json({ status: "Error", message: "'role' harus 'client' atau 'admin'." });
    }

    // Validasi format expired_at jika diisi
    if (expired_at && isNaN(Date.parse(expired_at))) {
        return res.status(400).json({
            status: "Error",
            message: "Format 'expired_at' tidak valid. Gunakan: YYYY-MM-DD HH:MM:SS",
        });
    }

    try {
        const newToken = await createToken({
            client_name: client_name.trim(),
            role,
            expired_at: expired_at || null,
        });

        return res.status(201).json({
            status: "Created",
            message: `Token untuk '${newToken.client_name}' berhasil dibuat.`,
            data: newToken,
            tip: "Simpan token ini baik-baik. Token tidak bisa diambil ulang jika hilang.",
        });
    } catch (err) {
        console.error("[ADMIN] createToken error:", err.message);
        return res.status(500).json({ status: "Error", message: "Gagal membuat token.", detail: err.message });
    }
});

// ─────────────────────────────────────────────
// GET /admin/tokens → List semua token
// ─────────────────────────────────────────────
router.get("/tokens", async (req, res) => {
    try {
        const tokens = await listTokens();
        return res.status(200).json({
            status: "Success",
            total: tokens.length,
            data: tokens,
        });
    } catch (err) {
        return res.status(500).json({ status: "Error", message: "Gagal mengambil daftar token.", detail: err.message });
    }
});

// ─────────────────────────────────────────────
// GET /admin/tokens/:id → Detail 1 token + sesi yang di-assign
// ─────────────────────────────────────────────
router.get("/tokens/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "Error", message: "ID tidak valid." });

    try {
        const [rows] = await require("../database/db").pool.query(
            `SELECT * FROM tokens WHERE id = ?`, [id]
        );
        const token = rows[0];
        if (!token) return res.status(404).json({ status: "Not Found", message: `Token ID ${id} tidak ditemukan.` });

        const sessions = await getTokenSessions(id);

        return res.status(200).json({
            status: "Success",
            data: { ...token, sessions },
        });
    } catch (err) {
        return res.status(500).json({ status: "Error", message: "Gagal mengambil detail token.", detail: err.message });
    }
});

// ─────────────────────────────────────────────
// PATCH /admin/tokens/:id → Edit token
// Body (salah satu atau kombinasi):
//   { "is_active": 0 }                          → Nonaktifkan token
//   { "expired_at": "2027-01-01 00:00:00" }     → Perpanjang expired
//   { "client_name": "Nama Baru" }              → Ganti nama klien
// ─────────────────────────────────────────────
router.patch("/tokens/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "Error", message: "ID tidak valid." });

    const { is_active, expired_at, client_name } = req.body;

    if (is_active === undefined && expired_at === undefined && client_name === undefined) {
        return res.status(400).json({
            status: "Error",
            message: "Sertakan minimal satu field yang ingin diubah: is_active, expired_at, atau client_name.",
        });
    }

    try {
        const updated = await updateToken(id, { is_active, expired_at, client_name });
        if (!updated) return res.status(404).json({ status: "Not Found", message: `Token ID ${id} tidak ditemukan.` });

        return res.status(200).json({
            status: "Updated",
            message: "Token berhasil diperbarui.",
            data: updated,
        });
    } catch (err) {
        return res.status(500).json({ status: "Error", message: "Gagal update token.", detail: err.message });
    }
});

// ─────────────────────────────────────────────
// DELETE /admin/tokens/:id → Hapus token + semua sesi yang di-assign
// ─────────────────────────────────────────────
router.delete("/tokens/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "Error", message: "ID tidak valid." });

    try {
        const deleted = await deleteToken(id);
        if (!deleted) return res.status(404).json({ status: "Not Found", message: `Token ID ${id} tidak ditemukan.` });

        return res.status(200).json({
            status: "Deleted",
            message: `Token ID ${id} dan semua mapping sesinya berhasil dihapus.`,
        });
    } catch (err) {
        return res.status(500).json({ status: "Error", message: "Gagal hapus token.", detail: err.message });
    }
});

// ─────────────────────────────────────────────
// POST /admin/tokens/:id/sessions → Assign sesi ke token
// Body: { "sessions": ["akun_1", "akun_2", "akun_3"] }
// ─────────────────────────────────────────────
router.post("/tokens/:id/sessions", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "Error", message: "ID tidak valid." });

    const { sessions } = req.body;
    if (!Array.isArray(sessions) || sessions.length === 0) {
        return res.status(400).json({ status: "Error", message: "'sessions' wajib berupa array string nama sesi." });
    }

    try {
        const result = await assignSessions(id, sessions);
        const current = await getTokenSessions(id);

        return res.status(200).json({
            status: "Success",
            message: `${result.added} sesi berhasil di-assign. ${result.skipped} sudah ada sebelumnya.`,
            added: result.added,
            skipped: result.skipped,
            current_sessions: current.map(s => s.session_name),
        });
    } catch (err) {
        return res.status(500).json({ status: "Error", message: "Gagal assign sesi.", detail: err.message });
    }
});

// ─────────────────────────────────────────────
// DELETE /admin/tokens/:id/sessions → Cabut sesi dari token
// Body: { "sessions": ["akun_1", "akun_2"] }
// ─────────────────────────────────────────────
router.delete("/tokens/:id/sessions", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "Error", message: "ID tidak valid." });

    const { sessions } = req.body;
    if (!Array.isArray(sessions) || sessions.length === 0) {
        return res.status(400).json({ status: "Error", message: "'sessions' wajib berupa array string nama sesi." });
    }

    try {
        const revoked = await revokeSessions(id, sessions);
        const current = await getTokenSessions(id);

        return res.status(200).json({
            status: "Success",
            message: `${revoked} sesi berhasil dicabut aksesnya.`,
            revoked,
            current_sessions: current.map(s => s.session_name),
        });
    } catch (err) {
        return res.status(500).json({ status: "Error", message: "Gagal cabut sesi.", detail: err.message });
    }
});

// ─────────────────────────────────────────────
// GET /admin/tokens/:id/sessions → List sesi milik token
// ─────────────────────────────────────────────
router.get("/tokens/:id/sessions", async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ status: "Error", message: "ID tidak valid." });

    try {
        const sessions = await getTokenSessions(id);
        return res.status(200).json({
            status: "Success",
            token_id: id,
            total: sessions.length,
            sessions,
        });
    } catch (err) {
        return res.status(500).json({ status: "Error", message: "Gagal ambil sesi.", detail: err.message });
    }
});

// ─────────────────────────────────────────────
// GET /admin/logs → Lihat access log dengan filter
// Query params: token_id, endpoint, status_code, date_from, date_to, limit, offset
// Contoh: /admin/logs?status_code=403&limit=50
// ─────────────────────────────────────────────
router.get("/logs", async (req, res) => {
    const { token_id, endpoint, status_code, date_from, date_to, limit = 100, offset = 0 } = req.query;

    try {
        const result = await getLogs({
            token_id:    token_id    ? parseInt(token_id)    : undefined,
            status_code: status_code ? parseInt(status_code) : undefined,
            endpoint, date_from, date_to,
            limit:  Math.min(parseInt(limit)  || 100, 1000), // max 1000 per request
            offset: parseInt(offset) || 0,
        });

        return res.status(200).json({
            status: "Success",
            total: result.total,
            returned: result.data.length,
            data: result.data,
        });
    } catch (err) {
        return res.status(500).json({ status: "Error", message: "Gagal ambil log.", detail: err.message });
    }
});

module.exports = router;