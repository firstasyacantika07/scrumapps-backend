const db = require('./config/db');

async function migrate() {
  try {
    console.log('Mulai migrasi database...');
    
    // 1. Buat tabel pivot
    await db.query(`
      CREATE TABLE IF NOT EXISTS tbr_tenant_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id BIGINT UNSIGNED NOT NULL,
        tenant_id INT NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'member',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY user_tenant_unique (user_id, tenant_id)
      )
    `);
    console.log('Tabel tbr_tenant_users siap.');

    // 2. Migrasi data lama dari tbr_users
    const [result] = await db.query(`
      INSERT IGNORE INTO tbr_tenant_users (user_id, tenant_id, role)
      SELECT id, tenant_id, role 
      FROM tbr_users 
      WHERE tenant_id IS NOT NULL
    `);
    
    console.log(`Berhasil memigrasikan ${result.affectedRows} data relasi user-tenant.`);
    console.log('Migrasi selesai!');
  } catch (err) {
    console.error('Error saat migrasi:', err);
  } finally {
    process.exit(0);
  }
}

migrate();
