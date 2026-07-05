const db = require('../config/db');

/**
 * 🏢 VALIDATOR 1: Memeriksa Kuota Pembuatan Proyek
 */
const checkProjectLimit = async (req, res, next) => {
  try {
    // 1. Manfaatkan cache data user & tenant yang sudah diekstrak oleh verifyToken sebelumnya
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Akses Ditolak: Sesi tidak valid atau kedaluwarsa." });
    }

    const tenantId = req.user.tenant_id;
    const tenantPackage = req.user.package_type || 'FREE';
    const subStatus = req.user.subscription_status || 'active';

    if (!tenantId) {
      return res.status(404).json({ message: "Data perusahaan/workspace tidak ditemukan." });
    }

    // 2. Blokir jika status perusahaan terdeteksi kedaluwarsa dari verifyToken
    if (subStatus === 'expired') {
      return res.status(403).json({ 
        message: "Akses Terkunci: Masa langganan atau trial workspace Anda telah habis. Silakan lakukan pembaruan paket." 
      });
    }

    // 3. HITUNG JUMLAH PROYEK YANG SUDAH DIBUAT TIM/TENANT INI
    const [projectRows] = await db.query(
      'SELECT COUNT(*) as total_projects FROM tbr_projects WHERE tenant_id = ?',
      [tenantId]
    );
    const currentProjects = projectRows[0].total_projects;

    // 4. EVALUASI BATASAN KUOTA PROYEK SESUAI ATURAN BISNIS
    if (tenantPackage === 'FREE' && currentProjects >= 1) {
      return res.status(403).json({ 
        message: "Batas Paket FREE: Anda hanya dapat membuat maksimal 1 proyek. Silakan hubungi Admin Workspace untuk upgrade ke paket PRO!" 
      });
    }

    if (tenantPackage === 'PRO' && currentProjects >= 15) {
      return res.status(403).json({ 
        message: "Batas Paket PRO: Anda telah mencapai batas maksimal 15 proyek. Silakan upgrade ke paket ENTERPRISE untuk kuota tanpa batas." 
      });
    }

    // Teruskan ke controller pembuatan proyek jika lolos kuota
    next();
  } catch (error) {
    console.error("CHECK PROJECT LIMIT ERROR:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada sistem pengecekan kuota proyek." });
  }
};

/**
 * 👥 VALIDATOR 2: Memeriksa Kuota Anggota di Dalam Proyek
 */
const checkTeamLimit = async (req, res, next) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: "Akses Ditolak: Sesi tidak valid." });
    }

    // 🔥 FIX SINKRONISASI: Ambil dari req.params sesuai struktur routing /:projectId/members
    const projectId = req.params.projectId || req.body.project_id; 
    const tenantPackage = req.user.package_type || 'FREE';

    if (!projectId) {
      return res.status(400).json({ message: "ID Proyek diperlukan untuk memeriksa kuota tim." });
    }

    // Hitung jumlah anggota tim yang terdaftar di proyek ini secara realtime
    const [memberRows] = await db.query(
      'SELECT COUNT(*) as total_members FROM tbr_project_members WHERE project_id = ?',
      [projectId]
    );
    const currentTeamSize = memberRows[0].total_members;

    // EVALUASI BATASAN KUOTA TIM SESUAI ATURAN BISNIS
    if (tenantPackage === 'FREE' && currentTeamSize >= 5) {
      return res.status(403).json({ 
        message: "Batas Paket FREE: Maksimal 5 anggota per proyek. Silakan upgrade ke paket PRO!" 
      });
    }

    if (tenantPackage === 'PRO' && currentTeamSize >= 25) {
      return res.status(403).json({ 
        message: "Batas Paket PRO: Maksimal 25 anggota per proyek. Hubungi pihak Enterprise untuk kuota unlimited." 
      });
    }

    next();
  } catch (error) {
    console.error("CHECK TEAM LIMIT ERROR:", error);
    res.status(500).json({ message: "Terjadi kesalahan pada sistem pengecekan kuota tim." });
  }
};

module.exports = { checkProjectLimit, checkTeamLimit };