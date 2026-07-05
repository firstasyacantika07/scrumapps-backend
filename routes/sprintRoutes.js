const express = require('express');
const router = express.Router();

const {
  getSprintsByProject,
  getSprintDetail,
  createSprint,
  updateSprint,
  deleteSprint,
  startSprint,
  endSprint,
  assignBacklogToSprint,
  removeBacklogFromSprint,
  getScrumStats,
} = require('../controllers/sprintController');

const { verifyToken } = require('../middleware/auth');

/*
|--------------------------------------------------------------------------
| SPRINT ROUTES
|--------------------------------------------------------------------------
| Semua route dilindungi oleh verifyToken middleware.
| Otorisasi role (BA / PO only) ditangani di dalam controller.
|--------------------------------------------------------------------------
*/

// 📊 Scrum stats untuk dashboard (dipanggil Dashboard.jsx)
router.get(
  '/projects/workspace/scrum/stats',
  verifyToken,
  getScrumStats
);

// 📋 Get semua sprint dalam satu project
router.get(
  '/projects/:projectId/sprints',
  verifyToken,
  getSprintsByProject
);

// 📋 Get detail sprint + backlog yang terikat
router.get(
  '/projects/:projectId/sprints/:sprintId',
  verifyToken,
  getSprintDetail
);

// ✨ Buat sprint baru
router.post(
  '/projects/:projectId/sprints',
  verifyToken,
  createSprint
);

// 🔄 Update sprint (nama, tanggal, status, review, retro)
router.put(
  '/projects/:projectId/sprints/:sprintId',
  verifyToken,
  updateSprint
);

// 🗑️ Hapus sprint (backlog terkait dilepas ke product backlog)
router.delete(
  '/projects/:projectId/sprints/:sprintId',
  verifyToken,
  deleteSprint
);

// ▶️ Start sprint (planned → active)
router.patch(
  '/projects/:projectId/sprints/:sprintId/start',
  verifyToken,
  startSprint
);

// ⏹️ End sprint (active → completed, backlog unfinished dikembalikan)
router.patch(
  '/projects/:projectId/sprints/:sprintId/end',
  verifyToken,
  endSprint
);

// 📌 Assign backlog ke sprint (body: { backlog_ids: [1, 2, 3] })
router.post(
  '/projects/:projectId/sprints/:sprintId/assign-backlog',
  verifyToken,
  assignBacklogToSprint
);

// 📤 Lepas satu backlog dari sprint
router.patch(
  '/projects/:projectId/sprints/:sprintId/remove-backlog/:backlogId',
  verifyToken,
  removeBacklogFromSprint
);

module.exports = router;
