const db = require('../config/db');
class BacklogModel {
static async getByProject(projectId) {
const [rows] = await db.query('SELECT * FROM tbr_backlogs WHERE project_id= ?', [projectId]);
return rows;
}
}
module.exports = BacklogModel;