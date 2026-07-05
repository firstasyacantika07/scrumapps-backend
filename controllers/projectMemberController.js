const db = require('../config/db');

/* ======================================================
   GET MEMBERS BY PROJECT
====================================================== */
exports.getMembers = async (req, res) => {
  try {

    // 🛠️ FIX: sebelumnya hanya membaca req.params.projectId. Jika route
    // didefinisikan dengan nama param ":id" (bukan ":projectId"), maka
    // projectId akan undefined, query gagal, dan frontend menampilkan
    // list kosong tanpa pesan error yang jelas. Sekarang menerima kedua
    // kemungkinan nama param.
    const projectId = req.params.projectId || req.params.id;

    if (!projectId) {
      return res.status(400).json({
        message: 'Project ID tidak ditemukan pada request (periksa definisi route, gunakan :projectId atau :id).'
      });
    }

    const [rows] = await db.query(`
      SELECT 
        pm.id,
        pm.project_id,
        pm.user_id,
        pm.role,

        u.name,
        u.email,
        u.phone_number

      FROM tbr_project_members pm

      JOIN tbr_users u
        ON u.id = pm.user_id

      WHERE pm.project_id = ?

      ORDER BY pm.created_at DESC
    `, [projectId]);

    res.json(rows);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      message: 'Failed get members'
    });

  }
};

/* ======================================================
   CREATE MEMBER
====================================================== */
exports.createMember = async (req, res) => {

  try {

    // 🛠️ FIX: sama seperti getMembers, jaga-jaga nama param route berbeda
    const projectId = req.params.projectId || req.params.id;

    const {
      user_id,
      role
    } = req.body;

    if (!projectId) {
      return res.status(400).json({
        message: 'Project ID tidak ditemukan pada request (periksa definisi route, gunakan :projectId atau :id).'
      });
    }

    if (!user_id || !role) {
      return res.status(400).json({
        message: 'user_id dan role wajib diisi'
      });
    }

    // CHECK DUPLICATE
    const [check] = await db.query(`
      SELECT * FROM tbr_project_members
      WHERE project_id = ?
      AND user_id = ?
    `, [projectId, user_id]);

    if (check.length > 0) {

      return res.status(400).json({
        message: 'User already in project'
      });

    }

    const [result] = await db.query(`
      INSERT INTO tbr_project_members (
        project_id,
        user_id,
        role
      )
      VALUES (?, ?, ?)
    `, [
      projectId,
      user_id,
      role
    ]);

    res.status(201).json({
      message: 'Member added',
      id: result.insertId
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      message: 'Failed create member'
    });

  }
};

/* ======================================================
   UPDATE MEMBER
====================================================== */
exports.updateMember = async (req, res) => {

  try {

    const { id } = req.params;

    const {
      role
    } = req.body;

    await db.query(`
      UPDATE tbr_project_members
      SET role = ?
      WHERE id = ?
    `, [
      role,
      id
    ]);

    res.json({
      message: 'Member updated'
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      message: 'Failed update member'
    });

  }
};

/* ======================================================
   DELETE MEMBER
====================================================== */
exports.deleteMember = async (req, res) => {

  try {

    const { id } = req.params;

    // CHECK MEMBER
    const [member] = await db.query(`
      SELECT * FROM tbr_project_members
      WHERE id = ?
    `, [id]);

    if (member.length === 0) {

      return res.status(404).json({
        message: 'Member not found'
      });

    }

    // PROTECT SUPERADMIN
    if (member[0].role === 'superadmin') {

      return res.status(400).json({
        message: 'Superadmin cannot delete'
      });

    }

    await db.query(`
      DELETE FROM tbr_project_members
      WHERE id = ?
    `, [id]);

    res.json({
      message: 'Member deleted'
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      message: 'Failed delete member'
    });

  }
};