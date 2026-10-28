/* Configurações — contas, categorias e informações do bot */
const NOMES_TABELA = { movimentacoes: "Lançamento", pessoas: "Pessoa", contas: "Conta", categorias: "Categoria" };
const NOMES_ACAO = { insert: "criado", update: "alterado", delete: "excluído" };
const CAMPOS = { valor: "valor", status: "situação", data: "data", vencimento: "vencimento", liquidado_em: "data da baixa",
  tipo: "tipo", pessoa_id: "pessoa", categoria_id: "categoria", conta_id: "conta", descricao: "descrição",
  nome: "nome", saldo_inicial: "saldo inicial", desconto: "desconto", juros: "juros", orcamento_mensal: "orçamento" };

/* Resume uma linha do histórico: o que mudou, de quanto para quanto */
function resumoAuditoria(a) {
  const reg = a.depois || a.antes || {};
  const titulo = reg.descricao || reg.nome || (reg.tipo ? rotuloMov(reg) : "") || "";
  let mudancas = "";
  if (a.acao === "update") {
    mudancas = Object.keys(CAMPOS).filter((k) => JSON.stringify(a.antes?.[k]) !== JSON.stringify(a.depois?.[k]))
      .map((k) => {
        const f = (v) => v === null || v === undefined ? "vazio" : ["valor", "saldo_inicial", "desconto", "juros", "orcamento_mensal"].includes(k) ? brl(v)
          : ["data", "vencimento", "liquidado_em"].includes(k) ? dataBR(v) : String(v);
        return `${CAMPOS[k]}: ${f(a.antes?.[k])} → ${f(a.depois?.[k])}`;
      }).join("; ");
  } else if (reg.valor !== undefined) mudancas = brl(reg.valor);
  return `${NOMES_TABELA[a.tabela] || a.tabela} ${NOMES_ACAO[a.acao] || a.acao}${titulo ? ` · ${esc(titulo)}` : ""}${mudancas ? `<div class="fino muted">${esc(mudancas)}</div>` : ""}`;
}

async function recarregar() {
  await carregarAux(true);
  const [{ data: saldos }, { data: problemas, error: e1 }, { data: historico, error: e2 }] = await Promise.all([
    db.from("v_saldo_contas").select("conta_id,saldo"),
    db.from("v_inconsistencias").select("*").order("problema"),
    db.from("auditoria").select("*").order("em", { ascending: false }).limit(40),
  ]);
  const saldoConta = new Map((saldos || []).map((c) => [c.conta_id, Number(c.saldo)]));

  const ROTULOS = { emprestimo_sem_conta: "Empréstimo sem conta em aberto", aberto_sem_vencimento: "Conta em aberto sem vencimento",
    sem_pessoa: "Lançamento sem pessoa", baixado_no_futuro: "Baixa com data futura", possivel_duplicado: "Possível duplicidade" };
  $("lista-conferencia").innerHTML = e1 ? `<div class="vazio">Não foi possível conferir: ${esc(e1.message)}</div>`
    : (problemas || []).length
    ? `<table><thead><tr><th>Problema</th><th>Detalhe</th><th>Pessoa</th><th class="num">Valor</th><th class="num"></th></tr></thead>
       <tbody>${problemas.map((p) => `<tr>
         <td><span class="tag t-amarelo">${ROTULOS[p.problema] || p.problema}</span></td>
         <td class="fino">${esc(p.detalhe)}</td>
         <td>${esc(p.pessoa_nome || "—")}</td>
         <td class="num">${brl(p.valor)}</td>
         <td class="num"><button class="btn-link" onclick="abrirMov(${p.movimentacao_id})">Abrir</button></td></tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Nenhuma inconsistência encontrada.</div>`;

  $("lista-historico").innerHTML = e2 ? `<div class="vazio">Histórico indisponível: ${esc(e2.message)}</div>`
    : (historico || []).length
    ? `<table><tbody>${historico.map((a) => `<tr>
        <td class="fino" style="white-space:nowrap;width:130px">${new Date(a.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
        <td>${resumoAuditoria(a)}</td>
        <td class="fino muted">${a.usuario ? "painel" : "bot / sistema"}</td></tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Nenhuma alteração registrada ainda.</div>`;

  $("lista-contas").innerHTML = Aux.contas.length
    ? `<table><thead><tr><th>Conta</th><th>Tipo</th><th class="num">Saldo inicial</th><th class="num">Saldo hoje</th><th class="num"></th></tr></thead>
       <tbody>${Aux.contas.map((c) => `<tr>
          <td><strong>${esc(c.nome)}</strong>${c.instituicao ? `<div class="fino muted">${esc(c.instituicao)}</div>` : ""}</td>
          <td class="fino">${esc(c.tipo.replace("_", " "))}</td>
          <td class="num">${brl(c.saldo_inicial)}</td>
          <td class="num"><strong>${saldoConta.has(c.id) ? brl(saldoConta.get(c.id)) : "—"}</strong></td>
          <td class="num"><button class="btn-link" onclick="editarConta(${esc(JSON.stringify(c))})">Editar</button></td>
       </tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Nenhuma conta cadastrada.</div>`;

  $("lista-categorias").innerHTML = Aux.categorias.length
    ? `<table><thead><tr><th>Categoria</th><th>Natureza</th><th class="num">Orçamento/mês</th><th class="num"></th></tr></thead>
       <tbody>${Aux.categorias.map((c) => `<tr>
          <td><span class="ponto" style="background:${esc(c.cor)}"></span>${esc(c.nome)}</td>
          <td><span class="tag ${c.natureza === "receita" ? "t-verde" : "t-vermelho"}">${c.natureza}</span></td>
          <td class="num ${c.orcamento_mensal ? "" : "muted"}">${c.orcamento_mensal ? brl(c.orcamento_mensal) : "—"}</td>
          <td class="num"><button class="btn-link" onclick="editarCategoria(${esc(JSON.stringify(c))})">Editar</button></td>
       </tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Nenhuma categoria cadastrada.</div>`;

  const { count } = await db.from("movimentacoes").select("*", { count: "exact", head: true }).eq("origem", "telegram");
  $("tabela-bot").innerHTML = `
    <tr><td class="muted">Bot</td><td><a href="https://t.me/fred_financas_bot" target="_blank" rel="noopener">@fred_financas_bot</a></td></tr>
    <tr><td class="muted">Lançamentos vindos do bot</td><td>${count ?? 0}</td></tr>
    <tr><td class="muted">Comandos</td><td class="fino">/nova · /emprestei · /recebi · /paguei · /peguei · /pessoa · /extrato · /saldos</td></tr>`;
}

window.abrirMov = async (id) => {
  const { data } = await db.from("movimentacoes").select("*").eq("id", id).single();
  if (data) abrirLancamento(data);
};

function editarConta(c) {
  $("c-id").value = c?.id ?? "";
  $("c-nome").value = c?.nome ?? "";
  $("c-tipo").value = c?.tipo ?? "conta_corrente";
  $("c-saldo").value = c ? valorParaCampo(c.saldo_inicial) : "";
  $("c-inst").value = c?.instituicao ?? "";
  $("modal-conta").hidden = false;
}

function editarCategoria(c) {
  $("k-id").value = c?.id ?? "";
  $("k-nome").value = c?.nome ?? "";
  $("k-natureza").value = c?.natureza ?? "despesa";
  $("k-cor").value = c?.cor ?? "#6b7280";
  $("k-orcamento").value = c?.orcamento_mensal ? valorParaCampo(c.orcamento_mensal) : "";
  $("modal-categoria").hidden = false;
}

iniciarPagina("configuracoes", async () => {
  $("nova-conta").onclick = () => editarConta(null);
  mascaraMoeda($("c-saldo"));
  mascaraMoeda($("k-orcamento"));
  $("nova-categoria").onclick = () => editarCategoria(null);

  $("form-conta").onsubmit = async (e) => {
    e.preventDefault();
    const dados = {
      nome: $("c-nome").value.trim(),
      tipo: $("c-tipo").value,
      instituicao: $("c-inst").value.trim() || null,
      saldo_inicial: lerValor($("c-saldo").value) ?? 0,
    };
    const id = $("c-id").value;
    const { error } = id ? await db.from("contas").update(dados).eq("id", id)
                         : await db.from("contas").insert(dados);
    if (error) return avisar("Erro: " + error.message, true);
    $("modal-conta").hidden = true;
    avisar("Conta salva.");
    recarregar();
  };

  $("form-categoria").onsubmit = async (e) => {
    e.preventDefault();
    const dados = { nome: $("k-nome").value.trim(), natureza: $("k-natureza").value, cor: $("k-cor").value,
                    orcamento_mensal: lerValor($("k-orcamento").value) };
    const id = $("k-id").value;
    const { error } = id ? await db.from("categorias").update(dados).eq("id", id)
                         : await db.from("categorias").insert(dados);
    if (error) return avisar(error.code === "23505" ? "Já existe uma categoria com esse nome." : "Erro: " + error.message, true);
    $("modal-categoria").hidden = true;
    avisar("Categoria salva.");
    recarregar();
  };

  await recarregar();
});
