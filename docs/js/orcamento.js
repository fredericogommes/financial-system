/* Orçamento: despesas do mês em fixas, parceladas e variáveis, e quanto da renda já está comprometido */
let grafico = null, movs = [], regras = {};
const CLASSES = { fixa: { nome: "Fixas", um: "Fixa", cor: "#2563eb" }, parcelada: { nome: "Parceladas", um: "Parcelada", cor: "#f0a11c" },
                  variavel: { nome: "Variáveis", um: "Variável", cor: "#ef6a5a" } };

async function recarregar() {
  const mes = $("mes").value;
  const o = Plan.orcamento(movs, regras, mes);
  const atual = o.serie.at(-1);
  const total = atual.fixa + atual.parcelada + atual.variavel;
  const renda = Plan.rendaTipica(movs, Plan.somarMes(mes, 1));
  const comprometido = atual.fixa + atual.parcelada;
  const pct = renda.valor ? Math.round((comprometido / renda.valor) * 100) : null;

  $("kpis").innerHTML =
    kpi("Fixas", brl(atual.fixa), "azul", "calendario", `${o.itens.filter((i) => i.classe === "fixa").length} conta(s)`, "",
        "Contas que se repetem todo mês com valor parecido, como aluguel, internet e assinaturas.") +
    kpi("Parceladas", brl(atual.parcelada), "amarelo", "lista", `${o.itens.filter((i) => i.classe === "parcelada").length} conta(s)`, "",
        "Compras divididas em parcelas (1/10, 2/10...).") +
    kpi("Variáveis", brl(atual.variavel), "vermelho", "pagar", `${o.itens.filter((i) => i.classe === "variavel").length} conta(s)`, "",
        "Todo o resto: mercado, lazer, compras avulsas.") +
    kpi("Renda comprometida", pct === null ? "—" : `${pct}%`, pct === null ? "azul" : pct > 70 ? "vermelho" : pct > 50 ? "amarelo" : "verde", "media",
        renda.valor ? `fixas + parceladas sobre ${brl(renda.valor)} de receita típica` : "sem receitas registradas para comparar", "",
        "Fixas + parceladas ÷ receita típica (mediana dos últimos 6 meses com receita). É o que já está comprometido antes de qualquer gasto variável.");

  $("divisao").innerHTML = total
    ? `<div style="display:flex;height:16px;border-radius:99px;overflow:hidden;background:#eef0f2">
         ${Object.entries(CLASSES).map(([k, c]) => atual[k] ? `<span title="${c.nome}: ${brl(atual[k])}" style="width:${(atual[k] / total) * 100}%;background:${c.cor}"></span>` : "").join("")}
       </div>
       <div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:10px" class="fino">
         ${Object.entries(CLASSES).map(([k, c]) => `<span><span class="ponto" style="background:${c.cor}"></span>${c.nome}: <strong>${brl(atual[k])}</strong> (${Math.round((atual[k] / total) * 100)}%)</span>`).join("")}
         <span class="muted">Total: <strong>${brl(total)}</strong></span>
       </div>`
    : `<div class="vazio">Nenhuma despesa baixada em ${nomeMes(mes)}.</div>`;

  if (grafico) grafico.destroy();
  grafico = new Chart($("gr-serie"), {
    type: "bar",
    data: { labels: o.serie.map((s) => nomeMes(s.mes)),
      datasets: Object.entries(CLASSES).map(([k, c]) => ({ label: c.nome, data: o.serie.map((s) => s[k]), backgroundColor: c.cor, borderRadius: 3 })) },
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { boxWidth: 10, font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${brl(c.raw)}` } } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: (v) => brl(v).replace("R$", "").trim() } } } },
  });

  $("itens").innerHTML = o.itens.length
    ? `<table><thead><tr><th>Conta</th><th>Categoria</th><th>Classe</th><th class="num">Meses no ano</th><th class="num">Lançamentos</th><th class="num">Valor no mês</th></tr></thead>
       <tbody>${o.itens.map((i) => `<tr>
         <td><strong>${esc(i.rotulo)}</strong></td>
         <td class="fino">${esc(i.categoria)}</td>
         <td><select data-chave="${esc(i.chave)}" class="classe" style="width:auto;padding:4px 8px">
           ${Object.entries(CLASSES).map(([k, c]) => `<option value="${k}"${k === i.classe ? " selected" : ""}>${c.um}</option>`).join("")}
           ${i.manual ? '<option value="">Automático</option>' : ""}
         </select>${i.manual ? ' <span class="tag t-cinza" title="Classe escolhida por você">manual</span>' : ""}</td>
         <td class="num">${i.meses}</td><td class="num">${i.qtd}</td>
         <td class="num">${brl(i.total)}</td></tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Sem despesas neste mês.</div>`;
  document.querySelectorAll("select.classe").forEach((s) => (s.onchange = () => corrigir(s.dataset.chave, s.value)));
}

/* Corrige a classe de uma conta (vale para todos os meses). Vazio volta à detecção automática. */
async function corrigir(chave, classe) {
  const { error } = classe
    ? await db.from("regras_despesa").upsert({ chave, classe, atualizado_em: new Date().toISOString() })
    : await db.from("regras_despesa").delete().eq("chave", chave);
  if (error) return avisar("Erro ao salvar: " + error.message, true);
  regras = await carregarRegras();
  avisar(classe ? "Classe corrigida. Vale para todos os meses dessa conta." : "A classe voltou a ser automática.");
  recarregar();
}

iniciarPagina("orcamento", async () => {
  [movs, regras] = await Promise.all([carregarMovimentos(somarMeses(mesAtual() + "-01", -23)), carregarRegras()]);
  $("mes").value = Plan.ultimoMesComDados(movs, mesAtual());
  $("mes").onchange = recarregar;
  await recarregar();
});
