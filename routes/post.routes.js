// =============================================
// routes/post.routes.js
// Endpoint scraping konten Facebook Business
//
// POST /check-posts → Scrape tab Scheduled & Published
//                     Data: title, caption, date, status,
//                           reach, likes_reactions, comments, shares
// =============================================
const express = require("express");
const { chromium } = require("playwright");
const router = express.Router();

const { getSessionStatus, getSessionPath } = require("../helpers/session.helper");

// ─────────────────────────────────────────────────────────────
// ROUTE: POST /check-posts
// Body: { "sessionName": "akun_nomor_1", "assetId": "951949034669021" }
// ─────────────────────────────────────────────────────────────
router.post("/check-posts", async (req, res) => {
    const { sessionName, assetId } = req.body;

    if (!sessionName?.trim())
        return res.status(400).json({ status: "Error", message: "Field 'sessionName' wajib diisi." });
    if (!assetId?.trim())
        return res.status(400).json({ status: "Error", message: "Field 'assetId' wajib diisi." });

    const cleanSession = sessionName.trim();
    const cleanAsset   = assetId.trim();

    const sessionStatus = getSessionStatus(cleanSession);
    if (!sessionStatus.exists || sessionStatus.status === "empty")
        return res.status(404).json({ status: "Error", message: `Sesi '${cleanSession}' tidak ditemukan.` });
    if (sessionStatus.status === "locked")
        return res.status(423).json({ status: "Locked", message: `Sesi '${cleanSession}' sedang digunakan.` });

    const sessionPath = getSessionPath(cleanSession);
    let context = null;

    console.log(`[CHECK-POSTS] Mulai scraping untuk assetId '${cleanAsset}'...`);

    try {
        context = await chromium.launchPersistentContext(sessionPath, {
            headless: true,
            args: ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            viewport: { width: 1440, height: 900 },
        });

        const page = await context.newPage();
        const baseUrl = `https://business.facebook.com/latest/posts`;

        // ── Tab: Scheduled ──
        console.log(`[CHECK-POSTS] Membuka tab Scheduled...`);
        await page.goto(`${baseUrl}/scheduled_posts?asset_id=${cleanAsset}`, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        });
        await page.waitForTimeout(7000);
        await autoScroll(page);
        const scheduledPosts = await scrapePosts(page, "scheduled");
        console.log(`[CHECK-POSTS] Scheduled: ${scheduledPosts.length} post`);

        // ── Tab: Published ──
        console.log(`[CHECK-POSTS] Membuka tab Published...`);
        await page.goto(`${baseUrl}/published_posts?asset_id=${cleanAsset}`, {
            waitUntil: "domcontentloaded",
            timeout: 60000,
        });
        await page.waitForTimeout(7000);
        await autoScroll(page);
        const publishedPosts = await scrapePosts(page, "published");
        console.log(`[CHECK-POSTS] Published: ${publishedPosts.length} post`);

        await context.close();
        context = null;

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
        if (context) { try { await context.close(); } catch (_) {} }
        console.error(`[CHECK-POSTS] Error:`, err.message);
        return res.status(500).json({
            status: "Error",
            message: "Gagal scraping data posts.",
            detail: err.message,
        });
    }
});

// ─────────────────────────────────────────────────────────────
// AUTO SCROLL — pastikan semua row lazy-loaded
// ─────────────────────────────────────────────────────────────
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 500;
            const timer = setInterval(() => {
                window.scrollBy(0, distance);
                totalHeight += distance;
                if (totalHeight >= document.body.scrollHeight - window.innerHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 350);
        });
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
}

// ─────────────────────────────────────────────────────────────
// KOORDINATOR SCRAPING — coba 2 metode
// ─────────────────────────────────────────────────────────────
async function scrapePosts(page, tabType) {
    // Metode 1: DOM row selector (akurat jika Facebook render role="row")
    let results = await scrapeViaDOM(page, tabType);
    if (results.length > 0) {
        console.log(`[CHECK-POSTS][${tabType}] ✓ Metode DOM: ${results.length} post`);
        return results;
    }

    // Metode 2: bodyText parsing (fallback)
    console.log(`[CHECK-POSTS][${tabType}] DOM kosong, fallback ke bodyText...`);
    const bodyText = await page.evaluate(() => document.body.innerText);
    results = scrapeViaBodyText(bodyText, tabType);
    console.log(`[CHECK-POSTS][${tabType}] ✓ Metode bodyText: ${results.length} post`);
    return results;
}

// ─────────────────────────────────────────────────────────────
// METODE 1 — DOM Selector (div[role="row"])
//
// Struktur kolom tabel Facebook Business (dari screenshot):
// [0] Title (+ thumbnail + tipe konten)
// [1] Date published
// [2] Status (icon badge)
// [3] Reach
// [4] Likes and reactions
// [5] Comments
// [6] Shares
// [7] Actions (Boost button, dll)
// ─────────────────────────────────────────────────────────────
async function scrapeViaDOM(page, tabType) {
    return await page.evaluate((tabType) => {
        const results = [];

        const rows = Array.from(document.querySelectorAll('[role="row"]'));
        if (rows.length === 0) return [];

        // Deteksi urutan kolom dari header row
        let colMap = { title: 0, date: 1, status: 2, reach: 3, likes: 4, comments: 5, shares: 6 };

        const headerRow = rows.find(r => {
            const text = r.innerText.toLowerCase();
            return text.includes("title") && (text.includes("date") || text.includes("reach"));
        });

        if (headerRow) {
            const cells = Array.from(headerRow.querySelectorAll('[role="columnheader"], [role="gridcell"], [role="cell"], th, td'));
            cells.forEach((cell, idx) => {
                const t = cell.innerText.toLowerCase().trim();
                if (t.includes("title"))               colMap.title    = idx;
                else if (t.includes("date"))           colMap.date     = idx;
                else if (t.includes("status"))         colMap.status   = idx;
                else if (t.includes("reach"))          colMap.reach    = idx;
                else if (t.includes("like") || t.includes("reaction")) colMap.likes = idx;
                else if (t.includes("comment"))        colMap.comments = idx;
                else if (t.includes("share"))          colMap.shares   = idx;
            });
        }

        // Proses setiap data row (skip header)
        for (const row of rows) {
            // Skip baris yang merupakan header kolom
            const isHeader = row.querySelector('[role="columnheader"]') !== null ||
                             row.closest("thead") !== null;
            if (isHeader) continue;

            const cells = Array.from(row.querySelectorAll('[role="gridcell"], [role="cell"], td'));
            if (cells.length < 2) continue;

            // ── Title ──
            const titleCell = cells[colMap.title];
            if (!titleCell) continue;

            // Title biasanya ada di heading atau baris pertama innerText
            const titleEl = titleCell.querySelector('[role="heading"]') ||
                            titleCell.querySelector('[class*="title"]') ||
                            titleCell.querySelector('a');

            const titleLines = titleCell.innerText.trim().split("\n").map(l => l.trim()).filter(Boolean);
            let title = titleEl ? titleEl.innerText.trim().split("\n")[0].trim() : titleLines[0] || "";

            // Skip baris yang judulnya keyword header
            if (!title || /^(title|date|status|reach|likes|comments|shares)$/i.test(title)) continue;
            if (title.length < 2) continue;

            // ── Caption ──
            // Cari teks yang bukan label tipe konten di dalam sel title
            let caption = null;
            for (let i = 1; i < titleLines.length; i++) {
                const l = titleLines[i];
                if (
                    l.length > 5 &&
                    !/^(Reel|Post|Story|Boost|Joget|Public|Private|Friends)/i.test(l) &&
                    !/^[·•]/.test(l)
                ) {
                    caption = l;
                    break;
                }
            }

            // ── Date ──
            let date = null;
            const dateCell = cells[colMap.date];
            if (dateCell) {
                const timeEl = dateCell.querySelector("time");
                date = timeEl
                    ? (timeEl.getAttribute("datetime") || timeEl.innerText.trim())
                    : dateCell.innerText.trim().split("\n")[0].trim();
            }

            // ── Status ──
            let status = tabType === "scheduled" ? "Scheduled" : "Published";
            const statusCell = cells[colMap.status];
            if (statusCell) {
                const txt = statusCell.innerText.trim().split("\n")[0].trim();
                if (txt && txt.length > 0 && txt.length < 50) status = txt;
            }

            // ── Metrik ──
            const reach    = readMetricCell(cells[colMap.reach]);
            const likes    = readMetricCell(cells[colMap.likes]);
            const comments = readMetricCell(cells[colMap.comments]);
            const shares   = readMetricCell(cells[colMap.shares]);

            // ── Post URL ──
            const linkEl   = titleCell.querySelector("a[href]");
            const postUrl  = linkEl ? linkEl.href : null;

            results.push({
                title,
                caption,
                date,
                status,
                reach:           reach,
                likes_reactions: likes,
                comments:        comments,
                shares:          shares,
                post_url:        postUrl,
            });
        }

        return results;

        function readMetricCell(cell) {
            if (!cell) return "0";
            const text = cell.innerText.trim();
            const match = text.match(/^[\d][\d.,]*[KkMmBb]?/);
            return match ? match[0] : "0";
        }
    }, tabType);
}

// ─────────────────────────────────────────────────────────────
// METODE 2 — bodyText Parser
//
// Dari screenshot, urutan teks per baris post di bodyText:
//
//   "Baris pertama Baris kedua 👤 Nama: ABC 📍 ..."   ← title (bisa panjang)
//   "Reel · Joget Flow"                                ← tipe konten (skip)
//   "Boost"                                            ← tombol (skip)
//   "28 February 10:22"                                ← tanggal ← ANCHOR
//   "0"                                                ← reach
//   "0"                                                ← likes
//   "0"                                                ← comments
//   "0"                                                ← shares
//
// Strategi: temukan semua baris tanggal sebagai anchor,
//           lalu scan atas (title/caption) dan bawah (metrik).
// ─────────────────────────────────────────────────────────────
function scrapeViaBodyText(bodyText, tabType) {
    // Regex tanggal: "28 February 10:22" atau "28 Feb 2026 10:22" atau "28 February 2026"
    const DATE_RE = /^\d{1,2}\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)(\s+\d{4})?(\s+\d{1,2}:\d{2})?$/i;

    // Angka metrik: "0", "1,234", "12K", "1.2M"
    const NUM_RE = /^[\d][\d.,]*[KkMmBb]?$/;

    // Baris UI yang harus dilewati saat mencari title
    const SKIP_RE = /^(Boost|Open Drop-down|Reel\s*[·•]|Post\s*[·•]|Story\s*[·•]|Public|Private|Friends|Content|Stories|Playlists|Series|Clips|Scheduled|Published|Drafts|Expiring|Expired|Post type|Filter|Clear|Search by|Title|Date published|Date scheduled|Date|Privacy|Status|Reach|Likes and reactions|Likes|Comments|Shares|Actions|Export|Create|Collapse|Close|New viewers|Edit|Search|Settings|Help|Home|Notifications|Inbox|Ads|Insights|All tools|Creator|Planner|Mentions|Feed|A\/B|Videos|Collections|Schedule, publish|Last \d+ days|Columns|out of|Joget Flow|Page \d+|\d+\s+of\s+\d+)$/i;

    const lines = bodyText
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 0);

    // Temukan semua posisi baris tanggal
    const datePositions = [];
    for (let i = 0; i < lines.length; i++) {
        if (DATE_RE.test(lines[i])) {
            datePositions.push(i);
        }
    }

    const results = [];

    for (let di = 0; di < datePositions.length; di++) {
        const dateIdx = datePositions[di];
        const date    = lines[dateIdx];

        // ── TITLE ──
        // Scan ke atas dari posisi tanggal, lewati noise
        let title = "(no title)";
        let titleIdx = -1;
        for (let j = dateIdx - 1; j >= Math.max(0, dateIdx - 15); j--) {
            const l = lines[j];
            if (
                l.length > 2 &&
                !SKIP_RE.test(l) &&
                !DATE_RE.test(l) &&
                !NUM_RE.test(l)
            ) {
                title    = l;
                titleIdx = j;
                break;
            }
        }

        // ── CAPTION ──
        // Scan lebih jauh ke atas dari posisi title
        let caption = null;
        if (titleIdx > 0) {
            for (let j = titleIdx - 1; j >= Math.max(0, titleIdx - 10); j--) {
                const l = lines[j];
                if (
                    l.length > 10 &&
                    !SKIP_RE.test(l) &&
                    !DATE_RE.test(l) &&
                    !NUM_RE.test(l) &&
                    l !== title
                ) {
                    caption = l;
                    break;
                }
            }
        }

        // ── STATUS ──
        let status = tabType === "scheduled" ? "Scheduled" : "Published";
        for (let j = dateIdx + 1; j < Math.min(lines.length, dateIdx + 6); j++) {
            if (/^(scheduled|published|draft|expiring|expired)$/i.test(lines[j])) {
                status = lines[j];
                break;
            }
        }

        // ── METRIK ──
        // Kumpulkan angka setelah baris tanggal sampai batas post berikutnya
        const nextDateIdx = datePositions[di + 1] ?? lines.length;
        const numbers = [];
        for (let j = dateIdx + 1; j < nextDateIdx && numbers.length < 4; j++) {
            if (NUM_RE.test(lines[j])) {
                numbers.push(lines[j]);
            }
        }

        results.push({
            title,
            caption:         caption || null,
            date,
            status,
            reach:           numbers[0] ?? "0",
            likes_reactions: numbers[1] ?? "0",
            comments:        numbers[2] ?? "0",
            shares:          numbers[3] ?? "0",
            post_url:        null,
        });
    }

    return results;
}

module.exports = router;