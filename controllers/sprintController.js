const db = require('../config/db');

// ============================================================
// HELPER: Validasi proyek milik tenant yang sedang login
// ============================================================
const validateProjectTenant = async (projectId, tenantId) => {
  const [rows] = await db.query(
    'SELECT id FROM tbr_projects WHERE id = ? AND tenant_id = ?',
    [projectId, tenantId]
  );
  return rows.length > 0;
};

// ============================================================
// HELPER: Validasi sprint milik proyek yang benar
// ============================================================
const validateSprintProject = async (sprintId, projectId, tenantId) => {
  const [rows] = await db.query(
    `SELECT s.id FROM tbr_sprints s
     INNER JOIN tbr_projects p ON s.project_id = p.id
     WHERE s.id = ? AND s.project_id = ? AND p.tenant_id = ?`,
    [sprintId, projectId, tenantId]
  );
  return rows.length > 0;
};

// ============================================================
// HELPER: Cek role akses tulis (hanya BA dan PO)
// ============================================================
const hasWriteAccess = (role) => {
  const r = String(role || '').toLowerCase().replace(/_/g, '');
  return r === 'businessanalyst' || r === 'projectowner' || r === 'productowner';
};

/**
 * 📋 1. GET ALL SPRINTS BY PROJECT
 * GET /projects/:projectId/sprints
 */
exports.getSprintsByProject = async (req, res) => {
  try {
    const { projectId } = req.params;
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

    const isValid = await validateProjectTenant(projectId, tenantId);
    if (!isValid) {
      return res.status(403).json({ message: 'Akses Ditolak: Proyek tidak ditemukan di workspace Anda.' });
    }

    const [sprints] = await db.query(
      `SELECT s.*,
        (SELECT COUNT(*) FROM tbr_backlogs b WHERE b.sprint_id = s.id) AS backlog_count
       FROM tbr_sprints s
       WHERE s.project_id = ?
       ORDER BY s.created_at DESC`,
      [projectId]
    );

    res.json({ success: true, data: sprints });
  } catch (err) {
    console.error('getSprintsByProject error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * 📋 2. GET SINGLE SPRINT DETAIL (beserta backlog yang terikat)
 * GET /projects/:projectId/sprints/:sprintId
 */
exports.getSprintDetail = async (req, res) => {
  try {
    const { projectId, sprintId } = req.params;
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

    const isValid = await validateSprintProject(sprintId, projectId, tenantId);
    if (!isValid) {
      return res.status(404).json({ message: 'Sprint tidak ditemukan.' });
    }

    const [[sprint]] = await db.query(
      'SELECT * FROM tbr_sprints WHERE id = ?',
      [sprintId]
    );

    const [backlogs] = await db.query(
      `SELECT b.*, u.name as creator_name
       FROM tbr_backlogs b
       LEFT JOIN tbr_users u ON b.user_id = u.id
       WHERE b.sprint_id = ?
       ORDER BY b.priority ASC, b.created_at ASC`,
      [sprintId]
    );

    res.json({ success: true, data: { ...sprint, backlogs } });
  } catch (err) {
    console.error('getSprintDetail error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * ✨ 3. CREATE SPRINT BARU
 * POST /projects/:projectId/sprints
 */
exports.createSprint = async (req, res) => {
  try {
    const { projectId } = req.params;
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
    const userRole = req.user.role;

    if (!hasWriteAccess(userRole)) {
      return res.status(403).json({ message: 'Akses Ditolak: Pembuatan Sprint hanya wewenang Business Analyst atau Project Owner.' });
    }

    const isValid = await validateProjectTenant(projectId, tenantId);
    if (!isValid) {
      return res.status(403).json({ message: 'Akses Ditolak: Proyek tidak ditemukan di workspace Anda.' });
    }

    const { name, description, start_date, end_date, status } = req.body;

    if (!name || !start_date || !end_date) {
      return res.status(400).json({ message: 'Validasi Gagal: name, start_date, dan end_date wajib diisi.' });
    }

    if (new Date(start_date) > new Date(end_date)) {
      return res.status(400).json({ message: 'Validasi Gagal: Tanggal selesai tidak boleh lebih awal dari tanggal mulai.' });
    }

    // Jika status 'active', pastikan tidak ada sprint lain yang aktif di proyek ini
    if (status === 'active') {
      const [activeSprints] = await db.query(
        "SELECT id FROM tbr_sprints WHERE project_id = ? AND status = 'active'",
        [projectId]
      );
      if (activeSprints.length > 0) {
        return res.status(409).json({ message: 'Konflik: Sudah ada sprint aktif di proyek ini. Selesaikan sprint yang berjalan terlebih dahulu.' });
      }
    }

    const [result] = await db.query(
      `INSERT INTO tbr_sprints 
       (name, description, start_date, end_date, status, project_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [name, description || null, start_date, end_date, status || 'planned', projectId]
    );

    res.status(201).json({
      success: true,
      message: 'Sprint baru berhasil dibuat.',
      id: result.insertId
    });
  } catch (err) {
    console.error('createSprint error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * 🔄 4. UPDATE SPRINT
 * PUT /projects/:projectId/sprints/:sprintId
 */
exports.updateSprint = async (req, res) => {
  try {
    const { projectId, sprintId } = req.params;
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
    const userRole = req.user.role;

    if (!hasWriteAccess(userRole)) {
      return res.status(403).json({ message: 'Akses Ditolak: Anda tidak memiliki hak memodifikasi sprint.' });
    }

    const isValid = await validateSprintProject(sprintId, projectId, tenantId);
    if (!isValid) {
      return res.status(404).json({ message: 'Sprint tidak ditemukan.' });
    }

    const { name, description, start_date, end_date, status, result_review, result_retrospective } = req.body;

    if (start_date && end_date && new Date(start_date) > new Date(end_date)) {
      return res.status(400).json({ message: 'Validasi Gagal: Tanggal selesai tidak boleh lebih awal dari tanggal mulai.' });
    }

    // Jika status diubah ke 'active', pastikan tidak ada sprint aktif lain
    if (status === 'active') {
      const [activeSprints] = await db.query(
        "SELECT id FROM tbr_sprints WHERE project_id = ? AND status = 'active' AND id != ?",
        [projectId, sprintId]
      );
      if (activeSprints.length > 0) {
        return res.status(409).json({ message: 'Konflik: Sudah ada sprint aktif di proyek ini.' });
      }
    }

    await db.query(
      `UPDATE tbr_sprints
       SET name = ?, description = ?, start_date = ?, end_date = ?, 
           status = ?, result_review = ?, result_retrospective = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        name, description || null, start_date, end_date,
        status || 'planned',
        status === 'completed' ? (result_review || null) : null,
        status === 'completed' ? (result_retrospective || null) : null,
        sprintId
      ]
    );

    res.json({ success: true, message: 'Sprint berhasil diperbarui.' });
  } catch (err) {
    console.error('updateSprint error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * 🗑️ 5. DELETE SPRINT
 * DELETE /projects/:projectId/sprints/:sprintId
 */
exports.deleteSprint = async (req, res) => {
  try {
    const { projectId, sprintId } = req.params;
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
    const userRole = req.user.role;

    if (!hasWriteAccess(userRole)) {
      return res.status(403).json({ message: 'Akses Ditolak.' });
    }

    const isValid = await validateSprintProject(sprintId, projectId, tenantId);
    if (!isValid) {
      return res.status(404).json({ message: 'Sprint tidak ditemukan.' });
    }

    // Lepas semua backlog dari sprint ini sebelum dihapus (set sprint_id = null)
    await db.query(
      'UPDATE tbr_backlogs SET sprint_id = NULL WHERE sprint_id = ?',
      [sprintId]
    );

    await db.query('DELETE FROM tbr_sprints WHERE id = ?', [sprintId]);

    res.json({ success: true, message: 'Sprint berhasil dihapus. Backlog terkait telah dilepas ke Product Backlog.' });
  } catch (err) {
    console.error('deleteSprint error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * ▶️ 6. START SPRINT (Ubah status planned → active)
 * PATCH /projects/:projectId/sprints/:sprintId/start
 */
exports.startSprint = async (req, res) => {
  try {
    const { projectId, sprintId } = req.params;
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
    const userRole = req.user.role;

    if (!hasWriteAccess(userRole)) {
      return res.status(403).json({ message: 'Akses Ditolak.' });
    }

    const isValid = await validateSprintProject(sprintId, projectId, tenantId);
    if (!isValid) {
      return res.status(404).json({ message: 'Sprint tidak ditemukan.' });
    }

    // Cek apakah sprint masih di status 'planned'
    const [[sprint]] = await db.query('SELECT status FROM tbr_sprints WHERE id = ?', [sprintId]);
    if (sprint.status !== 'planned') {
      return res.status(409).json({ message: `Gagal: Sprint tidak bisa dimulai karena statusnya sudah '${sprint.status}'.` });
    }

    // Cek apakah ada sprint lain yang sedang aktif
    const [activeSprints] = await db.query(
      "SELECT id FROM tbr_sprints WHERE project_id = ? AND status = 'active'",
      [projectId]
    );
    if (activeSprints.length > 0) {
      return res.status(409).json({ message: 'Konflik: Selesaikan sprint yang sedang aktif terlebih dahulu.' });
    }

    await db.query(
      "UPDATE tbr_sprints SET status = 'active', updated_at = NOW() WHERE id = ?",
      [sprintId]
    );

    res.json({ success: true, message: 'Sprint berhasil dimulai dan sekarang berstatus aktif.' });
  } catch (err) {
    console.error('startSprint error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * ⏹️ 7. END SPRINT (Ubah status active → completed)
 * PATCH /projects/:projectId/sprints/:sprintId/end
 */
exports.endSprint = async (req, res) => {
  try {
    const { projectId, sprintId } = req.params;
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
    const userRole = req.user.role;

    if (!hasWriteAccess(userRole)) {
      return res.status(403).json({ message: 'Akses Ditolak.' });
    }

    const isValid = await validateSprintProject(sprintId, projectId, tenantId);
    if (!isValid) {
      return res.status(404).json({ message: 'Sprint tidak ditemukan.' });
    }

    const [[sprint]] = await db.query('SELECT status FROM tbr_sprints WHERE id = ?', [sprintId]);
    if (sprint.status !== 'active') {
      return res.status(409).json({ message: 'Gagal: Hanya sprint yang sedang aktif yang bisa diselesaikan.' });
    }

    const { result_review, result_retrospective } = req.body;

    await db.query(
      `UPDATE tbr_sprints 
       SET status = 'completed', result_review = ?, result_retrospective = ?, updated_at = NOW()
       WHERE id = ?`,
      [result_review || null, result_retrospective || null, sprintId]
    );

    // Backlog yang belum selesai (status != 'done') dikembalikan ke product backlog
    const [unfinished] = await db.query(
      "SELECT id FROM tbr_backlogs WHERE sprint_id = ? AND status != 'done'",
      [sprintId]
    );

    if (unfinished.length > 0) {
      await db.query(
        "UPDATE tbr_backlogs SET sprint_id = NULL WHERE sprint_id = ? AND status != 'done'",
        [sprintId]
      );
    }

    res.json({
      success: true,
      message: 'Sprint berhasil diselesaikan.',
      unfinished_backlogs_returned: unfinished.length
    });
  } catch (err) {
    console.error('endSprint error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * 📌 8. ASSIGN BACKLOG KE SPRINT
 * POST /projects/:projectId/sprints/:sprintId/assign-backlog
 */
exports.assignBacklogToSprint = async (req, res) => {
  try {
    const { projectId, sprintId } = req.params;
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
    const userRole = req.user.role;
    const { backlog_ids } = req.body; // Array of backlog IDs

    if (!hasWriteAccess(userRole)) {
      return res.status(403).json({ message: 'Akses Ditolak.' });
    }

    if (!Array.isArray(backlog_ids) || backlog_ids.length === 0) {
      return res.status(400).json({ message: 'Validasi Gagal: backlog_ids harus berupa array dan tidak boleh kosong.' });
    }

    const isValid = await validateSprintProject(sprintId, projectId, tenantId);
    if (!isValid) {
      return res.status(404).json({ message: 'Sprint tidak ditemukan.' });
    }

    // Pastikan semua backlog_id milik proyek yang sama
    const placeholders = backlog_ids.map(() => '?').join(', ');
    const [validBacklogs] = await db.query(
      `SELECT id FROM tbr_backlogs WHERE id IN (${placeholders}) AND project_id = ?`,
      [...backlog_ids, projectId]
    );

    if (validBacklogs.length !== backlog_ids.length) {
      return res.status(400).json({ message: 'Validasi Gagal: Beberapa backlog tidak ditemukan atau bukan milik proyek ini.' });
    }

    await db.query(
      `UPDATE tbr_backlogs SET sprint_id = ?, updated_at = NOW() WHERE id IN (${placeholders})`,
      [sprintId, ...backlog_ids]
    );

    res.json({ success: true, message: `${validBacklogs.length} backlog berhasil ditambahkan ke sprint.` });
  } catch (err) {
    console.error('assignBacklogToSprint error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * 📤 9. REMOVE BACKLOG DARI SPRINT (kembalikan ke product backlog)
 * PATCH /projects/:projectId/sprints/:sprintId/remove-backlog/:backlogId
 */
exports.removeBacklogFromSprint = async (req, res) => {
  try {
    const { projectId, sprintId, backlogId } = req.params;
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
    const userRole = req.user.role;

    if (!hasWriteAccess(userRole)) {
      return res.status(403).json({ message: 'Akses Ditolak.' });
    }

    const isValid = await validateSprintProject(sprintId, projectId, tenantId);
    if (!isValid) {
      return res.status(404).json({ message: 'Sprint tidak ditemukan.' });
    }

    const [backlogCheck] = await db.query(
      'SELECT id FROM tbr_backlogs WHERE id = ? AND sprint_id = ? AND project_id = ?',
      [backlogId, sprintId, projectId]
    );
    if (backlogCheck.length === 0) {
      return res.status(404).json({ message: 'Backlog tidak ditemukan di sprint ini.' });
    }

    await db.query(
      'UPDATE tbr_backlogs SET sprint_id = NULL, updated_at = NOW() WHERE id = ?',
      [backlogId]
    );

    res.json({ success: true, message: 'Backlog berhasil dilepas dari sprint dan dikembalikan ke Product Backlog.' });
  } catch (err) {
    console.error('removeBacklogFromSprint error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * 📊 10. GET SPRINT STATS (untuk dashboard BA)
 * GET /projects/workspace/scrum/stats
 */
exports.getScrumStats = async (req, res) => {
  try {
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

    // Ambil semua project_id milik tenant ini
    const [projects] = await db.query(
      'SELECT id FROM tbr_projects WHERE tenant_id = ?',
      [tenantId]
    );

    if (projects.length === 0) {
      return res.json({
        success: true,
        data: { total_backlogs: 0, hold: 0, progress: 0, done: 0, late: 0, current_sprint: null }
      });
    }

    const projectIds = projects.map(p => p.id);
    const placeholders = projectIds.map(() => '?').join(', ');

    // Hitung statistik backlog per status
    const [stats] = await db.query(
      `SELECT 
        COUNT(*) AS total_backlogs,
        SUM(CASE WHEN status IN ('inactive', 'planned', 'hold') THEN 1 ELSE 0 END) AS hold,
        SUM(CASE WHEN status IN ('active', 'in_progress', 'progress') THEN 1 ELSE 0 END) AS progress,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN status != 'done' AND sprint_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM tbr_sprints s WHERE s.id = tbr_backlogs.sprint_id AND s.end_date < CURDATE() AND s.status = 'active'
        ) THEN 1 ELSE 0 END) AS late
       FROM tbr_backlogs
       WHERE project_id IN (${placeholders})`,
      projectIds
    );

    // Ambil sprint yang sedang aktif
    const [activeSprint] = await db.query(
      `SELECT s.id, s.name, s.end_date, s.project_id
       FROM tbr_sprints s
       WHERE s.project_id IN (${placeholders}) AND s.status = 'active'
       ORDER BY s.updated_at DESC
       LIMIT 1`,
      projectIds
    );

    res.json({
      success: true,
      data: {
        total_backlogs: stats[0]?.total_backlogs || 0,
        hold: stats[0]?.hold || 0,
        progress: stats[0]?.progress || 0,
        done: stats[0]?.done || 0,
        late: stats[0]?.late || 0,
        current_sprint: activeSprint[0] || null
      }
    });
  } catch (err) {
    console.error('getScrumStats error:', err.message);
    res.status(500).json({ error: err.message });
  }
};
