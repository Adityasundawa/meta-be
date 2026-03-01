// =============================================
// routes/asset.routes.js
// Endpoint verifikasi asset & scraping konten
//
// POST /check-asset    → Verifikasi satu assetId
// POST /check-business → Deteksi semua page dari satu sesi
// =============================================
const express = require("express");
const { chromium } = require("playwright");
const router = express.Router();

const { getSessionStatus, getSessionPath } = require("../helpers/session.helper");
const { verifyAssetId } = require("../services/asset.service");

// ---- POST /check-asset → Verifikasi assetId ----
// Body: { "sessionName": "akun_nomor_1", "assetId": "123456789" }
router.post("/check-asset", async (req, res) => {
    const { sessionName, assetId } = req.body;

    if (!sessionName?.trim()) return res.status(400).json({ status: "Error", message: "Field 'sessionName' wajib diisi." });
    if (!assetId?.trim()) return res.status(400).json({ status: "Error", message: "Field 'assetId' wajib diisi." });

    const cleanSession = sessionName.trim();
    const cleanAsset = assetId.trim();

    const sessionStatus = getSessionStatus(cleanSession);
    if (!sessionStatus.exists || sessionStatus.status === "empty") {
        return res.status(404).json({ status: "Error", message: `Sesi '${cleanSession}' tidak ditemukan.` });
    }
    if (sessionStatus.status === "locked") {
        return res.status(423).json({ status: "Locked", message: `Sesi '${cleanSession}' sedang digunakan.` });
    }

    console.log(`[CHECK-ASSET] Verifikasi assetId '${cleanAsset}' dengan sesi '${cleanSession}'...`);
    const result = await verifyAssetId(cleanSession, cleanAsset);

    return res.status(result.valid ? 200 : 422).json({
        status: result.valid ? "Valid" : "Invalid",
        sessionName: cleanSession,
        assetId: cleanAsset,
        message: result.reason,
    });
});

// ---- POST /check-business → Deteksi semua page/assetId dari satu sesi ----
// Body: { "sessionName": "akun_nomor_1" }
router.post("/check-business", async (req, res) => {
    const { sessionName } = req.body;

    if (!sessionName?.trim()) return res.status(400).json({ status: "Error", message: "Field 'sessionName' wajib diisi." });

    const cleanName = sessionName.trim();
    const sessionStatus = getSessionStatus(cleanName);

    if (!sessionStatus.exists || sessionStatus.status === "empty") {
        return res.status(404).json({ status: "Error", message: `Sesi '${cleanName}' tidak ditemukan. Login dulu.` });
    }
    if (sessionStatus.status === "locked") {
        return res.status(423).json({ status: "Locked", message: `Sesi '${cleanName}' sedang digunakan.` });
    }

    const sessionPath = getSessionPath(cleanName);
    let context = null;

    console.log(`[CHECK-BUSINESS] Deteksi assetId untuk sesi '${cleanName}'...`);

    try {
        context = await chromium.launchPersistentContext(sessionPath, {
            headless: true,
            args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            viewport: { width: 1440, height: 900 },
        });

        const page = await context.newPage();

        // Step 1: Buka /latest/ untuk dapat assetId awal dari redirect
        await page.goto("https://business.facebook.com/latest/", { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(5000);

        const redirectUrl = page.url();
        console.log(`[CHECK-BUSINESS] URL setelah redirect: ${redirectUrl}`);

        if (redirectUrl.includes("login") || redirectUrl.includes("auth")) {
            await context.close();
            return res.status(401).json({
                status: "Error",
                message: `Sesi '${cleanName}' tidak login. Login ulang via /login-meta atau /login-cookies.`,
            });
        }

        const detectedAssetId = new URL(redirectUrl).searchParams.get("asset_id");
        if (!detectedAssetId) {
            await context.close();
            return res.status(400).json({
                status: "Error",
                message: "Gagal deteksi assetId awal dari redirect.",
                detected_url: redirectUrl,
            });
        }

        // Step 2: Buka halaman Settings Profiles untuk list semua page
        await page.goto(
            `https://business.facebook.com/latest/settings/profiles?asset_id=${detectedAssetId}`,
            { waitUntil: "domcontentloaded", timeout: 60000 }
        );
        await page.waitForTimeout(6000);

        // Step 3: Scrape nama page & assetId menggunakan 3 metode fallback
        const pageData = await page.evaluate(() => {
            // Metode 1: data-surface attribute (struktur lama)
            const surfaceEls = document.querySelectorAll('span[data-surface*="non_business_asset_item:"]');
            if (surfaceEls.length > 0) {
                const results = [];
                surfaceEls.forEach(el => {
                    const surface = el.getAttribute("data-surface") || "";
                    const nameEl = el.querySelector('div[role="heading"]');
                    const idMatch = surface.match(/non_business_asset_item:(\d+)/);
                    if (idMatch && nameEl) {
                        results.push({ page_name: nameEl.innerText.trim(), asset_id: idMatch[1] });
                    }
                });
                if (results.length > 0) return { method: "data-surface", results };
            }

            // Metode 2: ambil dari href link yang mengandung asset_id
            const links = [...document.querySelectorAll("a[href*='asset_id=']")];
            const seen = new Set();
            const fallbackResults = [];
            links.forEach(link => {
                try {
                    const url = new URL(link.href);
                    const assetId = url.searchParams.get("asset_id");
                    if (assetId && !seen.has(assetId)) {
                        seen.add(assetId);
                        const nameEl = link.querySelector('[role="heading"]') || link.closest("li, tr, div[role='row']");
                        const name = nameEl ? nameEl.innerText.split("\n")[0].trim() : link.innerText.trim();
                        if (name && !/^(Home|Settings|Content|Inbox|Ads)$/i.test(name)) {
                            fallbackResults.push({ page_name: name.substring(0, 80), asset_id: assetId });
                        }
                    }
                } catch (_) { }
            });
            if (fallbackResults.length > 0) return { method: "link-href", results: fallbackResults };

            // Metode 3: kumpulkan semua assetId unik dari semua href
            const allIds = new Set();
            document.querySelectorAll("a[href]").forEach(link => {
                try { const id = new URL(link.href).searchParams.get("asset_id"); if (id) allIds.add(id); } catch (_) { }
            });
            return {
                method: "asset-ids-only",
                results: [...allIds].map(id => ({ page_name: "(unknown)", asset_id: id })),
            };
        });

        // Deduplicate berdasarkan asset_id
        const unique = Array.from(
            new Map(pageData.results.map(item => [item.asset_id, item])).values()
        );

        await context.close();
        context = null;

        console.log(`[CHECK-BUSINESS] Selesai. Metode: ${pageData.method}, Ditemukan: ${unique.length} page.`);

        return res.status(200).json({
            status: "Success",
            sessionName: cleanName,
            total_found: unique.length,
            scrape_method: pageData.method,
            data: unique,
        });

    } catch (err) {
        if (context) { try { await context.close(); } catch (_) { } }
        console.error(`[CHECK-BUSINESS] Error:`, err.message);
        return res.status(500).json({
            status: "Error",
            message: "Gagal deteksi business assets.",
            detail: err.message,
        });
    }
});

module.exports = router;
