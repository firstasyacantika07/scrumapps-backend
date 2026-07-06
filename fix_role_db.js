const db = require('./config/db');

async function run() {
    console.log("Menghubungkan ke database...");

    try {
        console.log("1. Mengubah struktur kolom role di tabel tbr_users menjadi VARCHAR(50)...");
        await db.query("ALTER TABLE tbr_users MODIFY COLUMN role VARCHAR(50)");
        
        console.log("2. Mengubah struktur kolom role di tabel tbr_tenant_users menjadi VARCHAR(50)...");
        await db.query("ALTER TABLE tbr_tenant_users MODIFY COLUMN role VARCHAR(50)");
        
        console.log("3. Memperbaiki data role yang terpotong menjadi 'BusinessAnaly' di tabel tbr_users...");
        const [res1] = await db.query("UPDATE tbr_users SET role = 'BusinessAnalyst' WHERE role LIKE 'BusinessAnaly%'");
        console.log(`Berhasil mengubah ${res1.affectedRows} baris di tbr_users.`);
        
        console.log("4. Memperbaiki data role yang terpotong di tabel tbr_tenant_users...");
        const [res2] = await db.query("UPDATE tbr_tenant_users SET role = 'BusinessAnalyst' WHERE role LIKE 'BusinessAnaly%'");
        console.log(`Berhasil mengubah ${res2.affectedRows} baris di tbr_tenant_users.`);
        
        console.log("=== SELESAI! DATABASE TELAH DIPERBARUI SECARA PERMANEN ===");
    } catch (err) {
        console.error("Terjadi kesalahan saat mengubah database:", err.message);
    } finally {
        process.exit(0);
    }
}

run();
