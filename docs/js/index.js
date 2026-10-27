/* Dashboard */
let grFluxo = null;

function kpi(rotulo, valor, bolha, ico, extra = "") {
  return `<div class="kpi"><div class="bolha ${bolha}">${ico}</div>
    <div><div class="rotulo">${rotulo}</div><div class="valor">${valor}</div>
    ${extra ? `<div class="fino muted">${extra}</div>` : ""}</div></div>`;
}

async function recarregar() {
  const meses = Number($("periodo").value || 6);
  const [{ data: r }, { data: fluxo }, { data: venc }, { data: ult }, { data: cats }] = await Promise.all([
    db.from("v_resumo_financeiro").select("*").single(),
    db.from("v_fluxo_mensal").select("*").order("mes", { ascending: false }).limit(meses),
    db.from("v_movimentacoes").select("*").eq("status", "pendente").order("vencimento", { nullsFirst: false }).limit(8),
    db.from("v_movimentacoes").select("*").eq("status", "liquidado").order("data", { ascending: false }).order("id", { ascending: false }).limit(8),
    db.from("v_por_categoria").select("*").eq("mes", mesAtual() + "-01").eq("natureza", "despesa").order("total", { ascending: false }),
  ]);

  const resultado = Number(r.entradas_mes) - Number(r.saidas_mes);
  $("kpis").innerHTML =
    kpi("Saldo atual", brl(r.saldo_atual), "b-azul", "R$") +
    kpi("A receber", brl(r.a_receber), "b-verde", "&#8599;",
        r.receber_vencidos ? `${r.receber_vencidos} vencido(s)` : "em dia") +
    kpi("A pagar", brl(r.a_pagar), "b-vermelho", "&#8600;",
        r.pagar_vencidos ? `${r.pagar_vencidos} vencido(s)` : "em dia") +
    kpi("Resultado do mês", brl(resultado), resultado >= 0 ? "b-verde" : "b-amarelo", "&#8721;",
        `${brl(r.entradas_mes)} entraram · ${brl(r.saidas_mes)} saíram`);

  /* Gráfico */
  const linha = (fluxo || []).slice().reverse();
  const ctx = $("gr-fluxo");
  if (grFluxo) grFluxo.destroy();
  grFluxo = new Chart(ctx, {
    type: "bar",
    data: {
      labels: linha.map((f) => nomeMes(String(f.mes).slice(0, 7))),
      datasets: [
        { label: "Entradas (R$)", data: linha.map((f) => Number(f.entradas)), backgroundColor: "#2ecc40", borderRadius: 5 },
        { label: "Saídas (R$)", data: linha.map((f) => Number(f.saidas)), backgroundColor: "#e74c3c", borderRadius: 5 },
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

  /* Categorias do mês */
  const totalCat = (cats || []).reduce((t, c) => t + Number(c.total), 0);
  $("categorias-mes").innerHTML = (cats || []).length
    ? `<table><tbody>${cats.slice(0, 7).map((c) => `<tr>
        <td><span class="ponto" style="background:${esc(c.cor)}"></span>${esc(c.categoria)}</td>
        <td class="num">${brl(c.total)}</td>
        <td class="num muted fino">${totalCat ? Math.round((c.total / totalCat) * 100) : 0}%</td>
      </tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Nenhuma despesa registrada neste mês.</div>`;

  /* Vencimentos */
  $("vencimentos").innerHTML = (venc || []).length
    ? `<table><thead><tr><th>Vencimento</th><th>Lançamento</th><th class="num">Valor</th><th></th></tr></thead>
       <tbody>${venc.map((m) => {
         const atrasado = m.vencimento && m.vencimento < hoje();
         return `<tr>
           <td>${dataBR(m.vencimento)} ${atrasado ? '<span class="tag t-vermelho">vencido</span>' : ""}</td>
           <td>${esc(m.descricao || rotuloTipo(m.tipo))}${m.pessoa_nome ? ` <span class="muted fino">· ${esc(m.pessoa_nome)}</span>` : ""}</td>
           <td class="num ${entra(m.tipo) ? "pos" : "neg"}">${brl(m.valor)}</td>
           <td class="num"><button class="btn-link" onclick="liquidar(${m.id})">Dar baixa</button></td>
         </tr>`; }).join("")}</tbody></table>`
    : `<div class="vazio">Nada em aberto. Tudo certo.</div>`;

  /* Últimos lançamentos */
  $("ultimos").innerHTML = (ult || []).length
    ? `<table><thead><tr><th>Data</th><th>Lançamento</th><th>Categoria</th><th class="num">Valor</th></tr></thead>
       <tbody>${ult.map((m) => `<tr>
          <td>${dataBR(m.data)}</td>
          <td>${esc(m.descricao || rotuloTipo(m.tipo))}${m.pessoa_nome ? ` <span class="muted fino">· ${esc(m.pessoa_nome)}</span>` : ""}</td>
          <td class="muted fino">${esc(m.categoria_nome || "—")}</td>
          <td class="num ${entra(m.tipo) ? "pos" : "neg"}">${entra(m.tipo) ? "+" : "−"} ${brl(m.valor)}</td>
       </tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Nenhum lançamento ainda.</div>`;
}

iniciarPagina("index", async () => {
  $("periodo").onchange = recarregar;
  await recarregar();
});
