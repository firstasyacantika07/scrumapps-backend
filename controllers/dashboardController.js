const db = require('../config/db');

// =========================================================================
// 🏢 1. TENANT/WORKSPACE DASHBOARD (Untuk User Biasa & Admin Workspace)
// =========================================================================
/**
 * getStats:
 * Mengambil ringkasan data proyek spesifik untuk workspace/tenant tertentu.
 */
exports.getStats = async (req, res) => {
    try {
        const userId = req.user.id;
        // 🐛 BUG KEAMANAN DITEMUKAN & DIPERBAIKI: sebelumnya tenantId diambil dari
        // header `x-tenant-id` yang DIKIRIM CLIENT — artinya siapa pun yang login
        // (role apa pun, tenant mana pun) bisa mengganti header ini secara manual
        // dan melihat statistik project milik tenant LAIN. tenant_id sekarang
        // diambil dari req.user (hasil verifikasi JWT di middleware verifyToken),
        // bukan dari input yang bisa dipalsukan.
        const tenantId = req.user.tenant_id;

        if (!tenantId) {
            return res.status(400).json({ success: false, message: "Akun Anda tidak terhubung ke tenant manapun." });
        }

        // 1. Query untuk statistik proyek dengan nama tabel yang benar (tbr_projects)
        const [projectStats] = await db.query(
            `SELECT 
                COUNT(*) as totalProjects,
                SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as completedProjects,
                SUM(CASE WHEN status = 'on_progress' THEN 1 ELSE 0 END) as activeProjects
             FROM tbr_projects 
             WHERE tenant_id = ?`, 
            [tenantId]
        );

        // 2. Ambil 5 aktivitas proyek terbaru dalam lingkup tenant
        const [recentActivity] = await db.query(
            'SELECT name, status, updated_at FROM tbr_projects WHERE tenant_id = ? ORDER BY updated_at DESC LIMIT 5',
            [tenantId]
        );

        // 3. Pastikan data tidak kosong
        const summary = projectStats[0] || { totalProjects: 0, completedProjects: 0, activeProjects: 0 };

        // 4. Kirim respon
        return res.status(200).json({
            success: true,
            data: {
                summary: {
                    totalProjects: Number(summary.totalProjects) || 0,
                    completedProjects: Number(summary.completedProjects) || 0,
                    activeProjects: Number(summary.activeProjects) || 0
                },
                recentActivity: recentActivity,
                user: {
                    role: req.user.role
                }
            }
        });

    } catch (error) {
        console.error("Dashboard Stats Error:", error.message);
        return res.status(500).json({ 
            success: false, 
            message: "Gagal mengambil data statistik dashboard", 
            error: error.message 
        });
    }
};

// =========================================================================
// 👑 2. SUPERADMIN DASHBOARD (Global Platform SaaS - Memakai tbr_tenants)
// =========================================================================

/**
 * getDashboardStats:
 * Mengambil statistik akumulatif seluruh platform untuk kebutuhan Superadmin.
 */
exports.getDashboardStats = async (req, res) => {
    try {
        // Catatan: proteksi akses sudah ditangani middleware `authorize('superadmin')`
        // di dashboardRoutes.js. Sebelumnya ada pengecekan role di sini yang
        // mengevaluasi kondisi tapi tidak pernah return/block apa pun (dead code,
        // membingungkan) — sudah dihapus.

        // Hitung total tenant dari tbr_tenants
        const [tenantCount] = await db.query('SELECT COUNT(*) as totalTenants FROM tbr_tenants');
        // Hitung total user dari tbr_users
        const [userCount] = await db.query('SELECT COUNT(*) as totalUsers FROM tbr_users');
        // Hitung total subscription aktif
        const [activeSubs] = await db.query("SELECT COUNT(*) as activeSubs FROM tbr_tenants WHERE status = 'active'");

        // 🛠️ FIX: sebelumnya field ini tidak pernah di-query, sehingga di frontend
        // (SuperAdminView) Total Pendapatan & rasio paket selalu tampil 0 / kosong.
        // Hitung breakdown per package_type untuk kebutuhan chart Free/Pro/Enterprise.
        const [tierBreakdown] = await db.query(
            `SELECT package_type, COUNT(*) as jumlah FROM tbr_tenants GROUP BY package_type`
        );

        const tierMap = { free: 0, pro: 0, enterprise: 0 };
        for (const row of tierBreakdown) {
            const key = (row.package_type || '').toLowerCase();
            if (key in tierMap) tierMap[key] = Number(row.jumlah);
        }

        // 🐛 BUG DITEMUKAN & DIPERBAIKI: kolom di tabel tbr_payments bernama
        // `payment_status`, BUKAN `status`. Query lama selalu gagal dengan
        // ER_BAD_FIELD_ERROR ("Unknown column 'status'") lalu ke-swallow oleh
        // .catch() di bawah, sehingga totalRevenue di dashboard SELALU tampil 0
        // walau data pembayaran sudah ada di tbr_payments (24 baris).
        // Nilai payment_status yang tercatat sejauh ini uppercase (mis. 'PENDING'),
        // jadi pencocokan status "berhasil" dibuat case-insensitive dan mencakup
        // beberapa istilah umum. Sesuaikan daftar ini dengan status pasti yang
        // di-set oleh webhook/callback payment gateway kamu saat transaksi sukses.
        const [revenueResult] = await db.query(
            `SELECT COALESCE(SUM(amount), 0) as totalRevenue 
             FROM tbr_payments 
             WHERE UPPER(payment_status) IN ('PAID', 'SUCCESS', 'SETTLEMENT', 'COMPLETED')`
        ).catch((err) => {
            console.error("Revenue Query Error:", err.message);
            return [[{ totalRevenue: 0 }]];
        });

        return res.status(200).json({
            success: true,
            data: {
                totalCompanies: tenantCount[0].totalTenants, // Properti disamakan dengan kebutuhan frontend
                totalUsers: userCount[0].totalUsers,
                activeSubscriptions: activeSubs[0].activeSubs,
                totalRevenue: Number(revenueResult?.[0]?.totalRevenue) || 0,
                freeTier: tierMap.free,
                proTier: tierMap.pro,
                enterpriseTier: tierMap.enterprise
            }
        });
    } catch (error) {
        console.error("Superadmin Stats Error:", error.message);
        return res.status(500).json({ 
            success: false, 
            message: "Gagal memuat statistik dashboard superadmin.",
            error: error.message 
        });
    }
};

/**
 * getRecentTenants:
 * Mengambil 5 tenant/perusahaan yang baru saja mendaftar ke platform ScrumApps.
 */
exports.getRecentTenants = async (req, res) => {
    try {
        // Mengambil 5 tenant terbaru dari tbr_tenants
        // 🛠️ FIX: kolom nama perusahaan (company_name) sebelumnya tidak di-SELECT,
        // padahal frontend membaca c.company_name || c.name. Akibatnya nama
        // perusahaan selalu fallback ke teks statis "Workspace".
        // Sesuaikan nama kolom company_name di bawah dengan skema tabel tbr_tenants Anda.
        const [rows] = await db.query(`
            SELECT 
                id, 
                company_name,
                package_type, 
                billing_cycle, 
                status, 
                created_at 
            FROM tbr_tenants 
            ORDER BY created_at DESC 
            LIMIT 5
        `);

        return res.status(200).json({
            success: true,
            data: rows // Akan dipetakan oleh frontend ke tabel Recent Companies
        });
    } catch (error) {
        console.error("Superadmin Recent Tenants Error:", error.message);
        return res.status(500).json({ 
            success: false, 
            message: "Gagal memuat data perusahaan terbaru.",
            error: error.message 
        });
    }
};