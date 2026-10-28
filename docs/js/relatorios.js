/* Relatórios do ano.
   Resultado = receitas − despesas (empréstimos ficam de fora: não são ganho nem gasto).
   Fluxo de caixa = tudo que entrou − tudo que saiu, inclusive empréstimos.
   Todos os valores usam a data da baixa (regime de caixa). */
let g1 = null, g2 = null, g3 = null, dadosAno = [];

function rosca(ctx, itens) {
  return new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: itens.map((i) => i.categoria),
      datasets: [{ data: itens.map((i) => Number(i.total)), backgroundColor: itens.map((i) => i.cor), borderWidth: 0 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "58%",
      plugins: {
        legend: { position: "right", labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.label}: ${brl(c.raw)}` } },
      },
    },
  });
}

const corValor = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "muted");

async function recarregar() {
  const ano = $("ano").value;
  const [{ data: fluxo }, { data: cats }, { data: ant }] = await Promise.all([
    db.from("v_fluxo_mensal").select("*").gte("mes", `${ano}-01-01`).lte("mes", `${ano}-12-01`).order("mes"),
    db.from("v_por_categoria").select("*").gte("mes", `${ano}-01-01`).lte("mes", `${ano}-12-01`),
    db.from("v_fluxo_mensal").select("receitas,despesas").gte("mes", `${ano - 1}-01-01`).lte("mes", `${ano - 1}-12-01`),
  ]);
  // Todos os meses do ano (até o mês atual, se for o ano corrente), mesmo os sem lançamento
  const ultimoMes = Number(ano) === Number(hoje().slice(0, 4)) ? Number(hoje().slice(5, 7)) : 12;
  const porMes = new Map((fluxo || []).map((f) => [String(f.mes).slice(0, 7), f]));
  dadosAno = Array.from({ length: ultimoMes }, (_, i) => {
    const mes = `${ano}-${String(i + 1).padStart(2, "0")}`;
    const f = porMes.get(mes) || {};
    const n = (k) => Number(f[k] || 0);
    return { mes, receitas: n("receitas"), despesas: n("despesas"), resultado: dif(n("receitas"), n("despesas")),
             entradas: n("entradas"), saidas: n("saidas"), fluxo: dif(n("entradas"), n("saidas")) };
  });

  const t = (k) => somar(dadosAno, (f) => f[k]);
  const receitas = t("receitas"), despesas = t("despesas"), resultado = dif(receitas, despesas);
  const fluxoLiq = dif(t("entradas"), t("saidas"));
  const resAnt = dif(somar(ant || [], (f) => f.receitas), somar(ant || [], (f) => f.despesas));
  $("kpis").innerHTML =
    kpi(`Receitas em ${ano}`, brl(receitas), "verde", "receber", "", `caixa.html?grupo=resultado`,
        "Receitas e recebimentos que não são devolução de empréstimo, pela data da baixa.") +
    kpi(`Despesas em ${ano}`, brl(despesas), "vermelho", "pagar", `média de ${brl(despesas / (dadosAno.length || 1))} por mês`, `caixa.html?grupo=resultado`,
        "Despesas e pagamentos que não são empréstimo, pela data da baixa.") +
    kpi("Resultado", brl(resultado), resultado >= 0 ? "verde" : "amarelo", "resultado", `${ano - 1}: ${brl(resAnt)}`, "",
        "Receitas − despesas. Mostra se você ganhou mais do que gastou; empréstimos não entram.") +
    kpi("Fluxo de caixa", brl(fluxoLiq), fluxoLiq >= 0 ? "azul" : "amarelo", "saldo", "inclui empréstimos", "caixa.html",
        "Tudo que entrou − tudo que saiu do caixa, inclusive empréstimos concedidos e devolvidos.");

  if (g1) g1.destroy();
  g1 = new Chart($("gr-ano"), {
    type: "bar",
    data: {
      labels: dadosAno.map((f) => nomeMes(f.mes)),
      datasets: [
        { label: "Receitas", data: dadosAno.map((f) => f.receitas), backgroundColor: "#4cd35e", borderRadius: 4 },
        { label: "Despesas", data: dadosAno.map((f) => f.despesas), backgroundColor: "#ef6a5a", borderRadius: 4 },
        { type: "line", label: "Resultado", data: dadosAno.map((f) => f.resultado), borderColor: "#2563eb", backgroundColor: "#2563eb", tension: .3, pointRadius: 3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${brl(c.raw)}` } } },
      scales: { y: { ticks: { callback: (v) => brl(v).replace("R$", "").trim() } }, x: { grid: { display: false } } },
    },
  });

  const agrupar = (nat) => {
    const m = new Map();
    (cats || []).filter((c) => c.natureza === nat).forEach((c) => {
      const a = m.get(c.categoria) || { categoria: c.categoria, cor: c.cor, total: 0 };
      a.total = dif(a.total, -Number(c.total)); m.set(c.categoria, a);
    });
    return [...m.values()].sort((a, b) => b.total - a.total);
  };
  if (g2) g2.destroy();
  if (g3) g3.destroy();
  const desp = agrupar("despesa"), rec = agrupar("receita");
  g2 = rosca($("gr-despesas"), desp);
  g3 = rosca($("gr-receitas"), rec);
  $("box-despesas").hidden = !desp.length; $("vazio-despesas").hidden = !!desp.length;
  $("box-receitas").hidden = !rec.length; $("vazio-receitas").hidden = !!rec.length;

  $("tabela-ano").innerHTML = dadosAno.length
    ? `<table><thead><tr><th>Mês</th><th class="num">Receitas</th><th class="num">Despesas</th><th class="num">Resultado</th>
         <th class="num">Entradas no caixa</th><th class="num">Saídas do caixa</th><th class="num">Fluxo de caixa</th></tr></thead>
       <tbody>${dadosAno.map((f) => `<tr>
          <td>${nomeMes(f.mes)}</td>
          <td class="num ${f.receitas ? "pos" : "muted"}">${brl(f.receitas)}</td>
          <td class="num ${f.despesas ? "neg" : "muted"}">${brl(f.despesas)}</td>
          <td class="num ${corValor(f.resultado)}">${brl(f.resultado)}</td>
          <td class="num ${f.entradas ? "" : "muted"}">${brl(f.entradas)}</td>
          <td class="num ${f.saidas ? "" : "muted"}">${brl(f.saidas)}</td>
          <td class="num ${corValor(f.fluxo)}">${brl(f.fluxo)}</td>
        </tr>`).join("")}
        <tr><td><strong>Total</strong></td><td class="num pos"><strong>${brl(receitas)}</strong></td>
        <td class="num neg"><strong>${brl(despesas)}</strong></td>
        <td class="num ${corValor(resultado)}"><strong>${brl(resultado)}</strong></td>
        <td class="num"><strong>${brl(t("entradas"))}</strong></td><td class="num"><strong>${brl(t("saidas"))}</strong></td>
        <td class="num ${corValor(fluxoLiq)}"><strong>${brl(fluxoLiq)}</strong></td></tr>
       </tbody></table>
       <p class="legenda-regra">A diferença entre o resultado e o fluxo de caixa são os empréstimos: dinheiro emprestado sai do caixa, mas não é gasto; a devolução entra no caixa, mas não é ganho.</p>`
    : `<div class="vazio">Nenhum lançamento em ${ano}.</div>`;

  await orcamento();
}

/* Orçado × realizado do mês escolhido, por categoria de despesa */
async function orcamento() {
  const mes = $("mes-orc").value;
  const { data: cats } = await db.from("v_por_categoria").select("categoria,total").eq("mes", mes + "-01").eq("natureza", "despesa");
  const real = new Map((cats || []).map((c) => [c.categoria, Number(c.total)]));
  const linhas = Aux.categorias.filter((c) => c.natureza === "despesa" && (Number(c.orcamento_mensal) || real.get(c.nome)))
    .map((c) => ({ nome: c.nome, cor: c.cor, orcado: Number(c.orcamento_mensal) || 0, realizado: real.get(c.nome) || 0 }));
  if (real.get("Sem categoria")) linhas.push({ nome: "Sem categoria", cor: "#6b7280", orcado: 0, realizado: real.get("Sem categoria") });
  const comOrc = Aux.categorias.some((c) => Number(c.orcamento_mensal));
  $("tabela-orcamento").innerHTML = linhas.length
    ? `<table><thead><tr><th>Categoria</th><th class="num">Orçado</th><th class="num">Realizado</th><th class="num">Diferença</th><th style="width:28%">Uso do orçamento</th></tr></thead>
       <tbody>${linhas.map((l) => {
         const uso = l.orcado ? Math.round((l.realizado / l.orcado) * 100) : null;
         const diferenca = dif(l.orcado, l.realizado);
         return `<tr><td><span class="ponto" style="background:${esc(l.cor)}"></span>${esc(l.nome)}</td>
           <td class="num ${l.orcado ? "" : "muted"}">${l.orcado ? brl(l.orcado) : "sem orçamento"}</td>
           <td class="num">${brl(l.realizado)}</td>
           <td class="num ${l.orcado ? corValor(diferenca) : "muted"}">${l.orcado ? (diferenca >= 0 ? "sobram " : "passou ") + brl(Math.abs(diferenca)) : "—"}</td>
           <td>${uso === null ? '<span class="fino muted">—</span>' : `<div style="display:flex;align-items:center;gap:8px"><div class="barra${uso > 100 ? " estourou" : ""}" style="flex:1"><span style="width:${Math.min(uso, 100)}%"></span></div><span class="fino">${uso}%</span></div>`}</td></tr>`;
       }).join("")}</tbody></table>
       ${comOrc ? "" : '<p class="legenda-regra">Nenhuma categoria tem orçamento ainda. Defina o valor mensal em Configurações → Categorias.</p>'}`
    : `<div class="vazio">Nenhuma despesa nem orçamento neste mês. Defina orçamentos em <a class="btn-link" href="configuracoes.html">Configurações</a>.</div>`;
}

iniciarPagina("relatorios", async () => {
  await carregarAux();
  const atual = Number(hoje().slice(0, 4));
  $("ano").innerHTML = [0, 1, 2, 3].map((i) => `<option value="${atual - i}">${atual - i}</option>`).join("");
  $("mes-orc").value = mesAtual();
  $("ano").onchange = recarregar;
  $("mes-orc").onchange = orcamento;
  $("exportar").onclick = () => baixarCSV(`relatorio-${$("ano").value}.csv`,
    ["Mes", "Receitas", "Despesas", "Resultado", "Entradas no caixa", "Saidas do caixa", "Fluxo de caixa"],
    dadosAno.map((f) => [f.mes, valorCSV(f.receitas), valorCSV(f.despesas), valorCSV(f.resultado),
      valorCSV(f.entradas), valorCSV(f.saidas), valorCSV(f.fluxo)]));
  await recarregar();
});
