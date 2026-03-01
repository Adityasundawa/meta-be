// =============================================
// middleware/session.guard.js
// Cek apakah token boleh mengakses sessionName yang diminta
//
// Dipasang SETELAH authMiddleware di route yang butuh sessionName
// Admin bisa akses semua sesi tanpa perlu di-assign
// =============================================
const { canAccessSession, writeLog } = require("../database/token.service");

async function sessionGuard(req, res, next) {
    const { tokenData } = req;

    // Ambil sessionName dari body atau query param
    const sessionName = req.body?.sessionName || req.query?.sessionName;

    // Jika endpoint tidak butuh sessionName → lewati guard ini
    if (!sessionName) return next();

    try {
        const allowed = await canAccessSession(tokenData.id, tokenData.role, sessionName);

        if (!allowed) {
            await writeLog({
                token_id:     tokenData.id,
                client_name:  tokenData.client_name,
                method:       req.method,
                endpoint:     req.path,
                session_name: sessionName,
                status_code:  403,
                message:      `Akses sesi '${sessionName}' ditolak`,
                ip_address:   req.ip,
            });

            return res.status(403).json({
                status: "Forbidden",
                message: `Token '${tokenData.client_name}' tidak punya akses ke sesi '${sessionName}'.`,
                hint: "Hubungi admin untuk assign sesi ini ke token kamu.",
            });
        }

        // Catat log akses yang berhasil (async, tidak blocking)
        writeLog({
            token_id:     tokenData.id,
            client_name:  tokenData.client_name,
            method:       req.method,
            endpoint:     req.path,
            session_name: sessionName,
            status_code:  200,
            message:      "Akses diterima",
            ip_address:   req.ip,
        }).catch(() => {}); // swallow log error agar tidak ganggu response

        next();

    } catch (err) {
        console.error("[SESSION-GUARD] DB error:", err.message);
        return res.status(500).json({ status: "Error", message: "Server error saat validasi akses sesi." });
    }
}

module.exports = { sessionGuard };