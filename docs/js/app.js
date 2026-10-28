/* Finanças do Fred — camada comum: layout, login, helpers e modal de lançamento.
   A chave publicável pode ficar no navegador: os dados só aparecem para quem fizer login (RLS). */
/* Se algo quebrar ao carregar, mostra o erro na tela em vez de deixar a página em branco */
function mostrarFalha(msg) {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;inset:auto 16px 16px 16px;z-index:99;background:#e74c3c;color:#fff;padding:12px 14px;border-radius:10px;font:14px system-ui";
  el.textContent = "O painel não carregou: " + msg + ". Tire um print desta mensagem e mande para o Claude.";
  (document.body || document.documentElement).appendChild(el);
}
window.addEventListener("error", (e) => mostrarFalha(e.message || "erro ao carregar " + (e.target?.src || "um arquivo")), true);
window.addEventListener("unhandledrejection", (e) => mostrarFalha(e.reason?.message || String(e.reason)));

const SUPABASE_URL = "https://nbwozmphkejikpkmfaqh.supabase.co";
const SUPABASE_KEY = "sb_publishable_vs5xBJpySadmlwsdcupLIg_SQsfQ0Fz";
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const brl = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (d) => (d ? String(d).slice(0, 10).split("-").reverse().join("/") : "—");
const hoje = () => new Date().toLocaleDateString("sv-SE");
const mesAtual = () => hoje().slice(0, 7);
const nomeMes = (m) => new Date(m + "-02").toLocaleDateString("pt-BR", { month: "short", year: "2-digit" }).replace(".", "");

/* Aceita "500", "150,90", "1.000", "1.234,56" */
function lerValor(t) {
  t = String(t).replace(/^r\$/i, "").trim();
  const n = /,\d{1,2}$/.test(t) || /\.\d{3}/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", ".");
  const v = Number(n);
  return v > 0 ? Math.round(v * 100) / 100 : null;
}

function avisar(texto, erro = false) {
  const el = $("aviso");
  el.textContent = texto;
  el.classList.toggle("erro", erro);
  el.hidden = false;
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => (el.hidden = true), 4200);
}

/* ---------------- Tipos de lançamento ---------------- */
const TIPOS = {
  receita:           { rotulo: "Receita",            direcao:  1, pessoa: false },
  despesa:           { rotulo: "Despesa",            direcao: -1, pessoa: false },
  recebi:            { rotulo: "Recebi de alguém",   direcao:  1, pessoa: true },
  paguei:            { rotulo: "Paguei alguém",      direcao: -1, pessoa: true },
  emprestei:         { rotulo: "Emprestei",          direcao: -1, pessoa: true },
  peguei_emprestado: { rotulo: "Peguei emprestado",  direcao:  1, pessoa: true },
};
const rotuloTipo = (t) => (TIPOS[t] ? TIPOS[t].rotulo : t);
const entra = (t) => TIPOS[t] && TIPOS[t].direcao === 1;

/* ---------------- Layout ---------------- */
const ICO = {
  painel: '<path d="M3 3h7v7H3zM14 3h7v5h-7zM14 11h7v10h-7zM3 13h7v8H3z"/>',
  pagar:  '<path d="M3 6h18v12H3z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5"/>',
  receber:'<path d="M12 2v14m0 0 5-5m-5 5-5-5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 20h16" stroke="currentColor" stroke-width="2"/>',
  caixa:  '<path d="M3 7h18v12H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 11h18" stroke="currentColor" stroke-width="2"/>',
  pessoas:'<circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" fill="none" stroke="currentColor" stroke-width="2"/>',
  relato: '<path d="M5 20V9m7 11V4m7 16v-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  config: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9l2.1 2.1m10 10 2.1 2.1m0-14.2-2.1 2.1m-10 10-2.1 2.1" stroke="currentColor" stroke-width="2"/>',
};
const svg = (k) => `<svg class="ico" viewBox="0 0 24 24" width="17" height="17" fill="currentColor">${ICO[k]}</svg>`;

const MENU = [
  { g: "Visão geral" },
  { id: "index",         href: "index.html",         nome: "Dashboard",        ico: "painel" },
  { g: "Financeiro" },
  { id: "pagar",         href: "pagar.html",         nome: "Contas a pagar",   ico: "pagar" },
  { id: "receber",       href: "receber.html",       nome: "Contas a receber", ico: "receber" },
  { id: "caixa",         href: "caixa.html",         nome: "Caixa",            ico: "caixa" },
  { id: "pessoas",       href: "pessoas.html",       nome: "Pessoas",          ico: "pessoas" },
  { g: "Outros" },
  { id: "relatorios",    href: "relatorios.html",    nome: "Relatórios",       ico: "relato" },
  { id: "configuracoes", href: "configuracoes.html", nome: "Configurações",    ico: "config" },
];

function montarLayout(pagina, email) {
  const iniciais = (email || "?").slice(0, 2).toUpperCase();
  $("topbar").innerHTML = `
    <button class="btn-menu" id="abrir-menu" aria-label="Menu">&#9776;</button>
    <div class="marca">FINANÇAS<span>.</span></div>
    <div class="sub">Controle pessoal</div>
    <div class="dir">
      <div class="usuario"><span class="avatar">${esc(iniciais)}</span><span>${esc(email || "")}</span></div>
      <button class="btn" id="sair" style="padding:6px 11px">Sair</button>
    </div>`;
  $("sidebar").innerHTML = MENU.map((m) =>
    m.g ? `<div class="grupo">${m.g}</div>`
        : `<a href="${m.href}" class="${m.id === pagina ? "ativo" : ""}">${svg(m.ico)}<span>${m.nome}</span></a>`
  ).join("");
  $("sair").onclick = async () => { await db.auth.signOut(); location.reload(); };
  $("abrir-menu").onclick = () => document.body.classList.toggle("menu-aberto");
}

/* ---------------- Login ---------------- */
function telaLogin() {
  const el = document.createElement("div");
  el.className = "tela-login";
  el.innerHTML = `
    <form class="caixa" id="form-login">
      <h1>Finanças do Fred</h1>
      <p>Entre com o seu e-mail e senha.</p>
      <label for="l-email">E-mail</label>
      <input id="l-email" type="email" required autocomplete="username">
      <label for="l-senha" style="margin-top:10px">Senha</label>
      <input id="l-senha" type="password" required autocomplete="current-password">
      <button class="btn btn-primario">Entrar</button>
    </form>`;
  document.body.appendChild(el);
  $("form-login").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await db.auth.signInWithPassword({ email: $("l-email").value, password: $("l-senha").value });
    if (error) return avisar("E-mail ou senha incorretos.", true);
    location.reload();
  };
}

/* ---------------- Dados auxiliares (cache) ---------------- */
const Aux = { categorias: null, contas: null, pessoas: null };
async function carregarAux(force = false) {
  if (Aux.categorias && !force) return Aux;
  const [cat, con, pes] = await Promise.all([
    db.from("categorias").select("*").order("natureza").order("nome"),
    db.from("contas").select("*").order("nome"),
    db.from("pessoas").select("id,nome,apelido").order("nome"),
  ]);
  Aux.categorias = cat.data || [];
  Aux.contas = con.data || [];
  Aux.pessoas = pes.data || [];
  return Aux;
}

/* ---------------- Modal de lançamento ---------------- */
function modalLancamento() {
  if ($("modal-lanc")) return;
  const el = document.createElement("div");
  el.id = "modal-lanc";
  el.className = "modal";
  el.hidden = true;
  el.innerHTML = `
    <form class="caixa" id="form-lanc">
      <h2 id="lanc-titulo">Novo lançamento</h2>
      <input type="hidden" id="x-id">
      <div class="form-grade">
        <div><label for="x-tipo">Tipo</label><select id="x-tipo"></select></div>
        <div><label for="x-valor">Valor (R$)</label><input id="x-valor" inputmode="decimal" placeholder="0,00" required></div>
        <div><label for="x-status">Situação</label>
          <select id="x-status"><option value="liquidado">Já aconteceu</option><option value="pendente">Em aberto</option></select></div>
        <div><label for="x-data">Data</label><input id="x-data" type="date" required></div>
        <div><label for="x-venc">Vencimento</label><input id="x-venc" type="date"></div>
        <div><label for="x-categoria">Categoria</label><select id="x-categoria"></select></div>
        <div><label for="x-conta">Conta</label><select id="x-conta"></select></div>
        <div id="campo-pessoa"><label for="x-pessoa">Pessoa</label><select id="x-pessoa"></select></div>
        <div class="col-2"><label for="x-desc">Descrição</label><input id="x-desc" placeholder="ex.: conta de luz de outubro"></div>
      </div>
      <div class="rodape">
        <button type="button" class="btn" id="x-cancelar">Cancelar</button>
        <button class="btn btn-primario">Salvar</button>
      </div>
    </form>`;
  document.body.appendChild(el);
  $("x-cancelar").onclick = () => (el.hidden = true);
  el.onclick = (ev) => { if (ev.target === el) el.hidden = true; };
  $("x-tipo").onchange = aplicarTipo;
  $("form-lanc").onsubmit = salvarLancamento;
}

function aplicarTipo() {
  const t = $("x-tipo").value;
  const natureza = entra(t) ? "receita" : "despesa";
  $("campo-pessoa").style.display = TIPOS[t].pessoa ? "" : "none";
  const cats = Aux.categorias.filter((c) => c.natureza === natureza);
  const atual = $("x-categoria").value;
  $("x-categoria").innerHTML = `<option value="">Sem categoria</option>` +
    cats.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join("");
  if (cats.some((c) => String(c.id) === atual)) $("x-categoria").value = atual;
}

async function abrirLancamento(mov, padrao = {}) {
  await carregarAux();
  modalLancamento();
  $("lanc-titulo").textContent = mov ? "Editar lançamento" : "Novo lançamento";
  $("x-tipo").innerHTML = Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v.rotulo}</option>`).join("");
  $("x-conta").innerHTML = `<option value="">Sem conta</option>` +
    Aux.contas.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join("");
  $("x-pessoa").innerHTML = `<option value="">Ninguém</option>` +
    Aux.pessoas.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join("");

  $("x-id").value = mov?.id ?? "";
  $("x-tipo").value = mov?.tipo ?? padrao.tipo ?? "despesa";
  aplicarTipo();
  $("x-valor").value = mov ? String(mov.valor).replace(".", ",") : "";
  $("x-status").value = mov?.status ?? padrao.status ?? "liquidado";
  $("x-data").value = (mov?.data || hoje()).slice(0, 10);
  $("x-venc").value = mov?.vencimento ? mov.vencimento.slice(0, 10) : "";
  $("x-categoria").value = mov?.categoria_id ?? "";
  $("x-conta").value = mov?.conta_id ?? (Aux.contas[0]?.id ?? "");
  $("x-pessoa").value = mov?.pessoa_id ?? padrao.pessoa_id ?? "";
  $("x-desc").value = mov?.descricao ?? "";
  $("modal-lanc").hidden = false;
  $("x-valor").focus();
}

async function salvarLancamento(e) {
  e.preventDefault();
  const valor = lerValor($("x-valor").value);
  if (!valor) return avisar("Valor inválido.", true);
  const tipo = $("x-tipo").value;
  const pessoa_id = TIPOS[tipo].pessoa ? Number($("x-pessoa").value) || null : null;
  if (TIPOS[tipo].pessoa && !pessoa_id) return avisar("Escolha a pessoa desse lançamento.", true);
  const status = $("x-status").value;
  const dados = {
    tipo, valor, pessoa_id, status,
    data: $("x-data").value,
    vencimento: $("x-venc").value || null,
    categoria_id: Number($("x-categoria").value) || null,
    conta_id: Number($("x-conta").value) || null,
    descricao: $("x-desc").value.trim() || null,
    liquidado_em: status === "liquidado" ? $("x-data").value : null,
  };
  const id = $("x-id").value;
  const { error } = id
    ? await db.from("movimentacoes").update(dados).eq("id", id)
    : await db.from("movimentacoes").insert(dados);
  if (error) return avisar("Erro ao salvar: " + error.message, true);
  $("modal-lanc").hidden = true;
  avisar("Lançamento salvo.");
  if (typeof recarregar === "function") recarregar();
}

async function liquidar(id) {
  const { error } = await db.from("movimentacoes")
    .update({ status: "liquidado", liquidado_em: hoje(), data: hoje() }).eq("id", id);
  if (error) return avisar("Erro: " + error.message, true);
  avisar("Baixa registrada.");
  if (typeof recarregar === "function") recarregar();
}

async function excluirLancamento(id) {
  if (!confirm("Excluir este lançamento?")) return;
  const { error } = await db.from("movimentacoes").delete().eq("id", id);
  if (error) return avisar("Erro: " + error.message, true);
  avisar("Lançamento excluído.");
  if (typeof recarregar === "function") recarregar();
}

/* ---------------- Início ---------------- */
async function iniciarPagina(pagina, aoCarregar) {
  const { data: { session } } = await db.auth.getSession();
  if (!session) { telaLogin(); return; }
  montarLayout(pagina, session.user.email);
  try { await aoCarregar(); }
  catch (err) { avisar("Erro ao carregar: " + err.message, true); }
}
