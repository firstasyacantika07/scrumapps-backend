const express = require('express');
const router = express.Router();

// Controller
const dashboardController = require('../controllers/dashboardController');

// Middleware
const { verifyToken, authorize } = require('../middleware/auth');

// 🔒 Semua route di bawah ini WAJIB login terlebih dahulu
router.use(verifyToken);

// ======================================================
// 🏢 WORKSPACE / TENANT DASHBOARD ROUTES
// ======================================================

// Route umum untuk melihat data statistik proyek internal workspace/perusahaan
router.get('/stats', dashboardController.getStats);


// ======================================================
// 👑 GLOBAL SUPERADMIN DASHBOARD ROUTES
// ======================================================

// Menangani: GET /api/superadmin/dashboard/stats
router.get('/dashboard/stats', authorize('superadmin'), dashboardController.getDashboardStats);

// Menangani: GET /api/superadmin/companies/recent
router.get('/companies/recent', authorize('superadmin'), dashboardController.getRecentTenants);


// ======================================================
// 🔐 DASHBOARD LANDING BY ROLE (Simulasi / Testing)
// ======================================================

// Khusus Superadmin
router.get('/admin', authorize('superadmin'), (req, res) => {
    res.json({ message: "Welcome to Superadmin Dashboard" });
});

// Khusus Business Analyst
router.get('/analyst', authorize('BusinessAnalyst'), (req, res) => {
    res.json({ message: "Welcome to Business Analyst Dashboard" });
});

// Khusus Developer
router.get('/developer', authorize('TeamDeveloper'), (req, res) => {
    res.json({ message: "Welcome to Developer Dashboard" });
});

module.exports = router;