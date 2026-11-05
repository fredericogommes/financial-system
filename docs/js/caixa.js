/* Caixa — extrato do que já foi pago e recebido (regime de caixa: vale a data da baixa) */
const LIMITE_CAIXA = 1000;
let linhas = [];

async function recarregar() {
  let q = db.from("v_movimentacoes").select("*", { count: "exact" }).eq("status", "liquidado");
  if ($("f-de").value) q = q.gte("data_caixa", $("f-de").value);
  if ($("f-ate").value) q = q.lte("data_caixa", $("f-ate").value);
  if ($("f-conta").value) q = q.eq("conta_id", Number($("f-conta").value));
  if ($("f-categoria").value) q = q.eq("categoria_id", Number($("f-categoria").value));
  if ($("f-pessoa").value) q = q.eq("pessoa_id", Number($("f-pessoa").value));
  if ($("f-tipo").value) q = q.eq("direcao", Number($("f-tipo").value));
  if ($("f-grupo").value) q = q.eq("grupo", $("f-grupo").value);
  const busca = $("f-busca").value.replace(/[,()%*]/g, " ").trim(); // caracteres que quebram o filtro .or()
  if (busca) q = q.or(`descricao.ilike.%${busca}%,pessoa_nome.ilike.%${busca}%`);

  $("tabela").innerHTML = '<div class="carregando">Carregando...</div>';
  const [{ data, error, count }, { data: r }] = await Promise.all([
    q.order("data_caixa", { ascending: false }).order("id", { ascending: false }).limit(LIMITE_CAIXA),
    db.from("v_resumo_financeiro").select("saldo_atual").single(),
  ]);
  if (error) { $("tabela").innerHTML = ""; return avisar("Erro: " + error.message, true); }
  linhas = data;

  const entradas = somar(data.filter((m) => m.direcao === 1));
  const saidas = somar(data.filter((m) => m.direcao === -1));
  const receitas = somar(data.filter((m) => m.direcao === 1 && m.grupo === "resultado"));
  const despesas = somar(data.filter((m) => m.direcao === -1 && m.grupo === "resultado"));
  $("kpis").innerHTML =
    kpi("Saldo disponível hoje", brl(r?.saldo_atual), "azul", "saldo", "todas as contas, sem filtros", "",
        "Saldo inicial das contas + tudo que já entrou − tudo que já saiu (inclui empréstimos).") +
    kpi("Entradas no período", brl(entradas), "verde", "receber", "", "", "Tudo que entrou no caixa com os filtros aplicados.") +
    kpi("Saídas no período", brl(saidas), "vermelho", "pagar", "", "", "Tudo que saiu do caixa com os filtros aplicados.") +
    kpi("Variação do caixa", brl(dif(entradas, saidas)), dif(entradas, saidas) >= 0 ? "verde" : "amarelo", "resultado",
        `resultado (sem empréstimos): ${brl(dif(receitas, despesas))}`, "",
        "Entradas − saídas. O resultado desconta empréstimos concedidos, tomados e devolvidos.");

  filtrosAtivos("ativos", [
    { rotulo: "Período", valor: $("f-de").value || $("f-ate").value ? `${dataBR($("f-de").value)} a ${dataBR($("f-ate").value)}` : "",
      limpar: () => { $("f-de").value = ""; $("f-ate").value = ""; } },
    { rotulo: "Conta", valor: textoSelect("f-conta"), limpar: () => ($("f-conta").value = "") },
    { rotulo: "Categoria", valor: textoSelect("f-categoria"), limpar: () => ($("f-categoria").value = "") },
    { rotulo: "Pessoa", valor: textoSelect("f-pessoa"), limpar: () => ($("f-pessoa").value = "") },
    { rotulo: "Movimento", valor: textoSelect("f-tipo"), limpar: () => ($("f-tipo").value = "") },
    { rotulo: "Origem", valor: textoSelect("f-grupo"), limpar: () => ($("f-grupo").value = "") },
    { rotulo: "Busca", valor: busca, limpar: () => ($("f-busca").value = "") },
  ], recarregar);

  $("tabela").innerHTML = data.length
    ? `<table><thead><tr>
        <th>Data da baixa</th><th>Lançamento</th><th>Categoria</th><th>Conta</th><th>Pessoa</th>
        <th class="num">Valor</th><th class="num">Ações</th></tr></thead>
       <tbody>${data.map((m) => `<tr>
          <td>${dataBR(m.data_caixa)}${m.data !== m.data_caixa ? `<div class="fino muted">lançado ${dataBR(m.data)}</div>` : ""}</td>
          <td>${esc(m.descricao || rotuloMov(m))}<div class="fino muted">${[m.descricao && rotuloMov(m), m.grupo === "emprestimo" && "empréstimo", m.origem === "telegram" && "Telegram"].filter(Boolean).join(" · ")}</div></td>
          <td>${m.categoria_nome ? `<span class="ponto" style="background:${esc(m.categoria_cor)}"></span>${esc(m.categoria_nome)}` : '<span class="muted">—</span>'}</td>
          <td class="fino">${esc(m.conta_nome || "—")}</td>
          <td class="fino">${esc(m.pessoa_nome || "—")}</td>
          <td class="num ${m.direcao === 1 ? "pos" : "neg"}">${m.direcao === 1 ? "+" : "−"} ${brl(m.valor)}</td>
          <td class="num" style="white-space:nowrap">
            ${m.tipo === "emprestei" || m.tipo === "peguei_emprestado" ? "" : `<button class="btn-link" onclick="reabrir(${m.id})">Desfazer baixa</button> · `}
            <button class="btn-link" onclick="editar(${m.id})">Editar</button> ·
            <button class="btn-link" style="color:var(--vermelho)" onclick="excluirLancamento(${m.id})">Excluir</button>
          </td></tr>`).join("")}</tbody></table>` + rodapeLista(data.length, count ?? data.length, LIMITE_CAIXA)
    : `<div class="vazio">Nenhum pagamento ou recebimento com esses filtros.${$("ativos").innerHTML ? ' <button class="btn-link" onclick="limparFiltros()">Limpar filtros</button>' : ""}</div>`;
}

window.editar = async (id) => {
  const { data } = await db.from("movimentacoes").select("*").eq("id", id).single();
  abrirLancamento(data);
};

function limparFiltros() {
  ["f-busca", "f-de", "f-ate", "f-conta", "f-categoria", "f-pessoa", "f-tipo", "f-grupo"].forEach((i) => ($(i).value = ""));
  recarregar();
}

function exportarCSV() {
  baixarCSV(`caixa-${hoje()}.csv`,
    ["Data da baixa", "Data do lancamento", "Tipo", "Descricao", "Categoria", "Conta", "Pessoa", "Valor", "Entrada/Saida", "Origem"],
    linhas.map((m) => [dataBR(m.data_caixa), dataBR(m.data), rotuloMov(m), m.descricao, m.categoria_nome, m.conta_nome,
      m.pessoa_nome, valorCSV(m.valor), m.direcao === 1 ? "Entrada" : "Saida", m.grupo === "emprestimo" ? "Emprestimo" : "Resultado"]));
}

iniciarPagina("caixa", async () => {
  await carregarAux();
  $("f-conta").innerHTML = `<option value="">Todas</option>` +
    Aux.contas.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join("");
  $("f-categoria").innerHTML = `<option value="">Todas</option>` +
    Aux.categorias.map((c) => `<option value="${c.id}">${esc(c.nome)} (${c.natureza})</option>`).join("");
  $("f-pessoa").innerHTML = `<option value="">Todas</option>` +
    Aux.pessoas.map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join("");
  [$("f-de").value, $("f-ate").value] = PERIODOS.mes();
  const url = new URLSearchParams(location.search);   // links do dashboard: ?grupo=resultado
  if (url.get("grupo")) $("f-grupo").value = url.get("grupo");
  atalhosPeriodo("atalhos", ["mes", "anterior", "ult30", "ano", "tudo"], recarregar);
  let t;
  $("f-busca").oninput = () => { clearTimeout(t); t = setTimeout(recarregar, 300); };
  ["f-de", "f-ate", "f-conta", "f-categoria", "f-pessoa", "f-tipo", "f-grupo"].forEach((i) => ($(i).onchange = recarregar));
  $("f-limpar").onclick = limparFiltros;
  $("exportar").onclick = exportarCSV;
  await recarregar();
});
