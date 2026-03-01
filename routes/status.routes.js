// =============================================
// routes/status.routes.js
// Endpoint monitoring status bot real-time
//
// GET /status → Tampilkan antrian, task aktif, dan history
// =============================================
const express = require("express");
const router = express.Router();
const { botState } = require("../services/queue.service");

router.get("/status", (req, res) => {
    res.json(botState);
});

module.exports = router;
