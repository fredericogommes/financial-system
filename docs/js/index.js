/* Dashboard — mesmo layout do painel Tech4You, adaptado para finanças pessoais */
let grFluxo = null;

const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

/* Lista dos últimos N meses ("2026-05", ..., "2026-10"), incluindo os que não tiveram lançamento */
function ultimosMeses(n) {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1);
    return `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`;
  });
}

function situacao(m) {
  if (m.status === "liquidado") return '<span class="pill pill-verde">Baixado</span>';
  if (!m.vencimento) return '<span class="pill pill-cinza">Sem vencimento</span>';
  if (m.vencimento < hoje()) return '<span class="pill pill-vermelho">Vencido</span>';
  if (m.vencimento === hoje()) return '<span class="pill pill-amarelo">Vence hoje</span>';
  return '<span class="pill pill-amarelo">Em aberto</span>';
}

const nomeLancamento = (m) =>
  `${esc(m.descricao || rotuloMov(m))}${m.pessoa_nome ? `<div class="fino muted">${esc(m.pessoa_nome)}</div>` : ""}`;

function renderGrafico(meses, entradas, saidas) {
  if (grFluxo) grFluxo.destroy();
  grFluxo = new Chart($("gr-fluxo"), {
    data: {
      labels: meses.map(nomeMes),
      datasets: [
        { type: "bar", label: "Entradas", data: entradas, backgroundColor: "#4cd35e", borderRadius: 4, barPercentage: 0.55 },
        { type: "bar", label: "Saídas", data: saidas, backgroundColor: "#ef6a5a", borderRadius: 4, barPercentage: 0.55 },
        { type: "line", label: "Entradas", data: entradas, borderColor: "#21a038", backgroundColor: "#21a038", pointRadius: 4, tension: 0.35 },
        { type: "line", label: "Saídas", data: saidas, borderColor: "#e74c3c", backgroundColor: "#e74c3c", pointRadius: 4, tension: 0.35 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { filter: (c) => c.dataset.type === "bar", callbacks: { label: (c) => `${c.dataset.label}: ${brl(c.raw)}` } },
      },
      scales: {
        y: { beginAtZero: true, grid: { color: "#eef0f2" },
             ticks: { font: { size: 11 }, callback: (v) => (v >= 1000 ? v / 1000 + "k" : v) } },
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      },
    },
  });
}

async function recarregar() {
  const meses = ultimosMeses(Number($("periodo").value || 6));
  const [{ data: r }, { data: fluxo }, { data: venc }, { data: ult }, { data: saldos }] = await Promise.all([
    db.from("v_resumo_financeiro").select("*").single(),
    db.from("v_fluxo_mensal").select("*").gte("mes", meses[0] + "-01"),
    db.from("v_movimentacoes").select("*").eq("status", "pendente")
      .order("vencimento", { ascending: true, nullsFirst: false }).limit(5),
    db.from("v_movimentacoes").select("*").eq("status", "liquidado")
      .order("data_caixa", { ascending: false }).order("id", { ascending: false }).limit(5),
    db.from("saldo_por_pessoa").select("saldo").neq("saldo", 0),
  ]);

  /* Cartões */
  const resultado = Number(r.entradas_mes) - Number(r.saidas_mes);
  $("kpis").innerHTML =
    kpi("Saldo atual", brl(r.saldo_atual), "azul", "saldo") +
    kpi("A receber", brl(r.a_receber), "verde", "receber",
        r.receber_vencidos ? plural(r.receber_vencidos, "vencido", "vencidos") : "") +
    kpi("A pagar", brl(r.a_pagar), "vermelho", "pagar",
        r.pagar_vencidos ? plural(r.pagar_vencidos, "vencido", "vencidos") : "") +
    kpi("Resultado do mês", brl(resultado), resultado >= 0 ? "verde" : "amarelo", "resultado");

  /* Fluxo financeiro: todos os meses do período, mesmo sem lançamento */
  const porMes = new Map((fluxo || []).map((f) => [String(f.mes).slice(0, 7), f]));
  const entradas = meses.map((m) => Number(porMes.get(m)?.entradas || 0));
  const saidas = meses.map((m) => Number(porMes.get(m)?.saidas || 0));
  renderGrafico(meses, entradas, saidas);
  $("total-entradas").textContent = brl(entradas.reduce((a, b) => a + b, 0));
  $("total-saidas").textContent = brl(saidas.reduce((a, b) => a + b, 0));

  /* Últimos lançamentos */
  $("ultimos").innerHTML = (ult || []).length
    ? `<table class="tabela-dash"><thead><tr><th>Data</th><th>Lançamento</th><th>Categoria</th><th class="num">Valor</th></tr></thead>
       <tbody>${ult.map((m) => `<tr>
          <td>${dataBR(m.data_caixa)}</td>
          <td>${nomeLancamento(m)}</td>
          <td>${m.categoria_nome ? `<span class="ponto" style="background:${esc(m.categoria_cor)}"></span>${esc(m.categoria_nome)}` : '<span class="muted">—</span>'}</td>
          <td class="num ${m.direcao === 1 ? "pos" : "neg"}">${m.direcao === 1 ? "+" : "−"} ${brl(m.valor)}</td>
       </tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Nenhum lançamento ainda.</div>`;

  /* Próximos vencimentos */
  $("vencimentos").innerHTML = (venc || []).length
    ? `<table class="tabela-dash"><thead><tr><th>Vencimento</th><th>Lançamento</th><th>Situação</th><th class="num">Valor</th><th></th></tr></thead>
       <tbody>${venc.map((m) => `<tr>
          <td>${dataBR(m.vencimento)}</td>
          <td>${nomeLancamento(m)}</td>
          <td>${situacao(m)}</td>
          <td class="num ${m.direcao === 1 ? "pos" : "neg"}">${brl(m.valor)}</td>
          <td class="num"><button class="btn-link" onclick="liquidar(${m.id})">Dar baixa</button></td>
       </tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Nada em aberto. Tudo certo.</div>`;

  /* Alertas */
  const pessoasAbertas = (saldos || []).length;
  const alertas = [
    { cor: "vermelho", ico: "calendario", href: "receber.html", titulo: "Contas a receber vencidas", qtd: r.receber_vencidos,
      desc: r.receber_vencidos ? plural(r.receber_vencidos, "título vencido", "títulos vencidos") : "Nenhum título vencido" },
    { cor: "amarelo", ico: "documento", href: "pagar.html", titulo: "Contas a pagar vencidas", qtd: r.pagar_vencidos,
      desc: r.pagar_vencidos ? plural(r.pagar_vencidos, "título vencido", "títulos vencidos") : "Nenhum título vencido" },
    { cor: "verde", ico: "relogio", href: "pagar.html", titulo: "Vencem nos próximos 7 dias", qtd: r.vence_em_7_dias,
      desc: r.vence_em_7_dias ? plural(r.vence_em_7_dias, "lançamento", "lançamentos") : "Nada vencendo nesta semana" },
    { cor: "cinza", ico: "pessoas", href: "pessoas.html", titulo: "Pessoas com saldo em aberto", qtd: pessoasAbertas,
      desc: pessoasAbertas ? plural(pessoasAbertas, "pessoa", "pessoas") + " com valores pendentes" : "Ninguém com saldo em aberto" },
  ];
  $("alertas").innerHTML = alertas.map((a) => `
    <a class="alerta" href="${a.href}">
      <div class="alerta-icone ai-${a.cor}">${icone(a.ico, 21)}</div>
      <div class="alerta-info">
        <div class="alerta-titulo at-${a.cor}">${a.titulo}</div>
        <div class="alerta-desc">${a.desc}</div>
      </div>
      <span class="alerta-badge ai-${a.cor}">${a.qtd || 0}</span>
      <span class="alerta-seta">${icone("seta", 16)}</span>
    </a>`).join("");
}

iniciarPagina("index", async () => {
  $("titulo-ultimos").innerHTML = icone("lista", 18) + "Últimos lançamentos";
  $("titulo-fluxo").innerHTML = icone("resultado", 18) + "Fluxo financeiro";
  $("titulo-vencimentos").innerHTML = icone("calendario", 18) + "Próximos vencimentos";
  $("titulo-alertas").innerHTML = icone("alerta", 18) + "Alertas";
  $("periodo").onchange = recarregar;
  await recarregar();
});
