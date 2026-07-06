const nodemailer = require("nodemailer");

// =========================================================================
// 🔧 FIX #5 (email notifikasi tidak terkirim, in-app berhasil):
//
// 🐛 AKAR MASALAH DITEMUKAN: file .env memakai nama variabel SMTP_HOST /
// SMTP_PORT / SMTP_USER / SMTP_PASS, tapi kode ini sebelumnya membaca
// EMAIL_USER / EMAIL_PASS (nama berbeda) dan meng-hardcode host/port.
// Akibatnya process.env.EMAIL_USER & EMAIL_PASS SELALU undefined walau
// .env sudah diisi dengan benar. Sekarang disesuaikan membaca SMTP_*,
// dan host/port ikut dibaca dari .env (dengan fallback aman kalau kosong).
//
// Port 587 (yang dipakai di .env Anda) butuh STARTTLS: secure harus FALSE
// dan requireTLS TRUE -- beda dengan port 465 yang butuh secure TRUE
// (implicit TLS). Kalau keduanya tertukar, Gmail akan menolak koneksi.
// =========================================================================

if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.error(
        "⚠️  [EMAIL SERVICE] SMTP_USER atau SMTP_PASS tidak ditemukan di .env. " +
        "Semua pengiriman email notifikasi akan GAGAL sampai ini diperbaiki."
    );
}

const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = Number(process.env.SMTP_PORT) || 587;
// Port 465 = implicit TLS (secure: true). Port lain (mis. 587) = STARTTLS (secure: false + requireTLS).
const isImplicitTLS = SMTP_PORT === 465;

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: process.env.SMTP_PORT == 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  tls: {
    rejectUnauthorized: false
  },
  family: 4,
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 10000
});

// Cek koneksi & kredensial SMTP sekali saat server start, supaya masalah
// konfigurasi ketahuan dari log tanpa harus menunggu ada notifikasi terkirim.
transporter.verify((err, success) => {
    if (err) {
        console.error("❌ [EMAIL SERVICE] Verifikasi SMTP GAGAL saat startup:");
        console.error("   Kode error :", err.code);
        console.error("   Pesan      :", err.message);
        if (err.response) console.error("   Respons server:", err.response);
        console.error(
            "   👉 Kalau kredensial sudah App Password Gmail yang benar, cek juga apakah " +
            "SMTP_HOST/SMTP_PORT di .env sudah sesuai (587 = STARTTLS, 465 = implicit TLS)."
        );
    } else {
        console.log("✅ [EMAIL SERVICE] Koneksi SMTP berhasil diverifikasi, siap mengirim email.");
    }
});

/**
 * Mengirim email
 * @param {String} toEmail
 * @param {String} subject
 * @param {String} html
 */
const sendEmail = async (toEmail, subject, html) => {
    try {
        // 🔧 FIX: guard email tujuan kosong -- sebelumnya langsung diteruskan ke
        // nodemailer dan gagal dengan error yang tidak jelas asal-usulnya.
        if (!toEmail || typeof toEmail !== 'string' || !toEmail.includes('@')) {
            console.error("[EMAIL SERVICE] Dibatalkan: alamat email tujuan tidak valid ->", toEmail);
            return false;
        }

        const mailOptions = {
            from: `"ScrumApps Notification" <${process.env.SMTP_USER}>`,
            to: toEmail,
            subject,
            html
        };

        const info = await transporter.sendMail(mailOptions);

        console.log("====================================");
        console.log("EMAIL BERHASIL DIKIRIM");
        console.log("Kepada :", toEmail);
        console.log("Subject :", subject);
        console.log("Message ID :", info.messageId);
        console.log("====================================");

        return true;

    } catch (err) {
        // 🔧 FIX: sebelumnya cuma console.error(err) (object mentah, sering
        // sulit dibaca di terminal). Sekarang field yang paling relevan untuk
        // diagnosis SMTP Gmail ditampilkan eksplisit.
        console.error("====================================");
        console.error("EMAIL GAGAL DIKIRIM");
        console.error("Kepada     :", toEmail);
        console.error("Kode error :", err.code);
        console.error("Pesan      :", err.message);
        if (err.response) console.error("Respons server:", err.response);
        console.error("====================================");

        return false;
    }
};

module.exports = {
    sendEmail
};