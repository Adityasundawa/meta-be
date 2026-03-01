// =============================================
// helpers/file.helper.js
// Fungsi bantu untuk deteksi tipe file
// =============================================
const path = require("path");
const { VIDEO_EXTS, IMAGE_EXTS } = require("../config/app.config");

/**
 * Deteksi tipe file berdasarkan ekstensi
 * @returns "video" | "image" | "unknown"
 */
function getFileType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (VIDEO_EXTS.includes(ext)) return "video";
    if (IMAGE_EXTS.includes(ext)) return "image";
    return "unknown";
}

module.exports = { getFileType };
