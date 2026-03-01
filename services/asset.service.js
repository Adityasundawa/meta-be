// =============================================
// services/asset.service.js
// Verifikasi apakah assetId valid di Facebook Business
// Menggunakan headless browser untuk navigasi & cek URL/konten
// =============================================
const { chromium } = require("playwright");
const { getSessionPath } = require("../helpers/session.helper");

/**
 * Verifikasi assetId ke Facebook secara headless
 * @returns {{ valid: boolean, reason: string }}
 */
async function verifyAssetId(sessionName, assetId) {
    const sessionPath = getSessionPath(sessionName);
    let context = null;

    try {
        context = await chromium.launchPersistentContext(sessionPath, {
            headless: true,
            args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            viewport: { width: 1280, height: 720 },
        });

        const page = await context.newPage();

        // Buka URL dashboard dengan assetId yang ingin diverifikasi
        const testUrl = `https://business.facebook.com/latest/?asset_id=${assetId}`;
        await page.goto(testUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForTimeout(6000);

        const currentUrl = page.url();

        // Jika redirect ke login → sesi expired
        if (currentUrl.includes("login") || currentUrl.includes("auth")) {
            await context.close();
            return { valid: false, reason: "Sesi expired atau belum login. Lakukan login ulang." };
        }

        // Cek teks error yang dirender React di halaman
        const renderedText = await page.evaluate(() => document.body.innerText || "");
        const errorPhrases = [
            "Sorry, this content isn't available",
            "This content isn't available at the moment",
            "The link you followed may have expired",
            "Page Not Found",
            "Something went wrong",
            "isn't available right now",
        ];
        const foundError = errorPhrases.find((phrase) =>
            renderedText.toLowerCase().includes(phrase.toLowerCase())
        );
        if (foundError) {
            await context.close();
            return { valid: false, reason: `AssetId '${assetId}' tidak valid atau tidak punya akses.` };
        }

        // Cek apakah Facebook redirect ke assetId yang berbeda
        const urlObj = new URL(currentUrl);
        const returnedAssetId = urlObj.searchParams.get("asset_id");
        if (returnedAssetId && returnedAssetId !== assetId) {
            await context.close();
            return { valid: false, reason: `AssetId '${assetId}' tidak valid. Redirect ke: ${returnedAssetId}` };
        }

        // Pastikan assetId masih ada di URL final (tidak dihapus redirect)
        if (!currentUrl.includes(assetId)) {
            await context.close();
            return { valid: false, reason: `AssetId '${assetId}' tidak dikenali oleh Facebook.` };
        }

        await context.close();
        return { valid: true, reason: "AssetId valid dan dapat diakses." };

    } catch (err) {
        if (context) { try { await context.close(); } catch (_) { } }
        return { valid: false, reason: `Gagal verifikasi: ${err.message}` };
    }
}

module.exports = { verifyAssetId };
