const db = require('../config/db');

class UserModel {
    static async getAll() {
        // PERBAIKAN: Mengubah trial_ends_at menjadi trial_start dan trial_end sesuai pembersihan database
        const [rows] = await db.query(
            'SELECT id, name, email, role, package_type, subscription_status, trial_start, trial_end, subscription_ends_at, created_at FROM tbr_users'
        );
        return rows;
    }

    static async findByEmail(email) {
        const [rows] = await db.query('SELECT * FROM tbr_users WHERE email = ?', [email]);
        return rows[0];
    }

    static async findById(id) {
        const [rows] = await db.query('SELECT * FROM tbr_users WHERE id = ?', [id]);
        return rows[0];
    }

    static async create(data) {
        // PERBAIKAN: Menyinkronkan kolom pendaftaran dengan skema tanggal yang baru, serta menambahkan gender (jika dibutuhkan oleh form register Anda)
        const { name, email, password, role, package_type, subscription_status, trial_start, trial_end, gender } = data;
        
        const [result] = await db.query(
            'INSERT INTO tbr_users (name, email, password, role, package_type, subscription_status, trial_start, trial_end, gender) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                name, 
                email, 
                password, 
                role || 'TeamDeveloper', // Menyesuaikan default role ScrumApps Anda
                package_type || 'FREE', 
                subscription_status || 'active', 
                trial_start || null, 
                trial_end || null,
                gender || 'male' // Menghindari anomali pergeseran data kosong pada gender
            ]
        );
        return result.insertId;
    }

    static async updateSubscription(id, data) {
        // PERBAIKAN: Mengubah parameter update sesuai kolom tanggal yang dipertahankan
        const { package_type, subscription_status, subscription_ends_at, trial_start, trial_end } = data;
        await db.query(
            'UPDATE tbr_users SET package_type = ?, subscription_status = ?, subscription_ends_at = ?, trial_start = ?, trial_end = ? WHERE id = ?',
            [package_type, subscription_status, subscription_ends_at, trial_start, trial_end, id]
        );
    }

    static async delete(id) {
        await db.query('DELETE FROM tbr_users WHERE id = ?', [id]);
    }
}

module.exports = UserModel;