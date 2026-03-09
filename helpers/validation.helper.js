// =============================================
// helpers/validation.helper.js
// Validasi input task sebelum masuk antrian
// =============================================
const fs = require("fs");
const { getSessionStatus } = require("./session.helper");
const { getFileType } = require("./file.helper");
const { isUrl, getExtFromUrl } = require("./download.helper");
const { VIDEO_EXTS, IMAGE_EXTS } = require("../config/app.config");

/**
 * Validasi semua task sebelum diproses
 * filePath bisa berupa path lokal ATAU URL (http/https)
 * @returns Array error (kosong jika semua valid)
 */
function validateTasks(sessionName, tasks) {
    const errors = [];

    // Validasi sesi terlebih dahulu
    const sessionStatus = getSessionStatus(sessionName);
    if (!sessionStatus.exists || sessionStatus.status === "empty") {
        errors.push({ field: "sessionName", message: `Sesi '${sessionName}' tidak ditemukan. Login dulu.` });
        return errors;
    }
    if (sessionStatus.status === "locked") {
        errors.push({ field: "sessionName", message: `Sesi '${sessionName}' sedang terbuka di browser lain.` });
        return errors;
    }

    // Validasi setiap task satu per satu
    tasks.forEach((task, i) => {
        const prefix = `Task[${i}]`;

        // ── Validasi filePath ──────────────────────────────────────
        if (!task.filePath || typeof task.filePath !== "string") {
            errors.push({ index: i, field: "filePath", message: `${prefix}: 'filePath' wajib diisi (path lokal atau URL).` });
        } else if (isUrl(task.filePath)) {
            // Validasi URL: cek ekstensi dari URL-nya
            const ext = getExtFromUrl(task.filePath);
            if (!ext) {
                // Tidak ada ekstensi di URL → warning saja, tetap lanjut
                // (beberapa URL tidak menyertakan ekstensi, mis. signed URL)
                console.warn(`[VALIDATE] Task[${i}]: URL tidak memiliki ekstensi jelas → ${task.filePath}`);
            } else {
                const allSupportedExts = [...VIDEO_EXTS, ...IMAGE_EXTS];
                if (!allSupportedExts.includes(ext)) {
                    errors.push({
                        index: i,
                        field: "filePath",
                        message: `${prefix}: Ekstensi '${ext}' tidak didukung. Gunakan mp4/jpg/png dll.`,
                    });
                }
            }
        } else {
            // Path lokal: cek file exists & ekstensi
            if (!fs.existsSync(task.filePath)) {
                errors.push({ index: i, field: "filePath", message: `${prefix}: File tidak ditemukan → ${task.filePath}` });
            } else {
                const type = getFileType(task.filePath);
                if (type === "unknown") {
                    errors.push({ index: i, field: "filePath", message: `${prefix}: Ekstensi tidak didukung. Gunakan mp4/jpg/png dll.` });
                }
            }
        }

        // ── Validasi assetId ───────────────────────────────────────
        if (!task.assetId || typeof task.assetId !== "string") {
            errors.push({ index: i, field: "assetId", message: `${prefix}: 'assetId' wajib diisi.` });
        }

        // ── Validasi caption ───────────────────────────────────────
        if (!task.caption || typeof task.caption !== "string") {
            errors.push({ index: i, field: "caption", message: `${prefix}: 'caption' wajib diisi.` });
        }

        // ── Validasi format tanggal DD/MM/YYYY ────────────────────
        if (!task.date || typeof task.date !== "string") {
            errors.push({ index: i, field: "date", message: `${prefix}: 'date' wajib diisi format DD/MM/YYYY.` });
        } else {
            const dateParts = task.date.split("/");
            if (dateParts.length !== 3) {
                errors.push({ index: i, field: "date", message: `${prefix}: Format date salah. Gunakan DD/MM/YYYY.` });
            } else {
                const [day, month, year] = dateParts.map(Number);
                const scheduledDate = new Date(year, month - 1, day, parseInt(task.hour || 0), 0, 0);
                if (isNaN(scheduledDate.getTime())) {
                    errors.push({ index: i, field: "date", message: `${prefix}: Tanggal tidak valid.` });
                } else if (scheduledDate < new Date()) {
                    errors.push({ index: i, field: "date", message: `${prefix}: Waktu jadwal sudah terlewat (${task.date} ${task.hour}:00).` });
                }
            }
        }

        // ── Validasi jam (0–23) ───────────────────────────────────
        if (task.hour === undefined || task.hour === null || task.hour === "") {
            errors.push({ index: i, field: "hour", message: `${prefix}: 'hour' wajib diisi (misal: "10" untuk jam 10).` });
        } else {
            const h = parseInt(task.hour);
            if (isNaN(h) || h < 0 || h > 23) {
                errors.push({ index: i, field: "hour", message: `${prefix}: 'hour' harus antara 0–23.` });
            }
        }
    });

    return errors;
}

module.exports = { validateTasks };