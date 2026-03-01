// =============================================
// routes/session.routes.js
// Endpoint manajemen sesi
//
// GET /check-session   → Verifikasi status & login sesi
// GET /list-sessions   → Daftar semua sesi yang tersimpan
// =============================================
const express = require("express");
const fs = require("fs");
const { chromium } = require("playwright");
const router = express.Router();

const { getSessionPath, getSessionStatus } = require("../helpers/session.helper");
const { getTokenSessions } = require("../database/token.service");
const { SESSION_BASE_DIR } = require("../config/app.config");

// ---- GET /check-session → Cek status & login sesi ----
// Body: { "sessionName": "akun_nomor_1" }
router.get("/check-session", async (req, res) => {
    const { sessionName } = req.body;

    if (!sessionName?.trim()) {
        return res.status(400).json({ status: "Error", message: "Field 'sessionName' wajib diisi." });
    }

    const cleanName = sessionName.trim();
    const sessionPath = getSessionPath(cleanName);
    const result = getSessionStatus(cleanName);

    // Sesi tidak ditemukan
    if (!result.exists) {
        return res.status(404).json({
            status: "Not Found",
            sessionName: cleanName,
            sessionPath,
            message: `Sesi '${cleanName}' tidak ditemukan. Login dulu via /login-meta atau /login-cookies.`,
        });
    }

    // Folder ada tapi kosong (login belum selesai)
    if (result.status === "empty") {
        return res.status(200).json({
            status: "Empty",
            sessionName: cleanName,
            sessionPath,
            message: `Folder sesi '${cleanName}' ada tapi kosong. Login belum selesai atau gagal tersimpan.`,
        });
    }

    // Sesi sedang digunakan (browser terbuka)
    if (result.status === "locked") {
        return res.status(423).json({
            status: "Locked",
            sessionName: cleanName,
            sessionPath,
            message: `Sesi '${cleanName}' sedang digunakan. Tutup browser untuk melepaskan Lock.`,
        });
    }

    // Verifikasi login via headless browser
    console.log(`[CHECK-SESSION] Verifikasi login untuk sesi '${cleanName}'...`);
    let context = null;

    try {
        context = await chromium.launchPersistentContext(sessionPath, {
            headless: true,
            args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            viewport: { width: 1280, height: 720 },
        });

        const page = await context.newPage();
        await page.goto("https://business.facebook.com/", { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(3000);

        const currentUrl = page.url();
        await context.close();
        context = null;

        console.log(`[CHECK-SESSION] URL: ${currentUrl}`);

        const isLoggedIn =
            !currentUrl.includes("login") &&
            !currentUrl.includes("checkpoint") &&
            !currentUrl.includes("auth") &&
            currentUrl.includes("business.facebook.com");

        return res.status(200).json({
            status: "Available",
            login_status: isLoggedIn ? "Logged In" : "Not Logged In",
            sessionName: cleanName,
            sessionPath,
            detected_url: currentUrl,
            message: isLoggedIn
                ? `Sesi '${cleanName}' valid dan sudah login. Siap digunakan.`
                : `Sesi '${cleanName}' ada tapi tidak login. Login ulang via /login-meta atau /login-cookies.`,
        });

    } catch (err) {
        if (context) { try { await context.close(); } catch (_) { } }
        console.error(`[CHECK-SESSION] Error '${cleanName}':`, err.message);
        return res.status(500).json({
            status: "Error",
            sessionName: cleanName,
            message: "Gagal membuka browser untuk verifikasi login.",
            detail: err.message,
        });
    }
});

// ---- GET /list-sessions → Daftar semua sesi (tanpa buka browser) ----
router.get("/list-sessions", async (req, res) => {
    try {
        let sessionNames;

        if (req.tokenData.role === "admin") {
            // Admin: ambil dari filesystem
            if (!fs.existsSync(SESSION_BASE_DIR)) {
                return res.status(200).json({ status: "Success", total: 0, sessions: [] });
            }
            sessionNames = fs.readdirSync(SESSION_BASE_DIR).filter((name) =>
                fs.statSync(`${SESSION_BASE_DIR}/${name}`).isDirectory()
            );
        } else {
            // Client: ambil dari DB (yang di-assign admin)
            const assigned = await getTokenSessions(req.tokenData.id);
            sessionNames = assigned.map((s) => s.session_name);
        }

        const sessions = sessionNames.map((name) => {
            const s = getSessionStatus(name);
            return { sessionName: name, status: s.status, sessionPath: getSessionPath(name) };
        });

        return res.status(200).json({ status: "Success", total: sessions.length, sessions });

    } catch (err) {
        return res.status(500).json({ status: "Error", message: "Gagal membaca daftar sesi.", detail: err.message });
    }
});

module.exports = router;
