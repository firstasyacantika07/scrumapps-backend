const db = require("../config/db");
const midtransClient = require("midtrans-client");
const crypto = require("crypto");

// ======================================================
// MIDTRANS CONFIG
// ======================================================
const snap = new midtransClient.Snap({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
  serverKey: process.env.MIDTRANS_SERVER_KEY,
});

const coreApi = new midtransClient.CoreApi({
  isProduction: process.env.MIDTRANS_IS_PRODUCTION === "true",
  serverKey: process.env.MIDTRANS_SERVER_KEY,
  clientKey: process.env.MIDTRANS_CLIENT_KEY,
});

// Helper untuk memformat objek Date menjadi format string MySQL (YYYY-MM-DD HH:mm:ss)
const formatToMySQLDateTime = (date) => {
  return date.toISOString().slice(0, 19).replace('T', ' ');
};

// ======================================================
// 1. SNAP PAYMENT (Mendapatkan Token & URL Snap)
// ======================================================
exports.createPayment = async (req, res) => {
  try {
    const { planId, billingCycle } = req.body;

    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "User tidak terautentikasi",
      });
    }

    if (!planId) {
      return res.status(400).json({
        success: false,
        message: "Parameter planId wajib disertakan",
      });
    }

    // 🔒 WAJIB ADA tenant_id
    const tenantId = req.user.tenant_id;
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID tidak ditemukan pada sesi Anda. Silakan login ulang.",
      });
    }

    const targetPlanId = Number(planId);

    const [plans] = await db.query(
      `SELECT * FROM tbr_plans WHERE id = ?`,
      [targetPlanId]
    );

    if (!plans || plans.length === 0) {
      return res.status(200).json({
        success: false,
        message: "Paket tidak ditemukan",
      });
    }

    const plan = plans[0];
    const cycle = billingCycle ? billingCycle.toUpperCase() : "MONTHLY";

    const amount = cycle === "YEARLY"
      ? Number(plan.price_yearly)
      : Number(plan.price_monthly);

    const orderId = `SCRUM-${Date.now()}`;

    // 🔧 ANTISIPASI BUG: Deteksi penempatan nama & email yang terbalik di session JWT
    const sessionName = req.user.name || "User";
    const sessionEmail = req.user.email || "user@scrumapps.local";

    // Regex sederhana untuk memeriksa format email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    let finalEmail = sessionEmail;
    let finalFirstName = sessionName;

    // Jika properti 'name' berformat email sedangkan properti 'email' salah, kita tukar posisinya
    if (emailRegex.test(sessionName) && !emailRegex.test(sessionEmail)) {
      finalEmail = sessionName;
      finalFirstName = sessionEmail;
    }

    const parameter = {
      transaction_details: {
        order_id: orderId,
        gross_amount: amount,
      },
      customer_details: {
        first_name: finalFirstName,
        email: finalEmail, // 🚀 Sekarang dijamin mengirimkan string berformat email valid ke Midtrans
      },
    };

    const transaction = await snap.createTransaction(parameter);

    await db.query(
      `
      INSERT INTO tbr_payments 
        (user_id, tenant_id, order_id, amount, payment_status, package_type, billing_cycle, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [req.user.id, tenantId, orderId, amount, "PENDING", plan.name, cycle]
    );

    return res.status(200).json({
      success: true,
      token: transaction.token,
      redirect_url: transaction.redirect_url,
      order_id: orderId,
    });

  } catch (error) {
    console.error("SNAP PAYMENT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Gagal membuat transaksi pembayaran",
      error: error.message,
    });
  }
};

// ======================================================
// 2. CORE API PAYMENT (Direct Charge Method)
// ======================================================
exports.createCheckoutSession = async (req, res) => {
  try {
    const { planId, amount, planName, paymentMethod, billingCycle } = req.body;

    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "User tidak terautentikasi",
      });
    }

    if (!planId || !amount || !planName || !paymentMethod) {
      return res.status(400).json({
        success: false,
        message: "Plan, amount, planName dan paymentMethod wajib diisi",
      });
    }

    // 🔒 WAJIB ADA tenant_id -- tanpa ini webhook tidak akan tahu tenant mana yang harus diupdate
    const tenantId = req.user.tenant_id;
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID tidak ditemukan pada sesi Anda. Silakan login ulang.",
      });
    }

    const cycle = billingCycle ? billingCycle.toUpperCase() : "MONTHLY";

    const orderId = `TRX-${Date.now()}`;

    const parameter = {
      payment_type: "",
      transaction_details: {
        order_id: orderId,
        gross_amount: Number(amount),
      },
      item_details: [
        {
          id: String(planId),
          price: Number(amount),
          quantity: 1,
          name: `ScrumApps Premium - ${planName}`,
        },
      ],
      customer_details: {
        first_name: req.user.name || "User",
        email: req.user.email || "user@scrumapps.local",
      },
    };

    if (paymentMethod === "qris") {
      parameter.payment_type = "qris";
      parameter.qris = { acquirer: "gopay" };
    }
    else if (["bca", "bni", "bri", "permata"].includes(paymentMethod)) {
      parameter.payment_type = "bank_transfer";
      parameter.bank_transfer = { bank: paymentMethod };
    }
    else if (paymentMethod === "mandiri") {
      parameter.payment_type = "echannel";
      parameter.echannel = {
        bill_info1: "Pembayaran",
        bill_info2: "ScrumApps Premium",
      };
    }
    else {
      return res.status(400).json({
        success: false,
        message: "Metode pembayaran tidak valid",
      });
    }

    const chargeResponse = await coreApi.charge(parameter);

    // ⚠️ Sama seperti createPayment: pastikan kolom tenant_id & billing_cycle sudah ada di tbr_payments.
    await db.query(
      `
      INSERT INTO tbr_payments 
        (user_id, tenant_id, order_id, transaction_id, amount, payment_method, payment_status, package_type, billing_cycle, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        req.user.id,
        tenantId,
        orderId,
        chargeResponse.transaction_id || null,
        amount,
        paymentMethod,
        "PENDING",
        planName,
        cycle,
      ]
    );

    return res.status(200).json({
      success: true,
      orderId,
      paymentData: chargeResponse,
    });

  } catch (error) {
    console.error("MIDTRANS CORE API ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Gagal memproses transaksi Midtrans",
      error: error.message,
    });
  }
};

// ======================================================
// 3. CHECK PAYMENT STATUS (Manual Polling)
// ======================================================
exports.checkPaymentStatus = async (req, res) => {
  try {
    const { orderId } = req.params;
    const statusResponse = await coreApi.transaction.status(orderId);

    return res.status(200).json({
      success: true,
      order_id: orderId,
      transaction_status: statusResponse.transaction_status,
      payment_type: statusResponse.payment_type,
      gross_amount: statusResponse.gross_amount,
    });

  } catch (error) {
    console.error("CHECK PAYMENT STATUS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Gagal mendapatkan status pembayaran",
    });
  }
};

// ======================================================
// 3b. MIDTRANS WEBHOOK (Server-to-Server Notification)
// ======================================================
exports.handleMidtransWebhook = async (req, res) => {
  // Ambil koneksi database pool khusus untuk transaksi atomik jika didukung, 
  // atau manfaatkan pool default secara aman.
  try {
    const notification = req.body;
    const {
      order_id,
      status_code,
      gross_amount,
      signature_key,
      transaction_status,
      fraud_status,
      transaction_id,
    } = notification;

    if (!order_id || !status_code || !gross_amount || !signature_key) {
      return res.status(400).json({ success: false, message: "Payload notifikasi tidak lengkap" });
    }

    // 1. Verifikasi signature_key
    const expectedSignature = crypto
      .createHash("sha512")
      .update(`${order_id}${status_code}${gross_amount}${process.env.MIDTRANS_SERVER_KEY}`)
      .digest("hex");

    if (expectedSignature !== signature_key) {
      console.warn("WEBHOOK SIGNATURE MISMATCH:", order_id);
      return res.status(401).json({ success: false, message: "Signature tidak valid" });
    }

    // 2. Ambil order dari tbr_payments
    const [payments] = await db.query(
      `SELECT * FROM tbr_payments WHERE order_id = ?`,
      [order_id]
    );

    if (!payments || payments.length === 0) {
      console.warn("WEBHOOK: order_id tidak ditemukan di tbr_payments:", order_id);
      return res.status(200).json({ success: false, message: "Order tidak ditemukan" });
    }

    const payment = payments[0];

    // 3. Idempotency guard -- cegah eksekusi berulang jika sudah sukses
    if (payment.payment_status === "SUCCESS" || payment.payment_status === "SETTLEMENT") {
      return res.status(200).json({ success: true, message: "Order sudah diproses sebelumnya" });
    }

    const isSuccess =
      transaction_status === "settlement" ||
      (transaction_status === "capture" && fraud_status === "accept");

    const isFailed = ["deny", "cancel", "expire", "failure"].includes(transaction_status);

    if (isFailed) {
      await db.query(
        `UPDATE tbr_payments SET payment_status = ?, transaction_id = ?, updated_at = NOW() WHERE order_id = ?`,
        [transaction_status.toUpperCase(), transaction_id || payment.transaction_id, order_id]
      );
      return res.status(200).json({ success: true, message: "Status kegagalan dicatat" });
    }

    if (!isSuccess) {
      await db.query(
        `UPDATE tbr_payments SET payment_status = ?, transaction_id = ?, updated_at = NOW() WHERE order_id = ?`,
        [String(transaction_status || "PENDING").toUpperCase(), transaction_id || payment.transaction_id, order_id]
      );
      return res.status(200).json({ success: true, message: "Status pending dicatat" });
    }

    // ================= PEMBAYARAN SUKSES =================
    const tenantId = payment.tenant_id;
    const userId = payment.user_id;
    const packageType = payment.package_type;
    const cycle = (payment.billing_cycle || "MONTHLY").toUpperCase();

    if (!tenantId) {
      console.error("WEBHOOK: payment sukses tapi tanpa tenant_id, tidak bisa aktivasi otomatis:", order_id);
      await db.query(
        `UPDATE tbr_payments SET payment_status = 'SUCCESS', transaction_id = ?, updated_at = NOW() WHERE order_id = ?`,
        [transaction_id || payment.transaction_id, order_id]
      );
      return res.status(200).json({
        success: true,
        message: "Pembayaran dicatat sukses, tapi tenant_id kosong -- aktivasi manual diperlukan",
      });
    }

    const startDate = new Date();
    const endDate = new Date();
    if (cycle === "YEARLY") {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }
    const mysqlStart = formatToMySQLDateTime(startDate);
    const mysqlEnd = formatToMySQLDateTime(endDate);

    // ✨ INTEGRASI DATABASE TRANSACTION UNTUK MENCEGAH DATA INKONSISTEN / RACE CONDITION
    await db.query("START TRANSACTION");

    try {
      // 4. Tandai payment SUCCESS
      await db.query(
        `UPDATE tbr_payments SET payment_status = 'SUCCESS', transaction_id = ?, updated_at = NOW() WHERE order_id = ?`,
        [transaction_id || payment.transaction_id, order_id]
      );

      // 5. Expire subscription lama utk tenant ini, lalu catat subscription baru
      await db.query(`UPDATE tbr_subscriptions SET status = 'EXPIRED' WHERE tenant_id = ?`, [tenantId]);

      await db.query(
        `
        INSERT INTO tbr_subscriptions
          (tenant_id, user_id, package_type, billing_cycle, start_date, end_date, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        [tenantId, userId, packageType, cycle, mysqlStart, mysqlEnd, "ACTIVE"]
      );

      // 6. 🔴 SUMBER KEBENARAN UTAMA: UPDATE tbr_tenants
      await db.query(
        `
        UPDATE tbr_tenants
        SET
          package_type = ?,
          billing_cycle = ?,
          status = 'active',
          subscription_ends_at = ?,
          is_trial = 0,
          updated_at = NOW()
        WHERE id = ?
        `,
        [packageType, cycle, mysqlEnd, tenantId]
      );

      // 7. UPDATE tbr_users -- kompatibilitas kode lama
      await db.query(
        `
        UPDATE tbr_users
        SET
          package_type = ?,
          billing_cycle = ?,
          subscription_status = 'active',
          subscription_ends_at = ?,
          is_trial = 0,
          updated_at = NOW()
        WHERE id = ?
        `,
        [packageType, cycle, mysqlEnd, userId]
      );

      // Jika seluruh query sukses tanpa interupsi, eksekusi permanen ke database
      await db.query("COMMIT");
      return res.status(200).json({ success: true, message: "Webhook diproses, paket aktif" });

    } catch (transactionError) {
      // Jika salah satu tabel gagal update, batalkan seluruh perubahan di atas!
      await db.query("ROLLBACK");
      throw transactionError; // Lemparkan ke catch induk untuk respons status 500
    }

  } catch (error) {
    console.error("MIDTRANS WEBHOOK ERROR:", error);
    return res.status(500).json({ success: false, message: "Gagal memproses notifikasi webhook" });
  }
};

// ======================================================
// NEW: START PRO TRIAL (7 Days Free Trial Activation)
// ======================================================
exports.startTrial = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ success: false, message: "User tidak terautentikasi" });
    }

    // 🔒 WAJIB ADA tenant_id -- tanpa ini subscription tidak akan tersinkron ke company/tenant
    const tenantId = req.user.tenant_id;
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID tidak ditemukan pada sesi Anda. Silakan login ulang.",
      });
    }

    // 1. Cek kuota pemakaian trial user melalui tbr_subscriptions
    const [trialCheck] = await db.query(
      `SELECT id FROM tbr_subscriptions WHERE user_id = ? AND billing_cycle = 'TRIAL'`,
      [req.user.id]
    );

    if (trialCheck && trialCheck.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Anda sudah pernah mengambil masa uji coba PRO Trial sebelumnya.",
      });
    }

    const now = new Date();
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 7); // Durasi 7 Hari

    const mysqlNowString = formatToMySQLDateTime(now);
    const mysqlEndString = formatToMySQLDateTime(trialEnd);

    // ✨ TRANSAKSI DB DIMULAI UNTUK PROSES AKTIVASI TRIAL
    await db.query("START TRANSACTION");

    try {
      // 2. Tandai status sub lama sebagai EXPIRED di tabel tbr_subscriptions jika ada
      await db.query(
        `UPDATE tbr_subscriptions SET status = 'EXPIRED' WHERE user_id = ?`,
        [req.user.id]
      );

      // 3. Catat transaksi log trial baru ke tbr_subscriptions
      await db.query(
        `
        INSERT INTO tbr_subscriptions
          (user_id, package_type, billing_cycle, start_date, end_date, status)
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [req.user.id, "PRO", "TRIAL", mysqlNowString, mysqlEndString, "ACTIVE"]
      );

      // 4. 🔴 SUMBER KEBENARAN UTAMA: UPDATE tbr_tenants (bukan tbr_users)
      await db.query(
        `
        UPDATE tbr_tenants
        SET
          is_trial = 1,
          package_type = 'PRO',
          billing_cycle = 'TRIAL',
          status = 'trial',
          trial_start = ?,
          trial_end = ?,
          subscription_ends_at = ?,
          updated_at = NOW()
        WHERE id = ?
        `,
        [mysqlNowString, mysqlEndString, mysqlEndString, tenantId]
      );

      // 5. UPDATE tbr_users
      await db.query(
        `
        UPDATE tbr_users
        SET 
          is_trial = 1,
          package_type = 'PRO',
          subscription_status = 'trialing',
          subscription_ends_at = ?,
          updated_at = NOW()
        WHERE id = ?
        `,
        [mysqlEndString, req.user.id]
      );

      await db.query("COMMIT");

      return res.status(200).json({
        success: true,
        message: "Trial Paket PRO berhasil diaktifkan selama 7 hari!",
        note: "PENTING: frontend wajib refresh token/re-login agar dashboard & fitur lain terbaca update.",
      });

    } catch (transactionError) {
      await db.query("ROLLBACK");
      throw transactionError;
    }

  } catch (err) {
    console.error("START TRIAL ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Terjadi gangguan internal server sewaktu mengaktifkan trial.",
      error: err.message
    });
  }
};




// ======================================================
// 4. ACTIVATE PLAN (Subscription Activation Logic)
// ======================================================
exports.activatePlan = async (req, res) => {
  try {
    const { package_type, billing_cycle } = req.body;

    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: "User tidak terautentikasi",
      });
    }

    // 🔒 WAJIB ADA tenant_id
    const tenantId = req.user.tenant_id;
    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: "Tenant ID tidak ditemukan pada sesi Anda. Silakan login ulang.",
      });
    }

    if (!package_type || !billing_cycle) {
      return res.status(400).json({
        success: false,
        message: "package_type dan billing_cycle wajib diisi",
      });
    }

    const startDate = new Date();
    const endDate = new Date();

    if (billing_cycle.toUpperCase() === "YEARLY") {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }

    const mysqlStart = formatToMySQLDateTime(startDate);
    const mysqlEnd = formatToMySQLDateTime(endDate);

    // ✨ TRANSAKSI DB DIMULAI UNTUK MANUAL ACTIVATE
    await db.query("START TRANSACTION");

    try {
      /* =========================================================================
         🗂️ SAFE-GUARD LOG SUBSCRIPTIONS
         Dibungkus try-catch agar kalau ada ketidakcocokan kolom 'tenant_id'
         di tabel log ini, proses aktivasi utama tidak ikut mampet (Crash 500).
         ========================================================================= */
      try {
        await db.query(
          `UPDATE tbr_subscriptions SET status = 'EXPIRED' WHERE user_id = ?`,
          [req.user.id]
        );

        await db.query(
          `
          INSERT INTO tbr_subscriptions 
            (user_id, package_type, billing_cycle, start_date, end_date, status)
          VALUES (?, ?, ?, ?, ?, ?)
          `,
          [req.user.id, package_type.toUpperCase(), billing_cycle.toUpperCase(), mysqlStart, mysqlEnd, "ACTIVE"]
        );
      } catch (logErr) {
        console.warn("⚠️ Skip log tbr_subscriptions:", logErr.message);
      }

      /* =========================================================================
         🔴 SUMBER KEBENARAN UTAMA: UPDATE tbr_tenants
         KOLOM 'is_trial' DIHAPUS karena tidak ada di struktur database Anda.
         ========================================================================= */
      await db.query(
        `
        UPDATE tbr_tenants
        SET
          package_type = ?,
          billing_cycle = ?,
          status = 'active',
          subscription_ends_at = ?,
          updated_at = NOW()
        WHERE id = ?
        `,
        [package_type.toUpperCase(), billing_cycle.toUpperCase(), mysqlEnd, tenantId]
      );

      /* =========================================================================
         👤 UPDATE tbr_users
         Pastikan kolom 'is_trial' di tbr_users juga disesuaikan jika tidak ada. 
         Di sini disesuaikan hanya mengupdate profil paket user.
         ========================================================================= */
      await db.query(
        `
        UPDATE tbr_users
        SET
          package_type = ?,
          billing_cycle = ?,
          subscription_status = 'active',
          subscription_ends_at = ?,
          updated_at = NOW()
        WHERE id = ?
        `,
        [package_type.toUpperCase(), billing_cycle.toUpperCase(), mysqlEnd, req.user.id]
      );

      await db.query("COMMIT");

      return res.status(200).json({
        success: true,
        message: "Paket berhasil diaktifkan",
        note: "PENTING: frontend wajib refresh token/re-login agar dashboard & fitur lain terbaca update.",
      });

    } catch (transactionError) {
      await db.query("ROLLBACK");
      throw transactionError;
    }

  } catch (err) {
    console.error("❌ ACTIVATE PLAN CRITICAL ERROR:", err);
    return res.status(500).json({
      success: false,
      message: "Server Error saat mengaktifkan paket",
      error: err.message
    });
  }
};

// ======================================================
// 5. GET ALL PLANS (Mengambil daftar paket untuk Frontend)
// ======================================================
exports.getPlans = async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT * FROM tbr_plans ORDER BY id ASC`);

    return res.status(200).json({
      success: true,
      data: rows
    });
  } catch (error) {
    console.error("GET PLANS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Gagal mengambil data paket dari database",
      error: error.message
    });
  }
};

// ======================================================
// NEW: GET CURRENT BILLING / SUBSCRIPTION STATUS
// ======================================================
exports.getBillingStatus = async (req, res) => {
  try {
    if (!req.user || !req.user.tenant_id) {
      return res.status(401).json({
        success: false,
        message: "User tidak terautentikasi atau Tenant ID tidak ditemukan.",
      });
    }

    const tenantId = req.user.tenant_id;

    // Ambil data langganan langsung dari sumber kebenaran utama (tbr_tenants)
    const [tenants] = await db.query(
      `SELECT package_type, billing_cycle, status, subscription_ends_at, is_trial 
       FROM tbr_tenants WHERE id = ?`,
      [tenantId]
    );

    if (!tenants || tenants.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Data workspace/tenant tidak ditemukan.",
      });
    }

    const tenant = tenants[0];

    return res.status(200).json({
      success: true,
      data: {
        packageType: tenant.package_type || "FREE",
        billingCycle: tenant.billing_cycle || "MONTHLY",
        status: tenant.status || "active",
        endsAt: tenant.subscription_ends_at,
        isTrial: tenant.is_trial === 1 || tenant.is_trial === true
      }
    });

  } catch (error) {
    console.error("GET BILLING STATUS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Gagal mengambil status langganan",
      error: error.message
    });
  }
};