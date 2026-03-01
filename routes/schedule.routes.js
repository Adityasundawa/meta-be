// =============================================
// routes/schedule.routes.js
// Endpoint penjadwalan konten ke Facebook Business
//
// POST /schedule → Masukkan batch task ke antrian global
// =============================================
const express = require("express");
const router = express.Router();

const { validateTasks } = require("../helpers/validation.helper");
const { verifyAssetId } = require("../services/asset.service");
const { enqueueBatch, globalQueue, botState } = require("../services/queue.service");
const { API_PORT } = require("../config/app.config");

// ---- POST /schedule ----
// Validasi → Verifikasi assetId → Masuk antrian → Proses background
//
// Body:
// {
//   "sessionName": "akun_nomor_1",
//   "tasks": [
//     {
//       "assetId": "123456789",
//       "filePath": "/path/ke/file/video.mp4",
//       "caption": "Caption konten ini\n👤 Emoji aman",
//       "date": "28/02/2026",
//       "hour": "10"
//     }
//   ]
// }
router.post("/schedule", async (req, res) => {
    const { sessionName, tasks } = req.body;

    // Validasi input dasar
    if (!sessionName || typeof sessionName !== "string") {
        return res.status(400).json({ status: "Error", message: "Field 'sessionName' wajib diisi." });
    }
    if (!Array.isArray(tasks) || tasks.length === 0) {
        return res.status(400).json({ status: "Error", message: "Field 'tasks' wajib berupa array dan tidak boleh kosong." });
    }

    // Validasi format semua task + cek sesi
    const errors = validateTasks(sessionName, tasks);
    if (errors.length > 0) {
        return res.status(422).json({
            status: "Rejected",
            message: "Antrean ditolak karena ada data tidak valid.",
            total_errors: errors.length,
            errors,
        });
    }

    // Verifikasi assetId ke Facebook (unique agar efisien)
    const uniqueAssetIds = [...new Set(tasks.map((t) => t.assetId))];
    console.log(`[SCHEDULE] Verifikasi ${uniqueAssetIds.length} assetId untuk sesi '${sessionName}'...`);

    const assetErrors = [];
    for (const assetId of uniqueAssetIds) {
        const verifyResult = await verifyAssetId(sessionName, assetId);
        if (!verifyResult.valid) {
            assetErrors.push({ field: "assetId", assetId, message: verifyResult.reason });
        } else {
            console.log(`[SCHEDULE] ✓ AssetId valid: ${assetId}`);
        }
    }

    if (assetErrors.length > 0) {
        return res.status(422).json({
            status: "Rejected",
            message: "Antrean ditolak karena ada assetId tidak valid.",
            total_errors: assetErrors.length,
            errors: assetErrors,
        });
    }

    // Hitung posisi antrian
    const queuePosition = globalQueue.length + (botState.is_processing ? 1 : 0) + 1;
    const batchId = `${sessionName}_${Date.now()}`;

    // Langsung balas ke client tanpa menunggu proses selesai
    res.status(202).json({
        status: "Queued",
        batchId,
        session: sessionName,
        total_tasks: tasks.length,
        queue_position: queuePosition,
        message: queuePosition === 1
            ? `Batch langsung diproses (tidak ada antrian).`
            : `Batch masuk antrian posisi ${queuePosition}. Menunggu giliran.`,
        realtime_status: `http://localhost:${API_PORT}/status`,
    });

    // Proses di background
    enqueueBatch(sessionName, tasks).then((result) => {
        if (result.success) {
            console.log(`[SCHEDULE] Batch '${batchId}' selesai semua sukses.`);
        } else {
            console.error(`[SCHEDULE] Batch '${batchId}' berhenti karena ada task gagal.`);
        }
    });
});

module.exports = router;
