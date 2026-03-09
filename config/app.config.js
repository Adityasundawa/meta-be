// =============================================
// config/app.config.js → Konfigurasi Global
// =============================================
const path = require("path");

module.exports = {
    API_PORT: 8002,

    // Direktori penyimpanan sesi browser
    SESSION_BASE_DIR: path.resolve(__dirname, "../session/meta"),

    // Direktori file yang sudah selesai diproses
    DONE_DIR: path.resolve(__dirname, "../selesai"),

    // Direktori file temporary hasil download dari URL
    TEMP_DOWNLOAD_DIR: path.resolve(__dirname, "../downloads/temp"),

    // Ekstensi file yang didukung
    VIDEO_EXTS: [".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"],
    IMAGE_EXTS: [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"],
};