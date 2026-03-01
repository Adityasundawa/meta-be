// =============================================
// middleware/admin.guard.js
// Pastikan hanya token dengan role='admin' yang bisa akses endpoint admin
// Dipasang SETELAH authMiddleware di semua route /admin/*
// =============================================
const { writeLog } = require("../database/token.service");

async function adminGuard(req, res, next) {
    const { tokenData } = req;

    if (tokenData.role !== "admin") {
        await writeLog({
            token_id:    tokenData.id,
            client_name: tokenData.client_name,
            method:      req.method,
            endpoint:    req.path,
            status_code: 403,
            message:     "Akses admin ditolak — bukan role admin",
            ip_address:  req.ip,
        });

        return res.status(403).json({
            status: "Forbidden",
            message: "Endpoint ini hanya bisa diakses oleh admin.",
        });
    }

    next();
}

module.exports = { adminGuard };