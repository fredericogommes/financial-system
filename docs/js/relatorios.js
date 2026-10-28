/* Relatórios do ano */
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

async function recarregar() {
  const ano = $("ano").value;
  const [{ data: fluxo }, { data: cats }] = await Promise.all([
    db.from("v_fluxo_mensal").select("*").gte("mes", `${ano}-01-01`).lte("mes", `${ano}-12-01`).order("mes"),
    db.from("v_por_categoria").select("*").gte("mes", `${ano}-01-01`).lte("mes", `${ano}-12-01`),
  ]);
  // Todos os meses do ano (até o mês atual, se for o ano corrente), mesmo os sem lançamento
  const ultimoMes = Number(ano) === new Date().getFullYear() ? new Date().getMonth() + 1 : 12;
  const porMes = new Map((fluxo || []).map((f) => [String(f.mes).slice(0, 7), f]));
  dadosAno = Array.from({ length: ultimoMes }, (_, i) => {
    const mes = `${ano}-${String(i + 1).padStart(2, "0")}`;
    const f = porMes.get(mes);
    return { mes, entradas: Number(f?.entradas || 0), saidas: Number(f?.saidas || 0), resultado: Number(f?.resultado || 0) };
  });

  const entradas = dadosAno.reduce((t, f) => t + Number(f.entradas), 0);
  const saidas = dadosAno.reduce((t, f) => t + Number(f.saidas), 0);
  const meses = dadosAno.length || 1; // meses do ano até agora
  $("kpis").innerHTML =
    kpi(`Entradas em ${ano}`, brl(entradas), "verde", "receber") +
    kpi(`Saídas em ${ano}`, brl(saidas), "vermelho", "pagar") +
    kpi("Resultado", brl(entradas - saidas), entradas - saidas >= 0 ? "verde" : "amarelo", "resultado") +
    kpi("Gasto médio por mês", brl(saidas / meses), "azul", "media");

  if (g1) g1.destroy();
  g1 = new Chart($("gr-ano"), {
    type: "line",
    data: {
      labels: dadosAno.map((f) => nomeMes(String(f.mes).slice(0, 7))),
      datasets: [
        { label: "Entradas", data: dadosAno.map((f) => Number(f.entradas)), borderColor: "#2ecc40", backgroundColor: "rgba(46,204,64,.12)", fill: true, tension: .3 },
        { label: "Saídas", data: dadosAno.map((f) => Number(f.saidas)), borderColor: "#e74c3c", backgroundColor: "rgba(231,76,60,.10)", fill: true, tension: .3 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${brl(c.raw)}` } } },
      scales: { y: { beginAtZero: true, ticks: { callback: (v) => brl(v).replace("R$", "").trim() } },
                x: { grid: { display: false } } },
    },
  });

  const agrupar = (nat) => {
    const m = new Map();
    (cats || []).filter((c) => c.natureza === nat).forEach((c) => {
      const a = m.get(c.categoria) || { categoria: c.categoria, cor: c.cor, total: 0 };
      a.total += Number(c.total); m.set(c.categoria, a);
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
    ? `<table><thead><tr><th>Mês</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Resultado</th></tr></thead>
       <tbody>${dadosAno.map((f) => `<tr>
          <td>${nomeMes(String(f.mes).slice(0, 7))}</td>
          <td class="num ${f.entradas ? "pos" : "muted"}">${brl(f.entradas)}</td>
          <td class="num ${f.saidas ? "neg" : "muted"}">${brl(f.saidas)}</td>
          <td class="num ${f.resultado > 0 ? "pos" : f.resultado < 0 ? "neg" : "muted"}">${brl(f.resultado)}</td>
        </tr>`).join("")}
        <tr><td><strong>Total</strong></td><td class="num pos"><strong>${brl(entradas)}</strong></td>
        <td class="num neg"><strong>${brl(saidas)}</strong></td>
        <td class="num ${entradas - saidas >= 0 ? "pos" : "neg"}"><strong>${brl(entradas - saidas)}</strong></td></tr>
       </tbody></table>`
    : `<div class="vazio">Nenhum lançamento em ${ano}.</div>`;
}

iniciarPagina("relatorios", async () => {
  const atual = new Date().getFullYear();
  $("ano").innerHTML = [0, 1, 2, 3].map((i) => `<option value="${atual - i}">${atual - i}</option>`).join("");
  $("ano").onchange = recarregar;
  $("exportar").onclick = () => {
    const csv = [["Mes", "Entradas", "Saidas", "Resultado"],
      ...dadosAno.map((f) => [String(f.mes).slice(0, 7), f.entradas, f.saidas, f.resultado])]
      .map((l) => l.join(";")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `relatorio-${$("ano").value}.csv`; a.click();
    URL.revokeObjectURL(url);
  };
  await recarregar();
});
