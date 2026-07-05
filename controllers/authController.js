const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../config/db");
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const { sendEmail } = require("../services/emailService");

// Helper internal sanitasi format tanggal ISO
const safeIsoDate = (dateString) => {
    if (!dateString) return null;
    if (dateString instanceof Date) {
        if (isNaN(dateString.getTime())) return null;
        return dateString.toISOString().split('T')[0];
    }
    if (typeof dateString === 'string') {
        const trimmed = dateString.trim();
        if (!trimmed || trimmed.startsWith('0000')) return null;
        const parsedDate = new Date(trimmed);
        return isNaN(parsedDate.getTime()) ? null : parsedDate.toISOString().split('T')[0];
    }
    return null;
};

// ======================================================
// 🔐 USER LOGIN
// ======================================================
exports.login = async (req, res) => {
    try {
        let { email, password } = req.body;

        // Normalisasi email
        email = email ? email.trim().toLowerCase() : email;

        // 1. Ambil data profile dasar
        const [rows] = await db.query(
            `SELECT id, name, email, password, role, tenant_id FROM tbr_users WHERE email = ? LIMIT 1`,
            [email]
        );

        const user = rows[0];

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "Email atau password salah",
            });
        }

        // 2. Sinkronisasi format hash bcrypt PHP ($2y$ ke $2a$)
        let hashedPassword = user.password;
        if (hashedPassword && hashedPassword.startsWith("$2y$")) {
            hashedPassword = "$2a$" + hashedPassword.slice(4);
        }

        // 3. Verifikasi Password
        const isMatch = await bcrypt.compare(password, hashedPassword);

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: "Email atau password salah",
            });
        }

        // 4. Ambil daftar workspace dari tabel pivot
        const [workspaces] = await db.query(`
      SELECT 
        tu.tenant_id, tu.role, t.company_name, t.subdomain, t.package_type, t.billing_cycle, t.status as tenant_status, t.trial_end, t.subscription_ends_at
      FROM tbr_tenant_users tu
      JOIN tbr_tenants t ON tu.tenant_id = t.id
      WHERE tu.user_id = ?
    `, [user.id]);

        // Update status kedaluwarsa untuk semua workspace
        for (let ws of workspaces) {
            let finalStatus = ws.tenant_status || "active";
            let triggerUpdate = false;
            const now = new Date();
            if (ws.billing_cycle === "TRIAL" && ws.trial_end && now > new Date(ws.trial_end)) {
                finalStatus = "expired";
                triggerUpdate = true;
            } else if (ws.package_type !== "FREE" && ws.subscription_ends_at && now > new Date(ws.subscription_ends_at)) {
                finalStatus = "expired";
                triggerUpdate = true;
            }
            ws.tenant_status = finalStatus;
            if (triggerUpdate && finalStatus === "expired") {
                await db.query(`UPDATE tbr_tenants SET status = 'expired' WHERE id = ?`, [ws.tenant_id]);
            }
        }

        // 5. Generate JWT Token
        const token = jwt.sign(
            { id: user.id },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        delete user.password;

        const defaultWorkspace = workspaces.length > 0 ? workspaces[0] : null;

        return res.status(200).json({
            success: true,
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                workspaces: workspaces,
                // Backward compatibility
                tenant_id: defaultWorkspace ? defaultWorkspace.tenant_id : user.tenant_id,
                role: defaultWorkspace ? defaultWorkspace.role : user.role,
                subscription_status: defaultWorkspace ? defaultWorkspace.tenant_status : 'active'
            },
        });

    } catch (error) {
        console.error("LOGIN ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
        });
    }
};

// ======================================================
// 🔍 GET ME (Check Current Logged In User Data)
// ======================================================
exports.getMe = async (req, res) => {
    try {
        if (!req.user || !req.user.id) {
            return res.status(401).json({
                success: false,
                message: "Token tidak valid atau kedaluwarsa",
            });
        }

        // Ambil semua workspaces
        const [workspaces] = await db.query(`
      SELECT 
        tu.tenant_id, tu.role, t.company_name, t.subdomain, t.package_type, t.billing_cycle, t.status as tenant_status, t.trial_end, t.subscription_ends_at
      FROM tbr_tenant_users tu
      JOIN tbr_tenants t ON tu.tenant_id = t.id
      WHERE tu.user_id = ?
    `, [req.user.id]);

        for (let ws of workspaces) {
            let finalStatus = ws.tenant_status || "active";
            let triggerUpdate = false;
            const now = new Date();
            if (ws.billing_cycle === "TRIAL" && ws.trial_end && now > new Date(ws.trial_end)) {
                finalStatus = "expired";
                triggerUpdate = true;
            } else if (ws.package_type !== "FREE" && ws.subscription_ends_at && now > new Date(ws.subscription_ends_at)) {
                finalStatus = "expired";
                triggerUpdate = true;
            }
            ws.tenant_status = finalStatus;
            if (triggerUpdate && finalStatus === "expired") {
                await db.query(`UPDATE tbr_tenants SET status = 'expired' WHERE id = ?`, [ws.tenant_id]);
            }
        }

        const formattedEndDate = req.user.billing_cycle === "TRIAL" ? req.user.trial_end : req.user.subscription_ends_at;

        return res.status(200).json({
            success: true,
            user: {
                id: req.user.id,
                name: req.user.name,
                email: req.user.email,
                workspaces: workspaces,
                tenant_id: req.user.tenant_id,
                role: req.user.role,
                package_type: req.user.package_type || "FREE",
                billing_cycle: req.user.billing_cycle || "NONE",
                subscription_status: req.user.subscription_status || "active",
                trial_start: req.user.trial_start,
                trial_end: req.user.trial_end,
                expired_trial: req.user.subscription_status === 'expired' && req.user.billing_cycle === 'TRIAL',
                expired_subscription: req.user.subscription_status === 'expired' && req.user.billing_cycle !== 'TRIAL',
                end_date: safeIsoDate(formattedEndDate)
            },
        });

    } catch (error) {
        console.error("GET ME ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal memuat data user",
            error: error.message,
        });
    }
};

// ======================================================
// 📝 USER REGISTER (Self Sign-Up)
// ======================================================
exports.register = async (req, res) => {
    let connection;
    try {
        connection = await db.getConnection();
        const { name, email, password, company_name, phone_number } = req.body;

        if (!name || !email || !password || !company_name) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "Nama, nama perusahaan, email, dan password wajib diisi",
            });
        }

        if (password.length < 6) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "Password minimal 6 karakter",
            });
        }

        const [existing] = await connection.query(
            `SELECT id FROM tbr_users WHERE email = ? LIMIT 1`,
            [email]
        );

        if (existing.length > 0) {
            connection.release();
            return res.status(409).json({
                success: false,
                message: "Email sudah terdaftar, silakan login",
            });
        }

        await connection.beginTransaction();

        const trialStart = new Date();
        const trialEnd = new Date();
        trialEnd.setDate(trialEnd.getDate() + 14);

        const baseSlug = company_name
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 30) || "workspace";
        const randomSuffix = Math.random().toString(36).slice(2, 8);
        const subdomain = `${baseSlug}-${randomSuffix}`;

        const [tenantResult] = await connection.query(
            `INSERT INTO tbr_tenants
        (company_name, package_type, billing_cycle, status, trial_start, trial_end, subdomain)
       VALUES (?, 'FREE', 'TRIAL', 'active', ?, ?, ?)`,
            [
                company_name.trim(),
                trialStart.toISOString().slice(0, 19).replace("T", " "),
                trialEnd.toISOString().slice(0, 19).replace("T", " "),
                subdomain,
            ]
        );

        const tenantId = tenantResult.insertId;
        const hashedPassword = await bcrypt.hash(password, 10);

        const [userResult] = await connection.query(
            `INSERT INTO tbr_users (name, email, password, role, tenant_id, phone_number)
       VALUES (?, ?, ?, 'admin', ?, ?)`,
            [name, email.trim().toLowerCase(), hashedPassword, tenantId, phone_number || null]
        );
        const newUserId = userResult.insertId;

        await connection.query(
            `INSERT INTO tbr_tenant_users (user_id, tenant_id, role) VALUES (?, ?, 'admin')`,
            [newUserId, tenantId]
        );

        await connection.commit();
        connection.release();

        const token = jwt.sign(
            { id: newUserId },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        const workspaces = [{
            tenant_id: tenantId,
            role: 'admin',
            company_name: company_name.trim(),
            subdomain: subdomain,
            package_type: 'FREE',
            billing_cycle: 'TRIAL',
            tenant_status: 'active',
            trial_end: trialEnd
        }];

        return res.status(201).json({
            success: true,
            message: "Registrasi berhasil",
            token,
            user: {
                id: newUserId,
                name,
                email,
                workspaces: workspaces,
                role: "admin",
                tenant_id: tenantId,
                package_type: "FREE",
                billing_cycle: "TRIAL",
                subscription_status: "active",
                end_date: safeIsoDate(trialEnd),
            },
        });

    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
                connection.release();
            } catch (e) { }
        }
        console.error("REGISTER ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal melakukan registrasi",
            error: error.message,
        });
    }
};

// ======================================================
// 🔑 FORGOT PASSWORD
// ======================================================
exports.forgotPassword = async (req, res) => {
    try {
        let { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Email wajib diisi",
            });
        }

        email = email.trim().toLowerCase();

        const [rows] = await db.query(
            `SELECT id, name FROM tbr_users WHERE email = ? LIMIT 1`,
            [email]
        );
        const user = rows[0];

        const genericResponse = {
            success: true,
            message: "Jika email terdaftar, tautan atur ulang kata sandi telah dikirim.",
        };

        if (!user) {
            return res.status(200).json(genericResponse);
        }

        const rawToken = crypto.randomBytes(32).toString("hex");
        const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

        await db.query(
            `UPDATE tbr_users SET reset_token = ?, reset_token_expires = ? WHERE id = ?`,
            [hashedToken, expiresAt.toISOString().slice(0, 19).replace("T", " "), user.id]
        );

        const resetUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`;

        const emailHtml = `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Atur Ulang Kata Sandi</h2>
        <p>Halo ${user.name || ""},</p>
        <p>Kami menerima permintaan untuk mengatur ulang kata sandi akun ScrumApps Anda. Klik tombol di bawah untuk melanjutkan:</p>
        <p style="text-align: center; margin: 32px 0;">
          <a href="${resetUrl}" style="background:#D31217;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">
            Atur Ulang Kata Sandi
          </a>
        </p>
        <p>Atau salin tautan ini ke browser Anda:<br>${resetUrl}</p>
        <p style="color:#888;font-size:13px;">Tautan ini berlaku selama 1 jam. Jika Anda tidak meminta ini, abaikan email ini.</p>
      </div>
    `;

        const emailSent = await sendEmail(email, "Atur Ulang Kata Sandi - ScrumApps", emailHtml);
        if (!emailSent) {
            console.error(`[FORGOT PASSWORD] Gagal mengirim email reset ke ${email}, tautan tetap dicatat untuk debugging: ${resetUrl}`);
        }

        return res.status(200).json(genericResponse);

    } catch (error) {
        console.error("FORGOT PASSWORD ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal memproses permintaan lupa password",
        });
    }
};

// ======================================================
// 🔑 RESET PASSWORD
// ======================================================
exports.resetPassword = async (req, res) => {
    try {
        const { email, token, newPassword } = req.body;

        if (!email || !token || !newPassword) {
            return res.status(400).json({
                success: false,
                message: "Email, token, dan password baru wajib diisi",
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: "Password minimal 6 karakter",
            });
        }

        const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

        const [rows] = await db.query(
            `SELECT id, reset_token_expires FROM tbr_users WHERE email = ? AND reset_token = ? LIMIT 1`,
            [email.trim().toLowerCase(), hashedToken]
        );
        const user = rows[0];

        if (!user || !user.reset_token_expires || new Date(user.reset_token_expires) < new Date()) {
            return res.status(400).json({
                success: false,
                message: "Tautan reset tidak valid atau sudah kedaluwarsa",
            });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        await db.query(
            `UPDATE tbr_users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?`,
            [hashedPassword, user.id]
        );

        return res.status(200).json({
            success: true,
            message: "Password berhasil diatur ulang, silakan login dengan password baru Anda",
        });

    } catch (error) {
        console.error("RESET PASSWORD ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal mengatur ulang password",
        });
    }
};

// ======================================================
// 🔧 DEBUG ENDPOINT (DISABLED)
// ======================================================
exports.debugListUsers = async (req, res) => {
    return res.status(410).json({
        success: false,
        message: "Endpoint debug ini sudah dinonaktifkan.",
    });
};

// ======================================================
// 🌐 GOOGLE AUTH LOGIN / REGISTER
// ======================================================
exports.googleAuth = async (req, res) => {
    let connection;
    try {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ success: false, message: "Token Google tidak ditemukan." });
        }

        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();

        const email = payload.email.trim().toLowerCase();
        const name = payload.name;

        connection = await db.getConnection();

        const [rows] = await connection.query(
            `SELECT
        u.id, u.name, u.email, u.role, u.tenant_id,
        t.package_type, t.billing_cycle, t.status as tenant_status,
        t.trial_end, t.subscription_ends_at
       FROM tbr_users u
       LEFT JOIN tbr_tenants t ON u.tenant_id = t.id
       WHERE u.email = ? LIMIT 1`,
            [email]
        );

        let user = rows[0];

        if (!user) {
            await connection.beginTransaction();

            const company_name = name + " Workspace";
            const trialStart = new Date();
            const trialEnd = new Date();
            trialEnd.setDate(trialEnd.getDate() + 14);

            const baseSlug = company_name.toString().trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30) || "workspace";
            const randomSuffix = Math.random().toString(36).slice(2, 8);
            const subdomain = `${baseSlug}-${randomSuffix}`;

            const [tenantResult] = await connection.query(
                `INSERT INTO tbr_tenants (company_name, package_type, billing_cycle, status, trial_start, trial_end, subdomain) VALUES (?, 'FREE', 'TRIAL', 'active', ?, ?, ?)`,
                [company_name.trim(), trialStart.toISOString().slice(0, 19).replace("T", " "), trialEnd.toISOString().slice(0, 19).replace("T", " "), subdomain]
            );
            const tenantId = tenantResult.insertId;

            const randomPassword = crypto.randomBytes(16).toString("hex");
            const hashedPassword = await bcrypt.hash(randomPassword, 10);

            const [userResult] = await connection.query(
                `INSERT INTO tbr_users (name, email, password, role, tenant_id) VALUES (?, ?, ?, 'admin', ?)`,
                [name, email, hashedPassword, tenantId]
            );
            const newUserId = userResult.insertId;

            await connection.query(
                `INSERT INTO tbr_tenant_users (user_id, tenant_id, role) VALUES (?, ?, 'admin')`,
                [newUserId, tenantId]
            );

            await connection.commit();
            user = { id: newUserId, name: name, email: email };
        }

        const [workspaces] = await connection.query(`
      SELECT 
        tu.tenant_id, tu.role, t.company_name, t.subdomain, t.package_type, t.billing_cycle, t.status as tenant_status, t.trial_end, t.subscription_ends_at
      FROM tbr_tenant_users tu
      JOIN tbr_tenants t ON tu.tenant_id = t.id
      WHERE tu.user_id = ?
    `, [user.id]);

        for (let ws of workspaces) {
            let finalStatus = ws.tenant_status || "active";
            let triggerUpdate = false;
            const now = new Date();
            if (ws.billing_cycle === "TRIAL" && ws.trial_end && now > new Date(ws.trial_end)) {
                finalStatus = "expired";
                triggerUpdate = true;
            } else if (ws.package_type !== "FREE" && ws.subscription_ends_at && now > new Date(ws.subscription_ends_at)) {
                finalStatus = "expired";
                triggerUpdate = true;
            }
            ws.tenant_status = finalStatus;
            if (triggerUpdate && finalStatus === "expired") {
                await connection.query(`UPDATE tbr_tenants SET status = 'expired' WHERE id = ?`, [ws.tenant_id]);
            }
        }

        if (connection) {
            connection.release();
            connection = null;
        }

        const jwtToken = jwt.sign(
            { id: user.id },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        const defaultWorkspace = workspaces.length > 0 ? workspaces[0] : null;

        return res.status(200).json({
            success: true,
            token: jwtToken,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                workspaces: workspaces,
                tenant_id: defaultWorkspace ? defaultWorkspace.tenant_id : null,
                role: defaultWorkspace ? defaultWorkspace.role : null,
                subscription_status: defaultWorkspace ? defaultWorkspace.tenant_status : 'active'
            },
        });

    } catch (error) {
        if (connection) {
            try { await connection.rollback(); connection.release(); } catch (e) { }
        }
        console.error("GOOGLE AUTH ERROR:", error);
        return res.status(500).json({
            success: false,
            message: "Gagal login dengan Google",
            error: error.message,
        });
    }
};