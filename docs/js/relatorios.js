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
  dadosAno = fluxo || [];

  const entradas = dadosAno.reduce((t, f) => t + Number(f.entradas), 0);
  const saidas = dadosAno.reduce((t, f) => t + Number(f.saidas), 0);
  const meses = dadosAno.length || 1;
  $("kpis").innerHTML = `
    <div class="kpi"><div class="bolha b-verde">&#8599;</div><div>
      <div class="rotulo">Entradas em ${ano}</div><div class="valor">${brl(entradas)}</div></div></div>
    <div class="kpi"><div class="bolha b-vermelho">&#8600;</div><div>
      <div class="rotulo">Saídas em ${ano}</div><div class="valor">${brl(saidas)}</div></div></div>
    <div class="kpi"><div class="bolha ${entradas - saidas >= 0 ? "b-verde" : "b-amarelo"}">&#8721;</div><div>
      <div class="rotulo">Resultado</div><div class="valor">${brl(entradas - saidas)}</div></div></div>
    <div class="kpi"><div class="bolha b-azul">&#8960;</div><div>
      <div class="rotulo">Gasto médio por mês</div><div class="valor">${brl(saidas / meses)}</div></div></div>`;

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
  g2 = rosca($("gr-despesas"), agrupar("despesa"));
  g3 = rosca($("gr-receitas"), agrupar("receita"));

  $("tabela-ano").innerHTML = dadosAno.length
    ? `<table><thead><tr><th>Mês</th><th class="num">Entradas</th><th class="num">Saídas</th><th class="num">Resultado</th></tr></thead>
       <tbody>${dadosAno.map((f) => `<tr>
          <td>${nomeMes(String(f.mes).slice(0, 7))}</td>
          <td class="num pos">${brl(f.entradas)}</td>
          <td class="num neg">${brl(f.saidas)}</td>
          <td class="num ${Number(f.resultado) >= 0 ? "pos" : "neg"}">${brl(f.resultado)}</td>
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
