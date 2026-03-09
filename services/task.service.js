// =============================================
// services/task.service.js
// Inti otomasi: upload & jadwalkan konten di Facebook Business
// Mendukung dua tipe konten: Video (Reels) dan Image (Post)
// =============================================
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { getSessionPath } = require("../helpers/session.helper");
const { getFileType } = require("../helpers/file.helper");
const { DONE_DIR } = require("../config/app.config");

// Pastikan folder "selesai" sudah ada
if (!fs.existsSync(DONE_DIR)) fs.mkdirSync(DONE_DIR, { recursive: true });

/**
 * Jalankan satu task otomasi (upload + jadwal posting)
 * @param {string} sessionName - nama sesi yang digunakan
 * @param {object} task - { filePath, assetId, caption, date, hour, _originalUrl? }
 * @param {object} botState - state global untuk update status real-time
 *
 * Catatan: jika task berasal dari URL, task._originalUrl akan terisi
 * dan task.filePath sudah berupa path lokal temp (sudah didownload di queue.service).
 * Penghapusan file temp dilakukan di queue.service, bukan di sini.
 */
async function runTask(sessionName, task, botState) {
    const sessionPath = getSessionPath(sessionName);
    const fileName = path.basename(task.filePath);
    const fileType = getFileType(task.filePath);
    const isFromUrl = !!task._originalUrl; // flag: file berasal dari URL

    // Update status real-time
    botState.in_progress = {
        file: isFromUrl ? task._originalUrl : fileName,
        type: fileType,
        session: sessionName,
        assetId: task.assetId,
        scheduled: `${task.date} ${task.hour}:00`,
        start_time: new Date().toLocaleTimeString(),
        source: isFromUrl ? "url" : "local",
    };

    console.log(`\n[TASK] Mulai → ${fileName} (${fileType}) | Jadwal: ${task.date} ${task.hour}:00`);
    if (isFromUrl) console.log(`[TASK] Sumber: URL → ${task._originalUrl}`);

    let context = null;

    try {
        context = await chromium.launchPersistentContext(sessionPath, {
            headless: false,
            args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--no-sandbox"],
            viewport: null,
        });

        const page = await context.newPage();

        // URL composer berbeda untuk video vs gambar
        const targetUrl = fileType === "video"
            ? `https://business.facebook.com/latest/reels_composer/?ref=biz_web_home_create_reel&asset_id=${task.assetId}&context_ref=HOME`
            : `https://business.facebook.com/latest/composer/?ref=biz_web_home_create_post&asset_id=${task.assetId}&context_ref=HOME`;

        console.log(`[TASK] Menuju: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(6000);

        // ---- Proses sesuai tipe file ----
        if (fileType === "video") {
            await uploadVideo(page, task);
        } else {
            await uploadImage(page, task);
        }

        // ---- Jadwalkan posting ----
        await schedulePost(page, task, fileType);

        console.log(`[TASK] ✓ Sukses! ${fileName}`);

        // ── Pindahkan file ke /selesai HANYA jika file lokal (bukan dari URL)
        // File dari URL sudah dihandle (dihapus) oleh queue.service setelah task ini return
        if (!isFromUrl) {
            const destPath = path.join(DONE_DIR, fileName);
            await fs.promises.rename(task.filePath, destPath);
            console.log(`[TASK] File dipindahkan ke /selesai`);
        }

        return {
            success: true,
            file: isFromUrl ? task._originalUrl : fileName,
            type: fileType,
            status: "Success",
            scheduled: `${task.date} ${task.hour}:00`,
            source: isFromUrl ? "url" : "local",
            time: new Date().toLocaleTimeString(),
        };

    } catch (err) {
        console.error(`[TASK] ✗ Error: ${err.message}`);
        return {
            success: false,
            file: isFromUrl ? task._originalUrl : fileName,
            type: fileType,
            error: err.message,
            source: isFromUrl ? "url" : "local",
            time: new Date().toLocaleTimeString(),
        };

    } finally {
        if (context) {
            try { await context.close(); } catch (_) { }
        }
        botState.in_progress = null;
    }
}

// =============================================
// Flow Upload VIDEO (Reels)
// =============================================
async function uploadVideo(page, task) {
    console.log(`[TASK] Upload video...`);
    const fileChooserPromise = page.waitForEvent("filechooser");
    await page.click('text="Add video"');
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(task.filePath);

    // Isi caption
    await page.waitForSelector('div[role="textbox"]', { timeout: 30000 });
    await page.fill('div[role="textbox"]', task.caption);

    // Tunggu upload selesai (progress bar hilang)
    console.log(`[TASK] Menunggu upload selesai...`);
    await page.waitForSelector('.upload-progress', { state: 'detached', timeout: 300000 }).catch(() => {});
    await page.waitForTimeout(3000);
}

// =============================================
// Flow Upload IMAGE (Post)
// =============================================
async function uploadImage(page, task) {
    console.log(`[TASK] Upload image...`);
    const fileChooserPromise = page.waitForEvent("filechooser");

    // Coba selector satu per satu — tidak bisa dicampur CSS + text selector dalam satu string
    const clicked = await page.locator('[aria-label="Photo/video"]').first().click({ timeout: 5000 }).then(() => true).catch(() => false)
        || await page.locator('[data-testid="media-attachment-button"]').first().click({ timeout: 5000 }).then(() => true).catch(() => false)
        || await page.getByText("Photo/Video", { exact: false }).first().click({ timeout: 5000 }).then(() => true).catch(() => false)
        || await page.getByText("Add photos/videos", { exact: false }).first().click({ timeout: 5000 }).then(() => true).catch(() => false)
        || await page.getByText("Photo", { exact: true }).first().click({ timeout: 5000 }).then(() => true).catch(() => false);

    if (!clicked) {
        throw new Error("Tidak bisa menemukan tombol upload photo. Pastikan halaman composer sudah terbuka.");
    }

    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(task.filePath);

    // Isi caption
    await page.waitForSelector('div[role="textbox"]', { timeout: 30000 });
    await page.fill('div[role="textbox"]', task.caption);

    await page.waitForTimeout(3000);
}

// =============================================
// Jadwalkan Post (sama untuk video & image)
// =============================================
async function schedulePost(page, task, fileType) {
    await page.waitForSelector('text="Schedule"', { visible: true, timeout: 30000 });
    console.log(`[TASK] Pilih Schedule...`);
    await page.click('text="Schedule"');
    await page.waitForTimeout(4000);

    // Helper isi input tanggal & jam
    const fillSchedule = async (index) => {
        const dateInput = page.locator('input[placeholder="dd/mm/yyyy"]').nth(index);
        await dateInput.click();
        await page.keyboard.press("Control+A");
        await page.keyboard.type(task.date);
        await page.keyboard.press("Enter");

        const hourInput = page.locator('input[role="spinbutton"][aria-label="hours"]').nth(index);
        await hourInput.click();
        await page.keyboard.press("Control+A");
        await page.keyboard.type(String(parseInt(task.hour)));
        await page.keyboard.press("Enter");
    };

    await fillSchedule(0);
    // Isi input kedua jika ada (beberapa versi UI punya 2 input)
    if (await page.locator('input[placeholder="dd/mm/yyyy"]').count() > 1) {
        await fillSchedule(1);
    }

    // Khusus video: tunggu copyright check selesai
    if (fileType === "video") {
        console.log(`[TASK] Menunggu Copyright Check...`);
        await page.waitForSelector('text="Your video is safe to publish!"', { timeout: 120000 });
        console.log(`[TASK] Copyright OK!`);
    }

    // Klik tombol Schedule final
    console.log(`[TASK] Klik Schedule final...`);
    const scheduleBtn = page.locator('div[role="button"]:has-text("Schedule"), button:has-text("Schedule")').last();
    await scheduleBtn.click({ force: true });

    // Tunggu popup konfirmasi muncul
    console.log(`[TASK] Menunggu konfirmasi popup...`);
    await Promise.race([
        page.waitForSelector(':text("Reel scheduled")', { timeout: 60000 }),
        page.waitForSelector(':text("Post scheduled")', { timeout: 60000 }),
        page.waitForSelector(':text("scheduled")', { timeout: 60000 }),
    ]);

    await page.waitForTimeout(2000);

    // Klik Done jika tombol tersedia
    const doneBtn = page.locator('button:has-text("Done"), div[role="button"]:has-text("Done")');
    if (await doneBtn.isVisible()) await doneBtn.click();
}

module.exports = { runTask };