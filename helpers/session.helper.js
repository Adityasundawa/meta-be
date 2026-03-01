// =============================================
// helpers/session.helper.js
// Fungsi bantu untuk manajemen sesi browser
// =============================================
const fs = require("fs");
const path = require("path");
const { SESSION_BASE_DIR } = require("../config/app.config");

// Pastikan direktori sesi sudah ada
if (!fs.existsSync(SESSION_BASE_DIR)) {
    fs.mkdirSync(SESSION_BASE_DIR, { recursive: true });
}

/**
 * Ambil path lengkap folder sesi berdasarkan nama sesi
 */
function getSessionPath(sessionName) {
    return path.join(SESSION_BASE_DIR, sessionName);
}

/**
 * Cek apakah sesi sedang dikunci (browser sedang terbuka)
 * Ditandai dengan file "SingletonLock" di folder sesi
 */
function isSessionLocked(sessionName) {
    const lockFile = path.join(getSessionPath(sessionName), "SingletonLock");
    return fs.existsSync(lockFile);
}

/**
 * Ambil status sesi: not_found | empty | locked | available
 */
function getSessionStatus(sessionName) {
    const sessionPath = getSessionPath(sessionName);

    if (!fs.existsSync(sessionPath)) return { exists: false, status: "not_found" };

    const files = fs.readdirSync(sessionPath);
    if (files.length === 0) return { exists: true, status: "empty" };
    if (isSessionLocked(sessionName)) return { exists: true, status: "locked" };

    return { exists: true, status: "available" };
}

module.exports = { getSessionPath, isSessionLocked, getSessionStatus };
