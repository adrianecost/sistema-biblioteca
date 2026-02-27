const mysql = require("mysql2/promise");
require("dotenv").config(); // Carrega as variáveis do .env

const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS, // Pega a senha do .env
  database: process.env.DB_NAME || "biblioteca",
  waitForConnections: true,
  connectionLimit: 10,
});

module.exports = pool;