// 🟢 DEBUG SEMENTARA: konfirmasi file ini benar-benar ter-load oleh Node.
// Hapus baris ini setelah masalah 404 selesai didiagnosis.
console.log('🟢 billingRoutes.js FILE TER-LOAD, waktu:', new Date().toISOString());

const express = require('express');
const router = express.Router();
const db = require("../config/db");

// Import Controller
const paymentController = require('../controllers/paymentController');
const billingController = require('../controllers/billingController');

// Middleware auth
const { verifyToken, authorize } = require('../middleware/auth');

/* =========================================================================
   🌐 WEBHOOK MIDTRANS (PUBLIC — HARUS SEBELUM router.use(verifyToken)!)
   ========================================================================= */
// Dipanggil server-to-server oleh Midtrans tanpa menggunakan token Bearer/JWT
router.post('/webhook', paymentController.handleMidtransWebhook);

// 🟢 DEBUG SEMENTARA: cek apakah router ini bisa dijangkau sama sekali.
// Test di browser: http://localhost:5000/api/billing/ping
// Hapus route ini setelah masalah 404 selesai didiagnosis.
router.get('/ping', (req, res) => res.json({ ok: true, message: 'billingRoutes reachable' }));


/* =========================================================================
   🔒 PROTECTED ROUTES (Semua rute di bawah wajib login JWT)
   ========================================================================= */
router.use(verifyToken);


/* =========================================================================
   📊 PLANS & STATUS ENDPOINTS
   ========================================================================= */

/**
 * 📊 GET: Mengambil status billing tenant saat ini & sisa kuota utilisasi
 * Endpoint: GET /api/billing/status (atau sesuai mounting di server.js Anda)
 *
 * 🔧 FIX (root cause data "tidak sinkron"): route ini sebelumnya punya logika
 * INLINE duplikat yang terpisah dari billingController.js, dengan bentuk
 * response berbeda (nested di bawah `data.constraints.*`) dan angka limit
 * paket yang berbeda pula dari billingController.js. billingController.js
 * sendiri TIDAK PERNAH ter-require di file ini, jadi versinya yang benar
 * (flat: `data.project_limit`, `data.team_limit`) tidak pernah benar-benar
 * jalan — yang jalan adalah versi inline ini, yang bentuk responsenya tidak
 * cocok dengan yang dibaca frontend. Itu sebabnya dashboard admin selalu
 * menampilkan "0/∞" walau query database-nya sendiri sukses.
 * Sekarang didelegasikan ke satu sumber kebenaran: billingController.js.
 *
 * ⚠️ CATATAN: fix ini sempat ter-revert sekali (file lama ter-upload ulang).
 * Pastikan file hasil terbaru ini yang benar-benar dipakai di server produksi/
 * development Anda -- cek ulang dengan `git diff` atau bandingkan isi file
 * setelah deploy, supaya tidak ter-overwrite balik ke versi lama lagi.
 */
router.get("/status", billingController.getBillingStatus);

/**
 * 🎯 GET: Mengambil daftar penawaran paket langganan dari database
 * Endpoint: GET /api/billing/plans
 */
router.get("/plans", async (req, res) => {
    try {
        const [plans] = await db.query(`SELECT * FROM tbr_plans ORDER BY id ASC`);
        return res.status(200).json({
            success: true,
            data: plans
        });
    } catch (error) {
        console.error("GET PLANS ROUTE ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil data paket penawaran"
        });
    }
});


/* =========================================================================
   💳 MIDTRANS & TRANSACTION ENDPOINTS
   ========================================================================= */

// ⚡ Mengenerate token transaksi via Midtrans Snap (Modal Popup)
router.post('/payment/create-transaction', paymentController.createPayment);

// 📱 Eksekusi direct charge via Midtrans Core API (E-Wallet / Virtual Account)
router.post('/payment/charge', paymentController.createCheckoutSession);

// 🔍 Melakukan polling status manual pengecekan pembayaran berdasarkan Order ID
router.get('/payment/status/:orderId', paymentController.checkPaymentStatus);

// 🚀 Aktivasi manual / bypassing perpanjangan paket subscription
router.post('/subscription/activate', paymentController.activatePlan);


/* =========================================================================
   📄 HISTORY & MANAGEMENT ENDPOINTS (ADMIN ONLY)
   ========================================================================= */

/**
 * 📜 GET: Menampilkan daftar riwayat aktivitas transaksi finansial (Hanya Superadmin)
 * Endpoint: GET /api/billing/history
 */
router.get('/history', authorize(['superadmin', 'Superadmin']), async (req, res) => {
    try {
        // 🔥 FIX: Nama tabel diubah dari tbr_payment menjadi tbr_payments agar sinkron
        const [history] = await db.query(
            `SELECT * FROM tbr_payments ORDER BY created_at DESC LIMIT 50`
        );
        
        return res.status(200).json({
            success: true,
            message: 'Riwayat seluruh transaksi berhasil diambil',
            data: history
        });
    } catch (error) {
        console.error("GET HISTORY ROUTE ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal mengambil data riwayat transaksi"
        });
    }
});

/**
 * ❌ DELETE: Menghapus log/membatalkan entitas draf transaksi pembayaran
 */
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        return res.status(200).json({
            success: true,
            message: `Transaksi dengan id ${id} berhasil dibatalkan`
        });
    } catch (error) {
        console.error("DELETE TRANSACTION ROUTE ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal membatalkan transaksi"
        });
    }
});

module.exports = router;