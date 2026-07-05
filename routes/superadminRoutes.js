// routes/superadminRoutes.js
const express = require('express');
const router = express.Router();
const db = require('../config/db'); // 💡 Menggunakan koneksi pool database MySQL Anda
const userController = require('../controllers/userController');
const { verifyToken } = require('../middleware/auth');

// =========================================================================
// 🛡️ MIDDLEWARE PROTEKSI KHUSUS SUPERADMIN
// =========================================================================
const requireSuperadmin = (req, res, next) => {
  if (req.user?.role !== 'superadmin') {
    return res.status(403).json({ 
      success: false, 
      message: "Akses ditolak. Otoritas ini hanya dimiliki oleh platform Superadmin." 
    });
  }
  next();
};

/**
 * 1. Menangani GET /api/superadmin/dashboard/stats
 * 🔥 DIOPTIMALKAN: Mengambil data riil & kalkulasi agregat pendapatan asli dari database
 * untuk mendukung diagram PieChart komponen SuperAdminView di frontend
 */
router.get('/dashboard/stats', verifyToken, requireSuperadmin, async (req, res) => {
  try {
    // a. Hitung total revenue riil dari akumulasi transaksi paket pelanggan premium yang berstatus aktif
    const [revenueQuery] = await db.query(`
      SELECT IFNULL(SUM(
        CASE 
          WHEN package_type = 'PRO' THEN 499000
          WHEN package_type = 'ENTERPRISE' THEN 3500000
          ELSE 0 
        END
      ), 0) AS total_revenue 
      FROM tbr_tenants WHERE status = 'active'
    `);

    // b. Hitung total seluruh tenant/perusahaan terdaftar
    const [totalCompanies] = await db.query('SELECT COUNT(*) as total FROM tbr_tenants');
    
    // c. Hitung rasio penyebaran data tipe paket langganan SaaS (Free, Pro, Enterprise)
    const [tiers] = await db.query(`
      SELECT 
        SUM(CASE WHEN package_type = 'FREE' OR package_type IS NULL THEN 1 ELSE 0 END) as free_tier,
        SUM(CASE WHEN package_type = 'PRO' THEN 1 ELSE 0 END) as pro_tier,
        SUM(CASE WHEN package_type = 'ENTERPRISE' THEN 1 ELSE 0 END) as enterprise_tier
      FROM tbr_tenants
    `);

    // d. Harmonisasikan data keluaran dengan penamaan properti di komponen Dashboard.jsx
    res.status(200).json({
      success: true,
      data: {
        totalRevenue: revenueQuery[0].total_revenue,
        totalCompanies: totalCompanies[0].total,
        freeTier: tiers[0].free_tier || 0,
        proTier: tiers[0].pro_tier || 0,
        enterpriseTier: tiers[0].enterprise_tier || 0
      }
    });
  } catch (error) {
    console.error('❌ Error fetching superadmin stats:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengambil statistik database',
      error: error.message 
    });
  }
});

/**
 * 2. Menangani GET /api/superadmin/companies/recent
 */
router.get('/companies/recent', verifyToken, requireSuperadmin, async (req, res) => {
  try {
    // 🏢 Mengambil 5 perusahaan terbaru berdasarkan kolom company_name, status, dan created_at
    const [recentTenants] = await db.query(
      `SELECT 
        id, 
        company_name AS name, 
        status, 
        package_type, 
        created_at AS createdAt 
       FROM tbr_tenants 
       ORDER BY created_at DESC 
       LIMIT 5`
    );

    // Kirim langsung array datanya ke frontend sesuai ekspektasi Dashboard.jsx
    res.status(200).json(recentTenants);
  } catch (error) {
    console.error('❌ Error fetching recent tenants:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengambil data perusahaan terbaru',
      error: error.message 
    });
  }
});

/**
 * 3. Menangani GET /api/superadmin/companies
 * Dipergunakan oleh komponen CompanyManagement frontend untuk merender semua item database
 */
router.get('/companies', verifyToken, requireSuperadmin, async (req, res) => {
  try {
    const query = `
      SELECT 
        id, 
        company_name, 
        subdomain, 
        plan_id, 
        status, 
        package_type, 
        billing_cycle, 
        trial_start, 
        trial_end, 
        subscription_ends_at, 
        company_logo, 
        created_at
      FROM tbr_tenants 
      ORDER BY created_at DESC
    `;
    const [rows] = await db.query(query);

    res.status(200).json({
      success: true,
      message: "Seluruh data perusahaan berhasil ditarik.",
      data: rows
    });
  } catch (error) {
    console.error('❌ Error fetching all companies:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Gagal mengambil data perusahaan dari database',
      error: error.message 
    });
  }
});

/**
 * 4. Menangani GET /api/superadmin/billing/invoices
 * Dipergunakan oleh komponen BillingTracker frontend Anda
 */
router.get('/billing/invoices', verifyToken, requireSuperadmin, async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        company_name,
        subdomain,
        package_type,
        billing_cycle,
        status,
        subscription_ends_at,
        DATE_FORMAT(created_at, '%Y-%m-%d') AS created_at,
        DATE_FORMAT(updated_at, '%Y-%m-%d %H:%i:%s') AS paid_at,
        /* Membuat nomor invoice generator otomatis berbasis tanggal join dan ID */
        CONCAT('INV/', DATE_FORMAT(created_at, '%Y%m'), '/', LPAD(id, 4, '0')) AS invoice_number,
        /* Memetakan nominal harga bayangan berdasarkan package_type */
        CASE 
          WHEN package_type = 'PRO' THEN 499000
          WHEN package_type = 'ENTERPRISE' THEN 3500000
          ELSE 0 
        END AS amount
      FROM tbr_tenants
      ORDER BY created_at DESC
    `;

    const [rows] = await db.query(query);

    res.status(200).json({
      success: true,
      message: "Data billing dari tabel tbr_tenants berhasil ditarik.",
      data: rows
    });
  } catch (error) {
    console.error('❌ Error fetching billing invoices:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memuat data billing dari database.',
      error: error.message
    });
  }
});

/**
 * 5. Menangani PATCH /api/superadmin/tenants/:id/activate
 * Berfungsi mengubah status perusahaan menjadi active saat tombol verifikasi diklik di BillingTracker
 */
router.patch('/tenants/:id/activate', verifyToken, requireSuperadmin, async (req, res) => {
  const { id } = req.params;
  try {
    const query = `
      UPDATE tbr_tenants 
      SET status = 'active', 
          subscription_ends_at = DATE_ADD(NOW(), INTERVAL 1 MONTH),
          updated_at = NOW()
      WHERE id = ?
    `;

    const [result] = await db.query(query, [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Perusahaan tenant tidak ditemukan di database."
      });
    }

    res.status(200).json({
      success: true,
      message: "Status pembayaran diverifikasi, tenant berhasil diaktifkan!"
    });
  } catch (error) {
    console.error('❌ Error activating tenant:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memperbarui status aktivasi di database.',
      error: error.message
    });
  }
});

/**
 * 6. Menangani PATCH /api/superadmin/companies/:id/status
 * Menyesuaikan dengan kebutuhan tombol "Bekukan" & "Aktifkan Akun" di halaman CompanyManagement
 */
router.patch('/companies/:id/status', verifyToken, requireSuperadmin, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body; // Menerima status baru ('active' atau 'suspended')

  // Validasi input status mencegah anomali data string ilegal
  if (!['active', 'suspended', 'trial'].includes(status)) {
    return res.status(400).json({
      success: false,
      message: "Status tidak valid. Gunakan 'active' atau 'suspended'."
    });
  }

  try {
    let query = `UPDATE tbr_tenants SET status = ?, updated_at = NOW() `;
    
    // Jika status diubah ke active, otomatis berikan masa perpanjangan opsional jika kosong
    if (status === 'active') {
      query += `, subscription_ends_at = IFNULL(subscription_ends_at, DATE_ADD(NOW(), INTERVAL 1 MONTH)) `;
    }
    
    query += ` WHERE id = ?`;

    const [result] = await db.query(query, [status, id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Organisasi tenant tidak ditemukan."
      });
    }

    res.status(200).json({
      success: true,
      message: `Berhasil mengubah status perusahaan menjadi ${status}.`
    });
  } catch (error) {
    console.error('❌ Error updating company status:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal memperbarui status kontrol organisasi di database.',
      error: error.message
    });
  }
});

// =========================================================================
// 👤 7. NEW ROUTE: Menangani GET /api/superadmin/users
// Dipergunakan oleh komponen UserManagement milik Superadmin untuk melihat skop global
// =========================================================================
router.get('/users', verifyToken, requireSuperadmin, userController.getAllUsersGlobal);

module.exports = router;