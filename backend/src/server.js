const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Rotas
app.use("/api/auth", require("./routes/auth.routes"));
app.use("/api/usuarios", require("./routes/usuarios.routes"));
app.use("/api/autores", require("./routes/autores.routes"));
app.use("/api/categorias", require("./routes/categorias.routes"));
app.use("/api/livros", require("./routes/livros.routes"));
app.use("/api/emprestimos", require("./routes/emprestimos.routes"));
app.use("/api/reservas", require("./routes/reservas.routes"));

// Healthcheck
app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = 3000;
app.listen(PORT, () => console.log(`✅ API rodando em http://localhost:${PORT}`));