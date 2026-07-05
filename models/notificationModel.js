const db = require('../config/db');

/**
 * Layer akses DB khusus notifikasi website (in-app notification).
 * Terpisah dari emailService supaya email & notifikasi web independen:
 * kalau email gagal kirim, notifikasi web tetap tersimpan, begitu juga sebaliknya.
 */
const notificationModel = {
  // Simpan satu notifikasi baru untuk ditampilkan di website
  create: async ({ userId, projectId = null, type, title, message }) => {
    try {
      const [result] = await db.query(
        `INSERT INTO tbr_notifications (user_id, project_id, type, title, message, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [userId, projectId, type, title, message]
      );
      return result.insertId;
    } catch (err) {
      console.error('[NOTIFICATION MODEL] Gagal menyimpan notifikasi:', err.message);
      return null;
    }
  },

  // Ambil daftar notifikasi milik satu user (untuk dropdown/lonceng notifikasi di website)
  getByUser: async (userId, { onlyUnread = false, limit = 20 } = {}) => {
    const conditions = ['user_id = ?'];
    const params = [userId];

    if (onlyUnread) {
      conditions.push('is_read = 0');
    }

    const [rows] = await db.query(
      `SELECT id, project_id, type, title, message, is_read, created_at
       FROM tbr_notifications
       WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC
       LIMIT ?`,
      [...params, limit]
    );
    return rows;
  },

  // Hitung jumlah notifikasi belum dibaca (untuk badge angka di icon lonceng)
  countUnread: async (userId) => {
    const [rows] = await db.query(
      `SELECT COUNT(*) as total FROM tbr_notifications WHERE user_id = ? AND is_read = 0`,
      [userId]
    );
    return rows[0]?.total || 0;
  },

  // Tandai satu notifikasi sudah dibaca
  markAsRead: async (notificationId, userId) => {
    const [result] = await db.query(
      `UPDATE tbr_notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
      [notificationId, userId]
    );
    return result.affectedRows > 0;
  },

  // Tandai semua notifikasi milik user sudah dibaca
  markAllAsRead: async (userId) => {
    await db.query(`UPDATE tbr_notifications SET is_read = 1 WHERE user_id = ?`, [userId]);
    return true;
  }
};

module.exports = notificationModel;