const express = require("express");
const router = express.Router();
const db = require("../db");

// Login: email + senha + tipo
router.post("/login", async (req, res) => {
  try {
    const { email, senha, tipo } = req.body;

    if (!email || !senha || !tipo) {
      return res.status(400).json({ error: "Email, senha e tipo são obrigatórios." });
    }

    const [rows] = await db.query(
      "SELECT id, nome, email, tipo FROM usuarios WHERE email = ? AND senha = ? AND tipo = ? LIMIT 1",
      [email, senha, tipo]
    );

    if (!rows.length) {
      return res.status(401).json({ error: "Credenciais inválidas." });
    }

    return res.json({ user: rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Erro no login." });
  }
});

module.exports = router;