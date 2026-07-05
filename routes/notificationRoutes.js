const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyToken } = require('../middleware/auth');
const { sendEmail } = require('../services/emailService');
const sprintReminderService = require('../cron/cronService');
const notificationModel = require('../models/notificationModel');

// =============================================
// 1. GET NOTIFIKASI USER
// =============================================
router.get('/', verifyToken, async (req, res) => {
  try {
    // 🔧 FIX: endpoint ini di-poll tiap 30 detik oleh NotificationBell.jsx.
    // Tanpa header ini, Express (ETag default aktif) bisa membalas 304 Not
    // Modified dan browser diam-diam memakai body dari cache lokal yang lama,
    // sehingga notifikasi baru terlihat "tidak muncul" walau sudah tersimpan
    // di DB. Data notifikasi bersifat dinamis, jadi jangan pernah di-cache.
    res.set('Cache-Control', 'no-store');

    const userId = req.user.id;
    const rows = await notificationModel.getByUser(userId, { limit: 100 });

    // Format tetap sama seperti sebelumnya (isRead, time, createdAt)
    // supaya NotificationBell.jsx tidak perlu diubah.
    const notifications = rows.map(n => ({
      id: n.id,
      title: n.title,
      message: n.message,
      type: n.type,
      isRead: n.is_read,
      time: new Date(n.created_at).toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
      }),
      createdAt: n.created_at
    }));

    // 🔧 FIX: sebelumnya key response ini "data", padahal NotificationBell.jsx
    // membaca response.data.notifications (key "notifications"). Akibatnya
    // fetch selalu dianggap gagal (Array.isArray(undefined) === false) dan
    // lonceng notifikasi selalu tampil "Tidak ada notifikasi" walau row-nya
    // sudah tersimpan di tabel tbr_notifications. Key diganti jadi
    // "notifications" tanpa mengubah struktur/isi data lain.
    res.status(200).json({ success: true, notifications });
  } catch (err) {
    console.error("Error fetching notifications:", err);
    res.status(500).json({ success: false, message: "Gagal mengambil data notifikasi" });
  }
});

// =============================================
// 2. TANDAI SEMUA NOTIFIKASI SUDAH DIBACA
// =============================================
router.patch('/read-all', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    await notificationModel.markAllAsRead(userId);

    res.status(200).json({ success: true, message: "Semua notifikasi ditandai sudah dibaca" });
  } catch (err) {
    console.error("Error marking notifications as read:", err);
    res.status(500).json({ success: false, message: "Gagal memperbarui status notifikasi" });
  }
});

// =============================================
// 2.1 TANDAI SATU NOTIFIKASI DIBACA
// =============================================
router.patch('/read/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const success = await notificationModel.markAsRead(id, userId);

    if (!success) {
      return res.status(404).json({ success: false, message: "Notifikasi tidak ditemukan" });
    }

    res.status(200).json({ success: true, message: "Notifikasi ditandai sudah dibaca" });
  } catch (err) {
    console.error("Error marking single notification as read:", err);
    res.status(500).json({ success: false, message: "Gagal memperbarui status notifikasi" });
  }
});

// =============================================
// 3. TRIGGER SPRINT REMINDER MANUAL (RF-14.1)
//    Sekarang cocok dengan export sprintReminderService.js
// =============================================
router.post('/trigger-sprint-check', verifyToken, async (req, res) => {
  try {
    console.log('⏰ Menjalankan trigger sprint check manual...');
    // 🔧 FIX: cronService.js meng-export `runSprintReminderJob`, bukan
    // `checkAndSendReminders` (fungsi itu tidak pernah ada). Sebelumnya ini
    // selalu melempar TypeError setiap endpoint ini dipanggil, sehingga
    // trigger manual RF-14.1 selalu gagal total (500 Internal Server Error).
    //
    // 🆕 Terima `userId` opsional dari body -- dipakai fitur "Kirim Reminder
    // Manual" di dashboard Team Developer untuk menyasar satu PO tertentu.
    // Tanpa `userId`, perilaku lama tetap: proses semua PO yang sprint-nya
    // akan berakhir < 3 hari.
    const targetUserId = req.body?.userId ? Number(req.body.userId) : null;
    const count = await sprintReminderService.runSprintReminderJob(targetUserId);

    res.status(200).json({
      success: true,
      message: count > 0
        ? `Pengecekan sprint selesai. ${count} notifikasi dikirim.`
        : targetUserId
          ? `Tidak ada sprint yang akan berakhir dalam waktu dekat untuk PO ini.`
          : `Pengecekan sprint selesai. 0 notifikasi dikirim.`,
      count,
    });
  } catch (error) {
    console.error('❌ Error triggering sprint check:', error);
    res.status(500).json({
      success: false,
      message: 'Gagal menjalankan pengecekan sprint',
      error: error.message,
    });
  }
});

// =============================================
// 4. FITUR PENGUJIAN EMAIL (TESTING)
// =============================================
router.post('/test-email', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: "Email tujuan diperlukan" });

    await sendEmail(
      email,
      "Tes Notifikasi ScrumApps",
      "<h1>Berhasil!</h1><p>Sistem email Anda berfungsi dengan baik.</p>"
    );

    res.status(200).json({ success: true, message: "Email tes terkirim ke: " + email });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;