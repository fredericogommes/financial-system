/* Configurações — contas, categorias e informações do bot */
async function recarregar() {
  await carregarAux(true);

  $("lista-contas").innerHTML = Aux.contas.length
    ? `<table><thead><tr><th>Conta</th><th>Tipo</th><th class="num">Saldo inicial</th><th class="num"></th></tr></thead>
       <tbody>${Aux.contas.map((c) => `<tr>
          <td><strong>${esc(c.nome)}</strong>${c.instituicao ? `<div class="fino muted">${esc(c.instituicao)}</div>` : ""}</td>
          <td class="fino">${esc(c.tipo.replace("_", " "))}</td>
          <td class="num">${brl(c.saldo_inicial)}</td>
          <td class="num"><button class="btn-link" onclick="editarConta(${esc(JSON.stringify(c))})">Editar</button></td>
       </tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Nenhuma conta cadastrada.</div>`;

  $("lista-categorias").innerHTML = Aux.categorias.length
    ? `<table><thead><tr><th>Categoria</th><th>Natureza</th><th class="num"></th></tr></thead>
       <tbody>${Aux.categorias.map((c) => `<tr>
          <td><span class="ponto" style="background:${esc(c.cor)}"></span>${esc(c.nome)}</td>
          <td><span class="tag ${c.natureza === "receita" ? "t-verde" : "t-vermelho"}">${c.natureza}</span></td>
          <td class="num"><button class="btn-link" onclick="editarCategoria(${esc(JSON.stringify(c))})">Editar</button></td>
       </tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Nenhuma categoria cadastrada.</div>`;

  const { count } = await db.from("movimentacoes").select("*", { count: "exact", head: true }).eq("origem", "telegram");
  $("tabela-bot").innerHTML = `
    <tr><td class="muted">Bot</td><td><a href="https://t.me/fred_financas_bot" target="_blank" rel="noopener">@fred_financas_bot</a></td></tr>
    <tr><td class="muted">Lançamentos vindos do bot</td><td>${count ?? 0}</td></tr>
    <tr><td class="muted">Comandos</td><td class="fino">/nova · /emprestei · /recebi · /paguei · /peguei · /pessoa · /extrato · /saldos</td></tr>`;
}

function editarConta(c) {
  $("c-id").value = c?.id ?? "";
  $("c-nome").value = c?.nome ?? "";
  $("c-tipo").value = c?.tipo ?? "conta_corrente";
  $("c-saldo").value = c ? String(c.saldo_inicial).replace(".", ",") : "";
  $("c-inst").value = c?.instituicao ?? "";
  $("modal-conta").hidden = false;
}

function editarCategoria(c) {
  $("k-id").value = c?.id ?? "";
  $("k-nome").value = c?.nome ?? "";
  $("k-natureza").value = c?.natureza ?? "despesa";
  $("k-cor").value = c?.cor ?? "#6b7280";
  $("modal-categoria").hidden = false;
}

iniciarPagina("configuracoes", async () => {
  $("nova-conta").onclick = () => editarConta(null);
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
    const dados = { nome: $("k-nome").value.trim(), natureza: $("k-natureza").value, cor: $("k-cor").value };
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
