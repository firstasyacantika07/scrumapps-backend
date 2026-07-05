const db = require('../../config/db'); // Pastikan koneksi DB Anda benar

const Project = {
  // RF-04: Mendapatkan statistik untuk Dashboard
  getStats: (callback) => {
    const query = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'hold' THEN 1 ELSE 0 END) as hold,
        SUM(CASE WHEN status = 'in progress' THEN 1 ELSE 0 END) as progress,
        SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as done,
        SUM(CASE WHEN status != 'done' AND end_date < NOW() THEN 1 ELSE 0 END) as late
      FROM tbr_projects
    `;
    db.query(query, callback);
  },

  // CRUD: Read All
  getAll: (callback) => {
    db.query("SELECT * FROM tbr_projects ORDER BY created_at DESC", callback);
  },

  // CRUD: Create
  create: (data, callback) => {
    const query = "INSERT INTO tbr_projects SET ?";
    db.query(query, data, callback);
  },

  // CRUD: Update
  update: (id, data, callback) => {
    const query = "UPDATE tbr_projects SET ? WHERE id = ?";
    db.query(query, [data, id], callback);
  },

  // CRUD: Delete
  delete: (id, callback) => {
    db.query("DELETE FROM tbr_projects WHERE id = ?", [id], callback);
  }
};

module.exports = Project;