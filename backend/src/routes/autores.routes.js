const express = require("express");
const pool = require("../db");

const router = express.Router();

router.get("/", async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM autores ORDER BY nome");
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { nome } = req.body;
  if (!nome) return res.status(400).json({ error: "nome é obrigatório" });

  const [r] = await pool.query("INSERT INTO autores (nome) VALUES (?)", [nome]);
  res.status(201).json({ id: r.insertId, nome });
});

router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const { nome } = req.body;

  const [r] = await pool.query("UPDATE autores SET nome=? WHERE id=?", [nome, id]);
  if (r.affectedRows === 0) return res.status(404).json({ error: "Autor não encontrado" });

  res.json({ id: Number(id), nome });
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [r] = await pool.query("DELETE FROM autores WHERE id=?", [id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: "Autor não encontrado" });
    res.status(204).send();
  } catch {
    res.status(409).json({ error: "Não pode excluir: existe livro ligado a esse autor." });
  }
});

module.exports = router;