// ⚠️⚠️⚠️ FILE INI SUDAH TIDAK DIPAKAI (DEPRECATED) — JANGAN DI-MOUNT DI app.js
// =============================================================================
// Setelah dicek, sistem project-members yang AKTIF & BENAR ada di
// projectRoutes.js (route '/:projectId/members') memakai teamController.js,
// karena controller itu memakai nama kolom database yang benar
// (role_in_project) dan melakukan validasi tenant_id (aman multi-tenant).
//
// File ini (projectMemberRoutes.js) + projectMemberController.js memakai nama
// kolom `role` yang salah (kemungkinan besar akan gagal SQL error) dan TIDAK
// melakukan validasi tenant sama sekali. Jika file ini masih ter-mount di
// app.js pada prefix yang sama dengan projectRoutes.js
// (mis. app.use('/api/projects', ...)), akan terjadi bentrok route lagi.
//
// Aman untuk dihapus. Dipertahankan sementara sebagai referensi/backup saja.
// =============================================================================

const express = require('express');

const router = express.Router();

// 🛠️ FIX: sebelumnya file ini tidak mengimport middleware auth sama sekali,
// sehingga endpoint create/update/delete member bisa diakses TANPA LOGIN
// dan tanpa batasan role. Disamakan dengan proteksi di projectRoutes.js.
const { verifyToken, authorize } = require('../middleware/auth');
// 🛠️ FIX: checkTeamLimit dipindah ke sini dari projectRoutes.js supaya limit
// jumlah anggota tim sesuai paket langganan tetap ditegakkan pada endpoint
// members yang sekarang aktif (yang lama, di projectRoutes.js, sudah dihapus).
const { checkTeamLimit } = require('../middleware/SubscriptionsMiddleware');

const {
  getMembers,
  createMember,
  updateMember,
  deleteMember
} = require('../controllers/projectMemberController');

/* ======================================================
   🔒 Semua route di bawah wajib login (JWT)
====================================================== */
router.use(verifyToken);

/* ======================================================
   ROUTES
====================================================== */

// GET ALL MEMBERS — semua role yang login boleh melihat
router.get(
  '/projects/:projectId/members',
  getMembers
);

// CREATE MEMBER — hanya superadmin & admin (selaras dengan canManageMember di Members.jsx)
router.post(
  '/projects/:projectId/members',
  authorize(['superadmin', 'admin']),
  checkTeamLimit,
  createMember
);

// UPDATE MEMBER — hanya superadmin & admin
router.put(
  '/projects/:projectId/members/:id',
  authorize(['superadmin', 'admin']),
  updateMember
);

// DELETE MEMBER — hanya superadmin & admin
router.delete(
  '/projects/:projectId/members/:id',
  authorize(['superadmin', 'admin']),
  deleteMember
);

module.exports = router;