// =============================================
// routes/auth.routes.js
// Endpoint login sesi Facebook Business
//
// POST /login-meta     → Login manual (buka browser visible)
// POST /login-cookies  → Login via cookies dari Cookie Editor
// =============================================
const express = require("express");
const fs = require("fs");
const { chromium } = require("playwright");
const router = express.Router();

const { getSessionPath, isSessionLocked } = require("../helpers/session.helper");

// ---- POST /login-meta → Login Manual ----
// Buka browser yang terlihat, user login sendiri, lalu tutup browser
// Body: { "sessionName": "akun_nomor_1" }
router.post("/login-meta", async (req, res) => {
    const { sessionName } = req.body;

    if (!sessionName?.trim()) {
        return res.status(400).json({ status: "Error", message: "Field 'sessionName' wajib diisi." });
    }

    const cleanName = sessionName.trim();
    const sessionPath = getSessionPath(cleanName);

    if (isSessionLocked(cleanName)) {
        return res.status(423).json({
            status: "Locked",
            sessionName: cleanName,
            message: `Sesi '${cleanName}' sedang terbuka. Tutup browser tersebut terlebih dahulu.`,
        });
    }

    if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
        console.log(`[LOGIN-MANUAL] Folder sesi dibuat: ${sessionPath}`);
    }

    console.log(`[LOGIN-MANUAL] Membuka browser untuk sesi: '${cleanName}'`);
    let context = null;

    try {
        context = await chromium.launchPersistentContext(sessionPath, {
            headless: false,
            args: ["--disable-blink-features=AutomationControlled", "--start-maximized", "--no-sandbox"],
            viewport: null,
        });

        const page = await context.newPage();
        await page.goto("https://business.facebook.com/", { waitUntil: "networkidle", timeout: 60000 });

        res.status(200).json({
            status: "Browser Opened",
            method: "manual",
            sessionName: cleanName,
            sessionPath,
            message: "Browser berhasil dibuka. Silakan login manual. TUTUP browser untuk menyimpan sesi.",
            next_step: "Gunakan GET /check-session untuk verifikasi setelah browser ditutup.",
        });

        context.on("close", () => {
            console.log(`[LOGIN-MANUAL] Browser '${cleanName}' ditutup. Sesi tersimpan.`);
            context = null;
        });

    } catch (err) {
        console.error(`[LOGIN-MANUAL] Error '${cleanName}':`, err.message);
        if (context) { try { await context.close(); } catch (_) { } }
        if (!res.headersSent) {
            res.status(500).json({ status: "Error", message: "Gagal membuka browser.", detail: err.message });
        }
    }
});

// ---- POST /login-cookies → Login via Cookies ----
// Inject cookies dari Cookie Editor, verifikasi login, lalu tutup browser otomatis
// Body: { "sessionName": "akun_nomor_1", "cookies": [...] }
router.post("/login-cookies", async (req, res) => {
    const { sessionName, cookies } = req.body;

    if (!sessionName?.trim()) {
        return res.status(400).json({ status: "Error", message: "Field 'sessionName' wajib diisi." });
    }
    if (!Array.isArray(cookies) || cookies.length === 0) {
        return res.status(400).json({
            status: "Error",
            message: "Field 'cookies' wajib berupa Array JSON dari Cookie Editor.",
            contoh_format: [
                { name: "c_user", value: "123456789", domain: ".facebook.com", path: "/", secure: true, httpOnly: true, sameSite: "None", expirationDate: 1999999999 }
            ],
        });
    }

    const cleanName = sessionName.trim();
    const sessionPath = getSessionPath(cleanName);

    if (isSessionLocked(cleanName)) {
        return res.status(423).json({
            status: "Locked",
            sessionName: cleanName,
            message: `Sesi '${cleanName}' sedang terbuka di browser lain.`,
        });
    }

    if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
    }

    // Flatten jika cookies adalah array dalam array: [[{...}]] → [{...}]
    const flatCookies = Array.isArray(cookies[0]) ? cookies.flat() : cookies;

    // Map sameSite Cookie Editor → format Playwright
    const sameSiteMap = {
        no_restriction: "None", lax: "Lax", strict: "Strict",
        unspecified: "None", None: "None", Lax: "Lax", Strict: "Strict",
    };

    console.log(`[LOGIN-COOKIES] Inject ${flatCookies.length} cookies ke sesi '${cleanName}'...`);
    let context = null;

    try {
        context = await chromium.launchPersistentContext(sessionPath, {
            headless: true,
            args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            viewport: { width: 1280, height: 720 },
        });

        const page = await context.newPage();

        // Kunjungi facebook.com agar domain aktif sebelum inject cookies
        await page.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(2000);

        // Normalisasi cookies: hapus field yang tidak dikenal Playwright
        const normalizedCookies = flatCookies
            .map((cookie) => {
                const c = {
                    name: String(cookie.name || ""),
                    value: String(cookie.value || ""),
                    domain: cookie.domain || ".facebook.com",
                    path: cookie.path || "/",
                };
                if (typeof cookie.secure === "boolean") c.secure = cookie.secure;
                if (typeof cookie.httpOnly === "boolean") c.httpOnly = cookie.httpOnly;
                if (cookie.sameSite && sameSiteMap[cookie.sameSite]) c.sameSite = sameSiteMap[cookie.sameSite];
                if (cookie.expirationDate) c.expires = Math.floor(cookie.expirationDate);
                return c;
            })
            .filter((c) => c.name !== "" && c.value !== "");

        await context.addCookies(normalizedCookies);
        console.log(`[LOGIN-COOKIES] ${normalizedCookies.length} cookies berhasil di-inject.`);

        // Navigasi ke Facebook Business untuk verifikasi login
        await page.goto("https://business.facebook.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(3000);

        const currentUrl = page.url();
        await context.close();
        context = null;

        const isLoggedIn =
            !currentUrl.includes("login") &&
            !currentUrl.includes("checkpoint") &&
            !currentUrl.includes("auth") &&
            currentUrl.includes("business.facebook.com");

        if (isLoggedIn) {
            console.log(`[LOGIN-COOKIES] ✓ Sesi '${cleanName}' berhasil login!`);
            return res.status(200).json({
                status: "Success",
                method: "cookies",
                login_status: "Logged In",
                sessionName: cleanName,
                sessionPath,
                cookies_injected: normalizedCookies.length,
                detected_url: currentUrl,
                message: `Sesi '${cleanName}' berhasil dibuat via cookies.`,
                next_step: "Gunakan GET /check-session untuk verifikasi kapanpun.",
            });
        } else {
            console.warn(`[LOGIN-COOKIES] ✗ Login gagal '${cleanName}'. Redirect ke: ${currentUrl}`);
            return res.status(401).json({
                status: "Failed",
                method: "cookies",
                login_status: "Not Logged In",
                sessionName: cleanName,
                detected_url: currentUrl,
                message: "Cookies di-inject tapi gagal login. Cookies kemungkinan sudah expired.",
                tip: "Export ulang cookies dari browser yang masih aktif login.",
            });
        }

    } catch (err) {
        if (context) { try { await context.close(); } catch (_) { } }
        console.error(`[LOGIN-COOKIES] Error '${cleanName}':`, err.message);
        return res.status(500).json({
            status: "Error",
            message: "Terjadi kesalahan saat inject cookies.",
            detail: err.message,
        });
    }
});

module.exports = router;
