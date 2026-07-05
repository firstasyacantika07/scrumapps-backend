const db = require('../config/db');

exports.getDashboardStats = async (req, res) => {
    try {
        /** 
         * PERHATIKAN: 
         * Gunakan 'project_status' jika Anda sudah menambahkannya ke database.
         * Jika di database nama kolomnya masih 'status', ganti semua kata 
         * 'project_status' di bawah ini menjadi 'status'.
         */
        const query = `
            SELECT 
                (SELECT COUNT(*) FROM tbr_projects) as total_projects,
                (SELECT COUNT(*) FROM tbr_projects WHERE status = 'Hold') as hold,
                (SELECT COUNT(*) FROM tbr_projects WHERE status = 'In Progress') as progress,
                (SELECT COUNT(*) FROM tbr_projects WHERE status = 'Done') as done,
                (SELECT COUNT(*) FROM users) as total_users
        `;

        const [results] = await db.query(query);
        
        // Mengirimkan data dalam format JSON
        res.json({
            success: true,
            data: results[0]
        });

    } catch (err) {
        console.error("Dashboard Stats Error:", err.message);
        res.status(500).json({ 
            success: false, 
            error: "Gagal memuat statistik dashboard: " + err.message 
        });
    }
};

// --- TAMBAHAN KODE BARU ---

// Fungsi untuk statistik Super Admin (Fokus pada manajemen user)[cite: 1, 2]
exports.getAdminStats = async (req, res) => {
    try {
        const query = `
            SELECT 
                (SELECT COUNT(*) FROM users) as total_users,
                (SELECT COUNT(*) FROM users WHERE role = 'Super Admin') as total_admins,
                (SELECT COUNT(*) FROM tbr_projects) as total_projects
        `;
        const [results] = await db.query(query);
        res.status(200).json(results[0]);
    } catch (err) {
        res.status(500).json({ message: "Gagal memuat statistik admin: " + err.message });
    }
};

// Fungsi untuk statistik Project (Fokus pada Analyst/Developer)[cite: 1, 2]
exports.getProjectStats = async (req, res) => {
    try {
        const query = `
            SELECT 
                (SELECT COUNT(*) FROM tbr_projects) as total,
                (SELECT COUNT(*) FROM tbr_projects WHERE status = 'Hold') as hold,
                (SELECT COUNT(*) FROM tbr_projects WHERE status = 'In Progress') as progress,
                (SELECT COUNT(*) FROM tbr_projects WHERE status = 'Done') as done,
                (SELECT COUNT(*) FROM tbr_projects WHERE status = 'Late') as late
        `;
        const [results] = await db.query(query);
        res.status(200).json(results[0]);
    } catch (err) {
        res.status(500).json({ message: "Gagal memuat statistik proyek: " + err.message });
    }
};