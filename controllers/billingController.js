// controllers/billingController.js
const db = require('../config/db');

/**
 * =========================================================================
 * 📋 STATUS BILLING & PEMAKAIAN KUOTA WORKSPACE (MULTI-TENANT SAFE)
 * =========================================================================
 * * CATATAN SKEMA:
 * - Tabel tbr_tenants punya kolom: package_type, billing_cycle, status,
 * trial_start, trial_end, subscription_ends_at (BUKAN start_date/end_date).
 * - Batas project_limit / team_limit ditentukan dari package_type
 * (FREE / PRO / ENTERPRISE).
 * =========================================================================
 */

// Batas default kuota per paket.
const PLAN_LIMITS = {
    free: { project_limit: 1, team_limit: 5 },
    pro: { project_limit: 15, team_limit: 20 },
    enterprise: { project_limit: null, team_limit: null } // null = unlimited (∞)
};

/**
 * 🟢 GET STATUS BILLING WORKSPACE
 */
exports.getBillingStatus = async (req, res) => {
    try {
        // Utamakan tenant_id dari JWT (req.user) demi keamanan terverifikasi
        const tenantId = req.user?.tenant_id || req.headers['x-tenant-id'];

        if (!tenantId) {
            return res.status(400).json({
                success: false,
                message: "Tenant ID tidak ditemukan pada request."
            });
        }

        // Ambil data paket dan status langganan dari tabel tenant utama
        const [[tenant]] = await db.query(
            `SELECT package_type, billing_cycle, status, trial_start, trial_end, subscription_ends_at 
             FROM tbr_tenants WHERE id = ?`,
            [tenantId]
        );

        if (!tenant) {
            return res.status(404).json({
                success: false,
                message: "Data workspace/tenant tidak ditemukan."
            });
        }

        // Tentukan batas tanggal aktif paket berdasarkan billing cycle (TRIAL vs PAID)
        const relevantEndDate = tenant.billing_cycle === 'TRIAL' ? tenant.trial_end : tenant.subscription_ends_at;

        // Hitung sisa hari aktif masa berlaku paket
        let remainingDays = 0;
        if (relevantEndDate) {
            const end = new Date(relevantEndDate);
            const now = new Date();
            const diffMs = end.getTime() - now.getTime();
            remainingDays = diffMs > 0 ? Math.ceil(diffMs / (1000 * 60 * 60 * 24)) : 0;
        }

        const packageKey = (tenant.package_type || 'free').toLowerCase();
        const limits = PLAN_LIMITS[packageKey] || PLAN_LIMITS.free;

        // 1. Hitung aktual pemakaian jumlah proyek di bawah tenant aktif
        const [[projectUsage]] = await db.query(
            `SELECT COUNT(*) as cnt FROM tbr_projects WHERE tenant_id = ?`,
            [tenantId]
        );

        // 2. ✅ FIX MULTI-TENANT: Hitung aktual pemakaian jumlah anggota via tabel pivot tbr_tenant_users
        const [[teamUsage]] = await db.query(
            `SELECT COUNT(*) as cnt FROM tbr_tenant_users WHERE tenant_id = ?`,
            [tenantId]
        );

        return res.status(200).json({
            success: true,
            data: {
                package_type: (tenant.package_type || 'FREE').toUpperCase(),
                billing_cycle: (tenant.billing_cycle || 'TRIAL').toUpperCase(),
                remaining_days: remainingDays,
                project_used: projectUsage?.cnt || 0,
                project_limit: limits.project_limit, // null berarti ∞ (unlimited)
                team_used: teamUsage?.cnt || 0,
                team_limit: limits.team_limit
            }
        });

    } catch (error) {
        console.error("Billing Status Error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Gagal memuat status billing workspace.",
            error: error.message
        });
    }
};

/**
 * 🚀 NEW FUNCTION: UPDATE / UPGRADE SUBSCRIPTION (BULANAN ATAU TAHUNAN)
 * Fungsi ini dipanggil setelah proses transaksi/checkout pembayaran berhasil dilakukan.
 */
exports.updateSubscription = async (req, res) => {
    try {
        const tenantId = req.user?.tenant_id;
        const { billing_cycle } = req.body; // Menerima payload: "MONTHLY" atau "YEARLY"

        if (!tenantId) {
            return res.status(400).json({
                success: false,
                message: "Tenant ID tidak terdeteksi."
            });
        }

        // Validasi input billing cycle
        if (!billing_cycle || !['MONTHLY', 'YEARLY'].includes(billing_cycle.toUpperCase())) {
            return res.status(400).json({
                success: false,
                message: "Siklus tagihan tidak valid. Gunakan 'MONTHLY' atau 'YEARLY'."
            });
        }

        const cleanCycle = billing_cycle.toUpperCase();
        let subscriptionEndsAt = new Date();

        // Hitung masa berlaku langganan berdasarkan pilihan siklus
        if (cleanCycle === 'YEARLY') {
            // Jika tahunan, tambahkan 1 tahun penuh ke depan
            subscriptionEndsAt.setFullYear(subscriptionEndsAt.getFullYear() + 1);
        } else {
            // Jika bulanan, default tambahkan 30 hari kalender
            subscriptionEndsAt.setDate(subscriptionEndsAt.getDate() + 30);
        }

        // Jalankan query update data status langganan pada tenant
        await db.query(
            `UPDATE tbr_tenants 
             SET 
                package_type = 'PRO', 
                billing_cycle = ?, 
                status = 'ACTIVE', 
                is_trial = 0, 
                subscription_ends_at = ?, 
                updated_at = NOW() 
             WHERE id = ?`,
            [cleanCycle, subscriptionEndsAt, tenantId]
        );

        return res.status(200).json({
            success: true,
            message: `Workspace Anda berhasil di-upgrade ke paket PRO (${cleanCycle}).`,
            expires_at: subscriptionEndsAt
        });

    } catch (error) {
        console.error("Update Subscription Error:", error.message);
        return res.status(500).json({
            success: false,
            message: "Gagal memproses perubahan paket langganan.",
            error: error.message
        });
    }
};