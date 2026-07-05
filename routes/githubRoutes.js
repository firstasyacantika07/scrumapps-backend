// routes/githubRoutes.js
const express = require('express');
const router = express.Router();
const githubController = require('../controllers/githubController');

// 💡 Catatan Kunci:
// Pastikan router ini dilewati oleh middleware autentikasi Anda (misal: verifyToken) 
// di file server utama (app.js/index.js) agar objek `req.user` terisi dengan benar.

// ─────────────────────────────────────────────────────────────────────────────
// 🚀 ENDPOINT KHUSUS: SINKRONISASI 5-ROLE MULTI-TENANT VIEW (UNTUK FRONTEND)
// ─────────────────────────────────────────────────────────────────────────────

// 👑 Tampilan 1: Monitoring Dashboard Global (Khusus Superadmin)
router.get('/global-stats', githubController.getGlobalStats);

// 🏢 Tampilan 2: Koneksi Organisasi & Workspace Repositori (Admin / Tenant Admin)
router.get('/tenant-repos', githubController.getTenantRepos);

// 🎯 Tampilan 3: Traceability Matrix Manajemen Proyek (Project Owner & Business Analyst)
router.get('/tracking-dashboard', githubController.getTrackingDashboard);

// 💻 Tampilan 4: Log Aktivitas Git & Tautan Akun Developer (Team Developer)
router.get('/developer-log', githubController.getDeveloperLog);


// ─────────────────────────────────────────────────────────────────────────────
// ⚡ OPERASIONAL CORE INTEGRASI (LOGIKA DATABASE RIIL & GITHUB API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 1. Mengambil status integrasi spesifik milik satu proyek
 * GET /api/github/project/:projectId
 */
router.get('/project/:projectId', githubController.getIntegrationByProject);

/**
 * 2. Mengajukan integrasi repositori baru oleh BA atau Admin Workspace
 * POST /api/github/request/:projectId
 */
router.post('/request/:projectId', githubController.createIntegrationRequest);

/**
 * 3. Mengambil URL OAuth GitHub untuk proses otentikasi (Superadmin Platform)
 * GET /api/github/oauth-url
 */
router.get('/oauth-url', githubController.getGitHubOAuthUrl);

/**
 * 4. Mengambil seluruh riwayat pengajuan integrasi dari semua proyek (Superadmin/Admin Dashboard)
 * GET /api/github/requests
 */
router.get('/requests', githubController.getAllIntegrationRequests);

/**
 * 5. Menyetujui pengajuan & generate OAuth URL (Superadmin Platform Pusat)
 * PUT /api/github/requests/:id/approve
 */
router.put('/requests/:id/approve', githubController.approveIntegrationRequest);

/**
 * 6. Menolak pengajuan integrasi repositori (Superadmin Platform Pusat)
 * PUT /api/github/requests/:id/reject
 */
router.put('/requests/:id/reject', githubController.rejectIntegrationRequest);

/**
 * 7. Memutuskan hubungan repositori dengan proyek / Disconnect
 * DELETE /api/github/:id
 */
router.delete('/:id', githubController.disconnectGitHub);

/**
 * 8. Callback Handler dari GitHub OAuth (Dialihkan dari server otentikasi pusat GitHub)
 * GET /api/github/callback
 * ⚠️ CATATAN: Lewatkan route ini dari token verification jika dipanggil langsung dari luar platform
 */
router.get('/callback', githubController.handleGitHubCallback);

/**
 * 9. Mengambil aktivitas commit terbaru dari repo yang aktif melalui API GitHub
 * GET /api/github/project/:projectId/activity
 */
router.get('/project/:projectId/activity', githubController.getRepoActivity);

/**
 * 10. Menyelaraskan (Sync) Backlog aplikasi ScrumApps dengan GitHub Issues
 * POST /api/github/project/:projectId/sync-backlog
 */
router.post('/project/:projectId/sync-backlog', githubController.syncBacklogWithGitHub);

/**
 * 11. Konfigurasi Webhook Repositori Otomatis untuk sinkronisasi Kanban
 * POST /api/github/project/:projectId/webhooks
 */
router.post('/project/:projectId/webhooks', githubController.configureWebhook);

/**
 * 12. Mengelola / Memperbarui Personal Access Token (PAT) secara Manual
 * POST /api/github/project/:projectId/pat
 */
router.post('/project/:projectId/pat', githubController.managePAT);

/**
 * 13. Menghubungkan Akun Personal GitHub Developer ke Profil Akun Internal
 * POST /api/github/connect-personal
 */
router.post('/connect-personal', githubController.connectPersonalAccount);

/**
 * 14. Webhook Receiver: Menghubungkan Commit/PR & Auto Update Kanban (Bypass Token check)
 * POST /api/github/project/:projectId/webhook-receiver
 */
router.post('/project/:projectId/webhook-receiver', githubController.linkGitActionToKanban);

module.exports = router;