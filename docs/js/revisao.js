/* Revisão de gastos: mapa de calor por categoria e sugestões de corte, com a economia por mês e por ano */
let movs = [], regras = {}, decisoes = [];
const TIPOS_SUG = {
  aumento:   { nome: "Aumento", cor: "t-vermelho", texto: (s) => `Subiu de ${brl(s.base)} (média dos meses anteriores) para ${brl(s.valor)}.` },
  fixa:      { nome: "Conta fixa", cor: "t-cinza", texto: (s) => `Cobrança de ${brl(s.valor)} que se repete há ${s.meses} mês(es). Ainda faz sentido?` },
  formiga:   { nome: "Gasto formiga", cor: "t-amarelo", texto: (s) => `${s.qtd} compras pequenas que somam ${brl(s.valor)} no mês. Cortar metade economiza ${brl(s.economia)}.` },
  duplicada: { nome: "Possível duplicata", cor: "t-vermelho", texto: (s) => `${s.qtd} lançamentos de ${brl(s.valor)} em até 3 dias. Confira se não foi cobrado duas vezes.` },
  nova:      { nome: "Conta nova", cor: "t-amarelo", texto: (s) => `Apareceu só neste mês: ${brl(s.valor)}.` },
};

async function recarregar() {
  const mes = $("mes").value;
  const r = Plan.revisao(movs, regras, mes, decisoes);
  const ativas = r.sugestoes.filter((s) => !s.decisao);
  // Cortes de verdade (aumentos e gasto formiga) ficam separados das contas fixas, que são só para rever
  const recorrente = ativas.filter((s) => ["aumento", "formiga"].includes(s.tipo)).reduce((t, s) => t + s.economia, 0);
  const fixas = ativas.filter((s) => s.tipo === "fixa");
  const avulsa = ativas.filter((s) => !s.recorrente).reduce((t, s) => t + s.economia, 0);
  const canceladas = decisoes.filter((d) => d.acao === "cancelei")
    .map((d) => ({ ...d, ...Plan.economiaRealizada(movs, d, Number(d.custo_mensal) || 0, mesAtual()) }));
  const feita = canceladas.reduce((t, c) => t + c.economia, 0);

  $("kpis").innerHTML =
    kpi("Economia possível por mês", brl(recorrente), "verde", "tesoura", `${brl(recorrente * 12)} por ano`, "",
        "Voltar ao gasto médio nas categorias que subiram e cortar metade do gasto formiga. Só o que você ainda não dispensou.") +
    kpi("Contas fixas para rever", brl(fixas.reduce((t, s) => t + s.economia, 0)), "azul", "calendario", `${fixas.length} conta(s) por mês`, "",
        "Assinaturas e contas que se repetem todo mês. Vale conferir se ainda fazem sentido.") +
    kpi("Para conferir", brl(avulsa), "amarelo", "alerta", `${ativas.filter((s) => !s.recorrente).length} item(ns) avulso(s)`, "",
        "Possíveis duplicatas e contas novas: valores de uma vez só, que vale conferir.") +
    kpi("Economia já feita", brl(feita), "azul", "receber", `${canceladas.length} cancelamento(s)`, "",
        "Para cada \"Cancelei\", conta os meses em que a cobrança não voltou.");

  const poucos = r.temHistorico < 2
    ? `<p class="aviso-lista">Ainda há pouco histórico (${r.temHistorico} mês(es) antes de ${nomeMes(mes)}). Aumentos, contas fixas e contas novas ficam mais precisos com 3 meses ou mais de lançamentos.</p>` : "";
  $("sugestoes").innerHTML = poucos + (r.sugestoes.length
    ? `<table><thead><tr><th>Tipo</th><th>Conta</th><th>Por quê</th><th class="num">Economia</th><th class="num"></th></tr></thead>
       <tbody>${r.sugestoes.map((s) => {
         const t = TIPOS_SUG[s.tipo];
         const acoes = s.decisao
           ? `<span class="tag t-cinza">${s.decisao.acao === "cancelei" ? "cancelei" : "dispensada"}</span> <button class="btn-link" onclick="desfazer(${s.decisao.id})">Desfazer</button>`
           : `${["fixa", "formiga"].includes(s.tipo) ? `<button class="btn-link" onclick='decidir(${esc(JSON.stringify({ tipo: s.tipo, chave: s.chave, rotulo: s.rotulo, custo: s.economia }))}, &quot;cancelei&quot;)'>Cancelei</button> · ` : ""}<button class="btn-link" style="color:var(--texto-2)" onclick='decidir(${esc(JSON.stringify({ tipo: s.tipo, chave: s.chave, rotulo: s.rotulo }))}, &quot;dispensar&quot;)'>Dispensar</button>`;
         return `<tr${s.decisao ? ' style="opacity:.55"' : ""}>
           <td><span class="tag ${t.cor}" style="white-space:nowrap">${t.nome}</span></td>
           <td><strong>${esc(s.rotulo)}</strong><div class="fino muted">${esc(s.categoria)}</div></td>
           <td class="fino">${t.texto(s)}</td>
           <td class="num">${brl(s.economia)}${s.recorrente ? '<div class="fino muted">por mês</div>' : '<div class="fino muted">uma vez</div>'}</td>
           <td class="num" style="white-space:nowrap">${acoes}</td></tr>`;
       }).join("")}</tbody></table>`
    : `<div class="vazio">Nenhuma sugestão de corte em ${nomeMes(mes)}.</div>`);

  const SIT = { confirmado: ["t-verde", "não voltou"], voltou: ["t-vermelho", "a cobrança voltou"], pendente: ["t-cinza", "aguardando o mês fechar"] };
  $("realizada").innerHTML = canceladas.length
    ? `<table><thead><tr><th>Conta</th><th>Cancelada em</th><th>Situação</th><th class="num">Meses sem cobrança</th><th class="num">Economia</th></tr></thead>
       <tbody>${canceladas.map((c) => `<tr><td><strong>${esc(c.rotulo || c.chave)}</strong></td><td>${dataBR(c.em)}</td>
         <td><span class="tag ${SIT[c.situacao][0]}">${SIT[c.situacao][1]}</span></td><td class="num">${c.meses}</td><td class="num">${brl(c.economia)}</td></tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Quando cancelar uma assinatura ou cortar um gasto, marque "Cancelei" na sugestão. Aqui você acompanha se a cobrança sumiu e quanto já economizou.</div>`;

  const max = Math.max(1, ...r.matriz.flatMap((l) => l.valores));
  $("matriz").innerHTML = r.matriz.length
    ? `<table><thead><tr><th>Categoria</th>${r.meses.map((m) => `<th class="num">${nomeMes(m)}</th>`).join("")}</tr></thead>
       <tbody>${r.matriz.map((l) => `<tr><td>${esc(l.categoria)}</td>${l.valores.map((v) =>
         `<td class="num" style="background:rgba(239,106,90,${(v / max) * 0.55})">${v ? brl(v) : '<span class="muted">—</span>'}</td>`).join("")}</tr>`).join("")}</tbody></table>
       <p class="legenda-regra">Quanto mais forte a cor, maior o gasto. Só receitas e despesas; empréstimos ficam de fora.</p>`
    : `<div class="vazio">Sem despesas nos últimos 6 meses.</div>`;
}

async function decidir(s, acao) {
  const { error } = await db.from("revisao_decisoes").upsert(
    { tipo: s.tipo, chave: s.chave, acao, rotulo: s.rotulo, custo_mensal: acao === "cancelei" ? s.custo : null, em: new Date().toISOString() },
    { onConflict: "tipo,chave" });
  if (error) return avisar("Erro ao salvar: " + error.message, true);
  await carregarDecisoes();
  avisar(acao === "cancelei" ? "Anotado. A economia aparece aqui a cada mês em que a cobrança não voltar." : "Sugestão dispensada.");
  recarregar();
}
async function desfazer(id) {
  const { error } = await db.from("revisao_decisoes").delete().eq("id", id);
  if (error) return avisar("Erro: " + error.message, true);
  await carregarDecisoes();
  recarregar();
}
async function carregarDecisoes() {
  const { data } = await db.from("revisao_decisoes").select("*").order("em");
  decisoes = data || [];
}

iniciarPagina("revisao", async () => {
  [movs, regras] = await Promise.all([carregarMovimentos(somarMeses(mesAtual() + "-01", -23)), carregarRegras(), carregarDecisoes()]);
  $("mes").value = Plan.ultimoMesComDados(movs, mesAtual());
  $("mes").onchange = recarregar;
  await recarregar();
});
