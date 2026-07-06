const express = require('express');
const router = express.Router();

const { verifyToken, authorize } = require('../middleware/auth');
// 🔥 IMPORT: Satpam pemblokir kuota data paket langganan
const { checkProjectLimit, checkTeamLimit } = require('../middleware/SubscriptionsMiddleware');

const projectController = require('../controllers/projectController');
const backlogController = require('../controllers/backlogController'); 
const teamController = require('../controllers/teamController');
const githubController = require('../controllers/githubController'); 

/* =====================================================
   🔓 PUBLIC / EXTERNAL ROUTES (TANPA TOKEN JWT)
   ===================================================== */
// Dipanggil langsung oleh GitHub setelah proses OAuth berhasil
router.get('/github/callback', githubController.handleGitHubCallback);


/* =====================================================
   🔒 PROTECTED ROUTES (Semua rute di bawah wajib login JWT)
   ===================================================== */
router.use(verifyToken);


/* =====================================================
   🛠️ AMANKAN VISION BOARD GLOBAL (ANTI COLLISION)
   Wajib di paling atas setelah verifyToken agar /vision-boards 
   tidak dianggap sebagai :projectId oleh rute dinamis di bawahnya.
   ===================================================== */
router.put('/vision-boards/:id', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst']), projectController.updateVision); 
router.delete('/vision-boards/:id', authorize(['superadmin', 'admin', 'projectowner']), projectController.deleteVision); 


/* =====================================================
   ⭐ GLOBAL PROJECT & DASHBOARD ROUTES (BASE: /api/projects)
   ===================================================== */

// 📂 Rute: Mengambil list seluruh proyek milik tenant (Merespon GET http://localhost:5000/api/projects)
router.get('/', projectController.getProjects);

// Pintu pembuatan proyek baru (Merespon POST http://localhost:5000/api/projects)
router.post('/', authorize(['superadmin', 'admin', 'projectowner']), checkProjectLimit, projectController.createProject);

// 📊 Statistik Grafik Scrum Dashboard (Sesuai dengan axios frontend)
router.get('/workspace/scrum/stats', 
    authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst', 'teamdeveloper', 'developer']), 
    projectController.getWorkspaceScrumStats
);

// 📈 Statistik Global Jumlah Project/Sprint/Task
router.get('/stats', projectController.getProjectStats);


/* =====================================================
   🌟 GITHUB INTEGRATION STATIS (GLOBAL)
   ===================================================== */
router.get('/github/oauth-url', 
    authorize(['superadmin', 'admin', 'businessanalyst', 'teamdeveloper', 'developer']), 
    githubController.getGitHubOAuthUrl
);

router.get('/github/requests', 
    authorize(['superadmin', 'admin', 'businessanalyst', 'teamdeveloper', 'developer']), 
    githubController.getAllIntegrationRequests
);

router.put('/github/requests/:id/reject', 
    authorize(['superadmin', 'admin']), 
    githubController.rejectIntegrationRequest
);

router.put('/github/requests/:id/approve', 
    authorize(['superadmin', 'admin']), 
    githubController.approveIntegrationRequest
);

router.delete('/github/integrations/:id', 
    authorize(['superadmin', 'admin']), 
    githubController.disconnectGitHub
);

router.post('/github/connect-personal', 
    authorize(['superadmin', 'admin', 'businessanalyst', 'teamdeveloper', 'developer']), 
    githubController.connectPersonalAccount
);


/* =====================================================
   ⚠️ PUBLIC WEBHOOK WITH PROJECT ID 
   (Dipindah ke bawah rute statis agar aman dari collision)
   ===================================================== */
// Webhook Receiver dari GitHub
router.post('/:projectId/github-link-action', githubController.linkGitActionToKanban);


/* =====================================================
   👥 TEAM ROUTES & TEAM LIMITATION SECURITY
   ===================================================== */
router.get('/:projectId/members', teamController.getTeamByProject);
router.post('/:projectId/members', authorize(['superadmin', 'admin']), checkTeamLimit, teamController.addTeamMember);
router.put('/:projectId/members/:memberId', authorize(['superadmin', 'admin']), teamController.updateTeamMember);
router.delete('/:projectId/members/:memberId', authorize(['superadmin', 'admin']), teamController.deleteTeamMember);


/* =====================================================
   📋 BACKLOG ROUTES
   ===================================================== */
router.get('/:projectId/backlogs', backlogController.getBacklogsByProject);
router.get('/:projectId/backlogs/export-pdf', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst', 'teamdeveloper', 'developer']), backlogController.exportBacklogToPDF);
router.post('/:projectId/backlogs', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst']), backlogController.createBacklog);
router.put('/:projectId/backlogs/:id', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst']), backlogController.updateBacklog); 
router.delete('/:projectId/backlogs/:id', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst']), backlogController.deleteBacklog); 


/* =====================================================
   🏃 SPRINT ROUTES
   ===================================================== */
router.get('/:projectId/sprints', projectController.getProjectSprints);
router.post('/:projectId/sprints', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst']), projectController.createSprint);
router.put('/:projectId/sprints/:id', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst']), projectController.updateSprint);
router.delete('/:projectId/sprints/:id', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst']), projectController.deleteSprint); 


/* =====================================================
   🗂️ DEVELOPMENT / TASK ROUTES (KANBAN)
   ===================================================== */
router.get('/:projectId/developments', projectController.getProjectDevelopments);
router.post('/:projectId/developments', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst', 'teamdeveloper', 'developer']), projectController.createDevelopment);
router.put('/:projectId/developments/:devId', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst', 'teamdeveloper', 'developer']), projectController.updateDevelopmentStatus);
router.delete('/:projectId/developments/:devId', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst', 'teamdeveloper', 'developer']), projectController.deleteDevelopment);


/* =====================================================
   👁️ VISION BOARD ROUTES (Struktur Nested / Bersarang)
   ===================================================== */
router.get('/:projectId/vision-boards', projectController.getProjectVisions);
router.post('/:projectId/vision-boards', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst']), projectController.createVision);

// Gunakan kembali :projectId di sini agar polanya sama persis dengan POST yang sukses
router.put('/:projectId/vision-boards/:id', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst']), projectController.updateVision); 
router.delete('/:projectId/vision-boards/:id', authorize(['superadmin', 'admin', 'projectowner']), projectController.deleteVision);


/* =====================================================
   📜 ACTIVITY LOG ROUTES
   ===================================================== */
router.get('/:projectId/logs', projectController.getProjectLogs);


/* =====================================================
   🐙 GITHUB INTEGRATION DINAMIS (BERBASIS PROJECT ID)
   ===================================================== */
router.get('/:projectId/github-status', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst', 'teamdeveloper', 'developer']), githubController.getIntegrationByProject);
router.get('/:projectId/github-activity', authorize(['superadmin', 'admin', 'projectowner', 'businessanalyst', 'teamdeveloper', 'developer']), githubController.getRepoActivity);
router.post('/:projectId/github-requests', authorize(['superadmin', 'admin', 'businessanalyst']), githubController.createIntegrationRequest);
router.post('/:projectId/github-sync-backlog', authorize(['superadmin', 'admin', 'businessanalyst', 'teamdeveloper', 'developer']), githubController.syncBacklogWithGitHub);
router.post('/:projectId/github-webhooks', authorize(['superadmin', 'admin', 'businessanalyst']), githubController.configureWebhook);
router.post('/:projectId/github-pat', authorize(['superadmin', 'admin']), githubController.managePAT);


/* =====================================================
   🚨 PROJECT ID WILDCARD (MUTLAK DI PALING BAWAH FILE)
   ===================================================== */
router.get('/:id', projectController.getProjectById);
router.put('/:id', authorize(['superadmin', 'admin', 'projectowner']), projectController.updateProject);
router.delete('/:id', authorize(['superadmin', 'admin']), projectController.deleteProject);

module.exports = router;