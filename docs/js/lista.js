/* Lista de contas a pagar / a receber — usada por pagar.js e receber.js */
const LIMITE_LISTA = 1000;
const FAIXAS = [
  { id: "1-30",  rotulo: "1 a 30 dias",  de: 1,  ate: 30 },
  { id: "31-60", rotulo: "31 a 60 dias", de: 31, ate: 60 },
  { id: "61-90", rotulo: "61 a 90 dias", de: 61, ate: 90 },
  { id: "90+",   rotulo: "mais de 90 dias", de: 91, ate: null },
];

function situacaoTexto(m) {
  if (m.status === "liquidado") return `<span class="tag t-verde">Baixado em ${dataBR(m.data_caixa)}</span>`;
  if (!m.vencimento) return '<span class="tag t-cinza">Em aberto · sem vencimento</span>';
  if (m.dias_atraso) return `<span class="tag t-vermelho">Vencido há ${m.dias_atraso} dia${m.dias_atraso > 1 ? "s" : ""}</span>`;
  if (m.vencimento === hoje()) return '<span class="tag t-amarelo">Vence hoje</span>';
  return '<span class="tag t-amarelo">Em aberto</span>';
}

function montarLista(config) {
  const { pagina, direcao } = config; // direcao: -1 sai, +1 entra
  const campoData = { vencimento: "competencia", lancamento: "data", baixa: "data_caixa" };
  let linhas = [];
  let faixa = null;

  async function recarregar() {
    const situacao = $("f-situacao").value;
    const tipoData = campoData[$("f-tipo-data").value];
    let q = db.from("v_movimentacoes").select("*", { count: "exact" }).eq("direcao", direcao);
    if (situacao === "pendente") q = q.eq("status", "pendente");
    else if (situacao === "liquidado") q = q.eq("status", "liquidado");
    else if (situacao === "vencido") q = q.eq("status", "pendente").lt("vencimento", hoje());
    else if (situacao === "a_vencer") q = q.eq("status", "pendente").gte("vencimento", hoje());
    if (faixa) {
      q = q.gte("dias_atraso", faixa.de);
      if (faixa.ate) q = q.lte("dias_atraso", faixa.ate);
    }
    if ($("f-de").value) q = q.gte(tipoData, $("f-de").value);
    if ($("f-ate").value) q = q.lte(tipoData, $("f-ate").value);
    if ($("f-categoria").value) q = q.eq("categoria_id", Number($("f-categoria").value));
    if ($("f-pessoa").value) q = q.eq("pessoa_id", Number($("f-pessoa").value));
    if ($("f-grupo").value) q = q.eq("grupo", $("f-grupo").value);
    const vmin = lerValor($("f-min").value), vmax = lerValor($("f-max").value);
    if (vmin) q = q.gte("valor", vmin);
    if (vmax) q = q.lte("valor", vmax);
    const busca = $("f-busca").value.replace(/[,()%*]/g, " ").trim(); // caracteres que quebram o filtro .or()
    if (busca) q = q.or(`descricao.ilike.%${busca}%,pessoa_nome.ilike.%${busca}%`);

    $("tabela").innerHTML = '<div class="carregando">Carregando...</div>';
    // Em aberto: o que vence primeiro no topo. Baixados: o mais recente no topo.
    q = situacao === "liquidado"
      ? q.order("data_caixa", { ascending: false })
      : q.order("vencimento", { ascending: true, nullsFirst: false }).order("data", { ascending: false });
    const [{ data, error, count }, { data: abertos }] = await Promise.all([
      q.order("id").limit(LIMITE_LISTA),
      // Cartões e faixas de atraso sempre olham todas as contas em aberto, sem os filtros
      db.from("v_movimentacoes").select("valor,vencimento,dias_atraso").eq("direcao", direcao).eq("status", "pendente"),
    ]);
    if (error) { $("tabela").innerHTML = ""; return avisar("Erro: " + error.message, true); }
    linhas = data;

    const ab = abertos || [];
    const vencidos = ab.filter((m) => m.dias_atraso);
    const prox30 = ab.filter((m) => m.vencimento && m.vencimento >= hoje() && m.vencimento <= somarDias(hoje(), 30));
    const semVenc = ab.filter((m) => !m.vencimento);
    const nome = direcao === 1 ? "receber" : "pagar";
    $("kpis").innerHTML =
      kpi("Total em aberto", brl(somar(ab)), direcao === 1 ? "verde" : "vermelho", nome,
          `${ab.length} conta(s)${semVenc.length ? ` · ${semVenc.length} sem vencimento` : ""}`, `${pagina}.html?situacao=pendente`,
          "Soma de todas as contas em aberto, com ou sem vencimento.") +
      kpi("Vencido", brl(somar(vencidos)), "amarelo", "alerta", `${vencidos.length} conta(s)`, `${pagina}.html?situacao=vencido`,
          "Contas em aberto com vencimento antes de hoje.") +
      kpi("Vence em 30 dias", brl(somar(prox30)), "azul", "calendario", `${prox30.length} conta(s)`, `${pagina}.html?situacao=a_vencer&periodo=prox30`,
          "Contas em aberto que vencem de hoje até daqui a 30 dias.") +
      kpi("Na listagem", brl(somar(data)), "azul", "lista", `${data.length} de ${count ?? data.length} com os filtros abaixo`, "",
          "Soma dos lançamentos que aparecem na tabela, com os filtros aplicados.");

    // Faixas de atraso (inadimplência): quanto está vencido e há quanto tempo
    $("faixas").innerHTML = FAIXAS.map((f) => {
      const itens = vencidos.filter((m) => m.dias_atraso >= f.de && (!f.ate || m.dias_atraso <= f.ate));
      return `<button type="button" class="faixa${faixa?.id === f.id ? " ativa" : ""}" data-f="${f.id}">
        <div class="faixa-rotulo">Vencido há ${f.rotulo}</div>
        <div class="faixa-valor ${itens.length ? "neg" : "muted"}">${brl(somar(itens))}</div>
        <div class="fino muted">${itens.length} conta(s)</div></button>`;
    }).join("");

    filtrosAtivos("ativos", [
      { rotulo: "Situação", valor: $("f-situacao").value !== "pendente" ? textoSelect("f-situacao") : "", limpar: () => ($("f-situacao").value = "pendente") },
      { rotulo: "Atraso", valor: faixa ? faixa.rotulo : "", limpar: () => (faixa = null) },
      { rotulo: textoSelect("f-tipo-data"), valor: $("f-de").value || $("f-ate").value ? `${dataBR($("f-de").value)} a ${dataBR($("f-ate").value)}` : "",
        limpar: () => { $("f-de").value = ""; $("f-ate").value = ""; } },
      { rotulo: "Categoria", valor: textoSelect("f-categoria"), limpar: () => ($("f-categoria").value = "") },
      { rotulo: "Pessoa", valor: textoSelect("f-pessoa"), limpar: () => ($("f-pessoa").value = "") },
      { rotulo: "Origem", valor: textoSelect("f-grupo"), limpar: () => ($("f-grupo").value = "") },
      { rotulo: "Valor", valor: vmin || vmax ? `${vmin ? "de " + brl(vmin) : ""} ${vmax ? "até " + brl(vmax) : ""}`.trim() : "",
        limpar: () => { $("f-min").value = ""; $("f-max").value = ""; } },
      { rotulo: "Busca", valor: busca, limpar: () => ($("f-busca").value = "") },
    ], recarregar);

    $("tabela").innerHTML = data.length
      ? `<table><thead><tr>
          <th>Vencimento</th><th>Lançamento</th><th>Pessoa</th><th>Categoria</th>
          <th>Situação</th><th class="num">Valor</th><th class="num">Ações</th>
        </tr></thead><tbody>${data.map((m) => `<tr>
            <td>${m.vencimento ? dataBR(m.vencimento) : '<span class="muted">—</span>'}<div class="fino muted">lançado ${dataBR(m.data)}</div></td>
            <td>${esc(m.descricao || rotuloMov(m))}<div class="fino muted">${[m.descricao && rotuloMov(m), m.grupo === "emprestimo" && "empréstimo", m.origem === "telegram" && "Telegram"].filter(Boolean).join(" · ")}</div></td>
            <td>${esc(m.pessoa_nome || "—")}</td>
            <td>${m.categoria_nome ? `<span class="ponto" style="background:${esc(m.categoria_cor)}"></span>${esc(m.categoria_nome)}` : '<span class="muted">—</span>'}</td>
            <td>${situacaoTexto(m)}</td>
            <td class="num ${direcao === 1 ? "pos" : "neg"}">${brl(m.valor)}${Number(m.desconto) || Number(m.juros) ? `<div class="fino muted">${Number(m.desconto) ? "desconto " + brl(m.desconto) : ""}${Number(m.juros) ? " juros " + brl(m.juros) : ""}</div>` : ""}</td>
            <td class="num" style="white-space:nowrap">
              ${m.status === "pendente" ? `<button class="btn-link" onclick="liquidar(${m.id})">Dar baixa</button> · ` : `<button class="btn-link" onclick="reabrir(${m.id})">Desfazer baixa</button> · `}
              <button class="btn-link" onclick="editar(${m.id})">Editar</button> ·
              <button class="btn-link" style="color:var(--vermelho)" onclick="excluirLancamento(${m.id})">Excluir</button>
            </td></tr>`).join("")}</tbody></table>` + rodapeLista(data.length, count ?? data.length, LIMITE_LISTA)
      : `<div class="vazio">Nenhuma conta com esses filtros.${$("ativos").innerHTML ? ' <button class="btn-link" onclick="limparFiltros()">Limpar filtros</button>' : ""}</div>`;
  }
  window.recarregar = recarregar;

  window.limparFiltros = () => {
    ["f-busca", "f-de", "f-ate", "f-min", "f-max"].forEach((i) => ($(i).value = ""));
    ["f-categoria", "f-pessoa", "f-grupo"].forEach((i) => ($(i).value = ""));
    $("f-situacao").value = "pendente"; $("f-tipo-data").value = "vencimento"; faixa = null;
    recarregar();
  };

  window.editar = async (id) => {
    const { data } = await db.from("movimentacoes").select("*").eq("id", id).single();
    abrirLancamento(data);
  };

  function exportar() {
    baixarCSV(`contas-a-${direcao === 1 ? "receber" : "pagar"}-${hoje()}.csv`,
      ["Vencimento", "Lancamento", "Baixa", "Tipo", "Descricao", "Pessoa", "Categoria", "Situacao", "Dias de atraso", "Valor", "Desconto", "Juros"],
      linhas.map((m) => [dataBR(m.vencimento), dataBR(m.data), m.status === "liquidado" ? dataBR(m.data_caixa) : "",
        rotuloMov(m), m.descricao, m.pessoa_nome, m.categoria_nome, m.status === "liquidado" ? "Baixado" : "Em aberto",
        m.dias_atraso ?? "", valorCSV(m.valor), valorCSV(m.desconto), valorCSV(m.juros)]));
  }

  iniciarPagina(pagina, async () => {
    await carregarAux();
    const natureza = direcao === 1 ? "receita" : "despesa";
    $("f-categoria").innerHTML = `<option value="">Todas</option>` +
      Aux.categorias.filter((c) => c.natureza === natureza)
        .map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join("");
    $("f-pessoa").innerHTML = `<option value="">Todas</option>` +
      Aux.pessoas.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join("");
    mascaraMoeda($("f-min")); mascaraMoeda($("f-max"));
    atalhosPeriodo("atalhos", ["mes", "anterior", "prox30", "ano", "tudo"], recarregar);

    // Links vindos do dashboard e dos cartões: ?situacao=vencido&periodo=prox30
    const url = new URLSearchParams(location.search);
    if (url.get("situacao")) $("f-situacao").value = url.get("situacao");
    if (url.get("periodo") && PERIODOS[url.get("periodo")]) [$("f-de").value, $("f-ate").value] = PERIODOS[url.get("periodo")]();

    let t;
    $("f-busca").oninput = () => { clearTimeout(t); t = setTimeout(recarregar, 300); };
    ["f-min", "f-max"].forEach((i) => ($(i).oninput = () => { clearTimeout(t); t = setTimeout(recarregar, 500); }));
    ["f-situacao", "f-tipo-data", "f-de", "f-ate", "f-categoria", "f-pessoa", "f-grupo"].forEach((i) => ($(i).onchange = recarregar));
    $("faixas").onclick = (e) => {
      const id = e.target.closest(".faixa")?.dataset.f; if (!id) return;
      faixa = faixa?.id === id ? null : FAIXAS.find((f) => f.id === id);
      if (faixa) $("f-situacao").value = "vencido";
      recarregar();
    };
    $("f-limpar").onclick = limparFiltros;
    $("exportar").onclick = exportar;
    await recarregar();
  });
}
