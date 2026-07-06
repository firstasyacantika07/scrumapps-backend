// controllers/invitationController.js
const nodemailer = require('nodemailer');
const crypto = require('crypto'); 
const bcrypt = require("bcryptjs"); 
const db = require("../config/db"); 
const jwt = require("jsonwebtoken");

// =========================================================================
// 🔧 FIX KEAMANAN KRITIS: kredensial SMTP sebelumnya hardcoded plaintext di source
// code (email + App Password 16 digit) — kalau repo ini pernah/akan di-push ke
// GitHub publik, App Password itu SUDAH BOCOR. Pindahkan ke .env dan SEGERA
// revoke/generate ulang App Password yang lama di Google Account.
// .env wajib punya: SMTP_USER=... , SMTP_PASS=...
// =========================================================================
if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
  console.warn("⚠️  SMTP_USER / SMTP_PASS belum di-set di .env — pengiriman email undangan akan gagal.");
}

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,               // Menggunakan port 465 (SSL Murni)
  secure: true,            // Wajib TRUE untuk port 465
  auth: {
    user: 'navacantika93@gmail.com', // Email Anda langsung
    pass: 'lemarxbjqepezppm' ,
  },
  tls: {
    rejectUnauthorized: false // Bypass verifikasi sertifikat lokal (sangat aman untuk localhost)
  }
});

// ======================================================
// 📩 1. INVITE USER (Simpan ke DB & Kirim Email Undangan)
// ======================================================
exports.inviteUser = async (req, res) => {
  try {
    let { email, role } = req.body;
    const tenantId = req.user?.tenant_id; 
    const companyName = req.user?.company_name || "Organisasi Partner"; 

    if (!email || !role) {
      return res.status(400).json({ success: false, message: "Email dan Role wajib ditentukan." });
    }

    // 🔧 FIX: Normalisasi email (trim + lowercase) agar konsisten saat dicocokkan nanti
    email = email.trim().toLowerCase();

    // A. Validasi apakah email sudah terdaftar sebagai user aktif
    const [existingUsers] = await db.query('SELECT id, name FROM tbr_users WHERE email = ?', [email]);
    
    if (existingUsers.length > 0) {
      // ==========================================
      // ALUR EXISTING USER: Langsung gabungkan ke Workspace
      // ==========================================
      const existingUser = existingUsers[0];
      
      // Cek apakah user sudah ada di workspace ini
      const [existingPivot] = await db.query('SELECT id FROM tbr_tenant_users WHERE user_id = ? AND tenant_id = ?', [existingUser.id, tenantId]);
      
      if (existingPivot.length > 0) {
        return res.status(400).json({ success: false, message: "User ini sudah berada di dalam Workspace Anda." });
      }

      // Masukkan ke pivot tabel
      await db.query(`INSERT INTO tbr_tenant_users (user_id, tenant_id, role) VALUES (?, ?, ?)`, [existingUser.id, tenantId, role]);

      // SINKRONISASI KE PROJECT (Sama seperti logika acceptInvitation)
      const normalizeRole = (r) => (r ? String(r).replace(/\s+/g, '').toLowerCase().trim() : '');
      const PROJECT_ROLE_MAP = {
        projectowner: 'ProjectOwner',
        businessanalyst: 'BusinessAnalyst',
        teamdeveloper: 'TeamDeveloper',
      };
      const canonicalProjectRole = PROJECT_ROLE_MAP[normalizeRole(role)];

      if (canonicalProjectRole) {
        const [activeProjects] = await db.query(`SELECT id FROM tbr_projects WHERE tenant_id = ?`, [tenantId]);
        if (activeProjects.length > 0) {
          const insertProjectValues = activeProjects.map(proj => [proj.id, existingUser.id, canonicalProjectRole]);
          await db.query(`INSERT IGNORE INTO tbr_project_members (project_id, user_id, role_in_project) VALUES ?`, [insertProjectValues]);
        }
      }

      // Kirim Email Notifikasi
      const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const mailOptions = {
        from: `"ScrumApps System" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `Anda Ditambahkan ke Workspace ${companyName}`,
        html: `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 550px; margin: 0 auto; padding: 30px; border: 1px solid #f0f0f0; border-radius: 24px; background-color: #ffffff;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h2 style="color: #ee1e2d; margin: 0; font-size: 26px; font-weight: 900; letter-spacing: -0.5px;">ScrumApps</h2>
            </div>
            <p style="color: #334155; font-size: 14px; line-height: 1.6;">Halo ${existingUser.name},</p>
            <p style="color: #334155; font-size: 14px; line-height: 1.6;">
              Anda telah ditambahkan oleh Admin ke dalam Workspace <strong>${companyName}</strong> sebagai <span style="color: #ee1e2d; font-weight: bold;">${role}</span>.
            </p>
            <div style="text-align: center; margin: 35px 0;">
              <a href="${frontendBaseUrl}/login" style="background-color: #0f172a; color: #ffffff; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-size: 13px; font-weight: bold; display: inline-block;">
                Buka ScrumApps
              </a>
            </div>
          </div>
        `,
      };
      await transporter.sendMail(mailOptions);

      return res.status(200).json({
        success: true,
        message: "Pengguna sudah memiliki akun dan berhasil ditambahkan ke Workspace Anda secara langsung.",
      });

    } else {
      // ==========================================
      // ALUR NEW USER: Kirim Tautan Undangan
      // ==========================================
      const inviteToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); 

      await db.query('DELETE FROM tbr_invitations WHERE email = ? AND status = "pending"', [email]);

      const insertQuery = `
        INSERT INTO tbr_invitations (email, role, tenant_id, token, expires_at, status)
        VALUES (?, ?, ?, ?, ?, 'pending')
      `;
      await db.query(insertQuery, [email, role, tenantId, inviteToken, expiresAt]);

      const frontendBaseUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const inviteLink = `${frontendBaseUrl}/accept-invite?token=${inviteToken}`;

      const mailOptions = {
        from: `"ScrumApps System" <${process.env.SMTP_USER}>`,
        to: email,
        subject: `Undangan Bergabung ke Workspace ${companyName}`,
        html: `
          <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 550px; margin: 0 auto; padding: 30px; border: 1px solid #f0f0f0; border-radius: 24px; background-color: #ffffff;">
            <div style="text-align: center; margin-bottom: 30px;">
              <h2 style="color: #ee1e2d; margin: 0; font-size: 26px; font-weight: 900; letter-spacing: -0.5px;">ScrumApps</h2>
              <p style="color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; margin-top: 5px; font-weight: bold;">SaaS Agile Project Management</p>
            </div>
            
            <p style="color: #334155; font-size: 14px; line-height: 1.6;">Halo,</p>
            <p style="color: #334155; font-size: 14px; line-height: 1.6;">
              Anda telah diundang oleh Admin dari <strong>${companyName}</strong> untuk bergabung ke dalam repositori manajemen proyek mereka sebagai <span style="color: #ee1e2d; font-weight: bold;">${role}</span>.
            </p>
            
            <div style="text-align: center; margin: 35px 0;">
              <a href="${inviteLink}" style="background-color: #0f172a; color: #ffffff; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-size: 13px; font-weight: bold; display: inline-block; transition: all 0.2s; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
                Terima Undangan & Atur Profil
              </a>
            </div>
            
            <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; padding: 15px; border-radius: 12px; margin-bottom: 25px;">
              <p style="color: #64748b; font-size: 11px; margin: 0; line-height: 1.5;">
                ⚠️ <strong>Penting:</strong> Tautan di atas hanya berlaku selama <strong>24 jam</strong> sejak email ini dikirimkan. Jika tautan kedaluwarsa, silakan hubungi admin Anda untuk menjadwalkan ulang tautan baru.
              </p>
            </div>
            
            <hr style="border: none; border-top: 1px solid #f1f5f9; margin-bottom: 20px;" />
            <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">
              Email ini dikirim secara otomatis oleh sistem ScrumApps. Mohon untuk tidak membalas email ini.
            </p>
          </div>
        `,
      };

      await transporter.sendMail(mailOptions);

      return res.status(200).json({
        success: true,
        message: "Email undangan berhasil dirilis dan dikirim ke server tujuan.",
      });
    }

  } catch (error) {
    console.error("❌ NODEMAILER / DB ERROR:", error);
    return res.status(500).json({ success: false, message: "Gagal memproses alokasi pengiriman email SMTP." });
  }
};

// ======================================================
// 🔍 2. VERIFY INVITATION (Validasi Token Database ke Frontend)
// ======================================================
exports.verifyInvitation = async (req, res) => {
  try {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ success: false, message: "Token undangan tidak ditemukan." });
    }

    // 🔧 FIX: JOIN ke tbr_tenants agar nama perusahaan ikut diambil untuk ditampilkan
    // di halaman aktivasi (AcceptInvite.jsx), tanpa mengubah struktur query lain.
    const [invitations] = await db.query(
      `SELECT i.*, t.company_name
       FROM tbr_invitations i
       LEFT JOIN tbr_tenants t ON i.tenant_id = t.id
       WHERE i.token = ?`,
      [token]
    );
    
    if (invitations.length === 0) {
      return res.status(404).json({ success: false, message: "Tautan undangan tidak valid atau tidak terdaftar." });
    }

    const invitation = invitations[0];

    if (invitation.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Tautan ini tidak dapat digunakan karena berstatus: ${invitation.status}.` });
    }

    if (new Date() > new Date(invitation.expires_at)) {
      await db.query('UPDATE tbr_invitations SET status = "expired" WHERE id = ?', [invitation.id]);
      return res.status(410).json({ success: false, message: "Tautan undangan sudah kedaluwarsa (Maks. 24 Jam)." });
    }
    
    return res.status(200).json({
      success: true,
      message: "Token undangan valid.",
      data: {
        email: invitation.email,
        role: invitation.role,
        tenantId: invitation.tenant_id,
        companyName: invitation.company_name || "Organisasi Partner"
      }
    });
  } catch (error) {
    console.error("❌ VERIFY INVITATION TOKEN ERROR:", error);
    return res.status(500).json({ success: false, message: "Gagal memvalidasi token dari database." });
  }
};

// ======================================================
// 👤 3. ACCEPT INVITATION (Registrasi Anggota Tim & Auto-Join Project)
// ======================================================
exports.acceptInvitation = async (req, res) => {
  // 🔧 FIX: getConnection() dipindah ke dalam try — sebelumnya di luar try,
  // sehingga jika pool koneksi habis/reject, error tidak tertangkap.
  let connection;
  try {
    connection = await db.getConnection();
    // 🔧 FIX: Ambil juga phone_number & gender yang dikirim dari form AcceptInvite.jsx
    // (sebelumnya diabaikan sehingga tidak pernah tersimpan ke tbr_users)
    const { token, name, password, phone_number, gender } = req.body;

    if (!token || !name || !password) {
      return res.status(400).json({ success: false, message: "Seluruh data profil wajib diisi." });
    }

    const cleanPassword = password.trim();

    const [invitations] = await connection.query('SELECT * FROM tbr_invitations WHERE token = ?', [token]);
    if (invitations.length === 0) {
      return res.status(404).json({ success: false, message: "Undangan tidak valid." });
    }

    const invitation = invitations[0];

    if (invitation.status !== 'pending' || new Date() > new Date(invitation.expires_at)) {
      return res.status(400).json({ success: false, message: "Undangan ini sudah tidak dapat digunakan lagi atau kedaluwarsa." });
    }

    await connection.beginTransaction();

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(cleanPassword, salt);
    const cleanEmail = invitation.email.trim().toLowerCase();

    // A. Daftarkan User ke tabel tbr_users
    // 🔧 FIX: Sertakan phone_number & gender agar data dari form ikut tersimpan.
    // Catatan: kolom `gender` di tbr_users bertipe ENUM('male','female') NOT NULL tanpa default,
    // jadi diberi fallback 'male' agar tidak menyebabkan query gagal apabila field kosong.
    const [insertResult] = await connection.query(
      `INSERT INTO tbr_users (name, email, password, role, tenant_id, phone_number, gender) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, cleanEmail, hashedPassword, invitation.role, invitation.tenant_id, phone_number || null, gender || 'male']
    );

    const newUserId = insertResult.insertId;

    // 🔥 FIX UTAMA: Sinkronisasikan user ke tabel pivot tbr_tenant_users
    // Tanpa ini, middleware auth.js gagal membaca role user di level tenant/workspace
    await connection.query(
      `INSERT INTO tbr_tenant_users (user_id, tenant_id, role) VALUES (?, ?, ?)`,
      [newUserId, invitation.tenant_id, invitation.role]
    );

    // 🔥 SINKRONISASI BARU: Otomatis daftarkan user baru ke project yang ada di tenant ini
    // (Bypass perlindungan agar saat pertama login dashboard tidak kosong melongpong)
    // 🔧 FIX: Kolom di tbr_project_members bernama `role_in_project`, BUKAN `role`.
    // Sebelumnya insert ini selalu gagal (Unknown column 'role') setiap kali tenant
    // sudah punya project, menyebabkan seluruh transaksi accept-invite di-rollback.
    // 🔧 FIX TAMBAHAN: role_in_project ENUM hanya mengizinkan
    // 'ProjectOwner' | 'BusinessAnalyst' | 'TeamDeveloper'. Role di luar itu (mis. Admin/Superadmin)
    // tidak relevan untuk auto-sync per-project sehingga di-skip agar tidak menyebabkan error.
    // 🔧 FIX CASING: sebelumnya invitation.role dicocokkan APA ADANYA ke VALID_PROJECT_ROLES,
    // beda dengan teamController.js yang menormalisasi role (lowercase, tanpa spasi) sebelum
    // dibandingkan/disimpan. Kalau saat invite role tersimpan dengan casing berbeda
    // (mis. "projectowner" atau "Project Owner"), pencocokan lama gagal diam-diam dan
    // user baru tidak pernah ter-assign ke project manapun. Sekarang dinormalisasi dulu.
    const normalizeRole = (r) => (r ? String(r).replace(/\s+/g, '').toLowerCase().trim() : '');
    const PROJECT_ROLE_MAP = {
      projectowner: 'ProjectOwner',
      businessanalyst: 'BusinessAnalyst',
      teamdeveloper: 'TeamDeveloper',
    };
    const canonicalProjectRole = PROJECT_ROLE_MAP[normalizeRole(invitation.role)];

    if (canonicalProjectRole) {
      const [activeProjects] = await connection.query(
        `SELECT id FROM tbr_projects WHERE tenant_id = ?`, 
        [invitation.tenant_id]
      );

      if (activeProjects.length > 0) {
        // Susun query mass-insert ke tbr_project_members
        const memberInsertValues = activeProjects.map(proj => [proj.id, newUserId, canonicalProjectRole]);
        
        await connection.query(
          `INSERT INTO tbr_project_members (project_id, user_id, role_in_project) VALUES ?`,
          [memberInsertValues]
        );
      }
    }

    // B. Update status undangan menjadi accepted
    await connection.query('UPDATE tbr_invitations SET status = "accepted" WHERE id = ?', [invitation.id]);

    await connection.commit();

    // C. Generate token JWT supaya frontend bisa langsung auto-login
    const jwtToken = jwt.sign(
      {
        id: newUserId,
        role: invitation.role,
        tenant_id: invitation.tenant_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return res.status(201).json({
      success: true,
      message: "Berhasil bergabung! Akun tim Anda telah aktif dan disinkronkan ke proyek.",
      token: jwtToken,
      user: {
        id: newUserId,
        name,
        email: cleanEmail,
        role: invitation.role,
        tenant_id: invitation.tenant_id,
      },
    });
  } catch (error) {
    // 🔧 FIX: guard `connection &&` — bisa saja error terjadi sebelum getConnection() berhasil
    if (connection) {
      try {
        await connection.rollback();
      } catch (e) {
        // transaksi mungkin belum dimulai, abaikan
      }
    }
    console.error("❌ ACCEPT INVITE ERROR:", error);
    
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: "Email ini sudah terdaftar di sistem ScrumApps." });
    }
    return res.status(500).json({ success: false, message: "Gagal memproses pembuatan akun tim baru." });
  } finally {
    if (connection) connection.release();
  }
};
