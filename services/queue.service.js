// =============================================
// services/queue.service.js
// Manajemen antrian global semua sesi
// Task diproses satu per satu secara berurutan
// =============================================
const path = require("path");
const { runTask } = require("./task.service");
const { isUrl, downloadFile, deleteTempFile } = require("../helpers/download.helper");

// ---- State antrian global ----
const globalQueue = [];
let isProcessing = false;

// ---- State real-time (diakses oleh GET /status) ----
const botState = {
    is_processing: false,
    total_in_queue: 0,
    queue_summary: [],
    current_batch: null,
    in_progress: null,
    history: [],
};

/**
 * Tambahkan batch ke antrian dan tunggu giliran diproses
 * @returns Promise yang resolve setelah batch selesai
 */
function enqueueBatch(sessionName, tasks) {
    return new Promise((resolve, reject) => {
        const batchId = `${sessionName}_${Date.now()}`;
        globalQueue.push({ batchId, sessionName, tasks, resolve, reject });
        updateQueueState();
        console.log(`[QUEUE] Batch '${batchId}' masuk antrian. Posisi: ${globalQueue.length}`);
        processNextBatch();
    });
}

/**
 * Sinkronisasi botState dengan kondisi antrian saat ini
 */
function updateQueueState() {
    botState.total_in_queue = globalQueue.length;
    botState.queue_summary = globalQueue.map((entry, idx) => ({
        position: idx + 1,
        batchId: entry.batchId,
        session: entry.sessionName,
        total_tasks: entry.tasks.length,
        files: entry.tasks.map((t) => {
            // Tampilkan nama file atau bagian akhir URL
            if (isUrl(t.filePath)) {
                try { return new URL(t.filePath).pathname.split("/").pop() || t.filePath; }
                catch (_) { return t.filePath; }
            }
            return path.basename(t.filePath);
        }),
    }));
}

/**
 * Proses batch berikutnya dari antrian (jika tidak ada yang berjalan)
 */
async function processNextBatch() {
    if (isProcessing || globalQueue.length === 0) return;

    isProcessing = true;
    const entry = globalQueue.shift();
    updateQueueState();

    botState.is_processing = true;
    botState.current_batch = {
        batchId: entry.batchId,
        session: entry.sessionName,
        total_tasks: entry.tasks.length,
        completed: 0,
        failed: null,
        start_time: new Date().toLocaleTimeString(),
    };

    console.log(`\n[QUEUE] Mulai proses batch '${entry.batchId}' (${entry.tasks.length} task)...`);

    let batchSuccess = true;
    const batchResults = [];

    for (let i = 0; i < entry.tasks.length; i++) {
        const task = entry.tasks[i];
        let tempFilePath = null; // path temp hasil download, null jika pakai lokal

        // ── Download file jika filePath adalah URL ─────────────────
        if (isUrl(task.filePath)) {
            const originalUrl = task.filePath;
            console.log(`[QUEUE] Task[${i}] filePath adalah URL, mulai download...`);
            console.log(`[QUEUE] URL → ${originalUrl}`);

            try {
                tempFilePath = await downloadFile(originalUrl);
                task.filePath = tempFilePath; // ganti ke path lokal sementara
                task._originalUrl = originalUrl; // simpan URL asli untuk logging
                console.log(`[QUEUE] Download selesai → ${path.basename(tempFilePath)}`);
            } catch (downloadErr) {
                console.error(`[QUEUE] Gagal download: ${downloadErr.message}`);
                batchResults.push({
                    file: originalUrl,
                    success: false,
                    error: `Download gagal: ${downloadErr.message}`,
                    time: new Date().toLocaleTimeString(),
                });
                batchSuccess = false;
                botState.current_batch.failed = { file: originalUrl, error: downloadErr.message };
                console.error(`[QUEUE] Task gagal (download error) → stop batch '${entry.batchId}'`);
                break;
            }
        }

        // ── Jalankan task ──────────────────────────────────────────
        const result = await runTask(entry.sessionName, task, botState);

        // ── Hapus file temp setelah task selesai (sukses/gagal) ───
        if (tempFilePath) {
            deleteTempFile(tempFilePath);
        }

        batchResults.push({
            file: task._originalUrl || path.basename(task.filePath),
            ...result,
        });

        // Jika task gagal → hentikan batch
        if (!result.success) {
            batchSuccess = false;
            botState.current_batch.failed = {
                file: task._originalUrl || path.basename(task.filePath),
                error: result.error,
            };
            console.error(`[QUEUE] Task gagal → stop batch '${entry.batchId}'`);
            break;
        }

        botState.current_batch.completed = i + 1;

        // Jeda antar task (kecuali task terakhir)
        if (i < entry.tasks.length - 1) {
            console.log(`[QUEUE] Jeda 5 detik sebelum task berikutnya...`);
            await new Promise((r) => setTimeout(r, 5000));
        }
    }

    // Simpan hasil ke history
    botState.history.push({
        batchId: entry.batchId,
        session: entry.sessionName,
        status: batchSuccess ? "Success" : "Failed",
        results: batchResults,
        end_time: new Date().toLocaleTimeString(),
    });

    // Reset state
    botState.current_batch = null;
    botState.in_progress = null;
    isProcessing = false;
    botState.is_processing = globalQueue.length > 0;
    updateQueueState();

    console.log(`[QUEUE] Batch '${entry.batchId}' selesai. Sisa antrian: ${globalQueue.length}`);

    // Resolve promise ke route handler
    entry.resolve({ success: batchSuccess, results: batchResults });

    // Proses batch berikutnya jika ada
    processNextBatch();
}

module.exports = { enqueueBatch, botState, globalQueue, isProcessing: () => isProcessing };