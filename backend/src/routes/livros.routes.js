const express = require("express");
const router = express.Router();
const db = require("../db");

// helper: pega ou cria autor
async function getOrCreateAutor(nome) {
  const [rows] = await db.query("SELECT id FROM autores WHERE nome = ? LIMIT 1", [nome]);
  if (rows.length) return rows[0].id;
  const [ins] = await db.query("INSERT INTO autores (nome) VALUES (?)", [nome]);
  return ins.insertId;
}

// helper: pega ou cria categoria
async function getOrCreateCategoria(nome) {
  const [rows] = await db.query("SELECT id FROM categorias WHERE nome = ? LIMIT 1", [nome]);
  if (rows.length) return rows[0].id;
  const [ins] = await db.query("INSERT INTO categorias (nome) VALUES (?)", [nome]);
  return ins.insertId;
}

// LISTA (para catálogo)
router.get("/", async (_req, res) => {
  const [rows] = await db.query(`
    SELECT l.*,
           a.nome AS autor_nome,
           c.nome AS categoria_nome
    FROM livros l
    JOIN autores a ON a.id = l.id_autor
    JOIN categorias c ON c.id = l.id_categoria
    ORDER BY l.id DESC
  `);
  res.json(rows);
});

// GET 1
router.get("/:id", async (req, res) => {
  const [rows] = await db.query("SELECT * FROM livros WHERE id = ?", [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: "Livro não encontrado." });
  res.json(rows[0]);
});

// CRIAR
// Aceita:
// - modo antigo: id_autor + id_categoria
// - modo novo: autor_nome + categoria_nome
router.post("/", async (req, res) => {
  try {
    let {
      titulo, descricao, imagem_url, ano_publicacao,
      id_autor, id_categoria,
      autor_nome, categoria_nome,
      quantidade_total, quantidade_disponivel
    } = req.body;

    if (!titulo) return res.status(400).json({ error: "Título é obrigatório." });

    quantidade_total = Number(quantidade_total ?? 1);
    quantidade_disponivel = Number(quantidade_disponivel ?? quantidade_total);

    if (!id_autor) {
      if (!autor_nome) return res.status(400).json({ error: "Informe autor (nome)." });
      id_autor = await getOrCreateAutor(String(autor_nome).trim());
    }

    if (!id_categoria) {
      if (!categoria_nome) return res.status(400).json({ error: "Informe categoria (nome)." });
      id_categoria = await getOrCreateCategoria(String(categoria_nome).trim());
    }

    await db.query(
      `INSERT INTO livros 
        (titulo, descricao, imagem_url, ano_publicacao, id_autor, id_categoria, quantidade_total, quantidade_disponivel)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        titulo,
        descricao || null,
        imagem_url || null,
        ano_publicacao ? Number(ano_publicacao) : null,
        Number(id_autor),
        Number(id_categoria),
        quantidade_total,
        quantidade_disponivel
      ]
    );

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar livro." });
  }
});

// EDITAR
router.put("/:id", async (req, res) => {
  try {
    let {
      titulo, descricao, imagem_url, ano_publicacao,
      id_autor, id_categoria,
      autor_nome, categoria_nome,
      quantidade_total, quantidade_disponivel
    } = req.body;

    if (!titulo) return res.status(400).json({ error: "Título é obrigatório." });

    if (!id_autor && autor_nome) id_autor = await getOrCreateAutor(String(autor_nome).trim());
    if (!id_categoria && categoria_nome) id_categoria = await getOrCreateCategoria(String(categoria_nome).trim());

    await db.query(
      `UPDATE livros SET
        titulo=?,
        descricao=?,
        imagem_url=?,
        ano_publicacao=?,
        id_autor=?,
        id_categoria=?,
        quantidade_total=?,
        quantidade_disponivel=?
       WHERE id=?`,
      [
        titulo,
        descricao || null,
        imagem_url || null,
        ano_publicacao ? Number(ano_publicacao) : null,
        Number(id_autor),
        Number(id_categoria),
        Number(quantidade_total),
        Number(quantidade_disponivel),
        req.params.id
      ]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao atualizar livro." });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  await db.query("DELETE FROM livros WHERE id = ?", [req.params.id]);
  res.status(204).send();
});

module.exports = router;