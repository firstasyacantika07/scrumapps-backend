const bcrypt = require('bcryptjs');
const db = require('./src/config/db');

const resetAll = async () => {
  const users = [
    { email: 'superadmin@gmail.com',    password: 'scrumapps123' },
    { email: 'support@gmail.com',       password: 'scrumapps123' },
    { email: 'vaclariva@gmail.com',     password: 'scrumapps123' },
    { email: 'meyclariva@gmail.com',    password: 'scrumapps123' },
    { email: 'projectowner@gmail.com',  password: 'scrumapps123' },
    { email: 'firstasya@gmail.com',     password: 'scrumapps123' },
    { email: 'hanisetya@gmail.com',    password: 'scrumapps123' },
    { email: 'tika@gmail.com',          password: 'scrumapps123'  }
  ];

  for (const u of users) {
    const hashed = await bcrypt.hash(u.password, 10);
    await db.query('UPDATE tbr_users SET password = ? WHERE email = ?', [hashed, u.email]);
    console.log(`✅ Reset: ${u.email}`);
  }

  console.log('Semua password berhasil direset!');
  process.exit();
};

resetAll();