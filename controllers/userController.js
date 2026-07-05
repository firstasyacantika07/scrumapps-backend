// controllers/userController.js
const db = require('../config/db');
const bcrypt = require('bcryptjs');

// =========================================================================
// 👑 1. GET ALL USERS GLOBAL (Khusus Superadmin - Lintas Seluruh Perusahaan)
// =========================================================================
exports.getAllUsersGlobal = async (req, res) => {
  try {
    // Superadmin menarik seluruh data pengguna lintas tenant via tabel pivot tbr_tenant_users
    const [rows] = await db.query(`
      SELECT 
        u.id, 
        u.name, 
        u.email, 
        tu.role, 
        u.phone_number, 
        u.gender, 
        tu.tenant_id,
        t.package_type, 
        t.status AS subscription_status 
      FROM tbr_users u
      LEFT JOIN tbr_tenant_users tu ON u.id = tu.user_id
      LEFT JOIN tbr_tenants t ON tu.tenant_id = t.id
      ORDER BY u.id DESC
    `);

    return res.status(200).json({
      success: true,
      message: "Seluruh data user global berhasil ditarik.",
      data: rows
    });
  } catch (err) {
    console.error("❌ GET GLOBAL USERS ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// =========================================================================
// 🏢 2. GET USERS BY TENANT (Khusus Tenant Admin / Halaman Users.jsx / Members.jsx)
// =========================================================================
exports.getUsersByTenant = async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;

    if (!tenantId) {
      return res.status(400).json({ 
        success: false, 
        message: "Identifikasi Tenant tidak valid pada sesi Anda." 
      });
    }

    // ✅ FIX: Data ditarik lewat tabel pivot tbr_tenant_users agar terisolasi per-tenant aktif
    const [rows] = await db.query(`
      SELECT 
        u.id, 
        u.name, 
        u.email, 
        tu.role, 
        u.phone_number, 
        u.gender 
      FROM tbr_tenant_users tu
      JOIN tbr_users u ON tu.user_id = u.id
      WHERE tu.tenant_id = ?
      ORDER BY u.name ASC
    `, [tenantId]);

    return res.status(200).json({
      success: true,
      message: "Data anggota tim berhasil dimuat.",
      data: rows
    });
  } catch (err) {
    console.error("❌ GET TENANT USERS ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

// =========================================================================
// 🚀 3. CREATE USER (Dashboard Modal / Auto-Join Project / Multi-Tenant Safe)
// =========================================================================
exports.createUser = async (req, res) => {
  const tenantId = req.user?.tenant_id;

  // Proteksi utama: Pastikan admin memiliki tenant_id yang jelas
  if (!tenantId) {
    return res.status(403).json({
      success: false,
      message: "Akses ditolak: Workspace Anda tidak teridentifikasi."
    });
  }

  try {
    const { name, email, password, role, phone_number, gender } = req.body;

    // VALIDASI WAJIB
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Nama, email, dan password wajib diisi."
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const userRole = role ? String(role).replace(/\s+/g, '').toLowerCase().trim() : 'teamdeveloper';

    // ✨ GUNAKAN TRANSAKSI DB: Menjamin atomisitas penulisan ke tbr_users, tbr_tenant_users, dan tbr_project_members
    await db.query("START TRANSACTION");

    let finalUserId;

    // Cek apakah email sudah terdaftar secara global di sistem
    const [existing] = await db.query('SELECT id FROM tbr_users WHERE email = ?', [cleanEmail]);

    if (existing.length > 0) {
      finalUserId = existing[0].id;

      // Cek apakah user yang sudah terdaftar tersebut ternyata sudah ada di tenant ini
      const [inTenant] = await db.query(
        'SELECT id FROM tbr_tenant_users WHERE user_id = ? AND tenant_id = ?', 
        [finalUserId, tenantId]
      );

      if (inTenant.length > 0) {
        await db.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "User dengan email ini sudah bergabung di dalam workspace Anda."
        });
      }

      // Kasus Multi-Tenant: User sudah ada di sistem global tapi belum join ke tenant ini,
      // kita langsung hubungkan ke tenant via tabel pivot.
      await db.query(
        `INSERT INTO tbr_tenant_users (tenant_id, user_id, role, joined_at) VALUES (?, ?, ?, NOW())`,
        [tenantId, finalUserId, userRole]
      );

    } else {
      // Kasus User Baru: Buat entitas user baru di tbr_users global
      const hash = await bcrypt.hash(password.trim(), 10);
      const [insertUserResult] = await db.query(
        `INSERT INTO tbr_users (name, email, password, phone_number, gender, created_at) VALUES (?, ?, ?, ?, ?, NOW())`,
        [name.trim(), cleanEmail, hash, phone_number || null, gender || 'male']
      );

      finalUserId = insertUserResult.insertId;

      // Hubungkan user baru tersebut ke tenant aktif saat ini
      await db.query(
        `INSERT INTO tbr_tenant_users (tenant_id, user_id, role, joined_at) VALUES (?, ?, ?, NOW())`,
        [tenantId, finalUserId, userRole]
      );
    }

    // 🔥 SINKRONISASI OTOMATIS KE PROYEK DI TENANT
    const [activeProjects] = await db.query(
      `SELECT id FROM tbr_projects WHERE tenant_id = ?`, 
      [tenantId]
    );

    if (activeProjects.length > 0) {
      const memberInsertValues = activeProjects.map(proj => [proj.id, finalUserId, userRole]);
      await db.query(
        `INSERT INTO tbr_project_members (project_id, user_id, role_in_project) VALUES ?`,
        [memberInsertValues]
      );
    }

    // Jika semua proses aman, komit data secara permanen
    await db.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "User berhasil ditambahkan dan terhubung otomatis ke proyek di dalam workspace ini."
    });

  } catch (err) {
    await db.query("ROLLBACK");
    console.error("❌ CREATE USER ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Gagal memproses pembuatan atau penambahan user.",
      error: err.message
    });
  }
};

// =========================================================================
// 🗑️ 4. DELETE USER FROM WORKSPACE (Aman Terisolasi)
// =========================================================================
exports.deleteUser = async (req, res) => {
  const userId = req.params.id;
  const tenantId = req.user?.tenant_id;

  if (!tenantId) {
    return res.status(403).json({ success: false, message: "Sesi tidak valid." });
  }

  try {
    // ✅ FIX: Keamanan Utama - Cek keberadaan user via tabel pivot tbr_tenant_users
    const [userCheck] = await db.query(
      'SELECT id FROM tbr_tenant_users WHERE user_id = ? AND tenant_id = ?', 
      [userId, tenantId]
    );

    if (userCheck.length === 0) {
      return res.status(403).json({ 
        success: false, 
        message: "Akses Ditolak: User tidak ditemukan di dalam workspace Anda." 
      });
    }

    // START TRANSACTION untuk memutus hubungan keanggotaan secara menyeluruh
    await db.query("START TRANSACTION");

    // 1. Hapus keanggotaan user pada project-project milik tenant ini saja
    await db.query(`
      DELETE pm FROM tbr_project_members pm
      JOIN tbr_projects p ON pm.project_id = p.id
      WHERE pm.user_id = ? AND p.tenant_id = ?
    `, [userId, tenantId]);

    // 2. Hapus relasi user dari workspace ini di tabel pivot
    await db.query(
      'DELETE FROM tbr_tenant_users WHERE user_id = ? AND tenant_id = ?', 
      [userId, tenantId]
    );

    // [Opsional]: Jika user tidak memiliki workspace lain lagi sama sekali di sistem,
    // Anda bisa menghapusnya dari tbr_users global. Namun standarnya dibiarkan 
    // agar riwayat data global akun tetap terjaga.

    await db.query("COMMIT");

    return res.status(200).json({ 
      success: true,
      message: "User berhasil dikeluarkan dari workspace dan seluruh proyek terkait secara permanen." 
    });

  } catch (err) {
    await db.query("ROLLBACK");
    console.error("❌ DELETE USER ERROR:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
};