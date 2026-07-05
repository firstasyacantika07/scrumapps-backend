const cron = require('node-cron');
const db = require('../config/db'); // Menggunakan koneksi DB yang sama dengan controller
const notificationService = require('../services/notificationService');

// Menjalankan setiap hari jam 08:00 pagi
cron.schedule('0 8 * * *', async () => {
  try {
    const query = `
      SELECT s.name as sprint_name, s.end_date, p.name as project_name, u.name as user_name, u.email
      FROM tbr_sprints s
      JOIN tbr_projects p ON s.project_id = p.id
      JOIN tbr_project_members pm ON p.id = pm.project_id
      JOIN tbr_users u ON pm.user_id = u.id
      WHERE pm.role_in_project = 'ProjectOwner'
      AND DATEDIFF(s.end_date, NOW()) <= 3 
      AND DATEDIFF(s.end_date, NOW()) >= 0
    `;
    
    const [sprints] = await db.query(query);

    for (const item of sprints) {
      await notificationService.sendSprintReminderNotification({
        email: item.email,
        userName: item.user_name,
        projectName: item.project_name,
        sprintName: item.sprint_name,
        daysLeft: 3, // Atau hitung selisih hari yang presisi
        endDate: item.end_date
      });
    }
  } catch (err) {
    console.error("Cron Job Error:", err.message);
  }
});