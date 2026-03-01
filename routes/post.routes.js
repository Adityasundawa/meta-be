// =============================================
// routes/post.routes.js
// Endpoint scraping konten Facebook Business
//
// POST /check-posts → Scrape tab Scheduled & Published
// =============================================
const express = require("express");
const { chromium } = require("playwright");
const router = express.Router();

const { getSessionStatus, getSessionPath } = require("../helpers/session.helper");

// Regex deteksi tanggal: "18 February 16:12" atau "28 Feb 2026"
const DATE_REGEX = /^\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}:\d{2}$/i;

// Pattern baris UI yang harus dilewati saat parsing teks
const SKIP_LINES_PATTERN = /^(Boost|Open Drop-down|Reel\s*·|Public|Private|Friends|Content|Stories|Playlists|Series|Clips|Scheduled|Published|Drafts|Expiring|Expired|Post type|Filter|Clear|Search by|Title|Date|Privacy|Status|Reach|Likes|Comments|Shares|Actions|Export|Create|Collapse|Close|New viewers|Edit|Search|Settings|Help|Home|Notifications|Inbox|Ads|Insights|All tools|Creator|Planner|Mentions|Feed|A\/B|Videos|Collections|Schedule, publish|Last \d+ days|Columns|out of)$/i;

// ---- POST /check-posts → Scrape konten terjadwal & terpublish ----
// Body: { "sessionName": "akun_nomor_1", "assetId": "951949034669021" }
router.post("/check-posts", async (req, res) => {
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

    const sessionPath = getSessionPath(cleanSession);
    let context = null;

    console.log(`[CHECK-POSTS] Scraping konten untuk assetId '${cleanAsset}'...`);

    try {
        context = await chromium.launchPersistentContext(sessionPath, {
            headless: true,
            args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            viewport: { width: 1440, height: 900 },
        });

        const page = await context.newPage();
        const baseUrl = `https://business.facebook.com/latest/posts`;

        // Scrape tab Scheduled
        console.log(`[CHECK-POSTS] Scraping tab Scheduled...`);
        await page.goto(`${baseUrl}/scheduled_posts?asset_id=${cleanAsset}`, {
            waitUntil: "domcontentloaded", timeout: 60000
        });
        await page.waitForTimeout(5000);
        const scheduledPosts = await scrapePostsFromBodyText(page, "scheduled_date");

        // Scrape tab Published
        console.log(`[CHECK-POSTS] Scraping tab Published...`);
        await page.goto(`${baseUrl}/published_posts?asset_id=${cleanAsset}`, {
            waitUntil: "domcontentloaded", timeout: 60000
        });
        await page.waitForTimeout(5000);
        const publishedPosts = await scrapePostsFromBodyText(page, "published_date");

        await context.close();
        context = null;

        console.log(`[CHECK-POSTS] Selesai. Scheduled: ${scheduledPosts.length}, Published: ${publishedPosts.length}`);

        return res.status(200).json({
            status: "Success",
            sessionName: cleanSession,
            assetId: cleanAsset,
            scheduled: {
                total: scheduledPosts.length,
                url: `${baseUrl}/scheduled_posts?asset_id=${cleanAsset}`,
                data: scheduledPosts,
            },
            published: {
                total: publishedPosts.length,
                url: `${baseUrl}/published_posts?asset_id=${cleanAsset}`,
                data: publishedPosts,
            },
        });

    } catch (err) {
        if (context) { try { await context.close(); } catch (_) { } }
        console.error(`[CHECK-POSTS] Error:`, err.message);
        return res.status(500).json({
            status: "Error",
            message: "Gagal scraping data posts.",
            detail: err.message,
        });
    }
});

/**
 * Scrape data post dari bodyText halaman
 * Strategi: cari baris yang cocok format tanggal, lalu cari judul di atas baris itu
 * @param {Page} page - Playwright page object
 * @param {string} dateKey - key nama field tanggal di output ("scheduled_date" | "published_date")
 */
async function scrapePostsFromBodyText(page, dateKey) {
    return await page.evaluate(
        ({ datePattern, skipPattern, dateKey }) => {
            const results = [];
            const dateRegex = new RegExp(datePattern, "i");
            const skipRegex = new RegExp(skipPattern, "i");

            const lines = document.body.innerText
                .split("\n")
                .map(l => l.trim())
                .filter(l => l.length > 0);

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (dateRegex.test(line)) {
                    // Cari judul: mundur ke atas, lewati baris noise
                    let title = "(no title)";
                    for (let j = i - 1; j >= 0; j--) {
                        const candidate = lines[j];
                        if (
                            candidate.length > 3 &&
                            !skipRegex.test(candidate) &&
                            !dateRegex.test(candidate) &&
                            !/^\d+$/.test(candidate)
                        ) {
                            title = candidate;
                            break;
                        }
                    }
                    results.push({ title, [dateKey]: line });
                }
            }

            return results;
        },
        {
            datePattern: DATE_REGEX.source,
            skipPattern: SKIP_LINES_PATTERN.source,
            dateKey,
        }
    );
}

module.exports = router;
