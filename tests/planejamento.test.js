// Testes das regras de planejamento: node --test tests/*.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../docs/js/planejamento.js");

let seq = 0;
const desp = (data, valor, descricao, extra = {}) => ({ id: ++seq, tipo: "paguei", valor, data, data_caixa: data, descricao,
  status: "liquidado", grupo: "resultado", direcao: -1, categoria_nome: extra.cat || "Moradia", ...extra });
const rec = (data, valor, descricao = "Salário") => ({ id: ++seq, tipo: "recebi", valor, data, data_caixa: data, descricao,
  status: "liquidado", grupo: "resultado", direcao: 1, categoria_nome: "Salário" });

test("chave ignora números, acentos e parcelas; descrição genérica usa a categoria", () => {
  assert.equal(P.chave({ descricao: "Condomínio Setembro 2026" }), "condominio setembro");
  assert.equal(P.chave({ descricao: "Geladeira (3/10)" }), "geladeira");
  assert.equal(P.chave({ descricao: "Despesa", categoria_nome: "Moradia" }), "cat:moradia");
  assert.equal(P.chave({ descricao: null, categoria_nome: "Lazer" }), "cat:lazer");
});

test("parcela vem da coluna ou de (n/m), nunca de uma data na descrição", () => {
  assert.deepEqual(P.parcelaDe({ parcela: "2/5" }), { atual: 2, total: 5 });
  assert.deepEqual(P.parcelaDe({ descricao: "TV (1/12)" }), { atual: 1, total: 12 });
  assert.equal(P.parcelaDe({ descricao: "Mercado 05/10" }), null);
});

test("conta com valor parecido em 3 meses é fixa; variação grande é variável", () => {
  const movs = [
    desp("2026-08-05", 100, "Internet"), desp("2026-09-05", 105, "Internet"), desp("2026-10-05", 100, "Internet"),
    desp("2026-08-10", 50, "Mercado"), desp("2026-09-10", 300, "Mercado"), desp("2026-10-10", 120, "Mercado"),
    desp("2026-10-12", 400, "TV (2/10)"),
  ];
  const o = P.orcamento(movs, {}, "2026-10");
  const classe = Object.fromEntries(o.itens.map((i) => [i.rotulo, i.classe]));
  assert.equal(classe.Internet, "fixa");
  assert.equal(classe.Mercado, "variavel");
  assert.equal(classe.TV, "parcelada");
  const out = o.serie.at(-1);
  assert.deepEqual([out.fixa, out.variavel, out.parcelada], [100, 120, 400]);
});

test("correção manual vence a detecção", () => {
  const movs = [desp("2026-09-05", 100, "Internet"), desp("2026-10-05", 100, "Internet"), desp("2026-08-05", 100, "Internet")];
  assert.equal(P.orcamento(movs, { internet: "variavel" }, "2026-10").itens[0].classe, "variavel");
});

test("empréstimo e conta em aberto não entram no orçamento", () => {
  const movs = [desp("2026-10-05", 100, "Internet"), { ...desp("2026-10-06", 900, "Empréstimo"), grupo: "emprestimo" },
    { ...desp("2026-10-07", 50, "Luz"), status: "pendente" }];
  assert.equal(P.orcamento(movs, {}, "2026-10").itens.length, 1);
});

test("revisão: aumento, formiga e duplicata", () => {
  const movs = [
    desp("2026-07-10", 200, "Restaurante", { cat: "Alimentação" }), desp("2026-08-10", 200, "Restaurante", { cat: "Alimentação" }),
    desp("2026-09-10", 200, "Restaurante", { cat: "Alimentação" }), desp("2026-10-10", 400, "Jantar fora", { cat: "Alimentação" }),
    ...[3, 8, 14, 20, 25].map((d) => desp(`2026-10-${String(d).padStart(2, "0")}`, 22, "Café", { cat: "Lanches" })),
    desp("2026-10-15", 89.9, "Loja X", { cat: "Compras" }), desp("2026-10-16", 89.9, "Loja X", { cat: "Compras" }),
  ];
  const r = P.revisao(movs, {}, "2026-10");
  const por = (t) => r.sugestoes.filter((s) => s.tipo === t);
  assert.equal(por("aumento")[0].categoria, "Alimentação");
  assert.equal(Math.round(por("aumento")[0].economia), 200);
  assert.equal(por("formiga")[0].qtd, 5);
  assert.equal(por("formiga")[0].economia, 55);
  assert.equal(por("duplicada")[0].qtd, 2);
  assert.ok(Math.abs(por("duplicada")[0].economia - 89.9) < 1e-9);
});

test("Pix não conta como gasto formiga", () => {
  const movs = [1, 2, 3, 4, 5].map((d) => desp(`2026-10-0${d}`, 30, "Café", { forma: "pix" }));
  assert.equal(P.revisao(movs, {}, "2026-10").sugestoes.filter((s) => s.tipo === "formiga").length, 0);
});

test("economia realizada: cobrança que sumiu conta, a que voltou não", () => {
  const movs = [desp("2026-08-05", 40, "Streaming"), desp("2026-09-05", 40, "Streaming")];
  const d = { chave: "streaming", em: "2026-09-10" };
  assert.deepEqual(P.economiaRealizada(movs, d, 40, "2026-12"), { situacao: "confirmado", meses: 2, economia: 80 });
  movs.push(desp("2026-11-05", 40, "Streaming"));
  assert.equal(P.economiaRealizada(movs, d, 40, "2026-12").situacao, "voltou");
});

test("projeção: renda mediana, médias de 3 meses e contas lançadas no vencimento", () => {
  const movs = [
    rec("2026-08-05", 5000), rec("2026-09-05", 5000), rec("2026-10-05", 9000),
    desp("2026-08-05", 1000, "Aluguel"), desp("2026-09-05", 1000, "Aluguel"), desp("2026-10-05", 1000, "Aluguel"),
    desp("2026-08-10", 600, "Mercado"), desp("2026-09-10", 900, "Mercado"), desp("2026-10-10", 1200, "Mercado"),
    { ...desp("2026-11-20", 300, "TV (3/10)"), status: "pendente", vencimento: "2026-12-20" },
    { ...desp("2026-11-05", 1000, "Aluguel"), status: "pendente", vencimento: "2026-12-05" },
    { ...desp("2026-10-01", 2000, "Empréstimo"), tipo: "recebi", direcao: 1, grupo: "emprestimo", status: "pendente", vencimento: "2026-12-30" },
  ];
  const p = P.projecao(movs, {}, "2026-11", 3, 10000);
  assert.equal(p.premissas.renda, 5000);
  assert.equal(p.premissas.fixa, 1000);
  assert.equal(p.premissas.variavel, 900);
  const dez = p.meses[1];
  assert.equal(dez.parcelas, 300);
  assert.equal(dez.outras, 0, "aluguel já lançado é fixa e já está na média");
  assert.equal(dez.receber, 2000);
  assert.equal(p.meses[0].saldo, 10000 + 5000 - 1900);
  assert.equal(dez.sobra, 5000 + 2000 - 1900 - 300);
});

test("tabela Price", () => {
  assert.equal(Math.round(P.parcelaPrice(10000, 2, 12) * 100) / 100, 945.6);
  assert.equal(P.parcelaPrice(1200, 0, 12), 100);
  const s = P.simulacao({ valor: 1200, entrada: 0, taxa: 0, parcelas: 3, inicio: "2026-12" }, "2026-11", 6);
  assert.deepEqual(s.valores, [0, 400, 400, 400, 0, 0]);
});

test("metas: juntar, reserva e reduzir", () => {
  const pj = { premissas: { fixa: 2000, mesesBase: 3 }, meses: [{ sobra: 1500 }, { sobra: 1500 }, { sobra: 1500 }] };
  const j = P.progressoMeta({ tipo: "juntar", valor_alvo: 10000, data_alvo: "2027-02-01" }, { patrimonio: 4000, projecao: pj, movs: [], hojeIso: "2026-11-15" });
  assert.equal(j.faltamMeses, 3); assert.equal(j.porMes, 2000); assert.equal(j.cabe, false);
  const r = P.progressoMeta({ tipo: "reserva", meses: 6 }, { patrimonio: 6000, projecao: pj, movs: [], hojeIso: "2026-11-15" });
  assert.equal(r.alvo, 12000); assert.equal(r.cobertura, 3);
  const movs = [desp("2026-11-03", 300, "Bar", { cat: "Lazer" })];
  const c = P.progressoMeta({ tipo: "reduzir", categoria_nome: "Lazer", base: 500, percentual: 20, criado_em: "2026-10-20" },
    { patrimonio: 0, projecao: pj, movs, hojeIso: "2026-11-15" });
  assert.equal(c.alvo, 400); assert.equal(c.atual, 300); assert.equal(c.ritmo, 600); assert.equal(c.historico.length, 2);
});

test("comparação de meses por categoria", () => {
  const movs = [desp("2026-09-05", 100, "Luz", { cat: "Moradia" }), desp("2026-10-05", 150, "Luz", { cat: "Moradia" })];
  const [c] = P.comparar(movs, "2026-09", "2026-10");
  assert.deepEqual([c.a, c.b, c.dif, c.pct], [100, 150, 50, 50]);
});
