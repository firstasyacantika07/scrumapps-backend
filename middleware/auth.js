const jwt = require('jsonwebtoken');
const db = require('../config/db');

/**
 * =========================================================================
 * 🔐 MIDDLEWARE VERIFY TOKEN (SINKRONISASI MULTI-TENANT SAAS)
 * =========================================================================
 */
const verifyToken = async (req, res, next) => {
  try {
    // 1. Mengambil header dengan ekstraksi toleran spasi & huruf besar/kecil
    const authHeader = req.header("Authorization") || req.headers["authorization"];

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Token diperlukan",
      });
    }

    // 2. Memotong string 'Bearer ' dengan aman menggunakan split
    const token = authHeader.split(" ")[1];

    if (!token || token === "null" || token === "undefined") {
      return res.status(401).json({
        success: false,
        message: "Token diperlukan",
      });
    }

    // 3. Verifikasi tanda tangan token JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const requestedTenantId = req.header("X-Tenant-ID");

    // 4. Tarik data user dan cek akses ke tenant
    let sql;
    let params;

    if (requestedTenantId) {
      sql = `
        SELECT 
          u.id, u.name, u.email,
          tu.role, tu.tenant_id,
          t.status as tenant_status, t.package_type, t.billing_cycle, t.trial_start, t.trial_end, t.subscription_ends_at
        FROM tbr_users u
        INNER JOIN tbr_tenant_users tu ON u.id = tu.user_id
        INNER JOIN tbr_tenants t ON tu.tenant_id = t.id
        WHERE u.id = ? AND tu.tenant_id = ?
        LIMIT 1
      `;
      params = [decoded.id, requestedTenantId];
    } else {
      // Fallback: ambil tenant pertama (atau biarkan tenant_id null jika tidak punya workspace)
      sql = `
        SELECT 
          u.id, u.name, u.email,
          tu.role, tu.tenant_id,
          t.status as tenant_status, t.package_type, t.billing_cycle, t.trial_start, t.trial_end, t.subscription_ends_at
        FROM tbr_users u
        LEFT JOIN tbr_tenant_users tu ON u.id = tu.user_id
        LEFT JOIN tbr_tenants t ON tu.tenant_id = t.id
        WHERE u.id = ?
        ORDER BY tu.joined_at ASC
        LIMIT 1
      `;
      params = [decoded.id];
    }

    const [rows] = await db.query(sql, params);

    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "User tidak ditemukan atau tidak memiliki akses ke Workspace ini",
      });
    }

    const user = rows[0];

    // Jika user punya akun tapi belum terdaftar di tenant mana pun (kasus langka)
    if (!user.tenant_id) {
       req.user = {
         id: user.id, name: user.name, email: user.email, role: 'member', tenant_id: null,
         package_type: 'FREE', subscription_status: 'active', billing_cycle: 'NONE'
       };
       return next();
    }

    // 5. Proteksi Tambahan: Jika perusahaan/tenant dibekukan oleh admin utama pusat
    if (user.tenant_status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: "Akses Perusahaan Ditangguhkan: Silakan hubungi bagian administrasi billing.",
      });
    }

    // =========================================================================
    // 🔄 SINKRONISASI CO-CHECK: Pengecekan Kedaluwarsa Realtime di Setiap Request API
    // =========================================================================
    let finalStatus = user.tenant_status || "active";
    let triggerDatabaseUpdate = false;
    const now = new Date();

    // A. Jalur cek kedaluwarsa TRIAL di level tenant
    if (user.billing_cycle === "TRIAL" && user.trial_end) {
      const endTrialDate = new Date(user.trial_end);
      if (now > endTrialDate) {
        finalStatus = "expired";
        triggerDatabaseUpdate = true;
      }
    } 
    // B. Jalur cek kedaluwarsa Paket Komersial Reguler (PRO BULANAN/TAHUNAN) di level tenant
    else if (user.package_type !== "FREE" && user.subscription_ends_at) {
      const endSubDate = new Date(user.subscription_ends_at);
      if (now > endSubDate) {
        finalStatus = "expired";
        triggerDatabaseUpdate = true;
      }
    }

    if (triggerDatabaseUpdate && user.tenant_status !== "expired") {
      await db.query(
        `UPDATE tbr_tenants SET status = 'expired' WHERE id = ?`,
        [user.tenant_id]
      );
    }

    // 🔥 FIX UTAMA: Normalisasi role diseragamkan menggunakan regex /[\s_]+/g
    const cleanRole = user.role 
        ? String(user.role).replace(/[\s_]+/g, '').toLowerCase().trim() 
        : '';

    // 6. Menyimpan data user & status billing ke objek request (req.user)
    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: cleanRole, 
      tenant_id: user.tenant_id,
      package_type: user.package_type || 'FREE',
      subscription_status: finalStatus,
      subscription_ends_at: user.subscription_ends_at,
      trial_start: user.trial_start,
      trial_end: user.trial_end,
      billing_cycle: user.billing_cycle || 'NONE'
    };

    return next(); // Pastikan return next() dipanggil dengan tegas
  } catch (err) {
    console.error("🔥 VERIFY TOKEN ERROR:", err.message);

    if (err.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token kedaluwarsa, silakan login kembali",
      });
    }

    return res.status(401).json({
      success: false,
      message: "Token tidak valid",
    });
  }
};

/**
 * =========================================================================
 * 🛡️ MIDDLEWARE OTORISASI HAK AKSES BERDASAR ROLE (RBAC)
 * =========================================================================
 */
const authorize = (roles = [], options = {}) => {
  if (typeof roles === "string") roles = [roles];
  
  // 🔥 FIX: Gunakan regex /[\s_]+/g yang sama dengan verifyToken
  const forbiddenRoles = options.forbiddenRoles || [];
  const strictForbidden = forbiddenRoles.map(r => r.replace(/[\s_]+/g, '').toLowerCase().trim());

  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: "Unauthorized" });

    const userRole = req.user.role; 
    const allowedRoles = roles.map(r => r.replace(/[\s_]+/g, '').toLowerCase().trim());

    if (strictForbidden.includes(userRole)) {
      return res.status(403).json({ 
        success: false,
        message: "Forbidden: Role Anda sengaja dibatasi untuk aksi ini." 
      });
    }

    // Superadmin mem-bypass semua aksi umum tingkat tenant/workspace
    if (userRole === "superadmin") return next();

    if (roles.length && !allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        success: false, 
        message: "Forbidden: Anda tidak memiliki hak akses untuk menu ini." 
      });
    }

    return next();
  };
};

module.exports = {
  verifyToken,
  authorize
};