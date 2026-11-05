/* Projeção dos próximos 6, 12 ou 24 meses e simulador de compra ou financiamento (tabela Price).
   Premissas editadas e simulações ficam só neste navegador. */
let grafico = null, movs = [], regras = {}, saldoHoje = 0, ajuste = {}, simulacoes = [];
const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} };
const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k)) ?? padrao; } catch (_) { return padrao; } };

function recarregar() {
  const n = Number($("horizonte").value), inicio = mesAtual();
  const extras = simulacoes.filter((s) => s.ativa).map((s) => ({ ...s, ...Plan.simulacao(s, inicio, n) }));
  const p = Plan.projecao(movs, regras, inicio, n, saldoHoje, extras, ajuste);
  const base = extras.length ? Plan.projecao(movs, regras, inicio, n, saldoHoje, [], ajuste) : p;
  const fim = p.meses.at(-1), pior = p.meses.reduce((w, m) => (m.saldo < w.saldo ? m : w));
  const negativos = p.meses.filter((m) => m.saldo < 0);

  $("kpis").innerHTML =
    kpi("Saldo disponível hoje", brl(saldoHoje), "azul", "saldo", "ponto de partida", "caixa.html") +
    kpi(`Saldo em ${nomeMes(fim.mes)}`, brl(fim.saldo), fim.saldo >= 0 ? "verde" : "vermelho", "resultado",
        extras.length ? `sem as simulações: ${brl(base.meses.at(-1).saldo)}` : `sobra média de ${brl((fim.saldo - saldoHoje) / n)} por mês`) +
    kpi("Menor saldo", brl(pior.saldo), pior.saldo >= 0 ? "verde" : "vermelho", "alerta", `em ${nomeMes(pior.mes)}`) +
    kpi("Meses no vermelho", negativos.length, negativos.length ? "vermelho" : "verde", "calendario",
        negativos.length ? `a partir de ${nomeMes(negativos[0].mes)}` : "o saldo não fica negativo");

  const pr = p.premissas;
  [["p-renda", "renda"], ["p-fixa", "fixa"], ["p-var", "variavel"]].forEach(([id, k]) => {
    if (document.activeElement !== $(id)) $(id).value = valorParaCampo(pr[k]);
    $(id).style.fontWeight = ajuste[k] !== undefined ? "700" : "";
  });
  $("p-base").textContent = pr.mesesBase
    ? `Calculado com ${pr.mesesBase} mês(es) de despesas e ${pr.mesesRenda} de receitas: receitas ${brl(pr.calculado.renda)}, fixas ${brl(pr.calculado.fixa)}, variáveis ${brl(pr.calculado.variavel)}. Valores em negrito foram editados por você.`
    : "Ainda não há meses completos com despesas. Preencha as premissas à mão para projetar.";
  $("p-restaurar").hidden = !Object.keys(ajuste).length;

  if (grafico) grafico.destroy();
  grafico = new Chart($("gr-proj"), {
    data: { labels: p.meses.map((m) => nomeMes(m.mes)), datasets: [
      { type: "line", label: "Saldo projetado", data: p.meses.map((m) => m.saldo), borderColor: "#2563eb", backgroundColor: "#2563eb", tension: .25, pointRadius: 2 },
      ...(extras.length ? [{ type: "line", label: "Sem simulações", data: base.meses.map((m) => m.saldo), borderColor: "#9aa3ad", borderDash: [5, 4], pointRadius: 0 }] : []),
      { type: "bar", label: "Sobra do mês", data: p.meses.map((m) => m.sobra), backgroundColor: p.meses.map((m) => (m.sobra >= 0 ? "#4cd35e" : "#ef6a5a")), borderRadius: 3 },
    ] },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${brl(c.raw)}` } } },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => brl(v).replace("R$", "").trim() } } } },
  });

  const col = (v, neg) => `<td class="num ${v ? (neg ? "neg" : "") : "muted"}">${v ? brl(v) : "—"}</td>`;
  $("tabela").innerHTML = `<table><thead><tr><th>Mês</th><th class="num">Receitas</th><th class="num">A receber</th><th class="num">Fixas</th><th class="num">Variáveis</th>
      <th class="num">Parcelas</th><th class="num">Outras contas</th><th class="num">A pagar (empréstimos)</th>${extras.length ? '<th class="num">Simulações</th>' : ""}
      <th class="num">Sobra</th><th class="num">Saldo</th></tr></thead>
    <tbody>${p.meses.map((m) => `<tr><td>${nomeMes(m.mes)}</td>${col(m.renda)}${col(m.receber)}${col(m.fixa, 1)}${col(m.variavel, 1)}${col(m.parcelas, 1)}${col(m.outras, 1)}${col(m.pagar, 1)}
      ${extras.length ? col(m.extra, 1) : ""}<td class="num ${m.sobra >= 0 ? "pos" : "neg"}">${brl(m.sobra)}</td><td class="num ${m.saldo >= 0 ? "" : "neg"}"><strong>${brl(m.saldo)}</strong></td></tr>`).join("")}</tbody></table>
    ${p.semVencimento ? `<p class="aviso-lista" style="margin-top:10px">${brl(p.semVencimento)} em contas abertas sem vencimento ficaram de fora. Dê um vencimento a elas em Contas a pagar ou a receber.</p>` : ""}`;

  $("simulacoes").innerHTML = simulacoes.length
    ? `<table><thead><tr><th></th><th>Simulação</th><th class="num">Parcela</th><th class="num">Parcelas</th><th class="num">Total pago</th><th class="num">Juros</th><th class="num"></th></tr></thead>
       <tbody>${simulacoes.map((s, i) => { const c = Plan.simulacao(s, inicio, n); return `<tr>
         <td><input type="checkbox" ${s.ativa ? "checked" : ""} onchange="alternar(${i})" title="Incluir na projeção" style="width:auto"></td>
         <td><strong>${esc(s.nome)}</strong><div class="fino muted">${brl(s.valor)}${s.entrada ? `, entrada de ${brl(s.entrada)}` : ""}, ${String(s.taxa).replace(".", ",")}% ao mês, a partir de ${nomeMes(s.inicio)}</div></td>
         <td class="num">${brl(c.parcela)}</td><td class="num">${s.parcelas}</td><td class="num">${brl(c.total)}</td><td class="num ${c.juros > 0 ? "neg" : "muted"}">${brl(c.juros)}</td>
         <td class="num"><button class="btn-link" style="color:var(--vermelho)" onclick="removerSim(${i})">Remover</button></td></tr>`; }).join("")}</tbody></table>`
    : `<div class="vazio">Simule um carro, uma reforma ou uma compra parcelada e veja o impacto no saldo dos próximos meses.</div>`;
}

function alternar(i) { simulacoes[i].ativa = !simulacoes[i].ativa; guardar("fin-simulacoes", simulacoes); recarregar(); }
function removerSim(i) { simulacoes.splice(i, 1); guardar("fin-simulacoes", simulacoes); recarregar(); }

function lerSim() {
  return { nome: $("s-nome").value.trim(), valor: lerValor($("s-valor").value) || 0, entrada: lerValor($("s-entrada").value) || 0,
    taxa: Number($("s-taxa").value) || 0, parcelas: Math.max(1, Number($("s-parcelas").value) || 1), inicio: $("s-inicio").value || mesAtual(), ativa: true };
}

iniciarPagina("projecao", async () => {
  ajuste = ler("fin-premissas", {}); simulacoes = ler("fin-simulacoes", []);
  const [m, r, { data: resumo }] = await Promise.all([
    carregarMovimentos(somarMeses(mesAtual() + "-01", -13)), carregarRegras(), db.from("v_resumo_financeiro").select("saldo_atual").single()]);
  movs = m; regras = r; saldoHoje = Number(resumo?.saldo_atual || 0);

  [["p-renda", "renda"], ["p-fixa", "fixa"], ["p-var", "variavel"]].forEach(([id, k]) => {
    mascaraMoeda($(id));
    $(id).addEventListener("change", () => {
      ajuste[k] = lerValor($(id).value) || 0; guardar("fin-premissas", ajuste); recarregar();
    });
  });
  $("p-restaurar").onclick = () => { ajuste = {}; guardar("fin-premissas", ajuste); recarregar(); };
  $("horizonte").onchange = recarregar;

  ["s-valor", "s-entrada"].forEach((id) => mascaraMoeda($(id)));
  const resumoSim = () => {
    const s = lerSim();
    if (!s.valor) return ($("s-resumo").textContent = "");
    const c = Plan.simulacao(s, mesAtual(), 1);
    $("s-resumo").textContent = `${s.parcelas} parcela(s) de ${brl(c.parcela)}. Total pago: ${brl(c.total)}, sendo ${brl(c.juros)} de juros.`;
  };
  ["s-valor", "s-entrada", "s-taxa", "s-parcelas"].forEach((id) => $(id).addEventListener("input", resumoSim));
  $("nova-sim").onclick = () => { $("form-sim").reset(); $("s-inicio").value = somarMeses(mesAtual() + "-01", 1).slice(0, 7); $("s-resumo").textContent = ""; $("modal-sim").hidden = false; $("s-nome").focus(); };
  $("s-cancelar").onclick = () => ($("modal-sim").hidden = true);
  $("form-sim").onsubmit = (e) => {
    e.preventDefault();
    const s = lerSim();
    if (!s.valor) return avisar("Informe o valor.", true);
    if (s.entrada >= s.valor) return avisar("A entrada precisa ser menor que o valor.", true);
    simulacoes.push(s); guardar("fin-simulacoes", simulacoes);
    $("modal-sim").hidden = true; recarregar();
  };
  recarregar();
});
