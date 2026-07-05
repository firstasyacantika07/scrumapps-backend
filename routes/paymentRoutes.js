const express = require("express");
const router = express.Router();

const paymentController = require("../controllers/paymentController");

// 💡 PENYESUAIAN MIDDLEWARE: Menggunakan verifyToken sesuai standar otentikasi aplikasi Anda
const { verifyToken } = require("../middleware/auth");

// ======================================================
// PUBLIC ROUTES (Bisa diakses tanpa login / token)
// ======================================================

/**
 * @route   GET /api/payment/plans
 * @desc    Mengambil semua daftar paket dari tabel tbr_plans
 * @access  Public
 * * ⚠️ CATATAN FRONTEND: 
 * Jika di server.js file ini di-mount menggunakan app.use('/api/payment', paymentRoutes),
 * maka di Billing.jsx panggilannya harus diubah menjadi: api.get('/payment/plans')
 */
router.get("/plans", paymentController.getPlans);


// ======================================================
// PRIVATE ROUTES (Wajib menyertakan Bearer Token / Login)
// ======================================================

/**
 * @route   POST /api/payment/create-transaction
 * @desc    Membentuk token & URL transaksi via Midtrans Snap API
 * @access  Private
 */
router.post(
  "/create-transaction",
  verifyToken,
  paymentController.createPayment
);

/**
 * @route   POST /api/payment/checkout-session
 * @desc    Direct Charge Method via Midtrans Core API (QRIS, VA Bank, dll)
 * @access  Private
 */
router.post(
  "/checkout-session",
  verifyToken,
  paymentController.createCheckoutSession
);

/**
 * @route   GET /api/payment/status/:orderId
 * @desc    Mengecek status transaksi langsung ke Midtrans API (Manual Polling)
 * @access  Private
 */
router.get(
  "/status/:orderId",
  verifyToken,
  paymentController.checkPaymentStatus
);

/**
 * @route   POST /api/payment/activate-plan
 * @desc    Mengaktifkan paket langganan user (Subscription Logic) setelah sukses
 * @access  Private
 */
router.post(
  "/activate-plan",
  verifyToken,
  paymentController.activatePlan
);

/**
 * @route   POST /api/payment/start-trial
 * @desc    Mengaktifkan fitur PRO Trial selama 7 hari (Hanya bisa 1x per user)
 * @access  Private
 */
router.post(
  "/start-trial",
  verifyToken,
  paymentController.startTrial
);

module.exports = router;