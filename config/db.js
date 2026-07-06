const mysql = require('mysql2');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  user: process.env.DB_USERNAME || 'root',        // Sesuai dengan DB_USERNAME di .env
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'scrumapps', // Sesuai dengan DB_DATABASE di .env
  port: process.env.DB_PORT || 4000,               // Sesuai dengan DB_PORT di .env (TiDB menggunakan 4000)
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // ⚠️ WAJIB: Ditambahkan agar koneksi ke TiDB Cloud yang menggunakan TLS/SSL tidak error
  ssl: {
    rejectUnauthorized: true
  }
});

module.exports = pool.promise();