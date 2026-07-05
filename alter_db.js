const db = require('./config/db');
db.query("ALTER TABLE tbr_notifications ADD COLUMN type VARCHAR(50) DEFAULT 'info' AFTER project_id")
  .then(() => console.log('Column added successfully'))
  .catch(err => {
    if (err.code === 'ER_DUP_FIELDNAME') {
      console.log('Column already exists');
    } else {
      console.error('Error adding column:', err.message);
    }
  })
  .finally(() => process.exit(0));
