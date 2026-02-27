const express = require("express");
const router = express.Router();
const db = require("../db");

// Regex simples: exige @ e um ponto depois
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

// GET /api/usuarios
router.get("/", async (_req, res) => {
  const [rows] = await db.query(
    "SELECT id, nome, email, tipo, data_criacao FROM usuarios ORDER BY id DESC"
  );
  res.json(rows);
});

// POST /api/usuarios
router.post("/", async (req, res) => {
  try {
    const { nome, email, senha, tipo } = req.body;

    if (!nome || !email || !senha) {
      return res.status(400).json({ error: "Nome, email e senha são obrigatórios." });
    }

    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: "Email inválido. Use o padrão nome@dominio.com" });
    }

    const userType = tipo || "ALUNO";

    await db.query(
      "INSERT INTO usuarios (nome, email, senha, tipo) VALUES (?, ?, ?, ?)",
      [nome, email, senha, userType]
    );

    return res.status(201).json({ ok: true });
  } catch (err) {
    if (String(err?.code) === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "Este email já está cadastrado." });
    }
    console.error(err);
    return res.status(500).json({ error: "Erro ao criar usuário." });
  }
});

// DELETE /api/usuarios/:id
router.delete("/:id", async (req, res) => {
  await db.query("DELETE FROM usuarios WHERE id = ?", [req.params.id]);
  res.status(204).send();
});

module.exports = router;