/* Lista de contas a pagar / a receber — usada por pagar.js e receber.js */
function montarLista(config) {
  const { pagina, direcao, tipoPadrao } = config; // direcao: -1 sai, +1 entra

  async function recarregar() {
    const situacao = $("f-situacao").value;
    let q = db.from("v_movimentacoes").select("*").eq("direcao", direcao);
    if (situacao === "pendente") q = q.eq("status", "pendente");
    else if (situacao === "liquidado") q = q.eq("status", "liquidado");
    else if (situacao === "vencido") q = q.eq("status", "pendente").lt("vencimento", hoje());
    if ($("f-de").value) q = q.gte("competencia", $("f-de").value);
    if ($("f-ate").value) q = q.lte("competencia", $("f-ate").value);
    if ($("f-categoria").value) q = q.eq("categoria_id", Number($("f-categoria").value));
    const busca = $("f-busca").value.replace(/[,()%*]/g, " ").trim(); // caracteres que quebram o filtro .or()
    if (busca) q = q.or(`descricao.ilike.%${busca}%,pessoa_nome.ilike.%${busca}%`);

    const { data, error } = await q.order("vencimento", { ascending: true, nullsFirst: false })
                                   .order("data", { ascending: false }).limit(300);
    if (error) return avisar("Erro: " + error.message, true);

    const abertos  = data.filter((m) => m.status === "pendente");
    const vencidos = abertos.filter((m) => m.vencimento && m.vencimento < hoje());
    const soma = (l) => l.reduce((t, m) => t + Number(m.valor), 0);
    $("kpis").innerHTML =
      kpi("Total em aberto", brl(soma(abertos)), direcao === 1 ? "verde" : "vermelho", direcao === 1 ? "receber" : "pagar",
          `${abertos.length} lançamento(s)`) +
      kpi("Vencidos", brl(soma(vencidos)), "amarelo", "alerta", `${vencidos.length} lançamento(s)`) +
      kpi("Na listagem", brl(soma(data)), "azul", "lista", `${data.length} lançamento(s)`);

    $("tabela").innerHTML = data.length
      ? `<table><thead><tr>
          <th>Vencimento</th><th>Lançamento</th><th>Categoria</th><th>Pessoa</th>
          <th>Situação</th><th class="num">Valor</th><th class="num">Ações</th>
        </tr></thead><tbody>${data.map((m) => {
          const atrasado = m.status === "pendente" && m.vencimento && m.vencimento < hoje();
          const tag = m.status === "liquidado"
            ? `<span class="tag t-verde">Baixado em ${dataBR(m.data_caixa)}</span>`
            : atrasado ? '<span class="tag t-vermelho">Vencido</span>' : '<span class="tag t-amarelo">Em aberto</span>';
          return `<tr>
            <td>${dataBR(m.vencimento || m.data)}</td>
            <td>${esc(m.descricao || rotuloMov(m))}<div class="fino muted">${rotuloMov(m)}${m.origem === "telegram" ? " · Telegram" : ""}</div></td>
            <td>${m.categoria_nome ? `<span class="ponto" style="background:${esc(m.categoria_cor)}"></span>${esc(m.categoria_nome)}` : '<span class="muted">—</span>'}</td>
            <td>${esc(m.pessoa_nome || "—")}</td>
            <td>${tag}</td>
            <td class="num ${direcao === 1 ? "pos" : "neg"}">${brl(m.valor)}</td>
            <td class="num" style="white-space:nowrap">
              ${m.status === "pendente" ? `<button class="btn-link" onclick="liquidar(${m.id})">Dar baixa</button> · ` : ""}
              <button class="btn-link" onclick="editar(${m.id})">Editar</button> ·
              <button class="btn-link" style="color:var(--vermelho)" onclick="excluirLancamento(${m.id})">Excluir</button>
            </td></tr>`; }).join("")}</tbody></table>`
      : `<div class="vazio">Nenhum lançamento com esses filtros.</div>`;
  }
  window.recarregar = recarregar;

  window.editar = async (id) => {
    const { data } = await db.from("movimentacoes").select("*").eq("id", id).single();
    abrirLancamento(data);
  };

  iniciarPagina(pagina, async () => {
    await carregarAux();
    const natureza = direcao === 1 ? "receita" : "despesa";
    $("f-categoria").innerHTML = `<option value="">Todas</option>` +
      Aux.categorias.filter((c) => c.natureza === natureza)
        .map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join("");
    let t;
    $("f-busca").oninput = () => { clearTimeout(t); t = setTimeout(recarregar, 300); };
    ["f-situacao", "f-de", "f-ate", "f-categoria"].forEach((i) => ($(i).onchange = recarregar));
    $("f-limpar").onclick = () => {
      ["f-busca", "f-de", "f-ate"].forEach((i) => ($(i).value = ""));
      $("f-situacao").value = "pendente"; $("f-categoria").value = "";
      recarregar();
    };
    await recarregar();
  });
}
