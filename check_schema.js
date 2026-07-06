const db = require('./config/db');
async function run() {
  try {
    await db.query("ALTER TABLE tbr_github_integrations MODIFY COLUMN status ENUM('Pending', 'Approved', 'Active', 'Rejected') DEFAULT 'Pending'");
    console.log("Successfully updated ENUM");
  } catch(e) {
    console.error(e);
  }
  process.exit(0);
}
run();
