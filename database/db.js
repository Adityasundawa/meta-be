// =============================================
// database/db.js
// Koneksi MySQL menggunakan connection pool
// Semua query di seluruh aplikasi pakai file ini
// =============================================
const mysql = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
    host:               process.env.DB_HOST || "localhost",
    port:               parseInt(process.env.DB_PORT) || 3306,
    database:           process.env.DB_NAME || "bot_meta",
    user:               process.env.DB_USER || "botmeta_user",
    password:           process.env.DB_PASSWORD,
    connectionLimit:    parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
    waitForConnections: true,
    queueLimit:         0,
    timezone:           "+07:00", // WIB — sesuaikan jika berbeda
});

// Test koneksi saat server start
async function testConnection() {
    try {
        const conn = await pool.getConnection();
        console.log("[DB] ✓ Koneksi MySQL berhasil.");
        conn.release();
    } catch (err) {
        console.error("[DB] ✗ Gagal koneksi MySQL:", err.message);
        process.exit(1); // Hentikan server jika DB tidak bisa diakses
    }
}

module.exports = { pool, testConnection };