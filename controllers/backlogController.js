const db = require('../config/db');
const PDFDocument = require('pdfkit'); // Pastikan sudah install: npm install pdfkit

/**
 * 📦 1. GET ALL BACKLOGS BY PROJECT (Diferensiasi Multi-Tenant)
 */
exports.getBacklogsByProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

    // Validasi silang untuk memastikan proyek ini benar milik tenant user yang login
    const [projectCheck] = await db.query(
      'SELECT id FROM tbr_projects WHERE id = ? AND tenant_id = ?',
      [projectId, tenantId]
    );
    if (projectCheck.length === 0) {
      return res.status(403).json({ message: "Akses Ditolak: Proyek tidak ditemukan di workspace Anda." });
    }

    const [backlogs] = await db.query(
      `SELECT b.*, u.name as creator_name, s.name as sprint_name 
       FROM tbr_backlogs b
       LEFT JOIN tbr_users u ON b.user_id = u.id
       LEFT JOIN tbr_sprints s ON b.sprint_id = s.id
       WHERE b.project_id = ?
       ORDER BY b.created_at DESC`,
      [projectId]
    );

    res.json(backlogs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * 📝 2. CREATE BACKLOG (Manual User Story oleh PO / BA)
 */
exports.createBacklog = async (req, res) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
    const { name, description, priority, applicant, status, sprint_id } = req.body;

    // Batasan Hak Akses: Team Developer dilarang membuat User Story
    if (userRole === 'teamdeveloper' || userRole === 'superadmin') {
      return res.status(403).json({ message: "Akses Ditolak: Pembuatan Product Backlog murni wewenang PO atau BA." });
    }

    // Validasi Tenant Proyek
    const [projectCheck] = await db.query('SELECT id FROM tbr_projects WHERE id = ? AND tenant_id = ?', [projectId, tenantId]);
    if (projectCheck.length === 0) return res.status(403).json({ message: "Akses Ilegal." });

    const sql = `
      INSERT INTO tbr_backlogs 
      (name, description, priority, applicant, status, sprint_id, project_id, user_id, created_at, updated_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    const [result] = await db.query(sql, [
      name, description || null, priority || 'low', applicant || null, status || 'inactive', sprint_id || null, projectId, userId
    ]);

    res.status(201).json({ success: true, message: "User Story Backlog berhasil dibuat secara manual.", id: result.insertId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * 🔄 3. UPDATE BACKLOG
 */
exports.updateBacklog = async (req, res) => {
  try {
    const { id } = req.params; // ID Backlog
    const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
    const { name, description, priority, applicant, status, sprint_id } = req.body;

    if (userRole === 'teamdeveloper' || userRole === 'superadmin') {
      return res.status(403).json({ message: "Akses Ditolak: Anda tidak memiliki hak memodifikasi User Story." });
    }

    // Pastikan backlog milik proyek yang berada di bawah tenant yang sah
    const [backlogCheck] = await db.query(
      `SELECT b.id FROM tbr_backlogs b 
       INNER JOIN tbr_projects p ON b.project_id = p.id 
       WHERE b.id = ? AND p.tenant_id = ?`,
      [id, tenantId]
    );
    if (backlogCheck.length === 0) return res.status(404).json({ message: "Data Product Backlog tidak ditemukan." });

    const sql = `
      UPDATE tbr_backlogs 
      SET name = ?, description = ?, priority = ?, applicant = ?, status = ?, sprint_id = ?, updated_at = NOW() 
      WHERE id = ?
    `;
    await db.query(sql, [name, description || null, priority || 'low', applicant || null, status || 'inactive', sprint_id || null, id]);

    res.json({ success: true, message: "Product Backlog berhasil diperbarui." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * 🗑️ 4. DELETE BACKLOG
 */
exports.deleteBacklog = async (req, res) => {
  try {
    const { id } = req.params;
    const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

    if (userRole === 'teamdeveloper' || userRole === 'superadmin') {
      return res.status(403).json({ message: "Akses Ditolak." });
    }

    const [backlogCheck] = await db.query(
      `SELECT b.id FROM tbr_backlogs b 
       INNER JOIN tbr_projects p ON b.project_id = p.id 
       WHERE b.id = ? AND p.tenant_id = ?`,
      [id, tenantId]
    );
    if (backlogCheck.length === 0) return res.status(404).json({ message: "Data tidak ditemukan." });

    await db.query('DELETE FROM tbr_backlogs WHERE id = ?', [id]);
    res.json({ success: true, message: "Item Product Backlog berhasil dihapus." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * 📄 5. EXPORT BACKLOG TO PDF (Logika Pembatasan Watermark & Logo Paket SaaS)
 */
exports.exportBacklogToPDF = async (req, res) => {
  try {
    const { projectId } = req.params;
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

    // 1. Ambil info detail paket dan profile dari tbr_tenants
    const [tenantRows] = await db.query(
      'SELECT package_type, company_logo FROM tbr_tenants WHERE id = ? LIMIT 1', 
      [tenantId]
    );
    if (tenantRows.length === 0) return res.status(404).json({ message: "Workspace tidak terdaftar." });
    
    const currentPackage = tenantRows[0].package_type || 'FREE';
    const companyLogo = tenantRows[0].company_logo; // Path url/file logo perusahaan (Enterprise Only)

    // 2. Ambil data project & seluruh list backlognya
    const [projectRows] = await db.query('SELECT name FROM tbr_projects WHERE id = ? AND tenant_id = ?', [projectId, tenantId]);
    if (projectRows.length === 0) return res.status(403).json({ message: "Akses ilegal atau Proyek tidak ditemukan." });

    const [backlogs] = await db.query('SELECT * FROM tbr_backlogs WHERE project_id = ? ORDER BY created_at ASC', [projectId]);

    // 3. Inisiasi Dokumen PDF menggunakan PDFKit
    const doc = new PDFDocument({ margin: 50 });
    
    // Set Header Response agar langsung mendownload file PDF di browser
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Backlog-${projectRows[0].name.replace(/\s+/g, '_')}.pdf`);
    doc.pipe(res);

    // --- LOGIKA HEADER (ENTERPRISE LOGO) ---
    if (currentPackage === 'ENTERPRISE' && companyLogo) {
      try {
        // Asumsi companyLogo adalah local path file gambar logo PT
        doc.image(companyLogo, 50, 45, { width: 50 });
        doc.moveDown();
      } catch (e) {
        console.error("Gagal memuat logo kustom enterprise:", e.message);
      }
    }

    // Judul Dokumen
    doc.fontSize(20).text(`Product Backlog Report`, { align: 'center' });
    doc.fontSize(14).text(`Project: ${projectRows[0].name}`, { align: 'center' });
    doc.text(`Package Tier: ${currentPackage}`, { align: 'center' });
    doc.moveDown(2);

    // --- LOGIKA BACKGROUND WATERMARK (FREE PACKAGE ONLY) ---
    if (currentPackage === 'FREE') {
      doc.save();
      doc.fillColor('gray', 0.15); // Transparansi opacity tipis
      doc.fontSize(45).text('Generated by ScrumApps', 70, 350, {
        align: 'center',
        width: 450,
        height: 200,
        ellipsis: false
      });
      doc.restore();
    }

    // --- CETAK DATA BACKLOG USER STORIES ---
    doc.fillColor('black').fontSize(12);
    if (backlogs.length === 0) {
      doc.text("Tidak ada data item product backlog dalam proyek ini.", { italic: true });
    } else {
      backlogs.forEach((item, index) => {
        doc.fontSize(12).text(`${index + 1}. [${item.priority.toUpperCase()}] ${item.name}`, { bold: true });
        doc.fontSize(10).text(`   Description : ${item.description || '-'}`);
        doc.text(`   Applicant   : ${item.applicant || '-'}`);
        doc.text(`   Status      : ${item.status}`);
        doc.moveDown(1);
      });
    }

    // Selesaikan pembuatan PDF
    doc.end();

  } catch (err) {
    console.error("EXPORT PDF ERROR:", err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: "Gagal memproses pembuatan cetak dokumen PDF." });
    }
  }
};