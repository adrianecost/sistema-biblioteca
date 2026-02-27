const express = require("express");
const pool = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM categorias ORDER BY nome");
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ error: "nome é obrigatório" });

  try {
    const [r] = await pool.query("INSERT INTO categorias (nome) VALUES (?)", [nome]);
    res.status(201).json({ id: r.insertId, nome });
  } catch {
    res.status(409).json({ error: "Categoria já existe (nome único)." });
  }
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { nome } = req.body;

  try {
    const [r] = await pool.query("UPDATE categorias SET nome=? WHERE id=?", [nome, id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: "Categoria não encontrada" });
    res.json({ id: Number(id), nome });
  } catch {
    res.status(409).json({ error: "Categoria já existe (nome único)." });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [r] = await pool.query("DELETE FROM categorias WHERE id=?", [id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: "Categoria não encontrada" });
    res.status(204).send();
  } catch {
    res.status(409).json({ error: "Não pode excluir: existe livro ligado a essa categoria." });
  }
});

module.exports = router;