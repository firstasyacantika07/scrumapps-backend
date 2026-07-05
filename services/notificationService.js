const { sendEmail } = require('./emailService');
// 🔧 FIX: Nama variabel import sebelumnya "Notification" tapi dipakai sebagai
// "notificationModel" di bawah (beda nama) -> selalu ReferenceError setiap
// dispatch() dipanggil, sehingga notifikasi in-app (website) SELALU GAGAL diam-diam.
const notificationModel = require('../models/notificationModel');

/**
 * Helper internal: kirim email DAN simpan notifikasi website secara bersamaan.
 * Kalau salah satu gagal, yang lain tetap jalan (tidak saling menggagalkan).
 */
const dispatch = async ({ userId, projectId = null, type, email, subject, html, title, message }) => {
  const [emailResult, notifResult] = await Promise.allSettled([
    email ? sendEmail(email, subject, html) : Promise.resolve(false),
    userId ? notificationModel.create({ userId, projectId, type, title, message }) : Promise.resolve(null)
  ]);

  if (emailResult.status === 'rejected') {
    console.error('[NOTIFICATION] Gagal kirim email:', emailResult.reason?.message || emailResult.reason);
  }
  if (notifResult.status === 'rejected') {
    console.error('[NOTIFICATION] Gagal simpan notifikasi in-app:', notifResult.reason?.message || notifResult.reason);
  }

  return {
    emailSent: emailResult.status === 'fulfilled' ? emailResult.value : false,
    notifId: notifResult.status === 'fulfilled' ? notifResult.value : null,
  };
};

/**
 * =========================================================================
 * TEMPLATE BASE: Kartu email premium ScrumApps (gaya sama dengan
 * invitationController.js) — header brand, badge warna sesuai tipe notifikasi,
 * isi pesan, tombol CTA, dan footer otomatis.
 * =========================================================================
 * @param {string} badgeLabel - teks kecil di atas (mis. "STATUS PROYEK")
 * @param {string} badgeColor - warna aksen badge & tombol (hex)
 * @param {string} heading - judul utama di dalam kartu
 * @param {string} bodyHtml - isi pesan (boleh berupa beberapa paragraf HTML)
 * @param {string} ctaLabel - teks tombol aksi
 * @param {string} ctaUrl - link tombol aksi
 */
const buildEmailCard = ({ badgeLabel, badgeColor = '#ee1e2d', heading, bodyHtml, ctaLabel = 'Buka ScrumApps', ctaUrl = process.env.FRONTEND_URL || 'http://localhost:5173' }) => `
  <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 550px; margin: 0 auto; padding: 30px; border: 1px solid #f0f0f0; border-radius: 24px; background-color: #ffffff;">
    <div style="text-align: center; margin-bottom: 24px;">
      <h2 style="color: #ee1e2d; margin: 0; font-size: 26px; font-weight: 900; letter-spacing: -0.5px;">ScrumApps</h2>
      <p style="color: #94a3b8; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; margin-top: 5px; font-weight: bold;">SaaS Agile Project Management</p>
    </div>

    <div style="text-align: center; margin-bottom: 18px;">
      <span style="display: inline-block; background-color: ${badgeColor}1A; color: ${badgeColor}; font-size: 10px; font-weight: 900; text-transform: uppercase; letter-spacing: 1.5px; padding: 6px 14px; border-radius: 999px;">
        ${badgeLabel}
      </span>
    </div>

    <h3 style="color: #0f172a; font-size: 18px; font-weight: 800; text-align: center; margin: 0 0 16px 0;">${heading}</h3>

    <div style="color: #334155; font-size: 14px; line-height: 1.6;">
      ${bodyHtml}
    </div>

    <div style="text-align: center; margin: 30px 0 10px 0;">
      <a href="${ctaUrl}" style="background-color: #0f172a; color: #ffffff; padding: 14px 32px; border-radius: 12px; text-decoration: none; font-size: 13px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);">
        ${ctaLabel}
      </a>
    </div>

    <hr style="border: none; border-top: 1px solid #f1f5f9; margin: 24px 0 20px 0;" />
    <p style="color: #94a3b8; font-size: 11px; text-align: center; margin: 0;">
      Email ini dikirim secara otomatis oleh sistem ScrumApps. Mohon untuk tidak membalas email ini.
    </p>
  </div>
`;

const notificationService = {
  // RF-13.1: Notifikasi Tambah Proyek — Product Owner menerima notifikasi
  // melalui email saat ditambahkan ke dalam proyek.
  sendProjectAssignmentNotification: async ({ userId, email, userName, projectName, projectId = null }) => {
    const subject = `Anda Ditambahkan Pada Proyek Baru: ${projectName}`;
    const message = `Anda telah ditambahkan sebagai Product Owner pada proyek "${projectName}".`;
    const html = buildEmailCard({
      badgeLabel: 'Penugasan Proyek',
      badgeColor: '#2563eb',
      heading: 'Anda Ditambahkan ke Proyek Baru',
      bodyHtml: `
        <p>Halo, <strong>${userName}</strong></p>
        <p>Anda telah ditambahkan sebagai <strong>Product Owner</strong> pada proyek <strong>${projectName}</strong>. Anda sekarang dapat memantau progres, mengelola backlog, dan berkoordinasi dengan tim langsung dari dashboard.</p>
      `,
      ctaLabel: 'Buka Proyek Saya',
      ctaUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/projects`,
    });
    return dispatch({
      userId, projectId, email, subject, html,
      type: 'project_assignment',
      title: 'Ditambahkan ke proyek baru',
      message
    });
  },

  // RF-13.2: Notifikasi Hapus Proyek — Product Owner menerima notifikasi
  // melalui email saat proyek dihapus.
  sendProjectRemovalNotification: async ({ userId, email, userName, projectName, projectId = null }) => {
    const subject = `Pemberitahuan Penghapusan Proyek: ${projectName}`;
    const message = `Proyek "${projectName}" telah dihapus dari sistem.`;
    const html = buildEmailCard({
      badgeLabel: 'Proyek Dihapus',
      badgeColor: '#ee1e2d',
      heading: 'Proyek Telah Dihapus Permanen',
      bodyHtml: `
        <p>Halo, <strong>${userName}</strong></p>
        <p>Proyek <strong>${projectName}</strong> yang sebelumnya Anda kelola telah dihapus secara permanen oleh Admin Workspace. Seluruh data terkait proyek ini (backlog, sprint, dan tugas) sudah tidak dapat diakses lagi.</p>
      `,
      ctaLabel: 'Lihat Workspace Saya',
      ctaUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard`,
    });
    return dispatch({
      userId, projectId, email, subject, html,
      type: 'project_removal',
      title: 'Proyek dihapus',
      message
    });
  },

  // RF-04: Pengguna menerima notifikasi status proyek saat late/terlambat
  // dan done/selesai.
  // 🔧 CATATAN: khusus notifikasi status proyek ini SENGAJA tidak mengirim
  // email -- hanya disimpan sebagai notifikasi in-app (lonceng website).
  // Fitur lain (assignment, penghapusan proyek, pengingat sprint) tetap
  // memakai dispatch() seperti sebelumnya dan tetap mengirim email.
  sendProjectStatusNotification: async ({ userId, email, userName, projectName, status, projectId = null }) => {
    const isLate = status === 'late';
    const statusLabel = isLate ? 'TERLAMBAT' : 'SELESAI';
    const message = `Status proyek "${projectName}" telah diperbarui menjadi ${statusLabel}.`;

    const notifId = await notificationModel.create({
      userId,
      projectId,
      type: 'project_status',
      title: `Status proyek: ${statusLabel}`,
      message
    });

    return { emailSent: false, notifId };
  },

  // RF-14.1: Product Owner menerima notifikasi pengingat sprint akan
  // berakhir melalui email saat tenggat sprint kurang dari tiga hari.
  sendSprintReminderNotification: async ({ userId, email, userName, projectName, sprintName, daysLeft, projectId = null }) => {
    // 🔧 FIX: sebelumnya daysLeft negatif (sprint sudah lewat tenggat) tetap
    // ditampilkan mentah sebagai "-2 hari lagi" yang membingungkan PO.
    // Sekarang dibedakan jadi kondisi "terlambat" dengan copy & warna berbeda.
    const isOverdue = daysLeft < 0;
    const dayLabel = isOverdue
      ? `sudah lewat ${Math.abs(daysLeft)} hari`
      : daysLeft === 0
        ? 'hari ini'
        : `${daysLeft} hari lagi`;

    const subject = isOverdue
      ? `Sprint Terlambat: ${sprintName} sudah melewati tenggat waktu`
      : `Pengingat Sprint: ${sprintName} akan berakhir ${dayLabel}`;
    const message = isOverdue
      ? `Sprint "${sprintName}" pada proyek "${projectName}" ${dayLabel} dari tenggat waktu.`
      : `Sprint "${sprintName}" pada proyek "${projectName}" akan berakhir ${dayLabel}.`;

    const html = buildEmailCard({
      badgeLabel: isOverdue ? 'Sprint Terlambat' : 'Pengingat Sprint',
      badgeColor: isOverdue ? '#ee1e2d' : '#f59e0b',
      heading: isOverdue ? 'Sprint Melewati Tenggat Waktu' : `Sprint Berakhir ${dayLabel}`,
      bodyHtml: isOverdue
        ? `
          <p>Halo, <strong>${userName}</strong></p>
          <p>Sprint <strong>${sprintName}</strong> pada proyek <strong>${projectName}</strong> <strong style="color:#ee1e2d;">${dayLabel}</strong> dari tenggat waktu yang direncanakan. Segera perbarui status sprint atau sesuaikan jadwalnya.</p>
        `
        : `
          <p>Halo, <strong>${userName}</strong></p>
          <p>Sprint <strong>${sprintName}</strong> pada proyek <strong>${projectName}</strong> akan berakhir <strong style="color:#f59e0b;">${dayLabel}</strong>. Pastikan seluruh backlog dan tugas pada sprint ini sudah ditinjau sebelum tenggat waktu.</p>
        `,
      ctaLabel: 'Buka Papan Sprint',
      ctaUrl: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/projects`,
    });
    return dispatch({
      userId, projectId, email, subject, html,
      type: isOverdue ? 'sprint_overdue' : 'sprint_reminder',
      title: isOverdue ? 'Sprint terlambat' : 'Pengingat sprint',
      message
    });
  },

  // Helper: hitung selisih hari secara akurat (bukan getDate() - getDate())
  getDaysLeft: (endDate) => {
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const end = new Date(endDate);
    end.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((end - today) / MS_PER_DAY);
  }
};

module.exports = notificationService;