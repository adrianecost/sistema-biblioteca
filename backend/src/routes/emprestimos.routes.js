const express = require("express");
const router = express.Router();
const db = require("../db");

function diffDays(a, b) {
  const da = new Date(a + "T00:00:00");
  const dbb = new Date(b + "T00:00:00");
  return Math.round((dbb - da) / (1000 * 60 * 60 * 24));
}

async function usuarioTemAtraso(id_usuario) {
  const [rows] = await db.query(
    `SELECT id FROM emprestimos 
     WHERE id_usuario = ? 
       AND status <> 'DEVOLVIDO'
       AND data_prevista_devolucao < CURDATE()
     LIMIT 1`,
    [id_usuario]
  );
  return rows.length > 0;
}

// LISTAR
router.get("/", async (req, res) => {
  const { id_usuario } = req.query;

  const params = [];
  let where = "";
  if (id_usuario) {
    where = "WHERE e.id_usuario = ?";
    params.push(id_usuario);
  }

  const [rows] = await db.query(
    `
    SELECT e.*,
           u.nome AS usuario_nome,
           u.tipo AS usuario_tipo,
           l.titulo AS livro_titulo
    FROM emprestimos e
    JOIN usuarios u ON u.id = e.id_usuario
    JOIN livros l   ON l.id = e.id_livro
    ${where}
    ORDER BY e.id DESC
    `,
    params
  );

  res.json(rows);
});

// CRIAR
router.post("/", async (req, res) => {
  try {
    const { id_usuario, id_livro, data_emprestimo, data_prevista_devolucao } = req.body;

    if (!id_usuario || !id_livro || !data_emprestimo || !data_prevista_devolucao) {
      return res.status(400).json({ error: "Campos obrigatórios: id_usuario, id_livro, data_emprestimo, data_prevista_devolucao" });
    }

    // pega o tipo do usuário que está tentando emprestar
    const [[u]] = await db.query("SELECT id, tipo FROM usuarios WHERE id = ?", [id_usuario]);
    if (!u) return res.status(404).json({ error: "Usuário não encontrado." });

    // Admin/Biblio NÃO emprestam pra si
    if (u.tipo === "ADMIN" || u.tipo === "BIBLIOTECARIO") {
      return res.status(403).json({ error: "Admin/Bibliotecário não fazem empréstimo para si. Eles apenas gerenciam." });
    }

    // Data prevista não pode ser antes
    if (data_prevista_devolucao < data_emprestimo) {
      return res.status(400).json({ error: "Data prevista não pode ser antes da data de empréstimo." });
    }

    // Prazo máximo 30 dias
    const days = diffDays(data_emprestimo, data_prevista_devolucao);
    if (days > 30) {
      return res.status(400).json({ error: "Prazo máximo é 30 dias por livro." });
    }

    // Bloqueio por atraso
    if (await usuarioTemAtraso(Number(id_usuario))) {
      return res.status(403).json({ error: "Usuário com empréstimo em atraso. Regularize antes de novos empréstimos." });
    }

    // Bloqueio: mesmo usuário não pode pegar o mesmo livro 2x em aberto
    const [dup] = await db.query(
      `SELECT id FROM emprestimos 
       WHERE id_usuario = ? AND id_livro = ? AND status <> 'DEVOLVIDO'
       LIMIT 1`,
      [id_usuario, id_livro]
    );
    if (dup.length) {
      return res.status(409).json({ error: "Você já está com este livro emprestado (em aberto)." });
    }

    // INSERT (trigger baixa estoque)
    await db.query(
      `INSERT INTO emprestimos (id_usuario, id_livro, data_emprestimo, data_prevista_devolucao, status)
       VALUES (?, ?, ?, ?, 'EM_ABERTO')`,
      [id_usuario, id_livro, data_emprestimo, data_prevista_devolucao]
    );

    res.status(201).json({ ok: true });
  } catch (err) {
    // Trigger: sem estoque
    if (String(err?.sqlState) === "45000") {
      return res.status(400).json({ error: err?.sqlMessage || "Livro sem estoque disponível." });
    }
    console.error(err);
    res.status(500).json({ error: "Erro ao criar empréstimo." });
  }
});

router.put("/:id/status", async (req, res) => {
  try {
    const { status, data_devolucao } = req.body;
    if (!status) return res.status(400).json({ error: "Status é obrigatório." });

    const [rows] = await db.query("SELECT data_emprestimo FROM emprestimos WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Empréstimo não encontrado." });

    const dataEmp = String(rows[0].data_emprestimo).slice(0, 10);

    if (status === "DEVOLVIDO") {
      if (!data_devolucao) return res.status(400).json({ error: "Informe data_devolucao ao marcar DEVOLVIDO." });
      if (data_devolucao < dataEmp) return res.status(400).json({ error: "Data de devolução não pode ser antes da data de empréstimo." });

      await db.query("UPDATE emprestimos SET status=?, data_devolucao=? WHERE id=?",
        [status, data_devolucao, req.params.id]
      );
    } else {
      await db.query("UPDATE emprestimos SET status=? WHERE id=?", [status, req.params.id]);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao alterar status." });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  await db.query("DELETE FROM emprestimos WHERE id = ?", [req.params.id]);
  res.status(204).send();
});

module.exports = router;