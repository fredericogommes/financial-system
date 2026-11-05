/* Metas: juntar um valor até uma data, gastar menos em uma categoria ou manter uma reserva de N meses.
   O progresso é calculado na hora. Patrimônio = saldo disponível hoje, somando todas as contas. */
let movs = [], regras = {}, patrimonio = 0, projecaoBase = null;

const barra = (pct, ruim = false) =>
  `<div class="barra${ruim ? " estourou" : ""}" style="flex:1"><span style="width:${Math.max(0, Math.min(pct, 100))}%"></span></div>`;

function cartaoMeta(g) {
  const p = Plan.progressoMeta(g, { patrimonio, projecao: projecaoBase, movs, hojeIso: hoje() });
  let corpo = "";
  if (g.tipo === "juntar") {
    const pct = p.alvo ? (p.atual / p.alvo) * 100 : 0;
    corpo = `<div style="display:flex;align-items:center;gap:10px">${barra(pct)}<span class="fino">${Math.round(pct)}%</span></div>
      <p class="fino" style="margin:8px 0 0">${brl(p.atual)} de ${brl(p.alvo)} até ${nomeMes(String(g.data_alvo).slice(0, 7))}.</p>
      ${p.feito ? '<p class="pos fino">Meta alcançada.</p>'
        : `<p class="fino" style="margin:4px 0 0">Guardar <strong>${brl(p.porMes)}</strong> por mês nos próximos ${Math.max(p.faltamMeses, 1)} mês(es).
           ${p.cabe === null ? '<span class="muted">Ainda não há histórico para saber se cabe.</span>'
             : p.cabe ? `<span class="pos">Cabe na sobra projetada (${brl(p.sobra)} por mês).</span>`
             : `<span class="neg">Não cabe: a sobra projetada é de ${brl(p.sobra)} por mês.</span>`}</p>`}`;
  } else if (g.tipo === "reserva") {
    const pct = p.alvo ? (p.atual / p.alvo) * 100 : 0;
    corpo = p.cobertura === null
      ? `<p class="fino muted">Ainda não há despesas fixas detectadas para calcular a reserva.</p>`
      : `<div style="display:flex;align-items:center;gap:10px">${barra(pct)}<span class="fino">${Math.round(pct)}%</span></div>
         <p class="fino" style="margin:8px 0 0">O saldo de hoje (${brl(p.atual)}) cobre <strong>${p.cobertura.toFixed(1).replace(".", ",")} mês(es)</strong> de despesas fixas.
         Alvo: ${g.meses} meses = ${brl(p.alvo)}.</p>`;
  } else {
    const pct = p.alvo ? (p.atual / p.alvo) * 100 : 0;
    corpo = `<div style="display:flex;align-items:center;gap:10px">${barra(pct, p.atual > p.alvo)}<span class="fino">${Math.round(pct)}% do teto</span></div>
      <p class="fino" style="margin:8px 0 0">Teto de <strong>${brl(p.alvo)}</strong> por mês (${Number(g.percentual)}% abaixo da média de ${brl(g.base)}).
      Neste mês: ${brl(p.atual)}${p.ritmo !== null ? `, no ritmo de ${brl(p.ritmo)} até o fim do mês` : ""}.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">${p.historico.map((h, i) =>
        `<span class="tag ${i === p.historico.length - 1 ? "t-cinza" : h.ok ? "t-verde" : "t-vermelho"}" title="${brl(h.total)}">${nomeMes(h.mes)}${i === p.historico.length - 1 ? " (em andamento)" : h.ok ? " ✓" : " ✗"}</span>`).join("")}</div>`;
  }
  const TIPO = { juntar: "Juntar dinheiro", reduzir: "Gastar menos", reserva: "Reserva de emergência" };
  return `<div class="card" style="margin-bottom:14px">
    <h2>${esc(g.nome)} <span class="tag t-cinza" style="margin-left:8px">${TIPO[g.tipo]}${g.tipo === "reduzir" ? ": " + esc(g.categoria_nome) : ""}</span>
      <button class="btn-link" style="margin-left:auto;color:var(--vermelho)" onclick="excluirMeta(${g.id})">Excluir</button></h2>${corpo}</div>`;
}

async function recarregar() {
  const { data, error } = await db.from("metas").select("*, categorias(nome)").order("criado_em");
  if (error) return avisar("Erro: " + error.message, true);
  const metas = (data || []).map((g) => ({ ...g, categoria_nome: g.categorias?.nome }));
  const progresso = metas.map((g) => ({ g, p: Plan.progressoMeta(g, { patrimonio, projecao: projecaoBase, movs, hojeIso: hoje() }) }));
  const sobra = projecaoBase?.premissas.mesesBase ? projecaoBase.meses[0].sobra : null;
  $("kpis").innerHTML =
    kpi("Saldo disponível", brl(patrimonio), "azul", "saldo", "base das metas de juntar e de reserva", "caixa.html") +
    kpi("Sobra projetada no mês", sobra === null ? "—" : brl(sobra), sobra === null ? "azul" : sobra >= 0 ? "verde" : "vermelho", "resultado",
        sobra === null ? "precisa de histórico" : "receitas − despesas previstas", "projecao.html",
        "Da Projeção: receita típica − fixas − variáveis − parcelas e contas do mês.") +
    kpi("Metas", metas.length, "verde", "alvo", `${progresso.filter((x) => x.p.feito).length} alcançada(s)`);
  $("lista-metas").innerHTML = metas.length ? metas.map(cartaoMeta).join("")
    : `<div class="card"><div class="vazio">Nenhuma meta ainda. Crie uma para juntar dinheiro, gastar menos em uma categoria ou montar uma reserva de emergência.</div></div>`;
}

function mostrarCampos() {
  const t = $("m-tipo").value;
  document.querySelectorAll(".so-juntar,.so-reduzir,.so-reserva").forEach((e) => (e.style.display = e.classList.contains("so-" + t) ? "" : "none"));
  $("m-ajuda").textContent = {
    juntar: "Mostra quanto guardar por mês e se isso cabe na sobra projetada. O progresso usa o saldo disponível de hoje.",
    reduzir: "O teto é a média dos 3 meses anteriores menos o percentual, fixado hoje. Cada mês mostra se ficou abaixo do teto.",
    reserva: "O alvo é esse número de meses vezes as suas despesas fixas (média dos últimos 3 meses).",
  }[t];
}

async function excluirMeta(id) {
  if (!confirm("Excluir esta meta?")) return;
  const { error } = await db.from("metas").delete().eq("id", id);
  if (error) return avisar("Erro: " + error.message, true);
  recarregar();
}

iniciarPagina("metas", async () => {
  const aux = await carregarAux();
  const [m, r, { data: resumo }] = await Promise.all([
    carregarMovimentos(somarMeses(mesAtual() + "-01", -13)), carregarRegras(), db.from("v_resumo_financeiro").select("saldo_atual").single()]);
  movs = m; regras = r; patrimonio = Number(resumo?.saldo_atual || 0);
  projecaoBase = Plan.projecao(movs, regras, mesAtual(), 24, patrimonio);

  $("m-cat").innerHTML = aux.categorias.filter((c) => c.natureza === "despesa").map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join("");
  mascaraMoeda($("m-valor"));
  $("m-tipo").onchange = mostrarCampos;
  $("nova-meta").onclick = () => { $("form-meta").reset(); $("m-data").value = somarMeses(mesAtual() + "-01", 12).slice(0, 7); mostrarCampos(); $("modal-meta").hidden = false; $("m-nome").focus(); };
  $("m-cancelar").onclick = () => ($("modal-meta").hidden = true);
  $("form-meta").onsubmit = (e) => { e.preventDefault(); travar($("form-meta"), salvar); };
  await recarregar();
});

async function salvar() {
  const tipo = $("m-tipo").value, dados = { tipo, nome: $("m-nome").value.trim() };
  if (tipo === "juntar") {
    dados.valor_alvo = lerValor($("m-valor").value);
    dados.data_alvo = $("m-data").value ? $("m-data").value + "-01" : null;
    if (!dados.valor_alvo || !dados.data_alvo) return avisar("Informe o valor e a data da meta.", true);
  } else if (tipo === "reduzir") {
    const cat = Aux.categorias.find((c) => String(c.id) === $("m-cat").value);
    dados.categoria_id = cat?.id; dados.percentual = Number($("m-pct").value);
    dados.base = Plan.baseReducao(movs, cat?.nome, hoje());
    if (dados.base === null) return avisar(`Não há gastos em ${cat?.nome} nos 3 meses anteriores para servir de base.`, true);
    dados.base = Math.round(dados.base * 100) / 100;
  } else dados.meses = Number($("m-meses").value);
  const { error } = await db.from("metas").insert(dados);
  if (error) return avisar("Erro ao salvar: " + error.message, true);
  $("modal-meta").hidden = true;
  avisar("Meta criada.");
  recarregar();
}
