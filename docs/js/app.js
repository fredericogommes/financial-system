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
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
/* "2026-10" → "Out/26" */
const nomeMes = (m) => `${MESES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;

/* Aceita "500", "150,90", "1.000", "1.234,56" */
function lerValor(t) {
  t = String(t).replace(/^r\$/i, "").trim();
  const n = /,\d{1,2}$/.test(t) || /\.\d{3}/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", ".");
  const v = Number(n);
  return v > 0 ? Math.round(v * 100) / 100 : null;
}

/* Contas em centavos para não acumular erro de ponto flutuante */
const centavos = (v) => Math.round(Number(v || 0) * 100);
const somar = (lista, f = (x) => x.valor) => lista.reduce((t, x) => t + centavos(f(x)), 0) / 100;
const dif = (a, b) => (centavos(a) - centavos(b)) / 100;

/* Datas em texto "AAAA-MM-DD" no fuso do navegador */
const isoData = (d) => d.toLocaleDateString("sv-SE");
function somarDias(iso, n) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoData(d); }
/* Mesmo dia nos meses seguintes; dia 31 vira o último dia do mês quando ele não existe */
function somarMeses(iso, n) {
  const [a, m, dia] = iso.split("-").map(Number);
  const ultimo = new Date(a, m - 1 + n + 1, 0).getDate();
  return isoData(new Date(a, m - 1 + n, Math.min(dia, ultimo), 12));
}

/* Campo de valor com vírgula e ponto automáticos: digitar 123456 mostra 1.234,56 */
const valorParaCampo = (v) => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function mascaraMoeda(input) {
  input.setAttribute("inputmode", "numeric");
  input.setAttribute("placeholder", "0,00");
  input.addEventListener("input", () => {
    const digitos = input.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 12);
    input.value = digitos ? valorParaCampo(Number(digitos) / 100) : "";
  });
}

/* ---------------- Cartões de resumo (mesmo visual em todas as telas) ---------------- */
const IC = {
  saldo:    '<rect x="2" y="6" width="20" height="13" rx="2"/><path d="M2 10h20"/><circle cx="16.5" cy="14.5" r="1.5"/>',
  receber:  '<circle cx="12" cy="12" r="10"/><polyline points="8 12 12 8 16 12"/><line x1="12" y1="16" x2="12" y2="8"/>',
  pagar:    '<circle cx="12" cy="12" r="10"/><polyline points="8 12 12 16 16 12"/><line x1="12" y1="8" x2="12" y2="16"/>',
  resultado:'<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  alerta:   '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  lista:    '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  pessoas:  '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  media:    '<line x1="6" y1="20" x2="6" y2="14"/><line x1="12" y1="20" x2="12" y2="8"/><line x1="18" y1="20" x2="18" y2="4"/>',
  calendario:'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  documento:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/>',
  relogio:  '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  seta:     '<polyline points="9 18 15 12 9 6"/>',
};
const icone = (nome, tam = 20) =>
  `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[nome]}</svg>`;

/* cor: verde | vermelho | amarelo | azul. nota: linha pequena abaixo do valor.
   link: ao clicar, abre os lançamentos que formam o número. ajuda: como o número é calculado */
function kpi(rotulo, valor, cor, ico, nota = "", link = "", ajuda = "") {
  const tag = link ? "a" : "div";
  return `<${tag} class="kpi${link ? " kpi-link" : ""}"${link ? ` href="${link}"` : ""}${ajuda ? ` title="${esc(ajuda)}"` : ""}>
    <div class="kpi-icone k-${cor}">${icone(ico, 26)}</div>
    <div><div class="kpi-rotulo">${rotulo}${ajuda ? ' <span class="kpi-ajuda">?</span>' : ""}</div><div class="kpi-valor">${valor}</div>
    ${nota ? `<div class="kpi-nota">${nota}</div>` : ""}</div></${tag}>`;
}

/* ---------------- Filtros comuns ---------------- */
/* Atalhos de período: preenchem os campos De/Até e recarregam */
const PERIODOS = {
  mes:       () => [mesAtual() + "-01", somarDias(somarMeses(mesAtual() + "-01", 1), -1)],
  anterior:  () => { const i = somarMeses(mesAtual() + "-01", -1); return [i, somarDias(mesAtual() + "-01", -1)]; },
  prox7:     () => [hoje(), somarDias(hoje(), 7)],
  prox30:    () => [hoje(), somarDias(hoje(), 30)],
  ult30:     () => [somarDias(hoje(), -30), hoje()],
  ano:       () => [hoje().slice(0, 4) + "-01-01", hoje().slice(0, 4) + "-12-31"],
  tudo:      () => ["", ""],
};
const NOMES_PERIODO = { prox7: "Próximos 7 dias", mes: "Este mês", anterior: "Mês passado", ult30: "Últimos 30 dias", prox30: "Próximos 30 dias", ano: "Este ano", tudo: "Tudo" };
function atalhosPeriodo(elId, opcoes, aoMudar) {
  $(elId).innerHTML = opcoes.map((k) => `<button type="button" class="chip" data-p="${k}">${NOMES_PERIODO[k]}</button>`).join("");
  $(elId).onclick = (e) => {
    const k = e.target.dataset?.p; if (!k) return;
    [$("f-de").value, $("f-ate").value] = PERIODOS[k]();
    aoMudar();
  };
}
/* Mostra os filtros em uso como etiquetas; cada uma tem um x para tirar só ela */
function filtrosAtivos(elId, itens, aoMudar) {
  const ativos = itens.filter((i) => i.valor);
  $(elId).innerHTML = ativos.length
    ? `<span class="fino muted">Filtros:</span> ` + ativos.map((i, n) =>
        `<span class="chip chip-ativo">${esc(i.rotulo)}: ${esc(i.valor)} <button type="button" data-n="${n}" aria-label="Tirar filtro">×</button></span>`).join("")
    : "";
  $(elId).onclick = (e) => {
    const n = e.target.dataset?.n; if (n === undefined) return;
    ativos[n].limpar(); aoMudar();
  };
}
const textoSelect = (id) => { const s = $(id); return s.value ? s.options[s.selectedIndex].text : ""; };

/* Rodapé de lista: deixa claro se os totais são de tudo ou só do que apareceu */
function rodapeLista(mostrados, total, limite) {
  return total > mostrados
    ? `<p class="aviso-lista">Mostrando ${mostrados} de ${total} lançamentos (limite de ${limite}). Os totais acima consideram só os mostrados: refine os filtros para ver tudo.</p>`
    : `<p class="fino muted" style="margin:10px 0 0">${total} lançamento(s). Os totais acima consideram todos eles.</p>`;
}

function baixarCSV(nome, cabecalho, linhas) {
  const csv = [cabecalho, ...linhas]
    .map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = nome; a.click();
  URL.revokeObjectURL(url);
}
const valorCSV = (v) => Number(v || 0).toFixed(2).replace(".", ",");

/* Evita salvar duas vezes com clique duplo: trava o botão enquanto grava */
async function travar(form, tarefa) {
  const botao = form.querySelector("button:not([type=button])");
  if (botao?.disabled) return;
  const texto = botao?.textContent;
  if (botao) { botao.disabled = true; botao.textContent = "Salvando..."; }
  try { await tarefa(); }
  finally { if (botao) { botao.disabled = false; botao.textContent = texto; } }
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
  recebi:            { rotulo: "Recebi de alguém",   direcao:  1, pessoa: true, status: "liquidado" },
  // Só existe no formulário: no banco é um "recebi" em aberto
  a_receber:         { rotulo: "A receber de alguém", direcao: 1, pessoa: true, status: "pendente", banco: "recebi" },
  paguei:            { rotulo: "Paguei alguém",      direcao: -1, pessoa: true, status: "liquidado" },
  // Só existe no formulário: no banco é um "paguei" em aberto
  a_pagar:           { rotulo: "A pagar a alguém",   direcao: -1, pessoa: true, status: "pendente", banco: "paguei" },
  emprestei:         { rotulo: "Emprestei",          direcao: -1, pessoa: true, status: "liquidado" },
  peguei_emprestado: { rotulo: "Peguei emprestado",  direcao:  1, pessoa: true, status: "liquidado" },
};
const rotuloTipo = (t) => (TIPOS[t] ? TIPOS[t].rotulo : t);
const tipoDoForm = (m) => m.status !== "pendente" ? m.tipo
  : m.tipo === "recebi" ? "a_receber" : m.tipo === "paguei" ? "a_pagar" : m.tipo;
const rotuloMov = (m) => rotuloTipo(tipoDoForm(m));
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
        <div><label for="x-valor">Valor (R$)</label><input id="x-valor" required></div>
        <div id="campo-status"><label for="x-status">Situação</label>
          <select id="x-status"><option value="liquidado">Já aconteceu</option><option value="pendente">Em aberto</option></select></div>
        <div><label for="x-data">Data do lançamento</label><input id="x-data" type="date" required></div>
        <div><label for="x-venc" id="rotulo-venc">Vencimento</label><input id="x-venc" type="date"></div>
        <div id="campo-baixa"><label for="x-baixa">Data da baixa (pagamento)</label><input id="x-baixa" type="date"></div>
        <div><label for="x-categoria">Categoria</label><select id="x-categoria"></select></div>
        <div><label for="x-conta">Conta</label><select id="x-conta"></select></div>
        <div id="campo-pessoa"><label for="x-pessoa">Pessoa</label><select id="x-pessoa"></select></div>
        <div class="col-2"><label for="x-desc">Descrição</label><input id="x-desc" placeholder="ex.: conta de luz de outubro"></div>
        <div id="campo-parcelas"><label for="x-parcelas">Parcelas</label>
          <input id="x-parcelas" type="number" min="1" max="60" value="1"></div>
        <div id="campo-modo"><label for="x-modo">O valor informado é</label>
          <select id="x-modo"><option value="total">O total (divide entre as parcelas)</option>
            <option value="cada">De cada parcela (repete todo mês)</option></select></div>
      </div>
      <p class="fino muted" id="x-resumo" style="margin:10px 0 0"></p>
      <div class="rodape">
        <button type="button" class="btn" id="x-cancelar">Cancelar</button>
        <button class="btn btn-primario">Salvar</button>
      </div>
    </form>`;
  document.body.appendChild(el);
  $("x-cancelar").onclick = () => (el.hidden = true);
  el.onclick = (ev) => { if (ev.target === el) el.hidden = true; };
  $("x-tipo").onchange = aplicarTipo;
  $("x-status").onchange = aplicarTipo;
  ["x-parcelas", "x-modo", "x-valor", "x-venc"].forEach((i) => $(i).addEventListener("input", resumoParcelas));
  mascaraMoeda($("x-valor"));
  $("form-lanc").onsubmit = (e) => { e.preventDefault(); travar(e.target, salvarLancamento); };
}

function aplicarTipo() {
  const t = $("x-tipo").value;
  const natureza = entra(t) ? "receita" : "despesa";
  $("campo-pessoa").style.display = TIPOS[t].pessoa ? "" : "none";
  // Empréstimo já saiu do caixa; a data de devolução vira o vencimento da conta a receber
  $("campo-status").style.display = TIPOS[t].status ? "none" : "";
  const emprestimo = t === "emprestei" || t === "peguei_emprestado";
  const status = TIPOS[t].status ?? $("x-status").value;
  $("rotulo-venc").textContent = t === "emprestei" ? "Devolve até" : t === "peguei_emprestado" ? "Pago até" : "Vencimento";
  $("campo-baixa").style.display = status === "liquidado" && !emprestimo ? "" : "none";
  // Parcelar só faz sentido em conta nova e em aberto
  const parcela = !$("x-id").value && status === "pendente";
  $("campo-parcelas").style.display = parcela ? "" : "none";
  $("campo-modo").style.display = parcela && Number($("x-parcelas").value) > 1 ? "" : "none";
  resumoParcelas();
  const cats = Aux.categorias.filter((c) => c.natureza === natureza);
  const atual = $("x-categoria").value;
  $("x-categoria").innerHTML = `<option value="">Sem categoria</option>` +
    cats.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join("");
  if (cats.some((c) => String(c.id) === atual)) $("x-categoria").value = atual;
}

/* Divide o valor em parcelas exatas em centavos; a diferença de arredondamento vai na 1ª */
function dividirParcelas(total, n) {
  const c = centavos(total), base = Math.floor(c / n);
  return Array.from({ length: n }, (_, i) => (base + (i === 0 ? c - base * n : 0)) / 100);
}
function resumoParcelas() {
  const el = $("x-resumo"); if (!el) return;
  const n = Number($("x-parcelas").value) || 1;
  const valor = lerValor($("x-valor").value);
  if ($("campo-parcelas").style.display === "none" || n <= 1 || !valor) { el.textContent = ""; return; }
  const partes = $("x-modo").value === "cada" ? Array(n).fill(valor) : dividirParcelas(valor, n);
  const venc = $("x-venc").value;
  el.textContent = `${n} parcelas: ${partes[0] === partes[n - 1] ? `${n} × ${brl(partes[0])}` : `1ª de ${brl(partes[0])} e ${n - 1} de ${brl(partes[1])}`}` +
    ` = ${brl(somar(partes, (x) => x))}` + (venc ? `, de ${dataBR(venc)} a ${dataBR(somarMeses(venc, n - 1))}.` : ". Informe o 1º vencimento.");
}

let lancAtual = null;
async function abrirLancamento(mov, padrao = {}) {
  lancAtual = mov;
  await carregarAux();
  modalLancamento();
  $("lanc-titulo").textContent = mov ? "Editar lançamento" : "Novo lançamento";
  $("x-tipo").innerHTML = Object.entries(TIPOS).map(([k, v]) => `<option value="${k}">${v.rotulo}</option>`).join("");
  $("x-conta").innerHTML = `<option value="">Sem conta</option>` +
    Aux.contas.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join("");
  $("x-pessoa").innerHTML = `<option value="">Ninguém</option>` +
    Aux.pessoas.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join("");

  $("x-id").value = mov?.id ?? "";
  $("x-tipo").value = mov ? tipoDoForm(mov) : padrao.tipo ?? "despesa";
  aplicarTipo();
  $("x-valor").value = mov ? valorParaCampo(mov.valor) : "";
  $("x-status").value = mov?.status ?? padrao.status ?? "liquidado";
  $("x-data").value = (mov?.data || hoje()).slice(0, 10);
  $("x-venc").value = mov?.vencimento ? mov.vencimento.slice(0, 10) : "";
  $("x-categoria").value = mov?.categoria_id ?? "";
  $("x-conta").value = mov?.conta_id ?? (Aux.contas[0]?.id ?? "");
  $("x-pessoa").value = mov?.pessoa_id ?? padrao.pessoa_id ?? "";
  $("x-desc").value = mov?.descricao ?? "";
  $("x-baixa").value = mov?.liquidado_em ?? "";
  $("x-parcelas").value = 1;
  aplicarTipo();
  $("modal-lanc").hidden = false;
  $("x-valor").focus();
}

async function salvarLancamento() {
  const valor = lerValor($("x-valor").value);
  if (!valor) return avisar("Informe um valor maior que zero.", true);
  const escolhido = $("x-tipo").value;
  const tipo = TIPOS[escolhido].banco ?? escolhido;
  const pessoa_id = TIPOS[escolhido].pessoa ? Number($("x-pessoa").value) || null : null;
  if (TIPOS[escolhido].pessoa && !pessoa_id) return avisar("Escolha a pessoa desse lançamento.", true);
  const status = TIPOS[escolhido].status ?? $("x-status").value;
  const data = $("x-data").value;
  const vencimento = $("x-venc").value || null;
  const baixa = status === "liquidado" ? ($("x-baixa").value || data) : null;
  // Conta em aberto precisa de vencimento para entrar nos vencidos e na projeção.
  // Exceção: contas que vieram de empréstimo, que podem não ter prazo combinado.
  if (status === "pendente" && !vencimento && !lancAtual?.referente_a)
    return avisar("Informe o vencimento da conta em aberto.", true);
  if (baixa && baixa > hoje() && !confirm(`A data da baixa (${dataBR(baixa)}) está no futuro. Salvar mesmo assim?`)) return;

  const dados = {
    tipo, valor, pessoa_id, status, data, vencimento,
    categoria_id: Number($("x-categoria").value) || null,
    conta_id: Number($("x-conta").value) || null,
    descricao: $("x-desc").value.trim() || null,
    liquidado_em: baixa,
  };
  const id = $("x-id").value;

  if (!id) {
    // Aviso de possível duplicidade: mesmo tipo, pessoa, valor e data
    let q = db.from("movimentacoes").select("id", { count: "exact", head: true })
      .eq("tipo", tipo).eq("valor", valor).eq("data", data);
    q = pessoa_id ? q.eq("pessoa_id", pessoa_id) : q.is("pessoa_id", null);
    const { count } = await q;
    if (count && !confirm(`Já existe ${count === 1 ? "um lançamento igual" : count + " lançamentos iguais"} (mesmo tipo, valor e data). Salvar outro?`)) return;
  }

  const n = Math.min(Math.max(Number($("x-parcelas").value) || 1, 1), 60);
  let error;
  if (!id && status === "pendente" && n > 1) {
    const partes = $("x-modo").value === "cada" ? Array(n).fill(valor) : dividirParcelas(valor, n);
    const base = dados.descricao || rotuloTipo(escolhido);
    ({ error } = await db.from("movimentacoes").insert(partes.map((v, i) => ({
      ...dados, valor: v, vencimento: somarMeses(vencimento, i),
      descricao: `${base} (${i + 1}/${n})`, parcela: `${i + 1}/${n}`,
    }))));
  } else {
    ({ error } = id
      ? await db.from("movimentacoes").update(dados).eq("id", id)
      : await db.from("movimentacoes").insert(dados));
  }
  if (error) return avisar("Erro ao salvar: " + error.message, true);
  $("modal-lanc").hidden = true;
  avisar(n > 1 && !id && status === "pendente" ? `${n} parcelas lançadas.` : "Lançamento salvo.");
  if (typeof recarregar === "function") recarregar();
}

/* ---------------- Dar baixa (total ou parcial) ---------------- */
let baixaAtual = null;

function modalBaixa() {
  if ($("modal-baixa")) return;
  const el = document.createElement("div");
  el.id = "modal-baixa";
  el.className = "modal";
  el.hidden = true;
  el.innerHTML = `
    <form class="caixa" id="form-baixa">
      <h2>Dar baixa</h2>
      <p class="fino muted" id="b-info" style="margin:-6px 0 14px"></p>
      <div class="form-grade">
        <div><label for="b-valor">Valor pago/recebido (R$)</label><input id="b-valor" required></div>
        <div><label for="b-data">Data da baixa</label><input id="b-data" type="date" required></div>
        <div><label for="b-desconto">Desconto concedido (R$)</label><input id="b-desconto"></div>
        <div><label for="b-juros">Juros / multa (R$)</label><input id="b-juros"></div>
        <div class="col-2"><label for="b-conta">Conta</label><select id="b-conta"></select></div>
      </div>
      <p class="fino muted" id="b-resto" style="margin:12px 0 0"></p>
      <div class="rodape">
        <button type="button" class="btn" id="b-cancelar">Cancelar</button>
        <button class="btn btn-primario">Confirmar baixa</button>
      </div>
    </form>`;
  document.body.appendChild(el);
  $("b-cancelar").onclick = () => (el.hidden = true);
  el.onclick = (ev) => { if (ev.target === el) el.hidden = true; };
  ["b-valor", "b-desconto", "b-juros"].forEach((i) => { mascaraMoeda($(i)); $(i).addEventListener("input", mostrarResto); });
  $("form-baixa").onsubmit = (e) => { e.preventDefault(); travar(e.target, confirmarBaixa); };
}

/* Quanto do valor em aberto esta baixa quita: pago − juros + desconto */
function calculoBaixa() {
  const pago = lerValor($("b-valor").value) || 0;
  const desconto = lerValor($("b-desconto").value) || 0;
  const juros = lerValor($("b-juros").value) || 0;
  const quitado = (centavos(pago) - centavos(juros) + centavos(desconto)) / 100;
  return { pago, desconto, juros, quitado, resto: dif(baixaAtual.valor, quitado) };
}
function mostrarResto() {
  const c = calculoBaixa();
  $("b-resto").innerHTML = c.quitado <= 0 ? "Informe o valor."
    : c.resto > 0 ? `<strong>Baixa parcial:</strong> quita ${brl(c.quitado)} e ${brl(c.resto)} continuam em aberto.`
    : c.resto < 0 ? `<strong>Atenção:</strong> o valor quita ${brl(-c.resto)} a mais do que está em aberto. Se for juros ou multa, informe no campo ao lado.`
    : `<strong>Baixa total:</strong> o lançamento sai da lista de abertos.`;
}

async function liquidar(id) {
  await carregarAux();
  const { data: m, error } = await db.from("v_movimentacoes").select("*").eq("id", id).single();
  if (error) return avisar("Erro: " + error.message, true);
  baixaAtual = { ...m, valor: Number(m.valor) };
  modalBaixa();
  $("b-info").textContent = [rotuloMov(m), m.descricao, m.pessoa_nome,
    m.vencimento && "vence " + dataBR(m.vencimento), "em aberto " + brl(m.valor)].filter(Boolean).join(" · ");
  $("b-valor").value = valorParaCampo(m.valor);
  $("b-desconto").value = ""; $("b-juros").value = "";
  $("b-data").value = hoje();
  $("b-conta").innerHTML = `<option value="">Sem conta</option>` +
    Aux.contas.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join("");
  $("b-conta").value = m.conta_id ?? (Aux.contas[0]?.id ?? "");
  mostrarResto();
  $("modal-baixa").hidden = false;
  $("b-valor").focus();
}

async function confirmarBaixa() {
  const m = baixaAtual;
  const c = calculoBaixa();
  if (!c.pago || c.quitado <= 0) return avisar("Informe o valor pago ou recebido.", true);
  const quando = $("b-data").value;
  if (quando > hoje() && !confirm(`A data da baixa (${dataBR(quando)}) está no futuro. Confirmar mesmo assim?`)) return;
  const conta_id = Number($("b-conta").value) || null;
  let error;
  if (c.resto > 0) {
    // Parcial: o que foi pago vira um lançamento baixado e o resto continua em aberto
    ({ error } = await db.from("movimentacoes").insert({
      tipo: m.tipo, pessoa_id: m.pessoa_id, valor: c.pago, desconto: c.desconto, juros: c.juros,
      data: quando, liquidado_em: quando, status: "liquidado",
      vencimento: m.vencimento, descricao: `${m.descricao || rotuloTipo(m.tipo)} (parcial)`,
      categoria_id: m.categoria_id, conta_id, referente_a: m.referente_a ?? m.id,
    }));
    if (!error) ({ error } = await db.from("movimentacoes").update({ valor: c.resto }).eq("id", m.id));
  } else {
    ({ error } = await db.from("movimentacoes").update({
      status: "liquidado", liquidado_em: quando, valor: c.pago, desconto: c.desconto, juros: c.juros, conta_id,
    }).eq("id", m.id));
  }
  if (error) return avisar("Erro: " + error.message, true);
  $("modal-baixa").hidden = true;
  avisar(c.resto > 0 ? `Baixa parcial registrada. Restam ${brl(c.resto)} em aberto.` : "Baixa registrada.");
  if (typeof recarregar === "function") recarregar();
}

/* Desfaz uma baixa: o lançamento volta a ficar em aberto (fica registrado no histórico) */
async function reabrir(id) {
  if (!confirm("Desfazer a baixa? O valor volta para em aberto e o saldo do caixa é recalculado.")) return;
  const { error } = await db.from("movimentacoes")
    .update({ status: "pendente", liquidado_em: null, desconto: 0, juros: 0 }).eq("id", id);
  if (error) return avisar("Erro: " + error.message, true);
  avisar("Baixa desfeita. O lançamento voltou para em aberto.");
  if (typeof recarregar === "function") recarregar();
}

async function excluirLancamento(id) {
  if (!confirm("Excluir este lançamento? Ele sai de todos os totais (a exclusão fica registrada no histórico).")) return;
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
