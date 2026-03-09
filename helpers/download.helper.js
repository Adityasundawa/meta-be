// =============================================
// helpers/download.helper.js
// Fungsi bantu untuk download file dari URL ke folder temp
// =============================================
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { v4: uuidv4 } = require("uuid");
const { TEMP_DOWNLOAD_DIR } = require("../config/app.config");

// Pastikan folder temp sudah ada saat module di-load
if (!fs.existsSync(TEMP_DOWNLOAD_DIR)) {
    fs.mkdirSync(TEMP_DOWNLOAD_DIR, { recursive: true });
}

/**
 * Cek apakah string adalah URL (http / https)
 * @param {string} str
 * @returns boolean
 */
function isUrl(str) {
    return typeof str === "string" && /^https?:\/\//i.test(str);
}

/**
 * Ambil ekstensi file dari URL
 * Contoh: https://example.com/video.mp4?token=xxx → .mp4
 * @param {string} url
 * @returns string ekstensi (contoh: ".mp4") atau "" jika tidak ditemukan
 */
function getExtFromUrl(url) {
    try {
        const pathname = new URL(url).pathname;
        const ext = path.extname(pathname).toLowerCase();
        return ext || "";
    } catch (_) {
        return "";
    }
}

/**
 * Map Content-Type header ke ekstensi file
 */
const CONTENT_TYPE_MAP = {
    "image/jpeg":  ".jpg",
    "image/jpg":   ".jpg",
    "image/png":   ".png",
    "image/gif":   ".gif",
    "image/webp":  ".webp",
    "image/bmp":   ".bmp",
    "video/mp4":   ".mp4",
    "video/quicktime": ".mov",
    "video/x-msvideo": ".avi",
    "video/x-matroska": ".mkv",
    "video/webm":  ".webm",
    "video/x-m4v": ".m4v",
};

/**
 * Ambil ekstensi dari Content-Type header
 * @param {string} contentType - contoh: "image/jpeg", "video/mp4; charset=..."
 * @returns string ekstensi (contoh: ".jpg") atau "" jika tidak dikenali
 */
function getExtFromContentType(contentType) {
    if (!contentType) return "";
    const mime = contentType.split(";")[0].trim().toLowerCase();
    return CONTENT_TYPE_MAP[mime] || "";
}

/**
 * Download file dari URL ke folder /downloads/temp
 * Nama file menggunakan UUID agar tidak bentrok antar request paralel
 * Ekstensi dideteksi dari URL terlebih dahulu, fallback ke Content-Type header
 *
 * @param {string} url - URL file yang akan didownload
 * @returns {Promise<string>} path lokal hasil download
 * @throws Error jika download gagal
 */
function downloadFile(url) {
    return new Promise((resolve, reject) => {
        const id = uuidv4();
        // Pakai ekstensi sementara dulu, nanti rename setelah tahu Content-Type
        const tempPath = path.join(TEMP_DOWNLOAD_DIR, `${id}.tmp`);
        const fileStream = fs.createWriteStream(tempPath);

        const protocol = url.startsWith("https") ? https : http;

        const request = protocol.get(url, (response) => {
            // Handle redirect (301, 302, 307, 308)
            if ([301, 302, 307, 308].includes(response.statusCode) && response.headers.location) {
                fileStream.close();
                fs.unlink(tempPath, () => {});
                return downloadFile(response.headers.location).then(resolve).catch(reject);
            }

            if (response.statusCode !== 200) {
                fileStream.close();
                fs.unlink(tempPath, () => {});
                return reject(new Error(`Download gagal. HTTP status: ${response.statusCode} → ${url}`));
            }

            // Tentukan ekstensi: URL dulu, fallback Content-Type
            let ext = getExtFromUrl(url);
            if (!ext) {
                ext = getExtFromContentType(response.headers["content-type"]);
                if (ext) {
                    console.log(`[DOWNLOAD] Ekstensi dari Content-Type: ${ext}`);
                } else {
                    console.warn(`[DOWNLOAD] Tidak bisa deteksi ekstensi, menggunakan .bin`);
                    ext = ".bin";
                }
            }

            const finalFileName = `${id}${ext}`;
            const finalPath = path.join(TEMP_DOWNLOAD_DIR, finalFileName);

            response.pipe(fileStream);

            fileStream.on("finish", () => {
                fileStream.close();
                // Rename dari .tmp ke ekstensi yang benar
                fs.rename(tempPath, finalPath, (renameErr) => {
                    if (renameErr) {
                        return reject(new Error(`Gagal rename temp file: ${renameErr.message}`));
                    }
                    console.log(`[DOWNLOAD] ✓ Berhasil → ${finalFileName}`);
                    resolve(finalPath);
                });
            });
        });

        request.on("error", (err) => {
            fileStream.close();
            fs.unlink(tempPath, () => {});
            reject(new Error(`Download error: ${err.message}`));
        });

        fileStream.on("error", (err) => {
            fs.unlink(tempPath, () => {});
            reject(new Error(`File write error: ${err.message}`));
        });

        // Timeout 5 menit untuk file besar
        request.setTimeout(300000, () => {
            request.destroy();
            fileStream.close();
            fs.unlink(tempPath, () => {});
            reject(new Error(`Download timeout (5 menit) → ${url}`));
        });
    });
}

/**
 * Hapus file temporary hasil download
 * Dipanggil setelah task selesai (sukses maupun gagal)
 * @param {string} filePath
 */
function deleteTempFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`[DOWNLOAD] Temp file dihapus → ${path.basename(filePath)}`);
        }
    } catch (err) {
        console.warn(`[DOWNLOAD] Gagal hapus temp file: ${err.message}`);
    }
}

module.exports = { isUrl, downloadFile, deleteTempFile, getExtFromUrl };