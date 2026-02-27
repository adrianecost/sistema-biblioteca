const express = require("express");
const router = express.Router();
const db = require("../db");

// LISTAR (admin/biblio gerenciam, aluno pode ver as dele via front; aqui retornamos tudo)
router.get("/", async (_req, res) => {
  const [rows] = await db.query(
    `
    SELECT r.*,
           u.nome AS usuario_nome,
           u.tipo AS usuario_tipo,
           l.titulo AS livro_titulo
    FROM reservas r
    JOIN usuarios u ON u.id = r.id_usuario
    JOIN livros l   ON l.id = r.id_livro
    ORDER BY r.id DESC
    `
  );
  res.json(rows);
});

// PREVISÃO (data em que deve ficar livre, baseado no menor data_prevista_devolucao)
router.get("/previsao/:idLivro", async (req, res) => {
  const idLivro = Number(req.params.idLivro);

  const [[livro]] = await db.query(
    "SELECT id, quantidade_disponivel, quantidade_total FROM livros WHERE id = ?",
    [idLivro]
  );
  if (!livro) return res.status(404).json({ error: "Livro não encontrado." });

  const [[prev]] = await db.query(
    `
    SELECT MIN(data_prevista_devolucao) AS proxima_data_prevista
    FROM emprestimos
    WHERE id_livro = ?
      AND status <> 'DEVOLVIDO'
    `,
    [idLivro]
  );

  res.json({
    quantidade_disponivel: livro.quantidade_disponivel,
    quantidade_total: livro.quantidade_total,
    proxima_data_prevista: prev?.proxima_data_prevista
      ? String(prev.proxima_data_prevista).slice(0, 10)
      : null
  });
});

// CRIAR (fila) — SOMENTE ALUNO pode criar reserva
router.post("/", async (req, res) => {
  try {
    const { id_usuario, id_livro } = req.body;

    if (!id_usuario || !id_livro) {
      return res.status(400).json({ error: "id_usuario e id_livro são obrigatórios." });
    }

    // ✅ Regra: só ALUNO pode reservar
    const [[u]] = await db.query("SELECT id, tipo FROM usuarios WHERE id = ?", [id_usuario]);
    if (!u) return res.status(404).json({ error: "Usuário não encontrado." });

    if (u.tipo !== "ALUNO") {
      return res.status(403).json({ error: "Somente ALUNO pode criar reservas." });
    }

    // Livro existe?
    const [[livro]] = await db.query(
      "SELECT id, quantidade_disponivel FROM livros WHERE id = ?",
      [id_livro]
    );
    if (!livro) return res.status(404).json({ error: "Livro não encontrado." });

    // Bloqueia duplicata ATIVA do mesmo usuário pro mesmo livro
    const [dup] = await db.query(
      `SELECT id FROM reservas
       WHERE id_usuario = ? AND id_livro = ? AND status = 'ATIVA'
       LIMIT 1`,
      [id_usuario, id_livro]
    );
    if (dup.length) {
      return res.status(409).json({ error: "Você já tem uma reserva ATIVA para este livro." });
    }

    // Se tem estoque, não faz reserva (faz empréstimo)
    if (livro.quantidade_disponivel > 0) {
      return res.status(400).json({ error: "Livro está disponível. Faça empréstimo em vez de reserva." });
    }

    await db.query(
      "INSERT INTO reservas (id_usuario, id_livro, status) VALUES (?, ?, 'ATIVA')",
      [id_usuario, id_livro]
    );

    res.status(201).json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao criar reserva." });
  }
});

// STATUS (admin/biblio vão usar isso pela interface)
router.put("/:id/status", async (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: "Status é obrigatório." });

  await db.query("UPDATE reservas SET status = ? WHERE id = ?", [status, req.params.id]);
  res.json({ ok: true });
});

// DELETE
router.delete("/:id", async (req, res) => {
  await db.query("DELETE FROM reservas WHERE id = ?", [req.params.id]);
  res.status(204).send();
});

module.exports = router;