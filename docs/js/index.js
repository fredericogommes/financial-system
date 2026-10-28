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
  const [{ data: r, error }, { data: fluxo }, { data: venc }, { data: ult }, { data: pessoas }, { count: problemas }] = await Promise.all([
    db.from("v_resumo_financeiro").select("*").single(),
    db.from("v_fluxo_mensal").select("*").gte("mes", meses[0] + "-01"),
    db.from("v_movimentacoes").select("*").eq("status", "pendente")
      .order("vencimento", { ascending: true, nullsFirst: false }).limit(6),
    db.from("v_movimentacoes").select("*").eq("status", "liquidado")
      .order("data_caixa", { ascending: false }).order("id", { ascending: false }).limit(6),
    db.from("saldo_por_pessoa").select("em_aberto").neq("em_aberto", 0),
    db.from("v_inconsistencias").select("*", { count: "exact", head: true }),
  ]);
  if (error) return avisar("Erro ao carregar os indicadores: " + error.message, true);

  /* Cartões: cada um abre os lançamentos que formam o número */
  const resultado = dif(r.receitas_mes, r.despesas_mes);
  const anterior = dif(r.receitas_mes_anterior, r.despesas_mes_anterior);
  const projecao = (centavos(r.saldo_atual) + centavos(r.receber_30_dias) - centavos(r.pagar_30_dias)) / 100;
  const semVenc = dif(r.receber_sem_vencimento, r.pagar_sem_vencimento);
  $("kpis").innerHTML =
    kpi("Saldo disponível", brl(r.saldo_atual), "azul", "saldo", "dinheiro em caixa hoje", "caixa.html",
        "Saldo inicial das contas + tudo que já entrou − tudo que já saiu (regime de caixa, inclui empréstimos).") +
    kpi("A receber", brl(r.a_receber), "verde", "receber",
        Number(r.receber_vencido_valor) ? `${brl(r.receber_vencido_valor)} vencido` : "nada vencido", "receber.html",
        "Soma das contas a receber em aberto, vencidas ou não.") +
    kpi("A pagar", brl(r.a_pagar), "vermelho", "pagar",
        Number(r.pagar_vencido_valor) ? `${brl(r.pagar_vencido_valor)} vencido` : "nada vencido", "pagar.html",
        "Soma das contas a pagar em aberto, vencidas ou não.") +
    kpi("Resultado do mês", brl(resultado), resultado >= 0 ? "verde" : "amarelo", "resultado",
        `mês anterior: ${brl(anterior)}`, "caixa.html?grupo=resultado",
        "Receitas − despesas baixadas neste mês. Empréstimos não entram: não são ganho nem gasto.") +
    kpi("Projeção 30 dias", brl(projecao), projecao >= 0 ? "azul" : "amarelo", "calendario",
        semVenc ? `fora da conta: ${brl(r.receber_sem_vencimento)} a receber sem vencimento` : "saldo + a receber − a pagar até 30 dias",
        "receber.html?situacao=pendente&periodo=prox30",
        "Saldo disponível + contas a receber com vencimento até 30 dias (inclui vencidas) − contas a pagar no mesmo prazo. Contas sem vencimento ficam de fora.");

  /* Fluxo de caixa: todos os meses do período, mesmo sem lançamento */
  const porMes = new Map((fluxo || []).map((f) => [String(f.mes).slice(0, 7), f]));
  const entradas = meses.map((m) => Number(porMes.get(m)?.entradas || 0));
  const saidas = meses.map((m) => Number(porMes.get(m)?.saidas || 0));
  renderGrafico(meses, entradas, saidas);
  $("total-entradas").textContent = brl(somar(entradas, (x) => x));
  $("total-saidas").textContent = brl(somar(saidas, (x) => x));

  /* Últimos pagamentos e recebimentos */
  $("ultimos").innerHTML = (ult || []).length
    ? `<table class="tabela-dash"><thead><tr><th>Baixa</th><th>Lançamento</th><th>Categoria</th><th class="num">Valor</th></tr></thead>
       <tbody>${ult.map((m) => `<tr>
          <td>${dataBR(m.data_caixa)}</td>
          <td>${nomeLancamento(m)}</td>
          <td>${m.categoria_nome ? `<span class="ponto" style="background:${esc(m.categoria_cor)}"></span>${esc(m.categoria_nome)}` : `<span class="muted">${m.grupo === "emprestimo" ? "empréstimo" : "—"}</span>`}</td>
          <td class="num ${m.direcao === 1 ? "pos" : "neg"}">${m.direcao === 1 ? "+" : "−"} ${brl(m.valor)}</td>
       </tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Nenhum pagamento ou recebimento ainda.</div>`;

  /* Próximos vencimentos (a pagar e a receber) */
  $("vencimentos").innerHTML = (venc || []).length
    ? `<table class="tabela-dash"><thead><tr><th>Vencimento</th><th>Lançamento</th><th>Situação</th><th class="num">Valor</th><th></th></tr></thead>
       <tbody>${venc.map((m) => `<tr>
          <td>${m.vencimento ? dataBR(m.vencimento) : '<span class="muted">—</span>'}</td>
          <td>${nomeLancamento(m)}</td>
          <td>${situacao(m)}</td>
          <td class="num ${m.direcao === 1 ? "pos" : "neg"}">${m.direcao === 1 ? "+" : "−"} ${brl(m.valor)}</td>
          <td class="num"><button class="btn-link" onclick="liquidar(${m.id})">Dar baixa</button></td>
       </tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Nada em aberto. Tudo certo.</div>`;

  /* Alertas */
  const pessoasAbertas = (pessoas || []).length;
  const alertas = [
    { cor: "vermelho", ico: "calendario", href: "receber.html?situacao=vencido", titulo: "Contas a receber vencidas", qtd: r.receber_vencidos,
      desc: r.receber_vencidos ? `${plural(r.receber_vencidos, "conta", "contas")} · ${brl(r.receber_vencido_valor)}` : "Nenhuma conta vencida" },
    { cor: "amarelo", ico: "documento", href: "pagar.html?situacao=vencido", titulo: "Contas a pagar vencidas", qtd: r.pagar_vencidos,
      desc: r.pagar_vencidos ? `${plural(r.pagar_vencidos, "conta", "contas")} · ${brl(r.pagar_vencido_valor)}` : "Nenhuma conta vencida" },
    { cor: "verde", ico: "relogio", href: "pagar.html?situacao=a_vencer&periodo=prox7", titulo: "Vencem nos próximos 7 dias", qtd: r.vence_em_7_dias,
      desc: r.vence_em_7_dias ? plural(r.vence_em_7_dias, "conta a pagar ou receber", "contas a pagar ou receber") : "Nada vencendo nesta semana" },
    { cor: "cinza", ico: "pessoas", href: "pessoas.html", titulo: "Pessoas com valores em aberto", qtd: pessoasAbertas,
      desc: pessoasAbertas ? plural(pessoasAbertas, "pessoa", "pessoas") : "Ninguém com valor em aberto" },
    { cor: problemas ? "vermelho" : "cinza", ico: "alerta", href: "configuracoes.html#conferencia", titulo: "Conferência dos dados", qtd: problemas,
      desc: problemas ? plural(problemas, "item precisa de atenção", "itens precisam de atenção") : "Nenhuma inconsistência encontrada" },
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
  $("titulo-ultimos").innerHTML = icone("lista", 18) + "Últimos pagamentos e recebimentos";
  $("titulo-fluxo").innerHTML = icone("resultado", 18) + "Fluxo de caixa";
  $("titulo-vencimentos").innerHTML = icone("calendario", 18) + "Próximos vencimentos";
  $("titulo-alertas").innerHTML = icone("alerta", 18) + "Alertas";
  $("periodo").onchange = recarregar;
  await recarregar();
});
