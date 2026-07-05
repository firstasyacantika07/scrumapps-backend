// routes/userRoutes.js
const express = require('express');
const router = express.Router();

const userController = require('../controllers/userController');
const invitationController = require('../controllers/invitationController');
const { verifyToken } = require('../middleware/auth');

/* =========================================================================
   🔓 1. PUBLIC ROUTES (TANPA TOKEN JWT)
   Harus di paling atas agar tidak sengaja tertelan oleh wildcard /:id di bawah
   ========================================================================= */

// Menangani: GET /api/users/invitations/verify?token=xyz
router.get('/invitations/verify', invitationController.verifyInvitation);

// Menangani: POST /api/users/invitations/accept
router.post('/invitations/accept', invitationController.acceptInvitation);


/* =========================================================================
   🛡️ MIDDLEWARE PROTEKSI GLOBAL
   Semua rute di bawah baris ini wajib melampirkan JWT valid pada header
   ========================================================================= */
router.use(verifyToken);


/* =========================================================================
   🔒 2. PROTECTED BASE ROUTES (BASE API: /api/users)
   Rute statis/akar wajib didahulukan sebelum rute berbasis parameter /:id
   ========================================================================= */

// 🏢 GET: Mengambil list seluruh anggota tim berdasarkan tenant yang sedang aktif login
router.get('/', userController.getUsersByTenant);

// ➕ POST: Membuat user baru via modal dashboard internal workspace
router.post('/', userController.createUser);

// ✉️ POST: Mengirimkan undangan email bergabung ke user baru
router.post('/invitations', invitationController.inviteUser);


/* =========================================================================
   🗂️ 3. DYNAMIC PARAMETER ROUTES (WILDCARD - MUTLAK DI PALING BAWAH)
   ========================================================================= */

// 🗑️ DELETE: Menghapus / mencabut hak akses user tertentu berdasarkan ID
router.delete('/:id', userController.deleteUser);

// ✏️ PUT: Menangani perubahan data profil pengguna internal tim (Multi-Tenant Safe)
router.put('/:id', async (req, res) => {
  try {
    const { name, gender, email, phone_number, password } = req.body;
    const tenantId = req.user?.tenant_id;
    const targetUserId = req.params.id;
    const db = require('../config/db');
    const bcrypt = require('bcryptjs');

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID tidak teridentifikasi pada sesi Anda."
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email wajib diisi."
      });
    }

    // 1. ✅ FIX MULTI-TENANT VALIDATION: Pastikan target user memang terdaftar di workspace admin ini via pivot
    const [membershipCheck] = await db.query(
      `SELECT id FROM tbr_tenant_users WHERE user_id = ? AND tenant_id = ?`,
      [targetUserId, tenantId]
    );

    if (membershipCheck.length === 0) {
      return res.status(403).json({ 
        success: false,
        message: "Akses ditolak: User tidak ditemukan atau bukan merupakan bagian dari workspace Anda." 
      });
    }

    // 2. Normalisasi email
    const cleanEmail = email.trim().toLowerCase();

    // 3. Cek duplikasi email global (kecuali milik user itu sendiri)
    const [emailCheck] = await db.query(
      `SELECT id FROM tbr_users WHERE email = ? AND id != ?`,
      [cleanEmail, targetUserId]
    );

    if (emailCheck.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Email sudah digunakan oleh pengguna lain di sistem."
      });
    }

    // 4. Bangun query dinamis untuk update profil global tbr_users
    let query = `
      UPDATE tbr_users
      SET name=?, gender=?, email=?, phone_number=?
    `;
    let params = [name ? name.trim() : name, gender || 'male', cleanEmail, phone_number || null];

    if (password) {
      const hash = await bcrypt.hash(password.trim(), 10);
      query += `, password=?`;
      params.push(hash);
    }

    query += ` WHERE id=?`;
    params.push(targetUserId);

    await db.query(query, params);

    return res.status(200).json({ 
      success: true,
      message: "Data profil user berhasil diperbarui." 
    });

  } catch (err) {
    console.error("UPDATE USER ERROR:", err);
    return res.status(500).json({ 
      success: false,
      message: "Gagal memperbarui data user.",
      error: err.message 
    });
  }
});

module.exports = router;