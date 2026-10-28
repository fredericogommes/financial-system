/* Pessoas — débitos de cada pessoa e o que você tem a pagar */
let pessoaAtual = null;
// Na ficha a pessoa já está clara, então o tipo pode ser curto
const CURTO = { recebi: "Recebido", a_receber: "A receber", paguei: "Paguei", emprestei: "Emprestei", peguei_emprestado: "Peguei emprestado" };

function textoSaldo(s) {
  s = Number(s);
  if (s > 0) return `<span class="pos">${brl(s)}</span>`;
  if (s < 0) return `<span class="neg">− ${brl(-s)}</span>`;
  return `<span class="muted">${brl(0)}</span>`;
}

async function recarregar(semFicha = false) {
  const termo = $("busca").value.trim();
  let ids = null;
  if (termo) {
    const { data } = await db.rpc("buscar_pessoas", { termo });
    ids = (data || []).map((p) => p.id);
  }
  const { data: saldos, error } = await db.from("saldo_por_pessoa").select("*").order("saldo", { ascending: false });
  if (error) return avisar("Erro: " + error.message, true);

  const filtro = $("f-saldo").value;
  let lista = saldos.filter((s) =>
    filtro === "todos" ? true :
    filtro === "devem" ? Number(s.saldo) > 0 :
    filtro === "devo" ? Number(s.saldo) < 0 : Number(s.saldo) !== 0);
  if (ids) lista = lista.filter((s) => ids.includes(s.pessoa_id));

  const total = (f) => saldos.filter(f).reduce((t, s) => t + Math.abs(Number(s.saldo)), 0);
  $("kpis").innerHTML =
    kpi("Total em aberto", brl(total((s) => s.saldo > 0)), "verde", "receber") +
    kpi("Total de débitos", brl(total((s) => s.saldo < 0)), "vermelho", "pagar") +
    kpi("Pessoas cadastradas", saldos.length, "azul", "pessoas");

  $("lista").innerHTML = lista.length
    ? `<table><thead><tr><th>Pessoa</th><th>Última movimentação</th><th class="num">Em aberto</th></tr></thead>
       <tbody>${lista.map((s) => `<tr style="cursor:pointer" onclick="abrirPessoa(${s.pessoa_id})">
          <td><strong>${esc(s.nome)}</strong></td>
          <td class="fino muted">${dataBR(s.ultima_movimentacao)}</td>
          <td class="num">${textoSaldo(s.saldo)}</td></tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Ninguém encontrado.${termo ? ` <button class="btn-link" onclick="formPessoa({nome:${esc(JSON.stringify(termo))}})">Cadastrar "${esc(termo)}"</button>` : ""}</div>`;

  if (pessoaAtual && !semFicha) abrirPessoa(pessoaAtual.id, true);
}

async function abrirPessoa(id, silencioso) {
  const [{ data: p }, { data: s }, { data: movs }] = await Promise.all([
    db.from("pessoas").select("*").eq("id", id).single(),
    db.from("saldo_por_pessoa").select("*").eq("pessoa_id", id).single(),
    db.from("v_movimentacoes").select("*").eq("pessoa_id", id)
      .order("data", { ascending: false }).order("id", { ascending: false }).limit(50),
  ]);
  pessoaAtual = p;
  const info = [p.apelido, p.telefone, p.chave_pix && "Pix " + p.chave_pix]
    .filter(Boolean).join(" · ");
  $("ficha").innerHTML = `
    <h2>${esc(p.nome)} <button class="btn-link" onclick="formPessoa(pessoaAtual)">Editar</button>
      <button class="btn-link" style="color:var(--vermelho)" onclick="excluirPessoa()">Excluir pessoa</button></h2>
    <p class="fino muted" style="margin:-6px 0 10px">${esc(info) || "Sem dados de contato."}</p>
    <p style="font-size:17px;margin:0 0 14px"><span class="muted fino">Em aberto</span> ${textoSaldo(s?.saldo ?? 0)}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <button class="btn btn-primario" onclick="abrirLancamento(null,{tipo:'emprestei',pessoa_id:${p.id}})">Emprestar</button>
      <button class="btn" onclick="abrirLancamento(null,{tipo:'recebi',pessoa_id:${p.id}})">Recebi</button>
      <button class="btn" onclick="abrirLancamento(null,{tipo:'paguei',pessoa_id:${p.id}})">Paguei</button>
    </div>
    <h2>Extrato</h2>
    ${(movs || []).length
      ? `<table class="extrato"><tbody>${movs.map((m) => `<tr>
          <td class="fino">${dataBR(m.data)}</td>
          <td>${CURTO[tipoDoForm(m)] || rotuloMov(m)}${m.status === "pendente" ? `<span class="tag t-amarelo">${m.vencimento ? "vence " + dataBR(m.vencimento) : "em aberto"}</span>` : ""}
              ${m.descricao ? `<div class="fino muted">${esc(m.descricao)}</div>` : ""}</td>
          <td class="num ${m.status === "pendente" ? "muted" : m.direcao === 1 ? "pos" : "neg"}" style="white-space:nowrap">${brl(m.valor)}</td>
          <td class="num" style="white-space:nowrap">${m.status === "pendente" ? `<button class="btn-link" onclick="liquidar(${m.id})">Dar baixa</button> · ` : ""}<button class="btn-link" style="color:var(--vermelho)" onclick="excluirLancamento(${m.id})">Excluir</button></td>
        </tr>`).join("")}</tbody></table>`
      : `<div class="vazio">Sem movimentações ainda.</div>`}`;
  if (!silencioso) $("ficha").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function excluirPessoa() {
  const p = pessoaAtual;
  const { count } = await db.from("movimentacoes").select("id", { count: "exact", head: true }).eq("pessoa_id", p.id);
  const aviso = count
    ? `Excluir ${p.nome} e os ${count} lançamento(s) ligados a ela? Isso não pode ser desfeito.`
    : `Excluir ${p.nome}?`;
  if (!confirm(aviso)) return;
  if (count) {
    // Primeiro as contas a receber em aberto, depois o resto (empréstimos e baixas)
    const { error: e1 } = await db.from("movimentacoes").delete()
      .eq("pessoa_id", p.id).eq("tipo", "recebi").eq("status", "pendente");
    if (e1) return avisar("Erro ao excluir os lançamentos: " + e1.message, true);
    const { error } = await db.from("movimentacoes").delete().eq("pessoa_id", p.id);
    if (error) return avisar("Erro ao excluir os lançamentos: " + error.message, true);
  }
  const { error } = await db.from("pessoas").delete().eq("id", p.id);
  if (error) return avisar("Erro ao excluir: " + error.message, true);
  pessoaAtual = null;
  $("ficha").innerHTML = `<h2>Ficha</h2><p class="muted fino">Escolha alguém na lista ao lado.</p>`;
  avisar(`${p.nome} foi excluída.`);
  recarregar();
}

function formPessoa(p) {
  $("titulo-pessoa").textContent = p?.id ? "Editar pessoa" : "Nova pessoa";
  $("p-id").value = p?.id ?? "";
  $("p-nome").value = p?.nome ?? "";
  $("p-apelido").value = p?.apelido ?? "";
  $("p-tel").value = p?.telefone ?? "";
  $("p-pix").value = p?.chave_pix ?? "";
  $("p-obs").value = p?.observacoes ?? "";
  $("modal-pessoa").hidden = false;
  $("p-nome").focus();
}

iniciarPagina("pessoas", async () => {
  $("nova-pessoa").onclick = () => formPessoa(null);
  $("p-tel").oninput = (e) => {   // (00) 00000-0000
    const d = e.target.value.replace(/\D/g, "").slice(0, 11);
    e.target.value = d.length <= 2 ? d.replace(/^(\d+)/, "($1")
      : d.length <= 6 ? d.replace(/^(\d{2})(\d+)/, "($1) $2")
      : d.length <= 10 ? d.replace(/^(\d{2})(\d{4})(\d+)/, "($1) $2-$3")
      : d.replace(/^(\d{2})(\d{5})(\d+)/, "($1) $2-$3");
  };
  $("p-cancelar").onclick = () => ($("modal-pessoa").hidden = true);
  $("modal-pessoa").onclick = (e) => { if (e.target === $("modal-pessoa")) $("modal-pessoa").hidden = true; };
  let t;
  $("busca").oninput = () => { clearTimeout(t); t = setTimeout(() => recarregar(true), 300); };  // a ficha aberta não muda com a busca
  $("f-saldo").onchange = () => recarregar(true);

  $("form-pessoa").onsubmit = async (e) => {
    e.preventDefault();
    const dados = {
      nome: $("p-nome").value.trim(),
      apelido: $("p-apelido").value.trim() || null,
      telefone: $("p-tel").value.trim() || null,
      chave_pix: $("p-pix").value.trim() || null,
      observacoes: $("p-obs").value.trim() || null,
    };
    const id = $("p-id").value;
    const chave = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ");
    const igual = (await carregarAux()).pessoas.find((p) => chave(p.nome) === chave(dados.nome) && String(p.id) !== id);
    if (igual && !confirm(`Já existe uma pessoa chamada ${igual.nome}. Cadastrar outra com o mesmo nome?`)) return;
    const { data, error } = id
      ? await db.from("pessoas").update(dados).eq("id", id).select().single()
      : await db.from("pessoas").insert(dados).select().single();
    if (error) return avisar("Erro: " + error.message, true);
    $("modal-pessoa").hidden = true;
    await carregarAux(true);
    avisar("Pessoa salva.");
    await recarregar();
    abrirPessoa(data.id);
  };
  await recarregar();
});
