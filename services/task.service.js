// =============================================
// services/task.service.js
// Inti otomasi: upload & jadwalkan konten di Facebook Business
// Mendukung dua tipe konten: Video (Reels) dan Image (Post)
// UPDATED: Full fix untuk UI Facebook Business terbaru
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
 */
async function runTask(sessionName, task, botState) {
    const sessionPath = getSessionPath(sessionName);
    const fileName = path.basename(task.filePath);
    const fileType = getFileType(task.filePath);
    const isFromUrl = !!task._originalUrl;

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
            await uploadVideoReels(page, task);
        } else {
            await uploadImage(page, task);
        }

        // ---- Jadwalkan posting ----
        await schedulePost(page, task, fileType);

        console.log(`[TASK] ✓ Sukses! ${fileName}`);

        // Pindahkan file ke /selesai HANYA jika file lokal (bukan dari URL)
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
// Flow Upload VIDEO (Reels) - Multi-step UI
// Step: Create → Edit → Share
// =============================================
async function uploadVideoReels(page, task) {
    console.log(`[TASK] Upload video...`);
    
    // Setup file chooser listener
    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 30000 });
    
    // Klik tombol Add video
    const addVideoSelectors = [
        'text="Add video"',
        'text="Tambah video"',
        '[aria-label="Add video"]',
        'button:has-text("Add")',
    ];
    
    let clicked = false;
    for (const sel of addVideoSelectors) {
        try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 3000 })) {
                await btn.click();
                clicked = true;
                console.log(`[TASK] ✓ Klik: ${sel}`);
                break;
            }
        } catch (_) {}
    }
    
    if (!clicked) {
        throw new Error("Tombol 'Add video' tidak ditemukan");
    }
    
    // Set file
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(task.filePath);
    console.log(`[TASK] ✓ File dipilih`);

    // Tunggu upload selesai
    console.log(`[TASK] Menunggu upload selesai...`);
    await page.waitForFunction(() => {
        const progressText = document.body.innerText;
        return progressText.includes('100%') || !document.querySelector('[role="progressbar"]');
    }, { timeout: 300000 }).catch(() => {});
    
    await page.waitForTimeout(3000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Isi caption
    console.log(`[TASK] Mengisi caption...`);
    await page.waitForSelector('div[role="textbox"]', { timeout: 30000 });
    
    const textbox = page.locator('div[role="textbox"]').first();
    await textbox.click();
    await page.waitForTimeout(500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await textbox.fill(task.caption);
    await page.waitForTimeout(1000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // ════════════════════════════════════════════
    // NAVIGASI: Create → Edit → Share
    // ════════════════════════════════════════════
    console.log(`[TASK] Navigasi ke step berikutnya...`);
    await clickNextButton(page);
    await clickNextButton(page);
    console.log(`[TASK] ✓ Sudah di step Share`);
}

// =============================================
// Helper: Klik tombol Next
// =============================================
async function clickNextButton(page) {
    const nextSelectors = [
        'button:has-text("Next")',
        'div[role="button"]:has-text("Next")',
        'button:has-text("Berikutnya")',
        'div[role="button"]:has-text("Berikutnya")',
        '[aria-label="Next"]',
        '[aria-label="Berikutnya"]',
    ];
    
    let clicked = false;
    
    for (const sel of nextSelectors) {
        try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 5000 })) {
                const isDisabled = await btn.getAttribute('aria-disabled');
                if (isDisabled === 'true') {
                    console.log(`[TASK] Tombol Next disabled, menunggu...`);
                    await page.waitForTimeout(3000);
                }
                
                await btn.click();
                clicked = true;
                console.log(`[TASK] ✓ Klik Next berhasil`);
                await page.waitForTimeout(3000);
                break;
            }
        } catch (_) {}
    }
    
    if (!clicked) {
        const screenshotPath = `debug_next_not_found_${Date.now()}.png`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[TASK] ⚠ Tombol Next tidak ditemukan. Screenshot: ${screenshotPath}`);
    }
}

// =============================================
// Flow Upload IMAGE (Post)
// Selector: <a role="link" aria-label="Select adding photos.">
// =============================================
async function uploadImage(page, task) {
    console.log(`[TASK] Upload image...`);
    
    await page.waitForTimeout(3000);
    
    // Screenshot awal
    const debugStart = `debug_image_start_${Date.now()}.png`;
    await page.screenshot({ path: debugStart, fullPage: true });
    console.log(`[TASK] Screenshot awal: ${debugStart}`);
    
    let uploadSuccess = false;
    
    // Selector berdasarkan HTML aktual
    const addPhotoSelectors = [
        'a[aria-label="Select adding photos."]',
        '[aria-label="Select adding photos."]',
        'a[role="link"]:has-text("Add Photo")',
        '[role="link"]:has-text("Add Photo")',
        'a:has-text("Add Photo")',
        'div:has-text("Add Photo") >> a',
    ];
    
    console.log(`[TASK] Mencari tombol Add Photo...`);
    
    for (const sel of addPhotoSelectors) {
        if (uploadSuccess) break;
        
        try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 3000 })) {
                console.log(`[TASK] ✓ Ditemukan: ${sel}`);
                
                // Setup file chooser listener SEBELUM klik
                const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 20000 });
                
                // Klik dengan force
                await btn.click({ force: true });
                console.log(`[TASK] ✓ Klik berhasil`);
                
                try {
                    const fileChooser = await fileChooserPromise;
                    await fileChooser.setFiles(task.filePath);
                    console.log(`[TASK] ✓ File dipilih: ${task.filePath}`);
                    uploadSuccess = true;
                } catch (fcError) {
                    console.log(`[TASK] File chooser timeout, mencoba metode lain...`);
                }
                
                break;
            }
        } catch (e) {
            console.log(`[TASK] Selector ${sel} tidak ditemukan`);
        }
    }
    
    // FALLBACK: Langsung set ke input[type="file"]
    if (!uploadSuccess) {
        console.log(`[TASK] Mencoba set file langsung ke input[type="file"]...`);
        
        try {
            await page.waitForTimeout(2000);
            
            const fileInputs = page.locator('input[type="file"]');
            const count = await fileInputs.count();
            console.log(`[TASK] Ditemukan ${count} input[type="file"]`);
            
            if (count > 0) {
                await fileInputs.first().setInputFiles(task.filePath);
                console.log(`[TASK] ✓ File di-set langsung ke input[type="file"]`);
                uploadSuccess = true;
            }
        } catch (e) {
            console.log(`[TASK] Set file langsung gagal: ${e.message}`);
        }
    }
    
    // FALLBACK 2: Klik via JavaScript
    if (!uploadSuccess) {
        console.log(`[TASK] Mencoba klik via JavaScript...`);
        
        try {
            await page.evaluate(() => {
                const addPhotoLink = document.querySelector('a[aria-label="Select adding photos."]') 
                    || document.querySelector('[aria-label="Select adding photos."]');
                    
                if (addPhotoLink) {
                    addPhotoLink.click();
                    return true;
                }
                
                const allLinks = document.querySelectorAll('a[role="link"]');
                for (const link of allLinks) {
                    if (link.textContent.includes('Add Photo')) {
                        link.click();
                        return true;
                    }
                }
                
                return false;
            });
            
            await page.waitForTimeout(2000);
            
            const fileInputs = page.locator('input[type="file"]');
            if (await fileInputs.count() > 0) {
                await fileInputs.first().setInputFiles(task.filePath);
                console.log(`[TASK] ✓ File di-set setelah klik via JS`);
                uploadSuccess = true;
            }
        } catch (e) {
            console.log(`[TASK] Metode JS gagal: ${e.message}`);
        }
    }
    
    // Screenshot setelah percobaan
    const debugAfter = `debug_after_upload_attempt_${Date.now()}.png`;
    await page.screenshot({ path: debugAfter, fullPage: true });
    console.log(`[TASK] Screenshot: ${debugAfter}`);
    
    if (!uploadSuccess) {
        throw new Error(`Gagal upload image. Cek screenshot: ${debugAfter}`);
    }
    
    // Tunggu upload selesai
    console.log(`[TASK] Menunggu upload selesai...`);
    await page.waitForTimeout(5000);
    
    // Verifikasi gambar sudah terupload
    try {
        await page.waitForFunction(() => {
            const imgs = document.querySelectorAll('img[src*="blob:"], img[src*="facebook"], img[src*="scontent"]');
            return imgs.length > 1;
        }, { timeout: 30000 });
        console.log(`[TASK] ✓ Image preview terdeteksi`);
    } catch (_) {
        console.log(`[TASK] ⚠ Preview tidak terdeteksi, lanjut...`);
    }
    
    await page.waitForTimeout(2000);

    // Isi caption
    console.log(`[TASK] Mengisi caption...`);
    
    const textboxSelectors = [
        'div[role="textbox"]',
        'textarea',
        '[contenteditable="true"]',
    ];
    
    for (const sel of textboxSelectors) {
        try {
            const textbox = page.locator(sel).first();
            if (await textbox.isVisible({ timeout: 3000 })) {
                await textbox.click();
                await page.waitForTimeout(500);
                await textbox.fill(task.caption);
                console.log(`[TASK] ✓ Caption diisi`);
                break;
            }
        } catch (_) {}
    }
    
    await page.waitForTimeout(1000);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    
    console.log(`[TASK] ✓ Upload image selesai`);
}

// =============================================
// Helper: Isi input tanggal dengan benar
// Format: dd/mm/yyyy (contoh: "02/04/2026")
// =============================================
async function fillDateInput(page, dateString) {
    console.log(`[TASK] Mengisi tanggal: ${dateString}`);
    
    const dateSelectors = [
        'input[placeholder*="dd/mm/yyyy"]',
        'input[placeholder*="DD/MM/YYYY"]',
        'input[placeholder*="mm/dd/yyyy"]',
        'input[placeholder*="dd"]',
        'input[type="text"][aria-label*="date" i]',
        'input[aria-label*="Date" i]',
    ];
    
    for (const sel of dateSelectors) {
        try {
            const dateInput = page.locator(sel).first();
            if (await dateInput.isVisible({ timeout: 3000 })) {
                // Triple click untuk select all
                await dateInput.click({ clickCount: 3 });
                await page.waitForTimeout(200);
                
                // Clear
                await page.keyboard.press("Backspace");
                await page.waitForTimeout(200);
                
                // Klik lagi untuk fokus
                await dateInput.click();
                await page.waitForTimeout(200);
                
                // Ketik karakter per karakter
                for (const char of dateString) {
                    await page.keyboard.type(char, { delay: 50 });
                }
                
                await page.waitForTimeout(500);
                await page.keyboard.press("Tab");
                
                console.log(`[TASK] ✓ Tanggal diisi: ${dateString}`);
                return true;
            }
        } catch (e) {
            console.log(`[TASK] Error isi tanggal dengan ${sel}: ${e.message}`);
        }
    }
    
    console.log(`[TASK] ⚠ Input tanggal tidak ditemukan`);
    return false;
}

// =============================================
// Helper: Isi input jam dengan benar
// Format: hour = "14" (24 jam), minute = "00"
// =============================================
async function fillTimeInput(page, hour, minute = "00") {
    const hourStr = String(parseInt(hour)).padStart(2, '0');
    const minuteStr = String(parseInt(minute)).padStart(2, '0');
    
    console.log(`[TASK] Mengisi waktu: ${hourStr}:${minuteStr}`);
    
    // Isi jam
    const hourSelectors = [
        'input[role="spinbutton"][aria-label*="hour" i]',
        'input[role="spinbutton"][aria-label*="jam" i]',
        'input[aria-label*="hour" i]',
        'input[role="spinbutton"][aria-label="hours"]',
    ];
    
    let hourFound = false;
    for (const sel of hourSelectors) {
        try {
            const hourInput = page.locator(sel).first();
            if (await hourInput.isVisible({ timeout: 3000 })) {
                await hourInput.click({ clickCount: 3 });
                await page.waitForTimeout(200);
                await page.keyboard.press("Backspace");
                await page.waitForTimeout(200);
                await hourInput.click();
                
                for (const char of hourStr) {
                    await page.keyboard.type(char, { delay: 50 });
                }
                
                await page.waitForTimeout(300);
                console.log(`[TASK] ✓ Jam diisi: ${hourStr}`);
                hourFound = true;
                break;
            }
        } catch (e) {}
    }
    
    if (!hourFound) {
        console.log(`[TASK] ⚠ Input jam tidak ditemukan`);
    }
    
    // Isi menit
    const minuteSelectors = [
        'input[role="spinbutton"][aria-label*="minute" i]',
        'input[role="spinbutton"][aria-label*="menit" i]',
        'input[aria-label*="minute" i]',
        'input[role="spinbutton"][aria-label="minutes"]',
    ];
    
    for (const sel of minuteSelectors) {
        try {
            const minuteInput = page.locator(sel).first();
            if (await minuteInput.isVisible({ timeout: 2000 })) {
                await minuteInput.click({ clickCount: 3 });
                await page.waitForTimeout(200);
                await page.keyboard.press("Backspace");
                await page.waitForTimeout(200);
                await minuteInput.click();
                
                for (const char of minuteStr) {
                    await page.keyboard.type(char, { delay: 50 });
                }
                
                await page.waitForTimeout(300);
                console.log(`[TASK] ✓ Menit diisi: ${minuteStr}`);
                break;
            }
        } catch (e) {}
    }
    
    await page.keyboard.press("Tab");
    return true;
}

// =============================================
// Jadwalkan Post - Support VIDEO dan IMAGE
// VIDEO: Share now dropdown → Schedule
// IMAGE: Toggle "Set date and time" → Isi jadwal → Publish
// FIXED: Cek toggle status sebelum klik (tidak double click)
// =============================================
async function schedulePost(page, task, fileType) {
    console.log(`[TASK] Memulai proses schedule...`);
    console.log(`[TASK] Data jadwal: tanggal=${task.date}, jam=${task.hour}`);
    
    await page.waitForTimeout(3000);
    
    // Screenshot sebelum schedule
    const debugBefore = `debug_before_schedule_${Date.now()}.png`;
    await page.screenshot({ path: debugBefore, fullPage: true });
    console.log(`[TASK] Screenshot: ${debugBefore}`);
    
    // ════════════════════════════════════════════
    // UNTUK IMAGE POST
    // ════════════════════════════════════════════
    if (fileType === "image") {
        console.log(`[TASK] Mode: Image Post`);
        
        // Scroll untuk lihat section Schedule
        await page.evaluate(() => window.scrollTo(0, 500));
        await page.waitForTimeout(1000);
        
        // Cek apakah sudah ada section "Schedule" visible
        const scheduleSection = page.locator('text="Schedule"').first();
        const scheduleVisible = await scheduleSection.isVisible({ timeout: 2000 }).catch(() => false);
        
        if (!scheduleVisible) {
            // Cari dan klik dropdown menu
            console.log(`[TASK] Mencari dropdown menu...`);
            
            const dropdownSelectors = [
                '[aria-haspopup="menu"]',
                '[aria-haspopup="listbox"]',
            ];
            
            for (const sel of dropdownSelectors) {
                try {
                    const dropdown = page.locator(sel).first();
                    if (await dropdown.isVisible({ timeout: 2000 })) {
                        await dropdown.click();
                        console.log(`[TASK] ✓ Klik dropdown`);
                        await page.waitForTimeout(1500);
                        
                        // Pilih Schedule dari menu
                        const scheduleOpt = page.locator('text="Schedule"').first();
                        if (await scheduleOpt.isVisible({ timeout: 2000 })) {
                            await scheduleOpt.click();
                            console.log(`[TASK] ✓ Pilih Schedule dari dropdown`);
                            await page.waitForTimeout(2000);
                        }
                        break;
                    }
                } catch (e) {}
            }
        }
        
        // ════════════════════════════════════════════
        // KLIK TOGGLE "Set date and time" - HANYA JIKA BELUM ON
        // FIX: Cek aria-checked dulu sebelum klik
        // ════════════════════════════════════════════
        console.log(`[TASK] Mencari toggle "Set date and time"...`);
        
        let toggleHandled = false;
        
        const toggleSelectors = [
            '[role="switch"]',
            'div:has-text("Set date and time") [role="switch"]',
        ];
        
        for (const sel of toggleSelectors) {
            try {
                const toggle = page.locator(sel).first();
                if (await toggle.isVisible({ timeout: 3000 })) {
                    // CEK STATUS TOGGLE DULU!
                    const isChecked = await toggle.getAttribute('aria-checked');
                    console.log(`[TASK] Toggle aria-checked = ${isChecked}`);
                    
                    if (isChecked === 'true') {
                        // SUDAH ON - JANGAN KLIK!
                        console.log(`[TASK] ✓ Toggle sudah ON, skip klik`);
                        toggleHandled = true;
                    } else {
                        // BELUM ON - KLIK UNTUK ON-KAN
                        await toggle.click({ force: true });
                        console.log(`[TASK] ✓ Toggle diklik untuk ON`);
                        toggleHandled = true;
                        await page.waitForTimeout(2000);
                    }
                    break;
                }
            } catch (e) {
                console.log(`[TASK] Error cek toggle: ${e.message}`);
            }
        }
        
        // Fallback: klik toggle via koordinat HANYA jika toggle belum ditemukan
        if (!toggleHandled) {
            console.log(`[TASK] Toggle tidak ditemukan, mencoba via koordinat...`);
            try {
                const setDateText = page.locator('text="Set date and time"').first();
                if (await setDateText.isVisible({ timeout: 2000 })) {
                    const box = await setDateText.boundingBox();
                    if (box) {
                        await page.mouse.click(box.x + box.width + 50, box.y + box.height / 2);
                        console.log(`[TASK] ✓ Toggle diklik via koordinat`);
                        toggleHandled = true;
                        await page.waitForTimeout(2000);
                    }
                }
            } catch (e) {}
        }
        
        // Screenshot setelah toggle
        const debugAfterToggle = `debug_after_toggle_${Date.now()}.png`;
        await page.screenshot({ path: debugAfterToggle, fullPage: true });
        console.log(`[TASK] Screenshot setelah toggle: ${debugAfterToggle}`);
        
        if (!toggleHandled) {
            throw new Error(`Toggle "Set date and time" tidak ditemukan. Cek screenshot: ${debugAfterToggle}`);
        }
        
        // ════════════════════════════════════════════
        // ISI TANGGAL DAN JAM
        // ════════════════════════════════════════════
        await page.waitForTimeout(2000);
        
        // Isi tanggal
        const dateSuccess = await fillDateInput(page, task.date);
        
        if (!dateSuccess) {
            console.log(`[TASK] Mencoba alternatif isi tanggal...`);
            try {
                const allInputs = page.locator('input[type="text"], input[placeholder]');
                const count = await allInputs.count();
                
                for (let i = 0; i < count; i++) {
                    const input = allInputs.nth(i);
                    const placeholder = await input.getAttribute('placeholder');
                    
                    if (placeholder && (placeholder.toLowerCase().includes('dd') || placeholder.toLowerCase().includes('mm'))) {
                        await input.click({ clickCount: 3 });
                        await page.keyboard.press("Backspace");
                        await input.click();
                        
                        for (const char of task.date) {
                            await page.keyboard.type(char, { delay: 50 });
                        }
                        
                        await page.keyboard.press("Tab");
                        console.log(`[TASK] ✓ Tanggal diisi via alternatif`);
                        break;
                    }
                }
            } catch (e) {}
        }
        
        await page.waitForTimeout(500);
        
        // Isi jam
        await fillTimeInput(page, task.hour, "00");
        
        // Screenshot setelah isi jadwal
        const debugScheduleFilled = `debug_schedule_filled_${Date.now()}.png`;
        await page.screenshot({ path: debugScheduleFilled, fullPage: true });
        console.log(`[TASK] Screenshot jadwal terisi: ${debugScheduleFilled}`);
        
        // ════════════════════════════════════════════
        // KLIK TOMBOL PUBLISH
        // ════════════════════════════════════════════
        console.log(`[TASK] Klik Publish untuk schedule...`);
        await page.waitForTimeout(1000);
        
        const publishBtn = page.locator('button:has-text("Publish")').last();
        if (await publishBtn.isVisible({ timeout: 3000 })) {
            await publishBtn.click({ force: true });
            console.log(`[TASK] ✓ Klik Publish`);
        } else {
            console.log(`[TASK] ⚠ Tombol Publish tidak ditemukan`);
        }
    }
    
    // ════════════════════════════════════════════
    // UNTUK VIDEO (Reels)
    // ════════════════════════════════════════════
    if (fileType === "video") {
        console.log(`[TASK] Mode: Video/Reels`);
        
        const shareDropdownSelectors = [
            'div[role="button"]:has-text("Share now")',
            'button:has-text("Share now")',
            'div[role="button"]:has-text("Bagikan sekarang")',
        ];
        
        let scheduleFound = false;
        
        for (const sel of shareDropdownSelectors) {
            try {
                const element = page.locator(sel).first();
                if (await element.isVisible({ timeout: 3000 })) {
                    await element.click({ force: true });
                    console.log(`[TASK] ✓ Klik: ${sel}`);
                    await page.waitForTimeout(2000);
                    
                    const scheduleOption = page.locator('div[role="option"]:has-text("Schedule"), text="Schedule"').first();
                    if (await scheduleOption.isVisible({ timeout: 3000 })) {
                        await scheduleOption.click({ force: true });
                        console.log(`[TASK] ✓ Pilih Schedule`);
                        scheduleFound = true;
                    }
                    break;
                }
            } catch (_) {}
        }
        
        if (!scheduleFound) {
            try {
                const scheduleBtn = page.locator('text="Schedule"').first();
                if (await scheduleBtn.isVisible({ timeout: 3000 })) {
                    await scheduleBtn.click({ force: true });
                    scheduleFound = true;
                }
            } catch (_) {}
        }
        
        if (!scheduleFound) {
            const screenshotPath = `debug_schedule_not_found_${Date.now()}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            throw new Error(`Tombol Schedule tidak ditemukan. Cek screenshot: ${screenshotPath}`);
        }
        
        await page.waitForTimeout(3000);
        
        await fillDateInput(page, task.date);
        await page.waitForTimeout(500);
        await fillTimeInput(page, task.hour, "00");
        
        console.log(`[TASK] Menunggu Copyright Check...`);
        try {
            await Promise.race([
                page.waitForSelector('text="Your video is safe to publish!"', { timeout: 120000 }),
                page.waitForSelector('text="Video Anda aman"', { timeout: 120000 }),
                page.waitForSelector('text="No issues found"', { timeout: 120000 }),
            ]);
            console.log(`[TASK] ✓ Copyright OK!`);
        } catch (_) {
            console.log(`[TASK] ⚠ Copyright check timeout, lanjut...`);
        }
        
        console.log(`[TASK] Klik Schedule final...`);
        const scheduleFinalBtn = page.locator('button:has-text("Schedule"), div[role="button"]:has-text("Schedule")').last();
        if (await scheduleFinalBtn.isVisible({ timeout: 3000 })) {
            await scheduleFinalBtn.click({ force: true });
            console.log(`[TASK] ✓ Klik Schedule`);
        }
    }

    // ════════════════════════════════════════════
    // TUNGGU KONFIRMASI
    // ════════════════════════════════════════════
    console.log(`[TASK] Menunggu konfirmasi...`);
    
    try {
        await page.waitForFunction(() => {
            const body = document.body.innerText;
            const stillLoading = body.includes('Publishing your post') 
                || body.includes('Publishing') 
                || body.includes('Scheduling') 
                || body.includes('This may take');
            return !stillLoading;
        }, { timeout: 120000 });
        console.log(`[TASK] ✓ Loading selesai`);
    } catch (_) {
        console.log(`[TASK] ⚠ Timeout menunggu loading`);
    }
    
    await page.waitForTimeout(5000);
    
    // Screenshot final
    const debugFinal = `debug_final_${Date.now()}.png`;
    await page.screenshot({ path: debugFinal, fullPage: true });
    console.log(`[TASK] Screenshot final: ${debugFinal}`);
    
    // Cek konfirmasi sukses
    const successSelectors = [
        'text="Post scheduled"',
        'text="Reel scheduled"',
        'text="scheduled"',
        'text="Your post has been scheduled"',
        'text="Your reel has been scheduled"',
        'button:has-text("View scheduled")',
        'button:has-text("Done")',
    ];
    
    let confirmed = false;
    for (const sel of successSelectors) {
        try {
            if (await page.locator(sel).isVisible({ timeout: 5000 })) {
                console.log(`[TASK] ✓ Konfirmasi: ${sel}`);
                confirmed = true;
                break;
            }
        } catch (_) {}
    }
    
    // Cek apakah masuk DRAFT (harus dihindari!)
    const draftIndicators = [
        'text="Saved as draft"',
        'text="Draft saved"',
        'text="saved to drafts"',
    ];
    
    for (const sel of draftIndicators) {
        try {
            if (await page.locator(sel).isVisible({ timeout: 2000 })) {
                throw new Error(`Post masuk Draft, bukan Schedule! Cek screenshot: ${debugFinal}`);
            }
        } catch (e) {
            if (e.message.includes('Draft')) throw e;
        }
    }
    
    if (!confirmed) {
        console.log(`[TASK] ⚠ Konfirmasi tidak terdeteksi secara eksplisit`);
    }

    // Klik Done jika ada
    try {
        const doneBtn = page.locator('button:has-text("Done"), div[role="button"]:has-text("Done")').first();
        if (await doneBtn.isVisible({ timeout: 5000 })) {
            await doneBtn.click({ force: true });
            console.log(`[TASK] ✓ Klik Done`);
        }
    } catch (_) {}
    
    console.log(`[TASK] ✓ Proses schedule selesai untuk jadwal: ${task.date} ${task.hour}:00`);
}

module.exports = { runTask };