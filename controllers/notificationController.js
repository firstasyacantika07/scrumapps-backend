const db = require('../models');
const sqlDb = require('../config/db'); // Import untuk akses query SQL tbr_notifications

exports.handleNotification = async (req, res) => {
    try {
        const statusResponse = req.body;
        const orderId = statusResponse.order_id;
        const transactionStatus = statusResponse.transaction_status;
        const fraudStatus = statusResponse.fraud_status;

        const order = await db.Order.findOne({ where: { order_id: orderId } });
        if (!order) return res.status(404).json({ message: "Order not found" });

        if (transactionStatus === 'settlement') {
            // 1. Update status order
            await order.update({ status: 'success' });

            // 2. Update Tier User & Masa Aktif
            const user = await db.User.findByPk(order.user_id);
            const durationDays = order.plan === 'PRO_MONTHLY' ? 30 : 365;
            
            const expiryDate = new Date();
            expiryDate.setDate(expiryDate.getDate() + durationDays);

            await user.update({
                subscription_tier: 'PRO',
                subscription_expiry: expiryDate
            });
        } 
        // Logika untuk 'expire' atau 'cancel' bisa ditambahkan di sini

        res.status(200).send('OK');
    } catch (error) {
        res.status(500).send(error.message);
    }
};

// --- TAMBAHAN CODE RF-04 (TANPA MENGUBAH LOGIKA SEBELUMNYA) ---
exports.sendProjectStatusNotification = async (userId, projectName, status) => {
    try {
        const title = status === 'done' ? 'Proyek Selesai' : 'Proyek Terlambat';
        const message = `Status proyek "${projectName}" saat ini adalah ${status}.`;
        const type = status.toUpperCase();

        await sqlDb.query(
            `INSERT INTO tbr_notifications (user_id, title, message, is_read, created_at, type) 
             VALUES (?, ?, ?, 0, NOW(), ?)`,
            [userId, title, message, type]
        );
        
        console.log(`✅ Notifikasi ${status} untuk user ${userId} tersimpan.`);
    } catch (error) {
        console.error("❌ Gagal menyimpan notifikasi status proyek:", error.message);
    }
};

// --- TAMBAHAN CODE: ENDPOINT NOTIFIKASI WEBSITE (LONCENG NOTIFIKASI) ---

// GET /api/notifications?unread=true
exports.getMyNotifications = async (req, res) => {
    try {
        const userId = req.user.id;
        const onlyUnread = req.query.unread === 'true';

        const [notifications] = await sqlDb.query(
            `SELECT id, project_id AS projectId, type, title, message,
                    is_read AS isRead, created_at AS createdAt
             FROM tbr_notifications
             WHERE user_id = ? ${onlyUnread ? 'AND is_read = 0' : ''}
             ORDER BY created_at DESC
             LIMIT 20`,
            [userId]
        );

        const [unreadRows] = await sqlDb.query(
            `SELECT COUNT(*) as total FROM tbr_notifications WHERE user_id = ? AND is_read = 0`,
            [userId]
        );

        res.status(200).json({
            success: true,
            notifications,
            unreadCount: unreadRows[0]?.total || 0
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// PATCH /api/notifications/:id/read
exports.markAsRead = async (req, res) => {
    try {
        const userId = req.user.id;
        const [result] = await sqlDb.query(
            `UPDATE tbr_notifications SET is_read = 1 WHERE id = ? AND user_id = ?`,
            [req.params.id, userId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Notifikasi tidak ditemukan.' });
        }

        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

// PATCH /api/notifications/read-all
exports.markAllAsRead = async (req, res) => {
    try {
        const userId = req.user.id;
        await sqlDb.query(`UPDATE tbr_notifications SET is_read = 1 WHERE user_id = ?`, [userId]);
        res.status(200).json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};