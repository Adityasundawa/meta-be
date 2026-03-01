// Simulasi full flow findToken untuk debug
// Jalankan ini di server dengan: node debug_token_flow.js <token_string>

require("dotenv").config();
const { pool } = require("./database/db");

async function debug(token) {
    console.log("\n=== DEBUG FULL TOKEN FLOW ===");
    console.log("Token yang dicek:", token);

    const [rows] = await pool.query(
        `SELECT id, token, client_name, role, is_active, expired_at,
                NOW() as server_time
         FROM tokens WHERE token = ? LIMIT 1`,
        [token]
    );

    if (!rows[0]) {
        console.log("❌ Token TIDAK DITEMUKAN di database");
        process.exit();
    }

    const t = rows[0];
    console.log("\n--- Data dari MySQL ---");
    console.log("id          :", t.id);
    console.log("client_name :", t.client_name);
    console.log("role        :", t.role);
    console.log("is_active   :", t.is_active, typeof t.is_active);
    console.log("expired_at  :", t.expired_at, typeof t.expired_at, t.expired_at instanceof Date ? "(Date object)" : "");
    console.log("server_time :", t.server_time);

    console.log("\n--- Cek Expired ---");
    if (!t.expired_at) {
        console.log("✅ expired_at = NULL → tidak pernah expired");
    } else {
        const expMs  = new Date(t.expired_at).getTime();
        const nowMs  = Date.now();
        console.log("expired_at.getTime() :", expMs);
        console.log("Date.now()           :", nowMs);
        console.log("Selisih (ms)         :", nowMs - expMs, "(positif = sudah expired)");
        console.log("Sudah expired?       :", expMs <= nowMs ? "✅ YA → harus 401" : "❌ BELUM → masih valid");
    }

    await pool.end();
}

const token = process.argv[2];
if (!token) {
    console.log("Usage: node debug_token_flow.js <bearer_token>");
    console.log("Contoh: node debug_token_flow.js bm_abc123...");
    process.exit();
}

debug(token).catch(console.error);