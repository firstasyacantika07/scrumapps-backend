const db = require('../config/db');

class CompanyModel {
    static async getStats() {
        const [projects] = await db.query('SELECT COUNT(*) as total FROM tbr_projects');
        const [users] = await db.query('SELECT COUNT(*) as total FROM tbr_users');
        const [backlogs] = await db.query('SELECT COUNT(*) as total FROM tbr_backlogs');
        
        return {
            totalProjects: projects[0].total,
            totalUsers: users[0].total,
            totalBacklogs: backlogs[0].total,
            companyName: "ScrumApps Inc." // Bisa diambil dari tabel settings jika ada
        };
    }
}

module.exports = CompanyModel;