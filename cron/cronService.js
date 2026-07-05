const cron = require('node-cron');
const db = require('../config/db');
const notificationService = require('../services/notificationService');

/**
 * PENTING: Ini SATU-SATUNYA file cron untuk pengingat sprint (RF-14.1 & 14.2).
 * File ini menggantikan cronService.js, sprintReminder.js, dan sprintReminderService.js.
 * Ketiga file lama mendaftarkan jadwal '0 8 * * *' yang sama persis, sehingga setiap
 * Project Owner menerima 3 email/notifikasi duplikat setiap pagi. Hapus ketiga file
 * lama tersebut (atau hentikan require-nya di app.js/server.js) setelah memakai file ini.
 */

const runSprintReminderJob = async (targetUserId = null) => {
  let sentCount = 0;

  try {
    // 🔧 FIX: RF-14.1 mensyaratkan "tenggat sprint KURANG DARI tiga hari".
    // Kondisi lama "<= 3" ikut mengirim reminder saat sisa waktu TEPAT 3 hari,
    // padahal itu bukan "kurang dari tiga hari". Diperbaiki menjadi "< 3".
    //
    // 🆕 targetUserId (opsional): kalau diisi, hanya sprint milik PO tersebut
    // yang diproses -- dipakai untuk fitur "Kirim Reminder Manual" di dashboard
    // Team Developer (kirim reminder ke satu PO tertentu, bukan job massal).
    const params = [];
    let userFilter = '';
    if (targetUserId) {
      userFilter = 'AND u.id = ?';
      params.push(targetUserId);
    }

    const [sprints] = await db.query(`
      SELECT
        s.name as sprint_name,
        s.end_date,
        p.name as project_name,
        p.id as project_id,
        u.id as user_id,
        u.name as user_name,
        u.email
      FROM tbr_sprints s
      JOIN tbr_projects p ON s.project_id = p.id
      JOIN tbr_project_members pm ON p.id = pm.project_id
      JOIN tbr_users u ON pm.user_id = u.id
      WHERE pm.role_in_project = 'ProjectOwner'
      AND DATEDIFF(s.end_date, NOW()) < 3
      ${userFilter}
    `, params);

    for (const item of sprints) {
      const daysLeft = notificationService.getDaysLeft(item.end_date);

      const result = await notificationService.sendSprintReminderNotification({
        userId: item.user_id,
        projectId: item.project_id,
        email: item.email,
        userName: item.user_name,
        projectName: item.project_name,
        sprintName: item.sprint_name,
        daysLeft
      });

      // 🔧 FIX: fungsi ini sebelumnya tidak melacak/mengembalikan apa pun,
      // padahal notificationRoutes.js (trigger-sprint-check) mengharapkan
      // nilai `count` untuk ditampilkan ke Business Analyst/Admin.
      if (result?.emailSent || result?.notifId) {
        sentCount += 1;
      }
    }
  } catch (err) {
    console.error('[Sprint Reminder Cron Error]:', err.message);
  }

  return sentCount;
};

const startCronJobs = () => {
  // 🔧 FIX: tanpa `timezone` eksplisit, jadwal ini mengikuti timezone SERVER
  // (kalau di-deploy di VPS/cloud yang di-set UTC, "jam 08:00" di sini
  // sebenarnya jam 15:00 WIB, bukan jam 8 pagi seperti yang dimaksud).
  // Dikunci ke Asia/Jakarta supaya konsisten di server manapun ia di-deploy.
  cron.schedule('0 8 * * *', runSprintReminderJob, { timezone: 'Asia/Jakarta' });
};

module.exports = { startCronJobs, runSprintReminderJob };