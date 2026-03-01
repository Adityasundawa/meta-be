// =============================================
// middleware/auth.middleware.js
// Validasi Bearer token di setiap request
//
// Alur:
//   1. Cek header Authorization: Bearer <token>
//   2. Cek token ada di database
//   3. Cek token masih aktif (is_active = 1)
//   4. Cek token belum expired
//   5. Simpan info token ke req.tokenData untuk middleware berikutnya
// =============================================
const { findToken, writeLog } = require("../database/token.service");

async function authMiddleware(req, res, next) {
    const authHeader = req.headers["authorization"] || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

    const logBase = {
        method:       req.method,
        endpoint:     req.path,
        ip_address:   req.ip || req.connection?.remoteAddress,
        session_name: req.body?.sessionName || null,
    };

    // ── Tidak ada token ──
    if (!token) {
        await writeLog({ ...logBase, status_code: 401, message: "Missing Bearer token" });
        return res.status(401).json({
            status:  "Unauthorized",
            message: "Akses ditolak. Sertakan Bearer token di header Authorization.",
            hint:    "Authorization: Bearer <token_kamu>",
        });
    }

    // ── Cari token di DB ──
    let tokenData;
    try {
        tokenData = await findToken(token);
    } catch (err) {
        console.error("[AUTH] DB error:", err.message);
        return res.status(500).json({ status: "Error", message: "Server error saat validasi token." });
    }

    // ── Token tidak ditemukan ──
    if (!tokenData) {
        await writeLog({ ...logBase, status_code: 401, message: "Token tidak ditemukan" });
        return res.status(401).json({
            status:  "Unauthorized",
            message: "Token tidak valid atau tidak ditemukan.",
        });
    }

    // ── Token dinonaktifkan ──
    if (!tokenData.is_active) {
        await writeLog({ ...logBase, token_id: tokenData.id, client_name: tokenData.client_name, status_code: 401, message: "Token dinonaktifkan" });
        return res.status(401).json({
            status:  "Unauthorized",
            message: `Token '${tokenData.client_name}' telah dinonaktifkan. Hubungi admin.`,
        });
    }

    // ── Token expired ──
    // FIX 1: Konversi expired_at ke timestamp number agar konsisten lintas timezone
    //         MySQL bisa return Date object atau string, .getTime() normalisasi keduanya
    // FIX 2: Gunakan <= bukan < agar token yang expired TEPAT sekarang juga tertangkap
    if (tokenData.expired_at) {
        const expiredAt  = new Date(tokenData.expired_at).getTime(); // FIX 1: normalisasi ke ms
        const now        = Date.now();                                // FIX 1: bandingkan sesama ms

        if (expiredAt <= now) {                                       // FIX 2: <= bukan <
            // Format tanggal untuk response yang mudah dibaca
            const expiredStr = new Date(expiredAt).toLocaleString("id-ID", {
                day:    "2-digit",
                month:  "long",
                year:   "numeric",
                hour:   "2-digit",
                minute: "2-digit",
                timeZone: "Asia/Jakarta",
            });

            await writeLog({
                ...logBase,
                token_id:    tokenData.id,
                client_name: tokenData.client_name,
                status_code: 401,
                message:     `Token expired sejak ${expiredStr}`,
            });

            return res.status(401).json({
                status:     "Unauthorized",
                message:    `Token '${tokenData.client_name}' sudah expired sejak ${expiredStr}.`,
                expired_at: new Date(expiredAt).toISOString(), // format standar ISO untuk client
            });
        }
    }

    // ── Valid → simpan ke req untuk middleware berikutnya ──
    req.tokenData = tokenData;
    next();
}

module.exports = { authMiddleware };