/* Pessoas — quem te deve, para quem você deve */
let pessoaAtual = null;

function textoSaldo(s) {
  s = Number(s);
  if (s > 0) return `<span class="pos">Te deve ${brl(s)}</span>`;
  if (s < 0) return `<span class="neg">Você deve ${brl(-s)}</span>`;
  return `<span class="muted">Quite</span>`;
}

async function recarregar() {
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
    kpi("Total que te devem", brl(total((s) => s.saldo > 0)), "verde", "receber") +
    kpi("Total que você deve", brl(total((s) => s.saldo < 0)), "vermelho", "pagar") +
    kpi("Pessoas cadastradas", saldos.length, "azul", "pessoas");

  $("lista").innerHTML = lista.length
    ? `<table><thead><tr><th>Pessoa</th><th>Última movimentação</th><th class="num">Saldo</th></tr></thead>
       <tbody>${lista.map((s) => `<tr style="cursor:pointer" onclick="abrirPessoa(${s.pessoa_id})">
          <td><strong>${esc(s.nome)}</strong></td>
          <td class="fino muted">${dataBR(s.ultima_movimentacao)}</td>
          <td class="num">${textoSaldo(s.saldo)}</td></tr>`).join("")}</tbody></table>`
    : `<div class="vazio">Ninguém encontrado.${termo ? ` <button class="btn-link" onclick="formPessoa({nome:${esc(JSON.stringify(termo))}})">Cadastrar "${esc(termo)}"</button>` : ""}</div>`;

  if (pessoaAtual) abrirPessoa(pessoaAtual.id, true);
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
    <h2>${esc(p.nome)} <button class="btn-link" onclick="formPessoa(pessoaAtual)">Editar</button></h2>
    <p class="fino muted" style="margin:-6px 0 10px">${esc(info) || "Sem dados de contato."}</p>
    <p style="font-size:17px;margin:0 0 14px">${textoSaldo(s?.saldo ?? 0)}</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
      <button class="btn btn-primario" onclick="abrirLancamento(null,{tipo:'emprestei',pessoa_id:${p.id}})">Emprestar</button>
      <button class="btn" onclick="abrirLancamento(null,{tipo:'recebi',pessoa_id:${p.id}})">Recebi</button>
      <button class="btn" onclick="abrirLancamento(null,{tipo:'paguei',pessoa_id:${p.id}})">Paguei</button>
    </div>
    <h2>Extrato</h2>
    ${(movs || []).length
      ? `<table><tbody>${movs.map((m) => `<tr>
          <td class="fino">${dataBR(m.data)}</td>
          <td>${rotuloMov(m)}${m.descricao ? ` <span class="muted fino">— ${esc(m.descricao)}</span>` : ""}
              ${m.status === "pendente" ? `<span class="tag t-amarelo">em aberto${m.vencimento ? " · vence " + dataBR(m.vencimento) : ""}</span>` : ""}</td>
          <td class="num ${m.status === "pendente" ? "muted" : m.direcao === 1 ? "pos" : "neg"}">${brl(m.valor)}</td>
          <td class="num">${m.status === "pendente" ? `<button class="btn-link" onclick="liquidar(${m.id})">Dar baixa</button> ` : ""}<button class="btn-link" style="color:var(--vermelho)" onclick="excluirLancamento(${m.id})">Excluir</button></td>
        </tr>`).join("")}</tbody></table>`
      : `<div class="vazio">Sem movimentações ainda.</div>`}`;
  if (!silencioso) $("ficha").scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  $("busca").oninput = () => { clearTimeout(t); t = setTimeout(recarregar, 300); };
  $("f-saldo").onchange = recarregar;

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
