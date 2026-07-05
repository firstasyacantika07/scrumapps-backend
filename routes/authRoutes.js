const express = require("express");
const router = express.Router();

// Impor controller & middleware bawaan project Anda
const authController = require("../controllers/authController");
const { verifyToken } = require("../middleware/auth");

// ======================================================
// 🔐 AUTHENTICATION ROUTES
// ======================================================

/**
 * @route   POST /api/auth/login
 * @desc    Log in user & generate JWT Token beserta data Tenant/SaaS
 * @access  Public
 */
router.post("/login", (req, res, next) => {
  if (!authController?.login) {
    return res.status(500).json({
      success: false,
      message: "Fungsi authController.login tidak ditemukan atau gagal diekspor",
    });
  }
  return authController.login(req, res, next);
});

/**
 * @route   POST /api/auth/google
 * @desc    Log in / Register with Google
 * @access  Public
 */
router.post("/google", (req, res, next) => {
  if (!authController?.googleAuth) {
    return res.status(500).json({
      success: false,
      message: "Fungsi authController.googleAuth tidak ditemukan",
    });
  }
  return authController.googleAuth(req, res, next);
});

/**
 * @route   GET /api/auth/me
 * @desc    Ambil data profile user yang sedang login & validasi kedaluwarsa Tenant
 * @access  Private (Memerlukan token JWT valid)
 */
// Menggunakan verifyToken sebagai middleware pelindung rute /me
router.get("/me", verifyToken, (req, res, next) => {
  if (!authController?.getMe) {
    return res.status(500).json({
      success: false,
      message: "Fungsi authController.getMe tidak ditemukan atau gagal diekspor",
    });
  }
  return authController.getMe(req, res, next);
});

/**
 * @route   POST /api/auth/register
 * @desc    Registrasi user baru + buat Tenant baru (auto-login setelah daftar)
 * @access  Public
 */
router.post("/register", (req, res, next) => {
  if (!authController?.register) {
    return res.status(500).json({
      success: false,
      message: "Fungsi authController.register tidak ditemukan atau gagal diekspor",
    });
  }
  return authController.register(req, res, next);
});

/**
 * @route   POST /api/auth/forgot-password
 * @desc    Kirim tautan atur ulang kata sandi ke email user (jika terdaftar)
 * @access  Public
 */
router.post("/forgot-password", (req, res, next) => {
  if (!authController?.forgotPassword) {
    return res.status(500).json({
      success: false,
      message: "Fungsi authController.forgotPassword tidak ditemukan atau gagal diekspor",
    });
  }
  return authController.forgotPassword(req, res, next);
});

/**
 * @route   POST /api/auth/reset-password
 * @desc    Atur ulang kata sandi menggunakan token dari email
 * @access  Public
 */
router.post("/reset-password", (req, res, next) => {
  if (!authController?.resetPassword) {
    return res.status(500).json({
      success: false,
      message: "Fungsi authController.resetPassword tidak ditemukan atau gagal diekspor",
    });
  }
  return authController.resetPassword(req, res, next);
});

/**
 * 🔍 DEBUG SEMENTARA — hapus route ini setelah masalah login selesai!
 * @route   GET /api/auth/debug-users
 */
router.get("/debug-users", (req, res, next) => {
  return authController.debugListUsers(req, res, next);
});

// ======================================================
// ✉️ INVITATION ROUTES (WORKSPACE COLLABORATION)
// ======================================================
// 🔧 FIX: Route invitation di sini DIHAPUS karena duplikat dengan
// backend/routes/invitationRoutes.js (yang di-mount terpisah, biasanya
// sebagai /api/invitations). Route di file ini sebelumnya tidak pernah
// kepakai oleh frontend (jadi kode mati), tapi dibiarkan berisiko
// membingungkan jika ada perubahan logic dilakukan di tempat yang salah.
// Satu-satunya sumber kebenaran untuk route invitation sekarang ada di
// backend/routes/invitationRoutes.js.

module.exports = router;