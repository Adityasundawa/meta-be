// =============================================
// index.js → Entry Point / Server Utama
// =============================================
require("dotenv").config();

const express    = require("express");
const bodyParser = require("body-parser");

// Database
const { testConnection } = require("./database/db");

// Middleware Keamanan
const { authMiddleware } = require("./middleware/auth.middleware");
const { sessionGuard }   = require("./middleware/session.guard");
const { adminGuard }     = require("./middleware/admin.guard");

// Routes Utama
const authRoutes     = require("./routes/auth.routes");
const scheduleRoutes = require("./routes/schedule.routes");
const sessionRoutes  = require("./routes/session.routes");
const assetRoutes    = require("./routes/asset.routes");
const postRoutes     = require("./routes/post.routes");
const statusRoutes   = require("./routes/status.routes");

// Routes Admin
const adminRoutes = require("./admin/admin.routes");

const API_PORT = process.env.API_PORT || 8002;

const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

// ─────────────────────────────────────────────
// Middleware Global: semua endpoint butuh Bearer token
// ─────────────────────────────────────────────
app.use(authMiddleware);

// ─────────────────────────────────────────────
// Route Admin: butuh role=admin
// ─────────────────────────────────────────────
app.use("/admin", adminGuard, adminRoutes);

// ─────────────────────────────────────────────
// Route Utama: token valid + session guard
// ─────────────────────────────────────────────
app.use("/", sessionGuard, authRoutes);
app.use("/", sessionGuard, scheduleRoutes);
app.use("/", sessionGuard, sessionRoutes);
app.use("/", sessionGuard, assetRoutes);
app.use("/", sessionGuard, postRoutes);
app.use("/", statusRoutes);

// ─────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error("[SERVER ERROR]", err.message);
    res.status(500).json({ status: "Error", message: "Internal server error.", detail: err.message });
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
async function start() {
    await testConnection();

    app.listen(API_PORT, () => {
        console.log("===============================================");
        console.log(" Bot Meta API → http://localhost:" + API_PORT);
        console.log("-----------------------------------------------");
        console.log(" [SECURED] Semua endpoint butuh Bearer token");
        console.log("-----------------------------------------------");
        console.log(" POST  /login-meta       → Login Manual");
        console.log(" POST  /login-cookies    → Login via Cookies");
        console.log(" GET   /check-session    → Verifikasi Sesi");
        console.log(" GET   /list-sessions    → Daftar Semua Sesi");
        console.log(" POST  /schedule         → Jadwalkan Konten");
        console.log(" GET   /status           → Status Bot");
        console.log(" POST  /check-asset      → Verifikasi AssetId");
        console.log(" POST  /check-posts      → Cek Post");
        console.log(" POST  /check-business   → Deteksi Page");
        console.log("-----------------------------------------------");
        console.log(" [ADMIN ONLY]");
        console.log(" POST   /admin/tokens              → Buat token");
        console.log(" GET    /admin/tokens              → List token");
        console.log(" GET    /admin/tokens/:id          → Detail token");
        console.log(" PATCH  /admin/tokens/:id          → Edit token");
        console.log(" DELETE /admin/tokens/:id          → Hapus token");
        console.log(" POST   /admin/tokens/:id/sessions → Assign sesi");
        console.log(" DELETE /admin/tokens/:id/sessions → Cabut sesi");
        console.log(" GET    /admin/tokens/:id/sessions → List sesi");
        console.log(" GET    /admin/logs                → Access log");
        console.log("===============================================");
    });
}

start();