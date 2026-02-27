const API = "http://127.0.0.1:3000/api";

// =======================
// LOGIN
// =======================
const user = JSON.parse(localStorage.getItem("user") || "null");
if (!user) window.location.href = "./login.html";

const ROLE = String(user.tipo || "").trim().toUpperCase();

document.querySelector("#who").textContent = `${user.nome} • ${ROLE}`;
document.querySelector("#btnLogout")?.addEventListener("click", () => {
  localStorage.removeItem("user");
  window.location.href = "./login.html";
});

// =======================
// PERMISSÕES
// =======================
const perms = {
  // Usuários: ADMIN
  canSeeUsuarios: ROLE === "ADMIN",
  canManageUsuarios: ROLE === "ADMIN",

  // Livros
  canEditLivros: ROLE === "ADMIN" || ROLE === "BIBLIOTECARIO",

  // Empréstimos
  // ALUNO cria (pra si); ADMIN/BIBLIO administram; VISITANTE não vê
  canSeeEmprestimos: ROLE === "ADMIN" || ROLE === "BIBLIOTECARIO" || ROLE === "ALUNO",
  canCreateEmprestimos: ROLE === "ALUNO",
  canManageEmprestimos: ROLE === "ADMIN" || ROLE === "BIBLIOTECARIO",

  // Reservas
  // ALUNO cria; ADMIN/BIBLIO administram; VISITANTE não vê
  canSeeReservas: ROLE === "ADMIN" || ROLE === "BIBLIOTECARIO" || ROLE === "ALUNO",
  canCreateReservas: ROLE === "ALUNO",
  canManageReservas: ROLE === "ADMIN" || ROLE === "BIBLIOTECARIO",

  isVisitante: ROLE === "VISITANTE",
};

// =======================
// ESCONDER ABAS
// =======================
if (!perms.canSeeUsuarios) document.querySelector("#tab-usuarios")?.closest("li")?.remove();
if (!perms.canSeeEmprestimos) document.querySelector("#tab-emprestimos")?.closest("li")?.remove();
if (!perms.canSeeReservas) document.querySelector("#tab-reservas")?.closest("li")?.remove();

// =======================
// UI
// =======================
const tabs = document.querySelectorAll("#tabs .nav-link");
const btnNovo = document.querySelector("#btnNovo");
const btnReload = document.querySelector("#btnReload");
const statusEl = document.querySelector("#status");
const content = document.querySelector("#content");

const modalEl = document.querySelector("#modal");
const modal = new bootstrap.Modal(modalEl);
const form = document.querySelector("#form");
const modalTitle = document.querySelector("#modalTitle");
const modalBody = document.querySelector("#modalBody");

let currentTab = "livros";
let cache = { autores: [], categorias: [], usuarios: [], livros: [] };

// Guardar “hoje” com base no horário do servidor (header Date)
let SERVER_NOW = null;

// Cache rápido para regras do aluno
let alunoCtx = {
  loaded: false,
  userId: null,
  hasActiveLoan: false,     // tem empréstimo EM_ABERTO/ATRASADO
  hasOverdue: false,        // tem atraso (1 dia já) -> bloqueia emprestar e reservar
  activeLoanBookIds: new Set(),  // livros em empréstimo não devolvido
  activeReserveBookIds: new Set()// reservas ATIVAS do aluno
};

function setStatus(msg) { statusEl.textContent = msg || ""; }

async function fetchJSON(url, options) {
  const res = await fetch(url, options);
  const dateHdr = res.headers.get("Date");
  if (dateHdr) SERVER_NOW = new Date(dateHdr);

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}

  if (!res.ok) {
    const msg = data?.error || text || `Erro ${res.status}`;
    throw new Error(`${msg}  (URL: ${url})`);
  }
  return data;
}

async function preloadBasics() {
  // ⚠️ Não pedir /usuarios se não for ADMIN, porque teu backend pode bloquear
  const promises = [
    fetchJSON(`${API}/autores`).catch(() => []),
    fetchJSON(`${API}/categorias`).catch(() => []),
    fetchJSON(`${API}/livros`).catch(() => []),
  ];

  if (perms.canSeeUsuarios) {
    promises.push(fetchJSON(`${API}/usuarios`).catch(() => []));
  } else {
    promises.push(Promise.resolve([]));
  }

  const [autores, categorias, livros, usuarios] = await Promise.all(promises);
  cache.autores = autores || [];
  cache.categorias = categorias || [];
  cache.livros = livros || [];
  cache.usuarios = usuarios || [];
}

function formatDateBR(yyyyMMdd) {
  if (!yyyyMMdd) return "";
  const s = String(yyyyMMdd).slice(0, 10);
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return s;
  return `${d}/${m}/${y}`;
}

function toISODate(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getServerTodayDate() {
  const d = SERVER_NOW ? new Date(SERVER_NOW) : new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(a, b) {
  // diferença em dias inteiros (b - a)
  const ms = 1000 * 60 * 60 * 24;
  const da = new Date(a); da.setHours(0,0,0,0);
  const db = new Date(b); db.setHours(0,0,0,0);
  return Math.floor((db - da) / ms);
}

function isOverdue(dataPrevista, status, refDate = getServerTodayDate()) {
  if (!dataPrevista) return false;
  if (status === "DEVOLVIDO") return false;
  const prev = new Date(String(dataPrevista).slice(0, 10) + "T00:00:00");
  const diff = daysBetween(prev, refDate); // >0 se passou do prazo
  return diff > 0;
}

// Multa com tolerância até 30 dias (0–30 = 0; 31–60=1; 61–90=2...)
function calcFineBRL(dataPrevista, status, refDate = getServerTodayDate()) {
  if (!dataPrevista) return 0;
  if (status === "DEVOLVIDO") return 0;

  const prev = new Date(String(dataPrevista).slice(0, 10) + "T00:00:00");
  const daysLate = daysBetween(prev, refDate); // 1..n
  if (daysLate <= 0) return 0;

  // tolerância 30 dias
  if (daysLate <= 30) return 0;

  // 31-60 => 1; 61-90 =>2 ...
  return Math.floor((daysLate - 1) / 30);
}

async function getCurrentUserId() {
  if (user?.id) return Number(user.id);

  // tenta achar pelo email (precisa /usuarios)
  if (!perms.canSeeUsuarios) {
    // fallback: tenta bater num endpoint que retorne o user no login, mas aqui não temos.
    throw new Error("Seu login não trouxe o ID do usuário. Faça login novamente (ou rode como ADMIN para depurar).");
  }

  await preloadBasics();
  const u = cache.usuarios.find(x => String(x.email).toLowerCase() === String(user.email || "").toLowerCase());
  if (!u) throw new Error("Não consegui identificar seu usuário (id). Faça login novamente.");
  return Number(u.id);
}

async function loadAlunoContextIfNeeded() {
  if (ROLE !== "ALUNO") return;

  // sempre recalcula porque o tempo passa e muda atraso/multa
  const myId = await getCurrentUserId();
  alunoCtx.userId = myId;

  const ref = getServerTodayDate();

  // pega empréstimos e reservas do servidor
  const [allEmp, allRes] = await Promise.all([
    fetchJSON(`${API}/emprestimos`).catch(() => []),
    fetchJSON(`${API}/reservas`).catch(() => []),
  ]);

  const meusEmp = (allEmp || []).filter(e => Number(e.id_usuario) === myId);
  const meusRes = (allRes || []).filter(r => Number(r.id_usuario) === myId);

  alunoCtx.activeLoanBookIds = new Set(
    meusEmp.filter(e => e.status !== "DEVOLVIDO").map(e => Number(e.id_livro))
  );

  alunoCtx.activeReserveBookIds = new Set(
    meusRes.filter(r => String(r.status).toUpperCase() === "ATIVA").map(r => Number(r.id_livro))
  );

  // 1 livro por vez: se tem algum EM_ABERTO/ATRASADO já conta como ativo
  alunoCtx.hasActiveLoan = meusEmp.some(e => e.status !== "DEVOLVIDO");

  // atraso 1 dia já bloqueia (qualquer overdue)
  alunoCtx.hasOverdue = meusEmp.some(e => isOverdue(e.data_prevista_devolucao, e.status, ref));

  alunoCtx.loaded = true;
}

function showAlunoBlockBannerIfNeeded() {
  if (ROLE !== "ALUNO") return;

  if (alunoCtx.hasOverdue) {
    // alerta “devolução pendente”
    // (não spam: só uma vez por render de aba)
    setTimeout(() => {
      alert("Devolução pendente: Regularize para liberar novas funções (empréstimo/reserva).");
    }, 50);
  }
}

// =======================
// Botão +Novo visibilidade
// =======================
function applyNovoVisibility() {
  let show = true;

  if (currentTab === "livros" && !perms.canEditLivros) show = false;
  if (currentTab === "usuarios" && !perms.canManageUsuarios) show = false;

  // 🔥 Empréstimos: +Novo só para ALUNO
  if (currentTab === "emprestimos" && !perms.canCreateEmprestimos) show = false;

  // Reservas: +Novo só para ALUNO
  if (currentTab === "reservas" && !perms.canCreateReservas) show = false;

  btnNovo.style.display = show ? "" : "none";
}

function setActiveTab(tab) {
  const exists = [...tabs].some(b => b.dataset.tab === tab);
  currentTab = exists ? tab : "livros";
  tabs.forEach(b => b.classList.toggle("active", b.dataset.tab === currentTab));
  applyNovoVisibility();
  loadTab();
}

tabs.forEach(b => b.addEventListener("click", () => setActiveTab(b.dataset.tab)));
btnReload.addEventListener("click", loadTab);
btnNovo.addEventListener("click", openCreateModal);

// =======================
// RENDER
// =======================
async function renderLivrosCatalogo() {
  await preloadBasics();
  await loadAlunoContextIfNeeded();

  const livros = cache.livros;

  const previsoes = {};
  await Promise.all(livros.map(async (l) => {
    try {
      previsoes[l.id] = await fetchJSON(`${API}/reservas/previsao/${l.id}`);
    } catch {
      previsoes[l.id] = null;
    }
  }));

  // Se aluno estiver bloqueado por atraso, avisar
  showAlunoBlockBannerIfNeeded();

  content.innerHTML = `
    <div class="row g-3">
      ${livros.map(l => {
        const p = previsoes[l.id];
        const disp = `${l.quantidade_disponivel}/${l.quantidade_total}`;

        let badge = `<span class="badge text-bg-success">Disponível</span>`;
        let extra = "";
        if (l.quantidade_disponivel <= 0) {
          badge = `<span class="badge text-bg-warning">Sem estoque</span>`;
          extra = p?.proxima_data_prevista
            ? `<div class="small text-muted mt-1">Próxima devolução prevista: <b>${formatDateBR(p.proxima_data_prevista)}</b></div>`
            : `<div class="small text-muted mt-1">Sem previsão registrada.</div>`;
        }

        const img = l.imagem_url
          ? `<img src="${l.imagem_url}" alt="capa" style="width:100%;height:220px;object-fit:cover;border-radius:14px;border:1px solid #cfe9db;">`
          : `<div style="width:100%;height:220px;border-radius:14px;border:1px dashed #9dbfae;display:flex;align-items:center;justify-content:center;color:#2b5a41;">Sem imagem</div>`;

        const sinopse = (l.descricao || "").trim() || "Sem sinopse cadastrada.";
        const sinopseCurta = sinopse.length > 140 ? sinopse.slice(0, 140) + "..." : sinopse;

        // AÇÕES POR PERFIL
        let actions = "";

        if (perms.isVisitante) {
          actions = `<span class="text-muted small">Consulta do acervo (sem empréstimo e sem reserva).</span>`;
        } else if (ROLE === "ALUNO") {
          const livroId = Number(l.id);
          const alunoBloqueado = alunoCtx.hasOverdue;

          const jaTemEsseLivroEmprestado = alunoCtx.activeLoanBookIds.has(livroId);
          const jaTemReservaAtiva = alunoCtx.activeReserveBookIds.has(livroId);

          // regra: 1 livro por vez
          const jaTemAlgumEmprestimoAtivo = alunoCtx.hasActiveLoan;

          // Emprestar: só se não estiver bloqueado, não tiver empréstimo ativo, e houver estoque
          const canEmprestar =
            !alunoBloqueado &&
            !jaTemAlgumEmprestimoAtivo &&
            l.quantidade_disponivel > 0;

          // Reservar: só se não estiver bloqueado, NÃO tiver esse livro emprestado, e o livro estiver sem estoque,
          // e não tiver reserva ativa duplicada.
          const canReservar =
            !alunoBloqueado &&
            !jaTemEsseLivroEmprestado &&
            !jaTemReservaAtiva &&
            l.quantidade_disponivel <= 0;

          // mensagens de bloqueio (bem claras)
          const hints = [];
          if (alunoBloqueado) hints.push("Bloqueado por atraso.");
          if (jaTemAlgumEmprestimoAtivo) hints.push("Regra: 1 livro por vez.");
          if (jaTemEsseLivroEmprestado) hints.push("Você já está com este livro.");
          if (jaTemReservaAtiva) hints.push("Você já tem reserva ATIVA deste livro.");
          if (l.quantidade_disponivel > 0) hints.push("Disponível: reserve só quando não há estoque.");

          actions += canEmprestar
            ? `<button class="btn btn-sm btn-outline-primary" data-action="emprestar" data-id="${l.id}">Emprestar</button> `
            : `<button class="btn btn-sm btn-outline-primary" disabled title="${hints.join(" ")}">Emprestar</button> `;

          actions += canReservar
            ? `<button class="btn btn-sm btn-outline-success" data-action="reservar" data-id="${l.id}">Reservar</button> `
            : `<button class="btn btn-sm btn-outline-success" disabled title="${hints.join(" ")}">Reservar</button> `;

          // dica visual
          if (hints.length) {
            actions += `<div class="small text-muted mt-1">${hints.join(" • ")}</div>`;
          }

        } else {
          actions = `<span class="text-muted small">Gestão feita pelas abas Empréstimos/Reservas.</span>`;
          if (perms.canEditLivros) {
            actions += ` <button class="btn btn-sm btn-outline-secondary" data-action="editLivro" data-id="${l.id}">Editar</button>`;
            actions += ` <button class="btn btn-sm btn-outline-danger" data-action="delLivro" data-id="${l.id}">Excluir</button>`;
          }
        }

        return `
          <div class="col-12 col-md-6 col-lg-4">
            <div class="card border-0 shadow-sm" style="border-radius:18px;">
              <div class="p-3">${img}</div>
              <div class="card-body pt-0">
                <div class="d-flex justify-content-between align-items-start gap-2">
                  <div>
                    <h5 class="mb-1">${l.titulo}</h5>
                    <div class="text-muted small">${l.autor_nome} • ${l.categoria_nome}</div>
                    <div class="text-muted small">Disponibilidade: <b>${disp}</b></div>
                  </div>
                  <div class="text-end">
                    ${badge}
                    ${extra}
                  </div>
                </div>
                <p class="mt-2 mb-3">${sinopseCurta}</p>
                <div class="d-flex flex-column gap-1">
                  <div class="d-flex gap-2 flex-wrap">
                    ${actions}
                  </div>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;

  setStatus(`Livros: ${livros.length}`);
}

async function renderUsuarios() {
  if (!perms.canSeeUsuarios) {
    content.innerHTML = `<div class="alert alert-warning">Sem permissão.</div>`;
    setStatus("");
    return;
  }

  const rows = await fetchJSON(`${API}/usuarios`);
  content.innerHTML = `
    <div class="table-responsive">
      <table class="table table-striped align-middle">
        <thead>
          <tr><th>ID</th><th>Nome</th><th>Email</th><th>Tipo</th><th>Criado em</th><th style="width:220px">Ações</th></tr>
        </thead>
        <tbody>
          ${rows.map(u => `
            <tr>
              <td>${u.id}</td>
              <td>${u.nome}</td>
              <td>${u.email}</td>
              <td>${u.tipo}</td>
              <td>${new Date(u.data_criacao).toLocaleString()}</td>
              <td>
                <button class="btn btn-sm btn-outline-primary" data-action="editUser" data-id="${u.id}">Editar</button>
                <button class="btn btn-sm btn-outline-danger" data-action="delUser" data-id="${u.id}">Excluir</button>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
  setStatus(`Usuários: ${rows.length}`);
}

async function renderEmprestimos() {
  if (!perms.canSeeEmprestimos) {
    content.innerHTML = `<div class="alert alert-warning">Sem permissão.</div>`;
    setStatus("");
    return;
  }

  const all = await fetchJSON(`${API}/emprestimos`);
  const ref = getServerTodayDate();

  let rows = all || [];
  if (ROLE === "ALUNO") {
    await loadAlunoContextIfNeeded();
    rows = rows.filter(e => Number(e.id_usuario) === alunoCtx.userId);
  }

  const showActions = perms.canManageEmprestimos;

  content.innerHTML = `
    <div class="table-responsive">
      <table class="table table-striped align-middle">
        <thead>
          <tr>
            <th>ID</th>
            ${ROLE === "ALUNO" ? "" : "<th>Usuário</th>"}
            <th>Livro</th>
            <th>Empréstimo</th>
            <th>Prev.</th>
            <th>Devolução</th>
            <th>Status</th>
            <th>Multa</th>
            ${showActions ? `<th style="width:260px">Ações</th>` : ""}
          </tr>
        </thead>
        <tbody>
          ${rows.map(e => {
            const atrasado = isOverdue(e.data_prevista_devolucao, e.status, ref);
            const multa = calcFineBRL(e.data_prevista_devolucao, e.status, ref);
            return `
              <tr>
                <td>${e.id}</td>
                ${ROLE === "ALUNO" ? "" : `<td>${e.usuario_nome}</td>`}
                <td>${e.livro_titulo}</td>
                <td>${formatDateBR(e.data_emprestimo)}</td>
                <td>${formatDateBR(e.data_prevista_devolucao)}</td>
                <td>${e.data_devolucao ? formatDateBR(e.data_devolucao) : ""}</td>
                <td>${atrasado ? "<span class='badge text-bg-danger'>ATRASADO</span>" : e.status}</td>
                <td>${multa > 0 ? `R$ ${multa},00` : "R$ 0,00"}</td>
                ${showActions ? `
                  <td>
                    <button class="btn btn-sm btn-outline-primary" data-action="statusEmp" data-id="${e.id}">Alterar status</button>
                    <button class="btn btn-sm btn-outline-danger" data-action="delEmp" data-id="${e.id}">Excluir</button>
                  </td>
                ` : ""}
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
  `;
  setStatus(`Empréstimos: ${rows.length}`);
}

async function renderReservas() {
  if (!perms.canSeeReservas) {
    content.innerHTML = `<div class="alert alert-warning">Sem permissão.</div>`;
    setStatus("");
    return;
  }

  const all = await fetchJSON(`${API}/reservas`);
  let rows = all || [];

  if (ROLE === "ALUNO") {
    await loadAlunoContextIfNeeded();
    rows = rows.filter(r => Number(r.id_usuario) === alunoCtx.userId);
  }

  const showActions = perms.canManageReservas;

  content.innerHTML = `
    <div class="table-responsive">
      <table class="table table-striped align-middle">
        <thead>
          <tr>
            <th>ID</th>
            ${ROLE === "ALUNO" ? "" : "<th>Usuário</th>"}
            <th>Livro</th>
            <th>Data</th>
            <th>Status</th>
            ${showActions ? `<th style="width:260px">Ações</th>` : ""}
          </tr>
        </thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td>${r.id}</td>
              ${ROLE === "ALUNO" ? "" : `<td>${r.usuario_nome}</td>`}
              <td>${r.livro_titulo}</td>
              <td>${new Date(r.data_reserva).toLocaleString()}</td>
              <td>${r.status}</td>
              ${showActions ? `
                <td>
                  <button class="btn btn-sm btn-outline-primary" data-action="statusRes" data-id="${r.id}">Alterar status</button>
                  <button class="btn btn-sm btn-outline-danger" data-action="delRes" data-id="${r.id}">Excluir</button>
                </td>
              ` : ""}
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
  setStatus(`Reservas: ${rows.length}`);
}

async function loadTab() {
  try {
    setStatus("Carregando...");
    if (currentTab === "livros") return await renderLivrosCatalogo();
    if (currentTab === "usuarios") return await renderUsuarios();
    if (currentTab === "emprestimos") return await renderEmprestimos();
    if (currentTab === "reservas") return await renderReservas();
  } catch (e) {
    setStatus("");
    alert(e.message);
  }
}

// =======================
// BOTÃO NOVO
// =======================
function openCreateModal() {
  if (currentTab === "livros") return openNovoLivroModal();
  if (currentTab === "emprestimos") return openNovoEmprestimoModal();
  if (currentTab === "reservas") return openNovaReservaModal();
  if (currentTab === "usuarios") return openNovoUsuarioModal();
}

function formToObj() {
  return Object.fromEntries(new FormData(form).entries());
}

// =======================
// MODAIS
// =======================
async function openNovoLivroModal() {
  if (!perms.canEditLivros) return alert("Você não tem permissão para cadastrar livros.");

  modalTitle.textContent = "Novo Livro";

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const obj = formToObj();
    try {
      obj.quantidade_total = Number(obj.quantidade_total);
      obj.quantidade_disponivel = Number(obj.quantidade_disponivel);
      obj.ano_publicacao = obj.ano_publicacao ? Number(obj.ano_publicacao) : null;

      obj.autor_nome = (obj.autor_nome || "").trim();
      obj.categoria_nome = (obj.categoria_nome || "").trim();
      if (!obj.autor_nome) throw new Error("Informe o autor (nome).");
      if (!obj.categoria_nome) throw new Error("Informe a categoria (nome).");

      await fetchJSON(`${API}/livros`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(obj)
      });

      modal.hide();
      await loadTab();
    } catch (e2) {
      alert(e2.message);
    }
  };

  modalBody.innerHTML = `
    <div class="row g-3">
      <div class="col-md-8">
        <label class="form-label">Título</label>
        <input class="form-control" name="titulo" required />
      </div>
      <div class="col-md-4">
        <label class="form-label">Ano</label>
        <input class="form-control" name="ano_publicacao" type="number" />
      </div>

      <div class="col-md-6">
        <label class="form-label">Autor (digite)</label>
        <input class="form-control" name="autor_nome" placeholder="Ex: Clarice Lispector" required />
      </div>

      <div class="col-md-6">
        <label class="form-label">Categoria (digite)</label>
        <input class="form-control" name="categoria_nome" placeholder="Ex: Romance" required />
      </div>

      <div class="col-md-6">
        <label class="form-label">Qtd Total</label>
        <input class="form-control" name="quantidade_total" type="number" value="1" min="1" />
      </div>

      <div class="col-md-6">
        <label class="form-label">Qtd Disponível</label>
        <input class="form-control" name="quantidade_disponivel" type="number" value="1" min="0" />
      </div>

      <div class="col-12">
        <label class="form-label">Imagem (URL)</label>
        <input class="form-control" name="imagem_url" placeholder="https://..." />
      </div>

      <div class="col-12">
        <label class="form-label">Sinopse</label>
        <textarea class="form-control" name="descricao" rows="4"></textarea>
      </div>
    </div>
  `;

  modal.show();
}

async function openNovoEmprestimoModal(idLivroPreSelecionado = null) {
  if (!perms.canCreateEmprestimos) return alert("Sem permissão para empréstimos.");
  if (perms.isVisitante) return alert("Visitante não pode emprestar.");

  await preloadBasics();
  await loadAlunoContextIfNeeded();

  // BLOQUEIOS DO ALUNO
  if (alunoCtx.hasOverdue) {
    return alert("Devolução pendente: Regularize para liberar novas funções (empréstimo/reserva).");
  }
  if (alunoCtx.hasActiveLoan) {
    return alert("Regra: o aluno só pode ter 1 livro por vez. Você já tem um empréstimo ativo.");
  }

  modalTitle.textContent = "Novo Empréstimo";

  const currentUserId = alunoCtx.userId;

  const userField = `
    <input class="form-control" value="${user.nome} (ALUNO)" disabled />
    <input type="hidden" name="id_usuario" value="${currentUserId}" />
  `;

  // prazo 30 dias e também max no calendário
  const hoje = getServerTodayDate();
  const prev = new Date(hoje);
  prev.setDate(prev.getDate() + 30);

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const obj = formToObj();
    try {
      obj.id_usuario = Number(obj.id_usuario);
      obj.id_livro = Number(obj.id_livro);

      // não pode emprestar se usuário já tem esse livro em empréstimo (dupla segurança)
      if (alunoCtx.activeLoanBookIds.has(obj.id_livro)) {
        throw new Error("Você já está com este livro emprestado.");
      }

      // valida datas: prevista >= emprestimo e <= emprestimo + 30
      if (obj.data_prevista_devolucao < obj.data_emprestimo) {
        throw new Error("A data prevista não pode ser antes da data de empréstimo.");
      }
      const dEmp = new Date(obj.data_emprestimo + "T00:00:00");
      const dPrev = new Date(obj.data_prevista_devolucao + "T00:00:00");
      const maxPrev = new Date(dEmp);
      maxPrev.setDate(maxPrev.getDate() + 30);
      if (dPrev > maxPrev) {
        throw new Error("Prazo máximo: 30 dias. Ajuste a data prevista.");
      }

      await fetchJSON(`${API}/emprestimos`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(obj)
      });

      // atualiza contexto
      alunoCtx.loaded = false;

      modal.hide();
      await loadTab();
    } catch (e2) {
      alert(e2.message);
    }
  };

  modalBody.innerHTML = `
    <div class="row g-3">
      <div class="col-md-6">
        <label class="form-label">Usuário</label>
        ${userField}
      </div>
      <div class="col-md-6">
        <label class="form-label">Livro</label>
        <select class="form-select" id="selLivroEmp" name="id_livro" required>
          ${cache.livros.map(l => `<option value="${l.id}">${l.titulo} [disp:${l.quantidade_disponivel}]</option>`).join("")}
        </select>
        <div class="form-text">Obs: empréstimo só se houver estoque.</div>
      </div>
      <div class="col-md-6">
        <label class="form-label">Data empréstimo</label>
        <input class="form-control" id="dataEmp" name="data_emprestimo" type="date" required value="${toISODate(hoje)}" />
      </div>
      <div class="col-md-6">
        <label class="form-label">Data prevista devolução (máx 30 dias)</label>
        <input class="form-control" id="dataPrev" name="data_prevista_devolucao" type="date"
               required value="${toISODate(prev)}"
               min="${toISODate(hoje)}"
               max="${toISODate(prev)}" />
      </div>
    </div>
  `;

  modal.show();

  setTimeout(() => {
    const sel = document.querySelector("#selLivroEmp");
    if (idLivroPreSelecionado) sel.value = String(idLivroPreSelecionado);

    const empEl = document.querySelector("#dataEmp");
    const prevEl = document.querySelector("#dataPrev");

    const syncMax = () => {
      const emp = new Date(empEl.value + "T00:00:00");
      const max = new Date(emp);
      max.setDate(max.getDate() + 30);

      prevEl.min = empEl.value;
      prevEl.max = toISODate(max);

      // se estava fora, corrige
      const chosen = new Date(prevEl.value + "T00:00:00");
      if (chosen < emp) prevEl.value = empEl.value;
      if (chosen > max) prevEl.value = toISODate(max);
    };

    empEl.addEventListener("change", syncMax);
    syncMax();
  }, 0);
}

async function openNovaReservaModal(idLivroPreSelecionado = null) {
  if (!perms.canCreateReservas) return alert("Sem permissão para reservas.");
  if (perms.isVisitante) return alert("Visitante não pode reservar.");

  await preloadBasics();
  await loadAlunoContextIfNeeded();

  // BLOQUEIO: atraso bloqueia tudo
  if (alunoCtx.hasOverdue) {
    return alert("Devolução pendente: Regularize para liberar novas funções (empréstimo/reserva).");
  }

  const currentUserId = alunoCtx.userId;

  modalTitle.textContent = "Nova Reserva";

  const userField = `
    <input class="form-control" value="${user.nome} (ALUNO)" disabled />
    <input type="hidden" name="id_usuario" value="${currentUserId}" />
  `;

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const obj = formToObj();
    try {
      obj.id_usuario = Number(obj.id_usuario);
      obj.id_livro = Number(obj.id_livro);

      // REGRA: aluno não pode reservar o mesmo livro que já está com ele
      if (alunoCtx.activeLoanBookIds.has(obj.id_livro)) {
        throw new Error("Você já está com este livro emprestado. Não é permitido reservar o mesmo livro.");
      }

      // REGRA: não pode duplicar reserva ativa
      if (alunoCtx.activeReserveBookIds.has(obj.id_livro)) {
        throw new Error("Você já tem uma reserva ATIVA deste livro.");
      }

      // REGRA: reserva só quando não há estoque (fila)
      const livro = cache.livros.find(x => Number(x.id) === Number(obj.id_livro));
      if (livro && Number(livro.quantidade_disponivel) > 0) {
        throw new Error("Livro disponível agora. Use Empréstimo (reserva é para fila quando não há estoque).");
      }

      await fetchJSON(`${API}/reservas`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(obj)
      });

      // atualiza contexto
      alunoCtx.loaded = false;

      modal.hide();
      await loadTab();
    } catch (e2) {
      alert(e2.message);
    }
  };

  modalBody.innerHTML = `
    <div class="row g-3">
      <div class="col-md-6">
        <label class="form-label">Usuário</label>
        ${userField}
      </div>
      <div class="col-md-6">
        <label class="form-label">Livro</label>
        <select class="form-select" id="selLivroRes" name="id_livro" required>
          ${cache.livros.map(l => `<option value="${l.id}">${l.titulo} [disp:${l.quantidade_disponivel}]</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="alert alert-warning mt-3 mb-0" id="previsaoBox">Selecione um livro para ver a previsão.</div>
  `;

  modal.show();

  setTimeout(() => {
    const sel = document.querySelector("#selLivroRes");
    const box = document.querySelector("#previsaoBox");
    if (idLivroPreSelecionado) sel.value = String(idLivroPreSelecionado);

    const atualizar = async () => {
      const livroId = Number(sel.value);

      // regra: se ele já está com o livro, aviso direto
      if (alunoCtx.activeLoanBookIds.has(livroId)) {
        box.className = "alert alert-danger mt-3 mb-0";
        box.textContent = "Bloqueado: você já está com este livro emprestado. Não pode reservar o mesmo livro.";
        return;
      }

      const p = await fetchJSON(`${API}/reservas/previsao/${sel.value}`);
      if (p.quantidade_disponivel > 0) {
        box.className = "alert alert-success mt-3 mb-0";
        box.textContent = "Livro disponível agora. Reserva não é necessária (use empréstimo).";
      } else {
        box.className = "alert alert-warning mt-3 mb-0";
        box.textContent = p.proxima_data_prevista
          ? `Sem estoque. Próxima devolução prevista: ${formatDateBR(p.proxima_data_prevista)}`
          : "Sem estoque. Sem previsão registrada.";
      }
    };

    sel.addEventListener("change", atualizar);
    atualizar();
  }, 0);
}

async function openNovoUsuarioModal() {
  if (!perms.canManageUsuarios) return alert("Somente ADMIN pode criar usuários por aqui.");

  modalTitle.textContent = "Novo Usuário";

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const obj = formToObj();
    try {
      await fetchJSON(`${API}/usuarios`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(obj)
      });
      modal.hide();
      await loadTab();
    } catch (e2) {
      alert(e2.message);
    }
  };

  modalBody.innerHTML = `
    <div class="row g-3">
      <div class="col-md-6">
        <label class="form-label">Nome</label>
        <input class="form-control" name="nome" required />
      </div>
      <div class="col-md-6">
        <label class="form-label">Email</label>
        <input class="form-control" name="email" type="email" required />
      </div>
      <div class="col-md-6">
        <label class="form-label">Senha</label>
        <input class="form-control" name="senha" required />
      </div>
      <div class="col-md-6">
        <label class="form-label">Tipo</label>
        <select class="form-select" name="tipo" required>
          <option>ADMIN</option>
          <option>BIBLIOTECARIO</option>
          <option>ALUNO</option>
          <option>VISITANTE</option>
        </select>
      </div>
    </div>
  `;
  modal.show();
}

// =======================
// Editar usuário (ADMIN) - simples para apresentação
// =======================
async function openEditUsuarioModal(id) {
  if (!perms.canManageUsuarios) return alert("Sem permissão.");

  const rows = await fetchJSON(`${API}/usuarios`);
  const u = (rows || []).find(x => Number(x.id) === Number(id));
  if (!u) return alert("Usuário não encontrado.");

  modalTitle.textContent = `Editar Usuário #${id}`;

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const obj = formToObj();
    try {
      await fetchJSON(`${API}/usuarios/${id}`, { method: "DELETE" });
      await fetchJSON(`${API}/usuarios`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(obj)
      });

      modal.hide();
      await loadTab();
    } catch (e2) {
      alert(e2.message);
    }
  };

  modalBody.innerHTML = `
    <div class="row g-3">
      <div class="col-md-6">
        <label class="form-label">Nome</label>
        <input class="form-control" name="nome" required value="${u.nome}" />
      </div>
      <div class="col-md-6">
        <label class="form-label">Email</label>
        <input class="form-control" name="email" type="email" required value="${u.email}" />
      </div>
      <div class="col-md-6">
        <label class="form-label">Senha (nova)</label>
        <input class="form-control" name="senha" required placeholder="Digite uma nova senha" />
      </div>
      <div class="col-md-6">
        <label class="form-label">Tipo</label>
        <select class="form-select" name="tipo" required>
          <option ${u.tipo === "ADMIN" ? "selected" : ""}>ADMIN</option>
          <option ${u.tipo === "BIBLIOTECARIO" ? "selected" : ""}>BIBLIOTECARIO</option>
          <option ${u.tipo === "ALUNO" ? "selected" : ""}>ALUNO</option>
          <option ${u.tipo === "VISITANTE" ? "selected" : ""}>VISITANTE</option>
        </select>
      </div>
      <div class="col-12">
        <div class="alert alert-warning mb-0">
          Obs: nesta versão, "editar" recria o registro (DELETE + POST). Para apresentação do CRUD, funciona.
        </div>
      </div>
    </div>
  `;
  modal.show();
}

// =======================
// AÇÕES NOS BOTÕES
// =======================
content.addEventListener("click", async (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = Number(btn.dataset.id);

  try {
    if (action === "emprestar") return openNovoEmprestimoModal(id);
    if (action === "reservar") return openNovaReservaModal(id);

    if (action === "editLivro") {
      if (!perms.canEditLivros) return alert("Sem permissão.");
      await preloadBasics();
      return openEditLivroModal(id);
    }

    if (action === "delLivro") {
      if (!perms.canEditLivros) return alert("Sem permissão.");
      if (!confirm("Excluir este livro?")) return;
      await fetchJSON(`${API}/livros/${id}`, { method: "DELETE" });
      return loadTab();
    }

    if (action === "statusEmp") {
      if (!perms.canManageEmprestimos) return alert("Apenas Bibliotecário/Admin pode alterar status.");
      return openStatusEmprestimoModal(id);
    }

    if (action === "delEmp") {
      if (!perms.canManageEmprestimos) return alert("Apenas Bibliotecário/Admin pode excluir empréstimo.");
      if (!confirm("Excluir este empréstimo?")) return;
      await fetchJSON(`${API}/emprestimos/${id}`, { method: "DELETE" });
      return loadTab();
    }

    if (action === "statusRes") {
      if (!perms.canManageReservas) return alert("Apenas Bibliotecário/Admin pode gerenciar reservas.");
      return openStatusReservaModal(id);
    }

    if (action === "delRes") {
      if (!perms.canManageReservas) return alert("Apenas Bibliotecário/Admin pode excluir reserva.");
      if (!confirm("Excluir esta reserva?")) return;
      await fetchJSON(`${API}/reservas/${id}`, { method: "DELETE" });
      return loadTab();
    }

    if (action === "delUser") {
      if (!perms.canManageUsuarios) return alert("Sem permissão.");
      if (!confirm("Excluir este usuário?")) return;
      await fetchJSON(`${API}/usuarios/${id}`, { method: "DELETE" });
      return loadTab();
    }

    if (action === "editUser") {
      if (!perms.canManageUsuarios) return alert("Sem permissão.");
      return openEditUsuarioModal(id);
    }
  } catch (err) {
    alert(err.message);
  }
});

// =======================
// EDIT LIVRO
// =======================
async function openEditLivroModal(id) {
  const l = await fetchJSON(`${API}/livros/${id}`);

  modalTitle.textContent = `Editar Livro #${id}`;

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const obj = formToObj();
    try {
      obj.id_autor = Number(obj.id_autor);
      obj.id_categoria = Number(obj.id_categoria);
      obj.quantidade_total = Number(obj.quantidade_total);
      obj.quantidade_disponivel = Number(obj.quantidade_disponivel);
      obj.ano_publicacao = obj.ano_publicacao ? Number(obj.ano_publicacao) : null;

      await fetchJSON(`${API}/livros/${id}`, {
        method: "PUT",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(obj)
      });

      modal.hide();
      await loadTab();
    } catch (e2) {
      alert(e2.message);
    }
  };

  await preloadBasics();

  modalBody.innerHTML = `
    <div class="row g-3">
      <div class="col-md-8">
        <label class="form-label">Título</label>
        <input class="form-control" name="titulo" required value="${l.titulo}" />
      </div>
      <div class="col-md-4">
        <label class="form-label">Ano</label>
        <input class="form-control" name="ano_publicacao" type="number" value="${l.ano_publicacao ?? ""}" />
      </div>

      <div class="col-md-6">
        <label class="form-label">Autor</label>
        <select class="form-select" name="id_autor" required>
          ${cache.autores.map(a => `<option value="${a.id}" ${a.id===l.id_autor?"selected":""}>${a.nome}</option>`).join("")}
        </select>
      </div>

      <div class="col-md-6">
        <label class="form-label">Categoria</label>
        <select class="form-select" name="id_categoria" required>
          ${cache.categorias.map(c => `<option value="${c.id}" ${c.id===l.id_categoria?"selected":""}>${c.nome}</option>`).join("")}
        </select>
      </div>

      <div class="col-md-6">
        <label class="form-label">Qtd Total</label>
        <input class="form-control" name="quantidade_total" type="number" value="${l.quantidade_total}" min="1" />
      </div>

      <div class="col-md-6">
        <label class="form-label">Qtd Disponível</label>
        <input class="form-control" name="quantidade_disponivel" type="number" value="${l.quantidade_disponivel}" min="0" />
      </div>

      <div class="col-12">
        <label class="form-label">Imagem (URL)</label>
        <input class="form-control" name="imagem_url" value="${l.imagem_url ?? ""}" placeholder="https://..." />
      </div>

      <div class="col-12">
        <label class="form-label">Sinopse</label>
        <textarea class="form-control" name="descricao" rows="4">${l.descricao ?? ""}</textarea>
      </div>
    </div>
  `;
  modal.show();
}

// =======================
// STATUS MODAIS
// =======================
async function openStatusEmprestimoModal(id) {
  // antes de abrir, pega info do empréstimo pra saber multa/atraso
  const ref = getServerTodayDate();
  const all = await fetchJSON(`${API}/emprestimos`);
  const emp = (all || []).find(e => Number(e.id) === Number(id));
  if (!emp) return alert("Empréstimo não encontrado.");

  const multa = calcFineBRL(emp.data_prevista_devolucao, emp.status, ref);
  const atrasado = isOverdue(emp.data_prevista_devolucao, emp.status, ref);

  modalTitle.textContent = `Alterar status do Empréstimo #${id}`;

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const obj = Object.fromEntries(new FormData(form).entries());

    try {
      // Se está devolvendo e havia atraso, confirmar “recebimento”
      if (String(obj.status).toUpperCase() === "DEVOLVIDO" && atrasado) {
        const ok = confirm(
          `Empréstimo está em atraso.\nMulta calculada: R$ ${multa},00\n\nConfirmar recebimento da multa?`
        );
        if (!ok) return; // não envia
      }

      await fetchJSON(`${API}/emprestimos/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(obj)
      });

      // refresh contexto aluno (se for o caso)
      alunoCtx.loaded = false;

      modal.hide();
      await loadTab();
    } catch (e2) {
      alert(e2.message);
    }
  };

  modalBody.innerHTML = `
    <div class="row g-3">
      <div class="col-12">
        <div class="alert ${atrasado ? "alert-warning" : "alert-info"} mb-0">
          ${atrasado
            ? `ATRASO detectado. Multa atual (tolerância 30 dias): <b>R$ ${multa},00</b>`
            : `Sem atraso. Multa: <b>R$ 0,00</b>`
          }
        </div>
      </div>

      <div class="col-md-6">
        <label class="form-label">Novo status</label>
        <select class="form-select" name="status" required>
          <option ${emp.status==="EM_ABERTO"?"selected":""}>EM_ABERTO</option>
          <option ${emp.status==="DEVOLVIDO"?"selected":""}>DEVOLVIDO</option>
          <option ${emp.status==="ATRASADO"?"selected":""}>ATRASADO</option>
        </select>
      </div>

      <div class="col-md-6">
        <label class="form-label">Data devolução (se DEVOLVIDO)</label>
        <input class="form-control" name="data_devolucao" type="date" />
      </div>
    </div>
  `;
  modal.show();
}

async function openStatusReservaModal(id) {
  modalTitle.textContent = `Alterar status da Reserva #${id}`;

  form.onsubmit = async (ev) => {
    ev.preventDefault();
    const obj = Object.fromEntries(new FormData(form).entries());
    try {
      await fetchJSON(`${API}/reservas/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify(obj)
      });
      modal.hide();
      await loadTab();
    } catch (e2) {
      alert(e2.message);
    }
  };

  modalBody.innerHTML = `
    <div class="row g-3">
      <div class="col-md-6">
        <label class="form-label">Novo status</label>
        <select class="form-select" name="status" required>
          <option>ATIVA</option>
          <option>CANCELADA</option>
          <option>ATENDIDA</option>
        </select>
      </div>
    </div>
  `;
  modal.show();
}

// =======================
// INIT
// =======================
setActiveTab("livros");