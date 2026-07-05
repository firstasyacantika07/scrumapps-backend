const db = require('../config/db');
const notificationService = require('../services/notificationService');

/**
 * =========================================================================
 * GLOBAL HELPER: CREATING AUDIT LOGS AUTOMATICALLY
 * =========================================================================
 */
const createLog = async (userId, projectId, activityDescription) => {
    try {
        const sql = `
            INSERT INTO tbr_activity_logs (user_id, project_id, activity, created_at) 
            VALUES (?, ?, ?, NOW())
        `;
        await db.query(sql, [userId, projectId, activityDescription]);
    } catch (err) {
        console.error("[AUDIT LOG ERROR]:", err.message);
    }
};

/**
 * =========================================================================
 * HELPER: Kirim notifikasi status project ke seluruh member project
 * =========================================================================
 */
const notifyProjectMembers = async (projectId, projectName, status) => {
    try {
        if (!["late", "done"].includes(String(status).toLowerCase())) {
            return;
        }

        const [members] = await db.query(`
            SELECT u.id, u.name, u.email 
            FROM tbr_project_members pm
            INNER JOIN tbr_users u ON pm.user_id = u.id
            WHERE pm.project_id = ?
        `, [projectId]);

        for (const member of members) {
            // 🔧 FIX: Sebelumnya tidak ada pengecekan email kosong/null, dan tidak ada
            // try/catch per-member. Akibatnya kalau salah satu member gagal terkirim
            // (mis. email null di tbr_users), exception melompat keluar dari loop dan
            // seluruh member SISANYA (apapun role-nya) ikut tidak dapat notifikasi.
            // Sekarang: skip member tanpa email, dan bungkus pengiriman tiap member
            // dalam try/catch sendiri supaya kegagalan satu member tidak menghentikan
            // pengiriman ke member lain.
            if (!member.email) {
                console.warn(`[NOTIF SKIP] project #${projectId}: user ${member.id} (${member.name || 'no name'}) tidak memiliki email, dilewati.`);
                continue;
            }

            try {
                await notificationService.sendProjectStatusNotification({
                    projectId,
                    userId: member.id,
                    email: member.email,
                    userName: member.name,
                    projectName,
                    status: String(status).toLowerCase()
                });
            } catch (notifErr) {
                console.error(`[NOTIF FAIL] project #${projectId}, user ${member.id} (${member.email}):`, notifErr.message);
                // Lanjut ke member berikutnya, jangan menghentikan seluruh loop.
            }
        }
    } catch (err) {
        console.error("[PROJECT NOTIFICATION ERROR]", err.message);
    }
};

/**
 * =========================================================================
 * 1. PROJECT CORE (CRUD & STATS - MULTI TENANT & ROLE ALIGNED)
 * =========================================================================
 */

exports.createProject = async (req, res) => {
    const userId = req.user.id;
    const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
    const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

    if (!tenantId || tenantId == 0) {
        return res.status(400).json({ success: false, message: "Bad Request: Organisasi / Tenant ID tidak teridentifikasi." });
    }

    if (userRole === 'superadmin' || userRole === 'businessanalyst' || userRole === 'teamdeveloper') {
        return res.status(403).json({ success: false, message: "Akses Ditolak: Peran Anda tidak memiliki hak akses untuk membuat proyek baru." });
    }

    try {
        // ✨ MULAI TRANSAKSI DB: Menjamin proyek & member terbuat secara bersamaan
        await db.query("START TRANSACTION");

        const sql = `
            INSERT INTO tbr_projects 
            (name, start_date, end_date, status, icon, label, user_id, tenant_id, repo_url, \`read\`, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;
        const values = [
            req.body.name,
            req.body.start_date || null,
            req.body.end_date || null,
            req.body.status || 'hold',
            req.body.icon || 'ki-duotone ki-star',
            req.body.label || 'external',
            userId,
            tenantId,
            req.body.repo_url || null,
            0
        ];

        const [result] = await db.query(sql, values);
        const newProjectId = result.insertId;

        const requestedOwnerId = req.body.owner_id ? Number(req.body.owner_id) : null;
        let ownerId = userId;

        if (requestedOwnerId) {
            // ✅ FIX MULTI-TENANT: Validasi kandidat PO menggunakan tabel pivot tbr_tenant_users tu
            const [candidateOwnerRows] = await db.query(
                `SELECT u.id, u.name, u.email 
                 FROM tbr_tenant_users tu
                 JOIN tbr_users u ON tu.user_id = u.id
                 WHERE u.id = ? AND tu.tenant_id = ?`,
                [requestedOwnerId, tenantId]
            );

            if (candidateOwnerRows.length === 0) {
                await db.query("ROLLBACK");
                return res.status(400).json({
                    success: false,
                    message: "Bad Request: User yang dipilih sebagai Product Owner tidak ditemukan di dalam workspace ini."
                });
            }

            ownerId = candidateOwnerRows[0].id;
        }

        // Daftarkan Product Owner ke tabel project members
        await db.query(
            `INSERT INTO tbr_project_members (project_id, user_id, role_in_project, created_at) VALUES (?, ?, ?, NOW())`,
            [newProjectId, ownerId, 'ProjectOwner']
        );

        // Catat Log Aktivitas
        await createLog(userId, newProjectId, `Membuat proyek baru: "${req.body.name}"`);

        // Komit transaksi database jika semua penulisan sukses
        await db.query("COMMIT");

        // ✉️ PROSES NOTIFIKASI (Diluar transaksi utama agar tidak memblokir DB jika service email delay)
        try {
            const [[ownerInfo]] = await db.query(`SELECT name, email FROM tbr_users WHERE id = ?`, [ownerId]);
            if (ownerInfo?.email) {
                await notificationService.sendProjectAssignmentNotification({
                    userId: ownerId,
                    email: ownerInfo.email,
                    userName: ownerInfo.name,
                    projectName: req.body.name,
                    projectId: newProjectId,
                });
            }
        } catch (notifErr) {
            console.error("⚠️ Gagal mengirimkan notifikasi pembuatan proyek:", notifErr.message);
            // Proyek tetap sukses dibuat meskipun email gagal terkirim
        }

        return res.status(201).json({
            success: true,
            message: "Proyek berhasil dibuat",
            id: newProjectId,
            owner_id: ownerId
        });

    } catch (err) {
        await db.query("ROLLBACK");
        console.error("❌ CREATE PROJECT ERROR:", err);
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.getProjects = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        let sql;
        let params;

        if (userRole === 'superadmin' || userRole === 'admin') {
            // Superadmin: lihat semua project di tenant manapun.
            // Admin: lihat semua project di tenant/workspace-nya sendiri (bukan hanya yang dia buat/jadi member).
            sql = `
                SELECT p.*, tnt.package_type as package_type 
                FROM tbr_projects p 
                INNER JOIN tbr_tenants tnt ON p.tenant_id = tnt.id
                WHERE p.tenant_id = ?
                ORDER BY p.created_at DESC
            `;
            params = [tenantId];
        } else {
            sql = `
                SELECT p.*, tnt.package_type as package_type 
                FROM tbr_projects p 
                INNER JOIN tbr_tenants tnt ON p.tenant_id = tnt.id
                LEFT JOIN tbr_project_members pm ON p.id = pm.project_id 
                WHERE p.tenant_id = ? AND (p.user_id = ? OR pm.user_id = ?) 
                GROUP BY p.id 
                ORDER BY p.created_at DESC
            `;
            params = [tenantId, userId, userId];
        }

        const [rows] = await db.query(sql, params);
        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.getProjectById = async (req, res) => {
    try {
        const projectId = req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        let sql;
        let params;

        if (userRole === 'superadmin' || userRole === 'admin') {
            sql = `
                SELECT p.*, tnt.package_type as package_type 
                FROM tbr_projects p 
                INNER JOIN tbr_tenants tnt ON p.tenant_id = tnt.id
                WHERE p.id = ? AND p.tenant_id = ?
            `;
            params = [projectId, tenantId];
        } else {
            sql = `
                SELECT p.*, tnt.package_type as package_type 
                FROM tbr_projects p 
                INNER JOIN tbr_tenants tnt ON p.tenant_id = tnt.id
                LEFT JOIN tbr_project_members pm ON p.id = pm.project_id 
                WHERE p.id = ? AND p.tenant_id = ? AND (p.user_id = ? OR pm.user_id = ?) 
                GROUP BY p.id
            `;
            params = [projectId, tenantId, userId, userId];
        }

        const [rows] = await db.query(sql, params);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Project tidak ditemukan atau akses dilarang." });
        }

        if (userRole !== 'superadmin') {
            await db.query(`UPDATE tbr_projects SET \`read\` = 1 WHERE id = ?`, [projectId]);
        }

        return res.json(rows[0]);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.updateProject = async (req, res) => {
    try {
        const projectId = req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
        const { name, start_date, end_date, status, repo_url } = req.body;

        if (userRole === 'superadmin') {
            return res.status(403).json({ success: false, message: "Akses Ditolak: Superadmin hanya diizinkan memantau data secara Read-Only." });
        }

        // 🔧 FIX (notifikasi status duplikat): ambil status LAMA sebelum di-update,
        // supaya bisa dibandingkan dengan status baru. Sebelumnya notifyProjectMembers()
        // selalu dipanggil di setiap updateProject, jadi kalau user cuma edit nama/
        // tanggal/repo_url pada proyek yang statusnya sudah "done"/"late", notifikasi
        // "Status proyek: SELESAI/TERLAMBAT" ikut terkirim ulang setiap kali -- padahal
        // statusnya tidak berubah sama sekali.
        const [projectCheck] = await db.query(`SELECT id, status FROM tbr_projects WHERE id = ? AND tenant_id = ?`, [projectId, tenantId]);
        if (projectCheck.length === 0) {
            return res.status(403).json({ success: false, message: "Akses Ditolak: Data tidak valid." });
        }
        const previousStatus = projectCheck[0].status;

        const sql = `
            UPDATE tbr_projects 
            SET name=?, start_date=?, end_date=?, status=?, repo_url=?, updated_at=NOW() 
            WHERE id=? AND tenant_id=?
        `;
        await db.query(sql, [name, start_date, end_date, status, repo_url || null, projectId, tenantId]);

        // Kirim notifikasi HANYA kalau status benar-benar berubah dari sebelumnya.
        const statusChanged = String(previousStatus).toLowerCase() !== String(status).toLowerCase();
        if (statusChanged) {
            await notifyProjectMembers(projectId, name, status);
        }
        await createLog(userId, projectId, `Memperbarui detail proyek. Status: ${status}, Repo: ${repo_url ? 'Diubah' : 'Belum Ditentukan'}`);

        return res.json({ success: true, message: "Proyek berhasil diperbarui" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.deleteProject = async (req, res) => {
    try {
        const projectId = req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        if (userRole !== 'admin') {
            return res.status(403).json({ success: false, message: "Hanya Admin Workspace (Pemilik Organisasi) yang dapat menghapus proyek ini secara permanen." });
        }

        const [projectInfo] = await db.query(`SELECT name FROM tbr_projects WHERE id = ? AND tenant_id = ?`, [projectId, tenantId]);
        if (projectInfo.length === 0) {
            return res.status(404).json({ success: false, message: "Proyek tidak ditemukan." });
        }

        // 🔧 FIX: Query notifikasi DIPISAH dalam try/catch sendiri.
        // Sebelumnya query ini satu try/catch besar dengan proses hapus project --
        // kalau query ini gagal (mis. kolom salah/tabel beda), seluruh permintaan
        // hapus project ikut gagal (500) padahal harusnya notifikasi gagal TIDAK
        // boleh menghalangi project tetap terhapus.
        //
        // 🔧 FIX: Matching role_in_project dibuat case-insensitive & trim
        // (LOWER(TRIM(...))) -- kalau di database tersimpan varian seperti
        // "projectowner", "Project Owner", atau ada spasi tak sengaja, query lama
        // akan gagal MENEMUKAN owner yang seharusnya, sehingga owner asli tidak
        // dapat notifikasi.
        let owners = [];
        try {
            [owners] = await db.query(`
                SELECT u.id, u.name, u.email 
                FROM tbr_project_members pm
                INNER JOIN tbr_users u ON pm.user_id = u.id
                WHERE pm.project_id = ? AND LOWER(TRIM(pm.role_in_project)) = 'projectowner'
            `, [projectId]);

            // 🔧 FIX: log eksplisit siapa yang terdeteksi sebagai ProjectOwner untuk
            // project ini, supaya kalau ada laporan "email salah kirim ke X" bisa
            // langsung dicek dari log apakah X memang tercatat sebagai ProjectOwner
            // di tbr_project_members, atau ada bug lain.
            console.log(`[DELETE PROJECT] Project #${projectId} ("${projectInfo[0].name}") -> ProjectOwner terdeteksi:`,
                owners.map(o => `${o.name} <${o.email}>`));
        } catch (notifQueryErr) {
            console.error(`[DELETE PROJECT] Gagal mengambil daftar ProjectOwner untuk notifikasi (project #${projectId}):`, notifQueryErr.message);
            // owners tetap [] -- proses hapus project TETAP lanjut di bawah.
        }

        for (const owner of owners) {
            if (owner.email) {
                await notificationService.sendProjectRemovalNotification({
                    userId: owner.id,
                    email: owner.email,
                    userName: owner.name,
                    projectName: projectInfo[0].name,
                });
            }
        }

        // Hapus data secara permanen
        await db.query(`DELETE FROM tbr_projects WHERE id=? AND tenant_id=?`, [projectId, tenantId]);
        await createLog(userId, projectId, `Menghapus proyek "${projectInfo[0].name}" secara permanen`);

        return res.json({ success: true, message: "Proyek berhasil dihapus secara permanen" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * =========================================================================
 * 2. DEVELOPMENT / TASK MANAGEMENT (KANBAN BOARD RUNTIME)
 * =========================================================================
 */

exports.getProjectDevelopments = async (req, res) => {
    try {
        const projectId = req.params.projectId || req.params.id;
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        const [rows] = await db.query(`
            SELECT d.* FROM tbr_developments d 
            INNER JOIN tbr_projects p ON d.project_id = p.id 
            WHERE d.project_id = ? AND p.tenant_id = ? 
            ORDER BY d.created_at DESC
        `, [projectId, tenantId]);

        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.createDevelopment = async (req, res) => {
    try {
        const projectId = req.params.projectId || req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
        const { title, description, status, link } = req.body;

        if (userRole === 'superadmin') {
            return res.status(403).json({ success: false, message: "Akses Ditolak: Mode Read-Only untuk Superadmin." });
        }

        const [projectCheck] = await db.query(`SELECT id FROM tbr_projects WHERE id = ? AND tenant_id = ?`, [projectId, tenantId]);
        if (projectCheck.length === 0) {
            return res.status(403).json({ success: false, message: "Modifikasi ilegal di luar tenant dilarang." });
        }

        const sql = `
            INSERT INTO tbr_developments (name, \`desc\`, status, link, project_id, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, NOW(), NOW())
        `;
        await db.query(sql, [title, description, status || 'todo', link || null, projectId]);

        await createLog(userId, projectId, `Menambahkan tugas pembangunan (Kanban Card) baru: "${title}"`);
        return res.status(201).json({ success: true, message: "Tugas Kanban berhasil ditambahkan" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.updateDevelopmentStatus = async (req, res) => {
    try {
        const devId = req.params.devId;
        const { status } = req.body;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        if (userRole === 'superadmin') {
            return res.status(403).json({ success: false, message: "Akses Ditolak: Mode Read-Only untuk Superadmin." });
        }

        const [devInfo] = await db.query(`
            SELECT d.name, d.project_id FROM tbr_developments d
            INNER JOIN tbr_projects p ON d.project_id = p.id 
            WHERE d.id = ? AND p.tenant_id = ?
        `, [devId, tenantId]);

        if (devInfo.length === 0) {
            return res.status(403).json({ success: false, message: "Data tidak ditemukan atau berada di luar lingkup organisasi Anda." });
        }

        await db.query(`UPDATE tbr_developments SET status = ?, updated_at = NOW() WHERE id = ?`, [status, devId]);
        await createLog(userId, devInfo[0].project_id, `Mengubah status tugas "${devInfo[0].name}" menjadi "${String(status).toUpperCase()}"`);

        return res.json({ success: true, message: "Status tugas berhasil disinkronkan" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.deleteDevelopment = async (req, res) => {
    try {
        const devId = req.params.devId;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        if (userRole === 'superadmin') {
            return res.status(403).json({ success: false, message: "Akses Ditolak: Mode Read-Only." });
        }

        const [devInfo] = await db.query(`
            SELECT d.name, d.project_id FROM tbr_developments d
            INNER JOIN tbr_projects p ON d.project_id = p.id 
            WHERE d.id = ? AND p.tenant_id = ?
        `, [devId, tenantId]);

        if (devInfo.length === 0) {
            return res.status(403).json({ success: false, message: "Data tidak ditemukan." });
        }

        await db.query(`DELETE FROM tbr_developments WHERE id = ?`, [devId]);
        await createLog(userId, devInfo[0].project_id, `Menghapus tugas pembangunan: "${devInfo[0].name}"`);

        return res.json({ success: true, message: "Tugas berhasil dihapus" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * =========================================================================
 * 3. SPRINT MANAGEMENT
 * =========================================================================
 */

exports.getProjectSprints = async (req, res) => {
    try {
        const projectId = req.params.projectId || req.params.id;
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        const [rows] = await db.query(`
            SELECT s.* FROM tbr_sprints s 
            INNER JOIN tbr_projects p ON s.project_id = p.id 
            WHERE s.project_id = ? AND p.tenant_id = ? 
            ORDER BY s.start_date DESC
        `, [projectId, tenantId]);

        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.createSprint = async (req, res) => {
    try {
        const projectId = req.params.projectId || req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
        const { name, description, start_date, end_date, status } = req.body;

        if (userRole === 'superadmin' || userRole === 'teamdeveloper') {
            return res.status(403).json({ success: false, message: "Akses Ditolak: Penentuan Sprint dilakukan manual oleh PO atau BA." });
        }

        const [projectCheck] = await db.query(`SELECT id FROM tbr_projects WHERE id = ? AND tenant_id = ?`, [projectId, tenantId]);
        if (projectCheck.length === 0) {
            return res.status(403).json({ success: false, message: "Akses Terlarang." });
        }

        await db.query(`
            INSERT INTO tbr_sprints (project_id, name, description, start_date, end_date, status, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
        `, [projectId, name, description, start_date, end_date, status || 'planned']);

        await createLog(userId, projectId, `Membuat Sprint baru secara manual: "${name}"`);
        return res.status(201).json({ success: true, message: "Sprint manual berhasil dijadwalkan" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.updateSprint = async (req, res) => {
    try {
        const sprintId = req.params.id;
        const projectId = req.params.projectId;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
        const { name, description, start_date, end_date, status } = req.body;

        if (userRole === 'superadmin' || userRole === 'teamdeveloper') {
            return res.status(403).json({ success: false, message: "Akses Ditolak: Manajemen sprint hanya untuk PO dan BA." });
        }

        const [sprintCheck] = await db.query(`
            SELECT s.project_id FROM tbr_sprints s 
            INNER JOIN tbr_projects p ON s.project_id = p.id 
            WHERE s.id = ? AND p.tenant_id = ?
        `, [sprintId, tenantId]);

        if (sprintCheck.length === 0) {
            return res.status(403).json({ success: false, message: "Sprint tidak valid atau berada di luar lingkup organisasi Anda." });
        }

        const sql = `
            UPDATE tbr_sprints 
            SET name = ?, description = ?, start_date = ?, end_date = ?, status = ?, updated_at = NOW() 
            WHERE id = ?
        `;
        await db.query(sql, [name, description || null, start_date, end_date, status || 'planned', sprintId]);

        const targetProject = projectId || sprintCheck[0].project_id;
        await createLog(userId, targetProject, `Memperbarui detail siklus pengerjaan Sprint manual: "${name}"`);

        return res.json({ success: true, message: "Sprint berhasil diperbarui" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.deleteSprint = async (req, res) => {
    try {
        const sprintId = req.params.sprintId || req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        if (userRole === 'superadmin') {
            return res.status(403).json({ success: false, message: "Akses Ditolak." });
        }

        const [sprintInfo] = await db.query(`
            SELECT s.name, s.project_id FROM tbr_sprints s
            INNER JOIN tbr_projects p ON s.project_id = p.id 
            WHERE s.id = ? AND p.tenant_id = ?
        `, [sprintId, tenantId]);

        if (sprintInfo.length === 0) {
            return res.status(404).json({ success: false, message: "Sprint tidak ditemukan." });
        }

        await db.query(`DELETE FROM tbr_sprints WHERE id = ?`, [sprintId]);
        await createLog(userId, sprintInfo[0].project_id, `Menghapus dokumen Sprint "${sprintInfo[0].name}"`);

        return res.json({ success: true, message: "Sprint berhasil dihapus" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * =========================================================================
 * 4. BACKLOG MANAGEMENT (MANUAL USER STORIES)
 * =========================================================================
 */

exports.getProjectBacklogs = async (req, res) => {
    try {
        const projectId = req.params.projectId || req.params.id;
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        const [rows] = await db.query(`
            SELECT b.* FROM tbr_backlogs b 
            INNER JOIN tbr_projects p ON b.project_id = p.id 
            WHERE b.project_id = ? AND p.tenant_id = ? 
            ORDER BY b.created_at DESC
        `, [projectId, tenantId]);

        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.createBacklog = async (req, res) => {
    try {
        const projectId = req.params.projectId || req.params.id || req.body.project_id;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
        const { name, description, priority, applicant, status, sprint_id } = req.body;

        if (userRole === 'superadmin' || userRole === 'teamdeveloper') {
            return res.status(403).json({ success: false, message: "Akses Ditolak: Penulisan User Story dijabarkan manual oleh BA atau PO." });
        }

        const [projectCheck] = await db.query(`SELECT id FROM tbr_projects WHERE id = ? AND tenant_id = ?`, [projectId, tenantId]);
        if (projectCheck.length === 0) {
            return res.status(403).json({ success: false, message: "Proyek tidak valid dalam lingkup organisasi Anda." });
        }

        const sql = `
            INSERT INTO tbr_backlogs (name, description, priority, applicant, status, sprint_id, project_id, user_id, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;
        await db.query(sql, [name, description || null, priority || 'low', applicant || null, status || 'inactive', sprint_id || null, projectId, userId]);

        await createLog(userId, projectId, `Menambahkan item Product Backlog manual: "${name}"`);
        return res.status(201).json({ success: true, message: "User story backlog berhasil dibuat" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.updateBacklog = async (req, res) => {
    try {
        const backlogId = req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
        const { name, description, priority, applicant, status, sprint_id } = req.body;

        if (userRole === 'superadmin') return res.status(403).json({ success: false, message: "Mode Read-Only." });

        const [backlogInfo] = await db.query(`
            SELECT b.project_id FROM tbr_backlogs b 
            INNER JOIN tbr_projects p ON b.project_id = p.id 
            WHERE b.id = ? AND p.tenant_id = ?
        `, [backlogId, tenantId]);

        if (backlogInfo.length === 0) return res.status(403).json({ success: false, message: "Akses Ilegal." });

        await db.query(`
            UPDATE tbr_backlogs 
            SET name=?, description=?, priority=?, applicant=?, status=?, sprint_id=?, updated_at=NOW() 
            WHERE id=?
        `, [name, description || null, priority || 'low', applicant || null, status || 'inactive', sprint_id || null, backlogId]);

        await createLog(userId, backlogInfo[0].project_id, `Memperbarui detail User Story Backlog: "${name}"`);
        return res.json({ success: true, message: "Backlog updated" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.deleteBacklog = async (req, res) => {
    try {
        const backlogId = req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        if (userRole === 'superadmin') return res.status(403).json({ success: false, message: "Mode Read-Only." });

        const [backlogInfo] = await db.query(`
            SELECT b.name, b.project_id FROM tbr_backlogs b 
            INNER JOIN tbr_projects p ON b.project_id = p.id 
            WHERE b.id = ? AND p.tenant_id = ?
        `, [backlogId, tenantId]);

        if (backlogInfo.length === 0) return res.status(404).json({ success: false, message: "Backlog tidak ditemukan." });

        await db.query(`DELETE FROM tbr_backlogs WHERE id = ?`, [backlogId]);
        await createLog(userId, backlogInfo[0].project_id, `Menghapus item Product Backlog: "${backlogInfo[0].name}"`);

        return res.json({ success: true, message: "Backlog berhasil dihapus" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * =========================================================================
 * 5. VISION BOARD MANAGEMENT (INISIASI PROYEK MANUAL PO)
 * =========================================================================
 */

exports.getProjectVisions = async (req, res) => {
    try {
        const projectId = req.params.projectId || req.params.id;
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        const [rows] = await db.query(`
            SELECT v.* FROM tbr_vision_boards v 
            INNER JOIN tbr_projects p ON v.project_id = p.id 
            WHERE v.project_id = ? AND p.tenant_id = ? 
            ORDER BY v.created_at DESC
        `, [projectId, tenantId]);

        return res.json(rows);
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.createVision = async (req, res) => {
    try {
        const projectId = req.params.projectId || req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
        const { name, vision, target_group, needs, products, business_goals, competitors } = req.body;

        if (!['projectowner', 'admin', 'businessanalyst'].includes(userRole)) {
            return res.status(403).json({ success: false, message: "Akses Ditolak: Penyusunan visi awal proyek adalah tanggung jawab Project Owner atau Business Analyst." });
        }

        const [projectCheck] = await db.query(`SELECT id FROM tbr_projects WHERE id = ? AND tenant_id = ?`, [projectId, tenantId]);
        if (projectCheck.length === 0) return res.status(403).json({ success: false, message: "Proyek tidak valid." });

        const sql = `
            INSERT INTO tbr_vision_boards (name, vision, target_group, needs, products, business_goals, competitors, project_id, created_at, updated_at) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;
        await db.query(sql, [name, vision, target_group, needs, products, business_goals, competitors, projectId]);

        await createLog(userId, projectId, `Menyusun Vision Board manual baru: "${name}"`);
        return res.status(201).json({ success: true, message: "Vision Board berhasil disimpan" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.updateVision = async (req, res) => {
    try {
        const visionId = req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];
        const { name, vision, target_group, needs, products, business_goals, competitors } = req.body;

        if (userRole === 'superadmin') return res.status(403).json({ success: false, message: "Mode Read-Only." });

        const [visionInfo] = await db.query(`
            SELECT v.project_id FROM tbr_vision_boards v 
            INNER JOIN tbr_projects p ON v.project_id = p.id 
            WHERE v.id = ? AND p.tenant_id = ?
        `, [visionId, tenantId]);

        if (visionInfo.length === 0) return res.status(403).json({ success: false, message: "Akses Ditolak." });

        const sql = `
            UPDATE tbr_vision_boards 
            SET name=?, vision=?, target_group=?, needs=?, products=?, business_goals=?, competitors=?, updated_at=NOW() 
            WHERE id=?
        `;
        await db.query(sql, [name, vision, target_group, needs, products, business_goals, competitors, visionId]);

        await createLog(userId, visionInfo[0].project_id, `Mengubah komponen data pada Vision Board: "${name}"`);
        return res.json({ success: true, message: "Vision Board berhasil diperbarui" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

exports.deleteVision = async (req, res) => {
    try {
        const visionId = req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role ? String(req.user.role).toLowerCase() : '';
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        if (userRole === 'superadmin') return res.status(403).json({ success: false, message: "Mode Read-Only." });

        const [visionInfo] = await db.query(`
            SELECT v.name, v.project_id FROM tbr_vision_boards v 
            INNER JOIN tbr_projects p ON v.project_id = p.id 
            WHERE v.id = ? AND p.tenant_id = ?
        `, [visionId, tenantId]);

        if (visionInfo.length === 0) return res.status(404).json({ success: false, message: "Vision Board tidak ditemukan." });

        await db.query(`DELETE FROM tbr_vision_boards WHERE id = ?`, [visionId]);
        await createLog(userId, visionInfo[0].project_id, `Menghapus komponen Vision Board: "${visionInfo[0].name}"`);

        return res.json({ success: true, message: "Vision Board deleted" });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * =========================================================================
 * 6. ACTIVITY LOGS (AUDIT MONITORING)
 * =========================================================================
 */
exports.getProjectLogs = async (req, res) => {
    try {
        const projectId = req.params.id || req.params.projectId;
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        const sql = `
            SELECT al.id, al.activity, al.created_at, u.name as user_name 
            FROM tbr_activity_logs al
            LEFT JOIN tbr_users u ON al.user_id = u.id
            INNER JOIN tbr_projects p ON al.project_id = p.id
            WHERE al.project_id = ? AND p.tenant_id = ?
            ORDER BY al.created_at DESC
        `;

        const [rows] = await db.query(sql, [projectId, tenantId]);
        return res.json(rows);
    } catch (err) {
        console.error("DATABASE ERROR:", err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
};
/**
 * =========================================================================
 * 7. PROJECT STATISTICS (MONITORING ACUAN DASHBOARD GLOBAL)
 * =========================================================================
 */
exports.getProjectStats = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        const [totalProjects] = await db.query(`SELECT COUNT(*) as total FROM tbr_projects WHERE tenant_id = ?`, [tenantId]);
        const [totalSprints] = await db.query(`
            SELECT COUNT(*) as total FROM tbr_sprints s 
            INNER JOIN tbr_projects p ON s.project_id = p.id WHERE p.tenant_id = ?
        `, [tenantId]);
        const [totalTasks] = await db.query(`
            SELECT COUNT(*) as total FROM tbr_developments d
            INNER JOIN tbr_projects p ON d.project_id = p.id WHERE p.tenant_id = ?
        `, [tenantId]);

        return res.json({
            success: true,
            stats: {
                total_projects: totalProjects[0]?.total || 0,
                total_sprints: totalSprints[0]?.total || 0,
                total_tasks: totalTasks[0]?.total || 0
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, error: err.message });
    }
};

/**
 * =========================================================================
 * 8. WORKSPACE SCRUM STATS (UNTUK GRAFIK DASHBOARD UTAMA)
 * =========================================================================
 */
exports.getWorkspaceScrumStats = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id || req.headers['x-tenant-id'];

        if (!tenantId) {
            return res.status(400).json({ success: false, message: "Tenant ID tidak ditemukan." });
        }

        const [statusRows] = await db.query(`
            SELECT 
                COUNT(b.id) as total_backlogs,
                IFNULL(SUM(CASE WHEN b.status IN ('hold', 'inactive') THEN 1 ELSE 0 END), 0) as hold,
                IFNULL(SUM(CASE WHEN b.status IN ('progress', 'active') THEN 1 ELSE 0 END), 0) as progress,
                IFNULL(SUM(CASE WHEN b.status = 'done' THEN 1 ELSE 0 END), 0) as done,
                IFNULL(SUM(CASE WHEN b.status IN ('late', 'overdue') THEN 1 ELSE 0 END), 0) as late
            FROM tbr_projects p
            INNER JOIN tbr_backlogs b ON p.id = b.project_id
            WHERE p.tenant_id = ?
        `, [tenantId]);

        // Jika tidak ada backlog, pastikan nilai default-nya nol agar chart tidak rusak
        const stats = statusRows[0] || { total_backlogs: 0, hold: 0, progress: 0, done: 0, late: 0 };

        const [sprintRows] = await db.query(`
            SELECT s.name, DATE_FORMAT(s.end_date, '%Y-%m-%d') as end_date 
            FROM tbr_sprints s
            INNER JOIN tbr_projects p ON s.project_id = p.id
            WHERE p.tenant_id = ? AND s.status = 'active'
            LIMIT 1
        `, [tenantId]);

        return res.json({
            success: true,
            data: {
                total_backlogs: stats.total_backlogs || 0,
                hold: stats.hold || 0,
                progress: stats.progress || 0,
                done: stats.done || 0,
                late: stats.late || 0,
                current_sprint: sprintRows.length > 0 ? sprintRows[0] : null
            }
        });
    } catch (err) {
        console.error("DEBUG ERROR SCRUM STATS:", err.message);
        return res.status(500).json({ success: false, error: "Terjadi kesalahan server saat mengambil statistik." });
    }
};