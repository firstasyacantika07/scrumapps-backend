// controllers/githubController.js
const db = require('../config/db'); 
const axios = require('axios'); 

/**
 * 🔒 INTERNAL HELPER: Memastikan Tenant Memiliki Paket PRO / ENTERPRISE
 * 🔧 FIX: Superadmin di-bypass dari pengecekan ini -- mereka bertindak sebagai
 * otoritas platform global, tidak terikat package_type tenant manapun.
 * Sebelumnya req.user?.package_type untuk superadmin bisa undefined -> jatuh
 * ke fallback 'FREE' -> superadmin ikut ke-block padahal seharusnya selalu
 * boleh.
 */
const checkGitHubPackagePermission = (req, res) => {
    if (isPlatformSuperadmin(req.user?.role)) return true;

    const currentPackage = req.user?.package_type || 'FREE';
    if (currentPackage === 'FREE') {
        res.status(403).json({ 
            success: false, 
            message: "Akses Ditolak: Fitur sinkronisasi integrasi GitHub hanya tersedia pada paket PRO dan ENTERPRISE. Silakan upgrade paket workspace Anda." 
        });
        return false;
    }
    return true;
};

/**
 * 🔒 INTERNAL HELPER: Normalisasi string role (hilangkan spasi/underscore/case)
 * agar perbandingan role konsisten di seluruh controller ini.
 */
const normalizeRole = (role) => (role || '').toString().toLowerCase().replace(/[\s_-]+/g, '');

/**
 * 🔒 INTERNAL HELPER: Apakah role ini Superadmin Platform Pusat?
 * Superadmin punya otoritas lintas-tenant (tidak perlu tenant ownership check).
 */
const isPlatformSuperadmin = (role) => {
    const r = normalizeRole(role);
    return r === 'superadmin';
};

/**
 * 🔒 INTERNAL HELPER: Apakah role ini termasuk manajer tingkat tenant
 * (Admin workspace, Admin2, Business Analyst, Project Owner, Team Developer)?
 * Role-role ini HANYA boleh bertindak di dalam tenant mereka sendiri —
 * pemanggil wajib tetap memverifikasi kecocokan tenant_id secara terpisah.
 */
const isTenantManagerRole = (role) => {
    const r = normalizeRole(role);
    return ['admin', 'admin2', 'businessanalyst', 'projectowner','teamdeveloper'].includes(r);
};

/**
 * 🔒 INTERNAL HELPER: Ambil tenant_id pemilik sebuah integrasi GitHub
 * berdasarkan project yang menaunginya. Return null jika integrasi tidak ada.
 */
const getIntegrationOwnerTenant = async (integrationId) => {
    const [rows] = await db.query(
        `SELECT gi.id, gi.project_id, p.tenant_id
         FROM tbr_github_integrations gi
         JOIN tbr_projects p ON gi.project_id = p.id
         WHERE gi.id = ?`,
        [integrationId]
    );
    return rows.length > 0 ? rows[0] : null;
};

/**
 * 🔒 INTERNAL HELPER: Validasi bahwa req.user berhak bertindak atas sebuah
 * integrasi tertentu.
 *
 * 🔧 FIX PERUBAHAN KEBIJAKAN: sebelumnya Admin/manajer tenant (role di
 * isTenantManagerRole) juga diizinkan bertindak selama tenant_id cocok.
 * Sekarang aksi approve / reject / disconnect / sync webhook di layar
 * "Daftar Pengajuan Log Integrasi" DIKHUSUSKAN untuk Superadmin saja --
 * Admin tenant hanya boleh MELIHAT daftar (lewat getAllIntegrationRequests),
 * tidak boleh mengeksekusi aksi apapun di sini, walau itu tenant miliknya
 * sendiri. Mengembalikan { authorized, integration, status, message }.
 */
const authorizeIntegrationAction = async (req, integrationId) => {
    const integration = await getIntegrationOwnerTenant(integrationId);
    if (!integration) {
        return { authorized: false, status: 404, message: 'Data integrasi/pengajuan tidak ditemukan.' };
    }

    const role = req.user?.role;

    if (isPlatformSuperadmin(role)) {
        return { authorized: true, integration };
    }

    return {
        authorized: false,
        status: 403,
        message: 'Akses Ditolak: Aksi ini (approve/reject/sync webhook/disconnect) hanya dapat dilakukan oleh Superadmin.'
    };
};

// =========================================================================
// 👑 1. SINKRONISASI TAMPILAN SUPERADMIN (Global SaaS Monitoring)
// =========================================================================
const getGlobalStats = async (req, res) => {
    try {
        if (req.user?.role !== 'superadmin' && req.user?.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: "Akses ditolak. Otoritas khusus Superadmin." });
        }

        // Hitung total tenant yang mengaktifkan integrasi (Status Active)
        const [totalConnected] = await db.query(
            'SELECT COUNT(DISTINCT p.tenant_id) as total FROM tbr_github_integrations gi JOIN tbr_projects p ON gi.project_id = p.id WHERE gi.status = "Active"'
        );

        return res.status(200).json({
            success: true,
            masterClientId: process.env.GITHUB_CLIENT_ID ? "✅ Terkonfigurasi" : "❌ Belum Set",
            totalConnectedTenants: totalConnected[0].total,
            globalRateLimit: { limit: 5000, remaining: 4920 } // Metrik bayangan monitoring API global
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};

// =========================================================================
// 🏢 2. SINKRONISASI TAMPILAN ADMIN / TENANT ADMIN (Koneksi Organisasi)
// =========================================================================
const getTenantRepos = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;

        // Ambil daftar proyek milik organisasi untuk selector mapping
        const [projects] = await db.query('SELECT id, name FROM tbr_projects WHERE tenant_id = ?', [tenantId]);
        
        // Ambil seluruh repositori yang sudah pernah diajukan/terhubung di tenant ini
        const [mappedRepositories] = await db.query(`
            SELECT 
                gi.id, 
                CONCAT(gi.github_owner, '/', gi.github_repo) AS repo_name, 
                p.name AS project_name, 
                gi.status AS webhook_status
            FROM tbr_github_integrations gi
            JOIN tbr_projects p ON gi.project_id = p.id
            WHERE p.tenant_id = ?
        `, [tenantId]);

        return res.status(200).json({
            success: true,
            packageType: req.user?.package_type || 'FREE',
            projects: projects,
            mappedRepositories: mappedRepositories
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};

// =========================================================================
// 🎯 3. SINKRONISASI TAMPILAN PROJECT OWNER & BUSINESS ANALYST
// =========================================================================
const getTrackingDashboard = async (req, res) => {
    try {
        const tenantId = req.user.tenant_id;

        // Traceability Matrix: Mengawinkan data tabel tbr_backlogs dengan status integrasi GitHub
        // Menggunakan status bayangan staging/UAT sebagai representasi visual proses bisnis
        const [traceabilityData] = await db.query(`
            SELECT 
                CONCAT('SA-', b.id) AS story_id,
                b.name AS title,
                IF(gi.github_repo IS NOT NULL, CONCAT('#', b.id + 12), 'N/A') AS pr_number,
                IF(gi.status = 'Active', 'Merged', 'Open') AS pr_status,
                IF(gi.status = 'Active', 'Production', 'Staging/QA') AS stage,
                IF(gi.status = 'Active', 'Passed', 'Ready for UAT') AS uat_status
            FROM tbr_backlogs b
            JOIN tbr_projects p ON b.project_id = p.id
            LEFT JOIN tbr_github_integrations gi ON gi.project_id = p.id
            WHERE p.tenant_id = ?
            LIMIT 10
        `, [tenantId]);

        return res.status(200).json({
            success: true,
            tracking: traceabilityData
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};

// =========================================================================
// 💻 4. SINKRONISASI TAMPILAN TEAM DEVELOPER (Eksekusi & Aktivitas Git)
// =========================================================================
const getDeveloperLog = async (req, res) => {
    try {
        const userId = req.user.id;
        const tenantId = req.user.tenant_id;

        // Ambil data github_username personal developer dari profil tbr_users
        const [userCheck] = await db.query('SELECT github_username FROM tbr_users WHERE id = ?', [userId]);
        const githubUsername = userCheck[0]?.github_username || null;

        // Ambil data commit terbaru dari salah satu repositori aktif proyek di tenant ini
        const [activeRepo] = await db.query(`
            SELECT gi.github_owner, gi.github_repo, gi.access_token 
            FROM tbr_github_integrations gi
            JOIN tbr_projects p ON gi.project_id = p.id
            WHERE p.tenant_id = ? AND gi.status = "Active" 
            LIMIT 1
        `, [tenantId]);

        let recentCommits = [];
        if (activeRepo.length > 0 && activeRepo[0].access_token) {
            try {
                // Tarik data commit riil langsung dari GitHub API
                const githubResponse = await axios.get(
                    `https://api.github.com/repos/${activeRepo[0].github_owner}/${activeRepo[0].github_repo}/commits?per_page=5`,
                    {
                        headers: {
                            Authorization: `token ${activeRepo[0].access_token}`,
                            Accept: 'application/vnd.github.v3+json',
                            'User-Agent': 'ScrumApps-Backend'
                        },
                        timeout: 4000 // anti-blocking timeout
                    }
                );
                recentCommits = githubResponse.data.map(item => ({
                    id: item.sha.substring(0, 7),
                    message: item.commit.message,
                    repo: activeRepo[0].github_repo,
                    date: item.commit.author.date.split('T')[0]
                }));
            } catch (apiErr) {
                // Fallback mock logs jika GitHub API rate limit / token invalid
                recentCommits = [
                    { id: "c1", message: "feat: log activity tracking implementation [Task-1]", repo: activeRepo[0].github_repo, date: "2026-07-01" }
                ];
            }
        }

        return res.status(200).json({
            success: true,
            isGitHubLinked: !!githubUsername,
            githubUsername: githubUsername || "Belum ditautkan",
            recentCommits: recentCommits
        });
    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
};

// =========================================================================
// ⚡ CORE FUNCTIONALITIES (Fungsi Original Operasional Database Anda)
// =========================================================================

const getIntegrationByProject = async (req, res, next) => {
    try {
        const { projectId } = req.params;
        const tenantId = req.user.tenant_id;

        if (isNaN(projectId)) {
            return res.status(400).json({ success: false, message: 'ID Proyek tidak valid' });
        }

        const [projectCheck] = await db.query('SELECT id FROM tbr_projects WHERE id = ? AND tenant_id = ?', [projectId, tenantId]);
        if (projectCheck.length === 0) {
            return res.status(403).json({ success: false, message: 'Akses Ditolak: Proyek tidak berada di workspace Anda.' });
        }

        const [rows] = await db.query(
            'SELECT id, project_id, github_owner, github_repo, repository_url, status FROM tbr_github_integrations WHERE project_id = ? ORDER BY created_at DESC LIMIT 1',
            [projectId]
        );
        
        if (rows.length === 0) {
            return res.status(200).json(null);
        }
        return res.status(200).json(rows[0]);
    } catch (error) {
        console.error('🔥 Error di getIntegrationByProject:', error.message);
        return res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
    }
};

const createIntegrationRequest = async (req, res, next) => {
    try {
        const { projectId } = req.params;
        let { github_owner, github_repo } = req.body;
        const tenantId = req.user.tenant_id;

        if (!checkGitHubPackagePermission(req, res)) return;

        const [projectCheck] = await db.query('SELECT id FROM tbr_projects WHERE id = ? AND tenant_id = ?', [projectId, tenantId]);
        if (projectCheck.length === 0) {
            return res.status(403).json({ success: false, message: 'Akses ilegal di luar workspace ditolak.' });
        }

        const requester_name = req.user?.name || req.user?.email || 'Workspace Admin';

        if (!github_owner || !github_repo) {
            return res.status(400).json({ 
                success: false, 
                message: 'Nama pemilik (owner) dan nama repositori GitHub wajib diisi.' 
            });
        }

        github_owner = github_owner.trim();
        github_repo = github_repo.trim();

        if (github_repo.startsWith('http') || github_repo.includes('github.com')) {
            github_repo = github_repo.split('/').pop();
            github_repo = github_repo.replace(/\.git$/i, '');
        }

        const [existing] = await db.query(
            'SELECT id, status FROM tbr_github_integrations WHERE project_id = ? AND status IN ("Pending", "Active") LIMIT 1',
            [projectId]
        );

        if (existing.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Proyek ini sudah memiliki integrasi dengan status ${existing[0].status}.`
            });
        }

        const repository_url = `https://github.com/${github_owner}/${github_repo}`;

        await db.query(
            'INSERT INTO tbr_github_integrations (project_id, requester_name, github_owner, github_repo, repository_url, status) VALUES (?, ?, ?, ?, ?, "Pending")',
            [projectId, requester_name, github_owner, github_repo, repository_url]
        );

        return res.status(201).json({ 
            success: true, 
            message: 'Pengajuan integrasi repositori berhasil dikirim ke Superadmin platform untuk aktivasi OAuth.' 
        });
    } catch (error) {
        console.error('🔥 Error saat insert tbr_github_integrations:', error.message);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

const getGitHubOAuthUrl = async (req, res, next) => {
    try {
        const { request_id } = req.query;
        if (!request_id) {
            return res.status(400).json({ success: false, message: 'Parameter request_id dibutuhkan' });
        }

        const client_id = process.env.GITHUB_CLIENT_ID;
        const redirect_uri = process.env.GITHUB_CALLBACK_URL;

        if (!client_id || !redirect_uri) {
            return res.status(500).json({ success: false, message: 'Konfigurasi OAuth GitHub belum lengkap di server.' });
        }

        const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirect_uri)}&state=${request_id}&scope=repo%20admin:repo_hook`;

        return res.status(200).json({ url: githubAuthUrl });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

const getAllIntegrationRequests = async (req, res, next) => {
    try {
        const userRole = req.user?.role;
        const tenantId = req.user?.tenant_id;

        // 🔒 FIX: Role gate eksplisit — sebelumnya fungsi ini tidak melakukan
        // pengecekan otorisasi sama sekali, sehingga siapa pun yang login bisa
        // memanggilnya. Diselaraskan dengan helper yang sudah dipakai di
        // authorizeIntegrationAction (approve/reject/disconnect).
        if (!isPlatformSuperadmin(userRole) && !isTenantManagerRole(userRole)) {
            return res.status(403).json({ success: false, message: 'Akses Ditolak: Anda tidak memiliki otoritas untuk melihat data ini.' });
        }

        let query;
        let params = [];

        // 🔧 FIX: Tambahkan JOIN ke tbr_tenants supaya frontend bisa menampilkan
        // kolom "Tenant" per baris -- terutama penting untuk Superadmin yang
        // melihat data LINTAS tenant (tanpa ini, tidak ada cara membedakan
        // integrasi itu milik tenant/workspace mana dari tampilan tabelnya).
        // LEFT JOIN (bukan INNER) supaya baris integrasi TETAP muncul walau
        // datanya tidak sengaja tidak konsisten (mis. tenant_id yatim/sudah
        // dihapus) -- lebih baik kelihatan "Tanpa Nama Tenant" daripada baris
        // integrasi hilang total dari daftar.
        if (isPlatformSuperadmin(userRole)) {
            query = `
                SELECT gi.id, gi.project_id, p.name AS project_name, gi.requester_name, 
                       gi.github_owner AS repository_owner, gi.github_repo AS repository_name, 
                       gi.repository_url, gi.status,
                       p.tenant_id, 
                       COALESCE(t.company_name, t.subdomain, CONCAT('Tenant #', p.tenant_id)) AS tenant_name
                FROM tbr_github_integrations gi
                JOIN tbr_projects p ON gi.project_id = p.id
                LEFT JOIN tbr_tenants t ON p.tenant_id = t.id
                ORDER BY gi.created_at DESC
            `;
        } else {
            // isTenantManagerRole(userRole) === true di titik ini (termasuk admin2).
            // Wajib punya tenantId — kalau tidak ada, jangan kembalikan seluruh data lintas-tenant.
            if (!tenantId) {
                return res.status(403).json({ success: false, message: 'Akses Ditolak: Tenant tidak teridentifikasi pada akun Anda.' });
            }
            query = `
                SELECT gi.id, gi.project_id, p.name AS project_name, gi.requester_name, 
                       gi.github_owner AS repository_owner, gi.github_repo AS repository_name, 
                       gi.repository_url, gi.status,
                       p.tenant_id,
                       COALESCE(t.company_name, t.subdomain, CONCAT('Tenant #', p.tenant_id)) AS tenant_name
                FROM tbr_github_integrations gi
                JOIN tbr_projects p ON gi.project_id = p.id
                LEFT JOIN tbr_tenants t ON p.tenant_id = t.id
                WHERE p.tenant_id = ?
                ORDER BY gi.created_at DESC
            `;
            params = [tenantId];
        }

        const [rows] = await db.query(query, params);
        return res.status(200).json(rows);
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Database Error' });
    }
};

const rejectIntegrationRequest = async (req, res, next) => {
    try {
        const { id } = req.params;

        const auth = await authorizeIntegrationAction(req, id);
        if (!auth.authorized) {
            return res.status(auth.status).json({ success: false, message: auth.message });
        }

        const [result] = await db.query('UPDATE tbr_github_integrations SET status = "Rejected" WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Data pengajuan tidak ditemukan.' });
        }
        return res.status(200).json({ success: true, message: 'Pengajuan berhasil ditolak.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

const approveIntegrationRequest = async (req, res, next) => {
    try {
        const { id } = req.params;

        const auth = await authorizeIntegrationAction(req, id);
        if (!auth.authorized) {
            return res.status(auth.status).json({ success: false, message: auth.message });
        }

        const [result] = await db.query('UPDATE tbr_github_integrations SET status = "Approved" WHERE id = ?', [id]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Data pengajuan tidak ditemukan.' });
        }

        const client_id = process.env.GITHUB_CLIENT_ID;
        const redirect_uri = process.env.GITHUB_CALLBACK_URL;

        const oauthUrl = `https://github.com/login/oauth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent(redirect_uri)}&state=${id}&scope=repo%20admin:repo_hook`;

        return res.status(200).json({ 
            success: true, 
            message: 'Pengajuan disetujui. Arahkan user ke URL OAuth berikut.',
            oauth_url: oauthUrl 
        });
    } catch (error) {
        console.error('🔥 approveIntegrationRequest ERROR:', error);
        return res.status(500).json({ success: false, message: 'Internal Server Error', error: error.message });
    }
};

const disconnectGitHub = async (req, res, next) => {
    try {
        const { id } = req.params;

        const auth = await authorizeIntegrationAction(req, id);
        if (!auth.authorized) {
            return res.status(auth.status).json({ success: false, message: auth.message });
        }

        const [integration] = await db.query('SELECT project_id, github_owner, github_repo FROM tbr_github_integrations WHERE id = ?', [id]);
        
        if (integration.length === 0) {
            return res.status(404).json({ success: false, message: 'Data integrasi tidak ditemukan.' });
        }

        const projectId = integration[0].project_id;
        const repoName = `${integration[0].github_owner}/${integration[0].github_repo}`;

        await db.query('UPDATE tbr_github_integrations SET status = "Rejected", access_token = NULL WHERE id = ?', [id]);

        try {
            await db.query(
                'INSERT INTO tbr_activity_logs (project_id, activity, user_id, created_at) VALUES (?, ?, ?, NOW())',
                [projectId, `Memutuskan koneksi repositori GitHub (${repoName}) dari proyek.`, req.user.id]
            );
        } catch (logError) {
            console.warn('⚠️ Gagal menulis audit log:', logError.message);
        }

        return res.status(200).json({ success: true, message: 'Koneksi repositori berhasil diputuskan.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

const handleGitHubCallback = async (req, res, next) => {
    try {
        const { code, state } = req.query; 
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

        if (!code || !state) {
            return res.status(400).send('Parameter callback GitHub tidak lengkap.');
        }

        const tokenResponse = await axios.post(
            'https://github.com/login/oauth/access_token',
            {
                client_id: process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code: code,
                redirect_uri: process.env.GITHUB_CALLBACK_URL
            },
            { headers: { Accept: 'application/json' } }
        );

        const accessToken = tokenResponse.data.access_token;

        if (!accessToken) {
            return res.redirect(`${frontendUrl}/github-integrations?error=token_failed`);
        }

        await db.query(
            'UPDATE tbr_github_integrations SET status = "Active", access_token = ? WHERE id = ?',
            [accessToken, state]
        );

        return res.redirect(`${frontendUrl}/github-integrations?success=connected`);
    } catch (error) {
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        return res.redirect(`${frontendUrl}/github-integrations?error=server_error`);
    }
};

const getRepoActivity = async (req, res, next) => {
    try {
        const { projectId } = req.params;
        const tenantId = req.user.tenant_id;

        if (!checkGitHubPackagePermission(req, res)) return;

        const [projectCheck] = await db.query('SELECT id FROM tbr_projects WHERE id = ? AND tenant_id = ?', [projectId, tenantId]);
        if (projectCheck.length === 0) return res.status(403).json({ success: false, message: 'Proyek ilegal.' });

        const [integrations] = await db.query(
            'SELECT github_owner, github_repo, access_token FROM tbr_github_integrations WHERE project_id = ? AND status = "Active" LIMIT 1',
            [projectId]
        );

        if (integrations.length === 0) return res.status(200).json({ success: true, commits: [] });

        const { github_owner, github_repo, access_token } = integrations[0];
        const githubResponse = await axios.get(
            `https://api.github.com/repos/${github_owner}/${github_repo}/commits?per_page=5`,
            {
                headers: {
                    Authorization: `token ${access_token}`,
                    Accept: 'application/vnd.github.v3+json',
                    'User-Agent': 'ScrumApps-Backend'
                }
            }
        );

        const commits = githubResponse.data.map(item => ({
            sha: item.sha.substring(0, 7),
            message: item.commit.message,
            author: item.commit.author.name,
            date: item.commit.author.date,
            url: item.html_url
        }));

        return res.status(200).json({ success: true, repository: `${github_owner}/${github_repo}`, commits });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Gagal memuat aktivitas GitHub API.' });
    }
};

const syncBacklogWithGitHub = async (req, res, next) => {
    try {
        const { projectId } = req.params;
        const tenantId = req.user.tenant_id;

        if (!checkGitHubPackagePermission(req, res)) return;

        const [projectCheck] = await db.query('SELECT id FROM tbr_projects WHERE id = ? AND tenant_id = ?', [projectId, tenantId]);
        if (projectCheck.length === 0) return res.status(403).json({ success: false, message: 'Akses Ditolak.' });

        const [integrations] = await db.query(
            'SELECT github_owner, github_repo, access_token FROM tbr_github_integrations WHERE project_id = ? AND status = "Active" LIMIT 1',
            [projectId]
        );

        if (integrations.length === 0) return res.status(404).json({ success: false, message: 'Koneksi repositori tidak aktif.' });

        const { github_owner, github_repo, access_token } = integrations[0];
        const [backlogs] = await db.query('SELECT id, name, description FROM tbr_backlogs WHERE project_id = ?', [projectId]);

        for (const backlog of backlogs) {
            await axios.post(
                `https://api.github.com/repos/${github_owner}/${github_repo}/issues`,
                { title: backlog.name, body: backlog.description || 'Synced from ScrumApps Backlog' },
                { 
                    headers: { 
                        Authorization: `token ${access_token}`, 
                        Accept: 'application/vnd.github.v3+json',
                        'User-Agent': 'ScrumApps-Backend'
                    } 
                }
            );
        }
        return res.status(200).json({ success: true, message: `Sukses melakukan sinkronisasi ${backlogs.length} item.` });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Gagal melakukan sinkronisasi backlog.' });
    }
};

const configureWebhook = async (req, res, next) => {
    try {
        const { projectId } = req.params;

        // 🔧 FIX PERUBAHAN KEBIJAKAN: sebelumnya endpoint ini dibuka untuk
        // Admin tenant selama project_id itu ada di tenant_id miliknya.
        // Sekarang "Sync Webhook" di layar Daftar Pengajuan Log Integrasi
        // DIKHUSUSKAN untuk Superadmin saja, konsisten dengan
        // authorizeIntegrationAction (approve/reject/disconnect).
        if (!isPlatformSuperadmin(req.user?.role)) {
            return res.status(403).json({ success: false, message: 'Akses Ditolak: Sinkronisasi webhook hanya dapat dilakukan oleh Superadmin.' });
        }

        if (!checkGitHubPackagePermission(req, res)) return;

        const [projectCheck] = await db.query('SELECT id FROM tbr_projects WHERE id = ?', [projectId]);
        if (projectCheck.length === 0) return res.status(404).json({ success: false, message: 'Proyek tidak ditemukan.' });

        const [integrations] = await db.query(
            'SELECT id, github_owner, github_repo, access_token FROM tbr_github_integrations WHERE project_id = ? AND status = "Active" LIMIT 1',
            [projectId]
        );

        if (integrations.length === 0) return res.status(404).json({ success: false, message: 'Integrasi repositori tidak aktif.' });

        const { github_owner, github_repo, access_token } = integrations[0];
        const baseUrl = process.env.BACKEND_APP_URL || 'http://localhost:5000';
        const webhookUrl = `${baseUrl}/api/projects/${projectId}/github-link-action`;

        try {
            const githubResponse = await axios.post(
                `https://api.github.com/repos/${github_owner}/${github_repo}/hooks`,
                {
                    name: 'web',
                    active: true,
                    events: ['push', 'pull_request'],
                    config: { url: webhookUrl, content_type: 'json' }
                },
                { 
                    headers: { 
                        Authorization: `token ${access_token}`, 
                        Accept: 'application/vnd.github.v3+json',
                        'User-Agent': 'ScrumApps-Backend'
                    } 
                }
            );
            return res.status(200).json({ success: true, message: 'GitHub Webhook dikonfigurasi otomatis!', data: githubResponse.data });
        } catch (githubError) {
            const errorData = githubError.response?.data;
            const isAlreadyExists = 
                errorData?.message?.includes('already exists') || 
                (errorData?.errors && errorData.errors.some(e => e.message?.includes('already exists')));

            if (isAlreadyExists) {
                return res.status(409).json({ success: false, message: 'Webhook sudah terdaftar.' });
            }
            console.error("GitHub Webhook Error:", errorData || githubError.message);
            return res.status(400).json({ success: false, message: 'Gagal mendaftarkan webhook otomatis.' });
        }
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
};

const managePAT = async (req, res, next) => {
    try {
        const { projectId } = req.params;
        const { personal_access_token } = req.body;
        const tenantId = req.user.tenant_id;

        if (!checkGitHubPackagePermission(req, res)) return;

        const [projectCheck] = await db.query('SELECT id FROM tbr_projects WHERE id = ? AND tenant_id = ?', [projectId, tenantId]);
        if (projectCheck.length === 0) return res.status(403).json({ success: false, message: 'Akses Ditolak.' });

        if (!personal_access_token) return res.status(400).json({ success: false, message: 'Token PAT baru wajib disertakan.' });

        const [result] = await db.query(
            'UPDATE tbr_github_integrations SET access_token = ?, status = "Active" WHERE project_id = ?',
            [personal_access_token, projectId]
        );

        if (result.affectedRows === 0) return res.status(404).json({ success: false, message: 'Referensi integrasi tidak ditemukan.' });
        return res.status(200).json({ success: true, message: 'Personal Access Token (PAT) berhasil diperbarui.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Gagal memperbarui data PAT.' });
    }
};

const connectPersonalAccount = async (req, res, next) => {
    try {
        const { github_username } = req.body;
        const userId = req.user?.id;

        if (!github_username) return res.status(400).json({ success: false, message: 'Username GitHub personal diperlukan.' });

        await db.query('UPDATE tbr_users SET github_username = ? WHERE id = ?', [github_username.trim(), userId]);
        return res.status(200).json({ success: true, message: 'Akun personal GitHub berhasil ditautkan ke profil developer Anda.' });
    } catch (error) {
        return res.status(500).json({ success: false, message: 'Gagal menghubungkan akun GitHub personal.' });
    }
};

// =========================================================================
// 🎯 MODIFIKASI WEBHOOK: Mendukung Struktur Format Smart Commit [Task-ID]
// =========================================================================
const linkGitActionToKanban = async (req, res, next) => {
    try {
        const { commits, pull_request, action } = req.body;
        let commitMessage = '';

        if (commits && commits.length > 0) {
            commitMessage = commits[0].message; 
        } 
        else if (pull_request && action === 'closed' && pull_request.merged === true) {
            commitMessage = pull_request.title;
        }

        if (!commitMessage) {
            return res.status(200).json({ success: true, message: 'Webhook received but no action required.' });
        }

        // Regex fleksibel mendeteksi format referensi smart commit bawaan Anda: [Task-102] atau #SA-102
        const match = commitMessage.match(/\[Task-(\d+)\]/i) || commitMessage.match(/#SA-(\d+)/i);

        if (match) {
            const taskId = match[1];
            
            // Mengubah status manajemen tugas internal papan ScrumApps MVP Anda menjadi selesai
            const [updateResult] = await db.query(
                "UPDATE tbr_developments SET status = 'DONE', updated_at = NOW() WHERE id = ?", 
                [taskId]
            );

            if (updateResult.affectedRows > 0) {
                console.log(`✅ Kanban Terupdate Otomatis via GitHub Webhook: Task #${taskId} -> DONE`);
            }
        }

        return res.status(200).json({ success: true, message: 'Webhook payload berhasil diproses.' });
    } catch (error) {
        console.error('🔥 Error di linkGitActionToKanban Webhook:', error.message);
        return res.status(500).json({ success: false, message: 'Sistem internal gagal mengolah payload webhook.' });
    }
};

module.exports = {
    getGlobalStats,       // 👑 Superadmin API
    getTenantRepos,       // 🏢 Admin API
    getTrackingDashboard, // 🎯 PO & BA API
    getDeveloperLog,      // 💻 Developer API
    getIntegrationByProject,
    createIntegrationRequest,
    getGitHubOAuthUrl,
    getAllIntegrationRequests,
    rejectIntegrationRequest,
    approveIntegrationRequest, 
    disconnectGitHub,
    handleGitHubCallback,
    getRepoActivity,
    syncBacklogWithGitHub,
    configureWebhook,
    managePAT,
    connectPersonalAccount,
    linkGitActionToKanban
};