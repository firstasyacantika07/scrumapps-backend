const express = require('express');
const router = express.Router();

const {
  getBacklogsByProject,
  createBacklog,
  updateBacklog,
  deleteBacklog,
  exportBacklogToPDF
} = require('../controllers/backlogController');

const { verifyToken } = require('../middleware/auth');

/*
|--------------------------------------------------------------------------
| BACKLOG ROUTES
|--------------------------------------------------------------------------
*/

// Ambil semua backlog project
router.get(
  '/projects/:projectId/backlogs',
  verifyToken,
  getBacklogsByProject
);

// Tambah backlog
router.post(
  '/projects/:projectId/backlogs',
  verifyToken,
  createBacklog
);

// Update backlog
router.put(
  '/backlogs/:id',
  verifyToken,
  updateBacklog
);

// Hapus backlog
router.delete(
  '/backlogs/:id',
  verifyToken,
  deleteBacklog
);

// Export PDF
router.get(
  '/projects/:projectId/backlogs/export/pdf',
  verifyToken,
  exportBacklogToPDF
);

module.exports = router;