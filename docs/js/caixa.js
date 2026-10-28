/* Caixa — extrato do que já aconteceu */
let linhas = [];

async function recarregar() {
  let q = db.from("v_movimentacoes").select("*").eq("status", "liquidado");
  if ($("f-de").value) q = q.gte("data_caixa", $("f-de").value);
  if ($("f-ate").value) q = q.lte("data_caixa", $("f-ate").value);
  if ($("f-conta").value) q = q.eq("conta_id", Number($("f-conta").value));
  if ($("f-categoria").value) q = q.eq("categoria_id", Number($("f-categoria").value));
  if ($("f-tipo").value) q = q.eq("direcao", Number($("f-tipo").value));
  const busca = $("f-busca").value.replace(/[,()%*]/g, " ").trim(); // caracteres que quebram o filtro .or()
  if (busca) q = q.or(`descricao.ilike.%${busca}%,pessoa_nome.ilike.%${busca}%`);

  const { data, error } = await q.order("data_caixa", { ascending: false }).order("id", { ascending: false }).limit(500);
  if (error) return avisar("Erro: " + error.message, true);
  linhas = data;

  const entradas = data.filter((m) => m.direcao === 1).reduce((t, m) => t + Number(m.valor), 0);
  const saidas = data.filter((m) => m.direcao === -1).reduce((t, m) => t + Number(m.valor), 0);
  const { data: r } = await db.from("v_resumo_financeiro").select("saldo_atual").single();

  $("kpis").innerHTML =
    kpi("Saldo atual", brl(r?.saldo_atual), "azul", "saldo", "saldo inicial das contas + tudo que já entrou e saiu") +
    kpi("Entradas no período", brl(entradas), "verde", "receber") +
    kpi("Saídas no período", brl(saidas), "vermelho", "pagar") +
    kpi("Resultado", brl(entradas - saidas), entradas - saidas >= 0 ? "verde" : "amarelo", "resultado");

  $("tabela").innerHTML = data.length
    ? `<table><thead><tr>
        <th>Data</th><th>Lançamento</th><th>Categoria</th><th>Conta</th><th>Pessoa</th>
        <th class="num">Valor</th><th class="num">Ações</th></tr></thead>
       <tbody>${data.map((m) => `<tr>
          <td>${dataBR(m.data_caixa)}</td>
          <td>${esc(m.descricao || rotuloMov(m))}<div class="fino muted">${m.descricao ? rotuloMov(m) : ""}${m.origem === "telegram" ? (m.descricao ? " · " : "") + "Telegram" : ""}</div></td>
          <td>${m.categoria_nome ? `<span class="ponto" style="background:${esc(m.categoria_cor)}"></span>${esc(m.categoria_nome)}` : '<span class="muted">—</span>'}</td>
          <td class="fino">${esc(m.conta_nome || "—")}</td>
          <td class="fino">${esc(m.pessoa_nome || "—")}</td>
          <td class="num ${m.direcao === 1 ? "pos" : "neg"}">${m.direcao === 1 ? "+" : "−"} ${brl(m.valor)}</td>
          <td class="num" style="white-space:nowrap">
            <button class="btn-link" onclick="editar(${m.id})">Editar</button> ·
            <button class="btn-link" style="color:var(--vermelho)" onclick="excluirLancamento(${m.id})">Excluir</button>
          </td></tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Nenhum lançamento com esses filtros.</div>`;
}

window.editar = async (id) => {
  const { data } = await db.from("movimentacoes").select("*").eq("id", id).single();
  abrirLancamento(data);
};

function exportarCSV() {
  const cab = ["Data", "Tipo", "Descricao", "Categoria", "Conta", "Pessoa", "Valor", "Entrada/Saida"];
  const linha = (m) => [dataBR(m.data_caixa), rotuloMov(m), m.descricao || "", m.categoria_nome || "",
    m.conta_nome || "", m.pessoa_nome || "", String(m.valor).replace(".", ","), m.direcao === 1 ? "Entrada" : "Saida"];
  const csv = [cab, ...linhas.map(linha)]
    .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
  const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = `caixa-${hoje()}.csv`; a.click();
  URL.revokeObjectURL(url);
}

iniciarPagina("caixa", async () => {
  await carregarAux();
  $("f-conta").innerHTML = `<option value="">Todas</option>` +
    Aux.contas.map((c) => `<option value="${c.id}">${esc(c.nome)}</option>`).join("");
  $("f-categoria").innerHTML = `<option value="">Todas</option>` +
    Aux.categorias.map((c) => `<option value="${c.id}">${esc(c.nome)} (${c.natureza})</option>`).join("");
  $("f-de").value = mesAtual() + "-01";
  let t;
  $("f-busca").oninput = () => { clearTimeout(t); t = setTimeout(recarregar, 300); };
  ["f-de", "f-ate", "f-conta", "f-categoria", "f-tipo"].forEach((i) => ($(i).onchange = recarregar));
  $("f-limpar").onclick = () => {
    ["f-busca", "f-de", "f-ate"].forEach((i) => ($(i).value = ""));
    ["f-conta", "f-categoria", "f-tipo"].forEach((i) => ($(i).value = ""));
    recarregar();
  };
  $("exportar").onclick = exportarCSV;
  await recarregar();
});
