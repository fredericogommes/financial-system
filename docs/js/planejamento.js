/* Planejamento: orçamento (fixas, parceladas, variáveis), revisão de gastos, projeção e metas.
   Regras adaptadas do FinAssist (github.com/MarcosAAlbanoJunior/go-financial-assistant, licença MIT),
   docs/regras-de-calculo.md. Tudo é calculado aqui, a partir dos lançamentos; nada de IA nos números.
   Meses são "AAAA-MM". Só entram receitas e despesas (grupo "resultado"): empréstimo não é gasto. */

const Plan = (() => {
  const cent = (v) => Math.round(Number(v || 0) * 100);
  const soma = (lista, f) => lista.reduce((t, x) => t + cent(f(x)), 0) / 100;
  const mediana = (v) => {
    if (!v.length) return 0;
    const s = [...v].sort((a, b) => a - b), n = s.length;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  };
  const media = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
  const mesDe = (iso) => String(iso).slice(0, 7);
  const somarMes = (m, n) => {
    const [a, b] = m.split("-").map(Number), t = a * 12 + (b - 1) + n;
    return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
  };
  const mesesEntre = (de, ate) => { const out = []; for (let m = de; m <= ate; m = somarMes(m, 1)) out.push(m); return out; };
  const diffMeses = (de, ate) => { const [a, b] = de.split("-").map(Number), [c, d] = ate.split("-").map(Number); return (c - a) * 12 + (d - b); };

  /* Parcela: coluna "parcela" (lançada pelo painel) ou "n/m" na descrição */
  const RE_PARCELA = /(?:\(\s*(\d+)\s*\/\s*(\d+)\s*\)|parc[a-z.]*\s*(\d+)\s*\/\s*(\d+)|^\s*(\d+)\s*\/\s*(\d+)\s*$)/i;
  function parcelaDe(m) {
    const txt = m.parcela || m.descricao || "";
    const r = RE_PARCELA.exec(txt);
    if (!r) return null;
    const atual = Number(r[1] || r[3] || r[5]), total = Number(r[2] || r[4] || r[6]);
    return total > 1 && atual >= 1 && atual <= total ? { atual, total } : null;
  }

  /* Chave da conta: a mesma despesa em meses diferentes. Descrição sem números, datas, parcelas,
     acentos e pontuação; sem descrição (ou só com o nome do tipo, como "Despesa"), vale a categoria. */
  const GENERICAS = new Set(["despesa", "receita", "conta a pagar", "conta a receber", "paguei", "recebi", "pagamento", "recebimento"]);
  function chave(m) {
    const d = String(m.descricao || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
      .replace(RE_PARCELA, " ").replace(/[^a-z]+/g, " ").trim().replace(/\s+/g, " ");
    return d && !GENERICAS.has(d) ? d : "cat:" + (m.categoria_nome || "sem categoria").toLowerCase();
  }
  const rotulo = (m) => {
    const d = String(m.descricao || "").replace(RE_PARCELA, "").trim();
    return d && !GENERICAS.has(d.toLowerCase()) ? d : m.categoria_nome || d || "Sem descrição";
  };

  /* Despesas e receitas baixadas, agrupadas por chave e mês (data da baixa) */
  function porChaveMes(movs, direcao) {
    const mapa = new Map();
    for (const m of movs) {
      if (m.status !== "liquidado" || m.grupo !== "resultado" || Number(m.direcao) !== direcao) continue;
      const k = chave(m), mes = mesDe(m.data_caixa), id = k + "|" + mes;
      const r = mapa.get(id) || { chave: k, mes, rotulo: rotulo(m), categoria: m.categoria_nome || "Sem categoria",
        total: 0, qtd: 0, parcelada: false, dia: Number(String(m.vencimento || m.data_caixa).slice(8, 10)) };
      r.total = (cent(r.total) + cent(m.valor)) / 100; r.qtd++;
      if (parcelaDe(m)) r.parcelada = true;
      mapa.set(id, r);
    }
    return [...mapa.values()];
  }

  /* Fixa: aparece em pelo menos 3 meses da janela (ou em todos, havendo só 2), até 2 vezes por mês,
     com variação (maior − menor) / mediana ≤ 30% (≤ 5% com só 2 meses de dados). */
  function pareceFixa(lista, necessarios) {
    if (necessarios < 2 || lista.length < necessarios) return false;
    if (lista.some((r) => r.qtd > 2)) return false;
    const t = lista.map((r) => r.total).sort((a, b) => a - b), med = mediana(t);
    return med > 0 && (t[t.length - 1] - t[0]) / med <= (necessarios === 2 ? 0.05 : 0.30);
  }

  /* Classe de cada conta na janela: correção manual > parcelada > fixa detectada > variável */
  function classificar(linhas, regras = {}) {
    const porChave = new Map();
    linhas.forEach((r) => porChave.set(r.chave, [...(porChave.get(r.chave) || []), r]));
    const necessarios = Math.min(3, new Set(linhas.map((r) => r.mes)).size);
    const classes = {};
    for (const [k, lista] of porChave) {
      classes[k] = regras[k] ? { classe: regras[k], manual: true, meses: lista.length }
        : { classe: lista.some((r) => r.parcelada) ? "parcelada" : pareceFixa(lista, necessarios) ? "fixa" : "variavel", manual: false, meses: lista.length };
    }
    return classes;
  }

  /* Orçamento: série de 12 meses até "ate" e as contas do mês "ate" */
  function orcamento(movs, regras, ate, janela = 12) {
    const de = somarMes(ate, -(janela - 1));
    const linhas = porChaveMes(movs, -1).filter((r) => r.mes >= de && r.mes <= ate);
    const classes = classificar(linhas, regras);
    const serie = mesesEntre(de, ate).map((mes) => ({ mes, fixa: 0, parcelada: 0, variavel: 0 }));
    const idx = new Map(serie.map((s, i) => [s.mes, i]));
    for (const r of linhas) { const s = serie[idx.get(r.mes)], c = classes[r.chave].classe; s[c] = (cent(s[c]) + cent(r.total)) / 100; }
    const itens = linhas.filter((r) => r.mes === ate).map((r) => ({ ...r, ...classes[r.chave] })).sort((a, b) => b.total - a.total);
    return { serie, itens, classes };
  }

  /* Receita mensal típica: mediana dos últimos 6 meses com movimento (um mês fora do padrão não pesa) */
  function rendaTipica(movs, antesDe, meses = 6) {
    const porMes = new Map();
    porChaveMes(movs, 1).forEach((r) => porMes.set(r.mes, (cent(porMes.get(r.mes)) + cent(r.total)) / 100));
    const ultimos = [...porMes.keys()].filter((m) => m < antesDe).sort().slice(-meses);
    return { valor: mediana(ultimos.map((m) => porMes.get(m))), meses: ultimos.length };
  }

  /* Revisão: mapa de calor (6 meses) e sugestões de corte, com a economia por mês */
  const R = { aumentoMin: 50, aumentoRazao: 1.2, formigaMax: 40, formigaQtd: 4, formigaTotal: 80,
              duplicadaMin: 5, duplicadaDias: 3, novaMin: 30, novaHistorico: 2 };
  function revisao(movs, regras, ate, decisoes = []) {
    const meses = mesesEntre(somarMes(ate, -5), ate);
    const linhas = porChaveMes(movs, -1);
    const porCat = new Map();
    linhas.filter((r) => meses.includes(r.mes)).forEach((r) => {
      const v = porCat.get(r.categoria) || meses.map(() => 0);
      const i = meses.indexOf(r.mes); v[i] = (cent(v[i]) + cent(r.total)) / 100; porCat.set(r.categoria, v);
    });
    const matriz = [...porCat].map(([categoria, valores]) => ({ categoria, valores }))
      .sort((a, b) => b.valores.reduce((s, x) => s + x, 0) - a.valores.reduce((s, x) => s + x, 0));

    const orc = orcamento(movs, regras, ate);
    const sug = [];
    // Aumento: categoria subiu ≥ R$ 50 e ≥ 20% sobre a média dos até 3 meses anteriores com dados
    const ult = meses.length - 1, hist = [];
    for (let i = ult - 1; i >= 0 && hist.length < 3; i--) if (matriz.some((r) => r.valores[i] > 0)) hist.push(i);
    if (hist.length) for (const r of matriz) {
      const base = media(hist.map((i) => r.valores[i])), atual = r.valores[ult];
      if (atual - base >= R.aumentoMin && atual >= base * R.aumentoRazao)
        sug.push({ tipo: "aumento", chave: r.categoria, rotulo: r.categoria, categoria: r.categoria, economia: atual - base, recorrente: true, valor: atual, base });
    }
    // Fixa ou assinatura: vale rever; economia = o valor por mês
    orc.itens.filter((i) => i.classe === "fixa").forEach((i) =>
      sug.push({ tipo: "fixa", chave: i.chave, rotulo: i.rotulo, categoria: i.categoria, economia: i.total, recorrente: true, valor: i.total, meses: i.meses }));
    // Gasto formiga: ≥ 4 compras de até R$ 40 (fora Pix) somando ≥ R$ 80 no mês; economia = metade
    const doMes = movs.filter((m) => m.status === "liquidado" && m.grupo === "resultado" && Number(m.direcao) === -1 && mesDe(m.data_caixa) === ate);
    const formiga = new Map();
    doMes.forEach((m) => {
      const k = chave(m);
      if (Number(m.valor) > R.formigaMax || String(m.forma || "").toLowerCase() === "pix" || orc.classes[k]?.classe !== "variavel") return;
      const a = formiga.get(k) || { rotulo: rotulo(m), categoria: m.categoria_nome || "Sem categoria", total: 0, qtd: 0 };
      a.total += Number(m.valor); a.qtd++; formiga.set(k, a);
    });
    for (const [k, a] of formiga) if (a.qtd >= R.formigaQtd && a.total >= R.formigaTotal)
      sug.push({ tipo: "formiga", chave: k, rotulo: a.rotulo, categoria: a.categoria, economia: a.total / 2, recorrente: true, valor: a.total, qtd: a.qtd });
    // Possível duplicata: mesmo valor e conta em até 3 dias (≥ R$ 5)
    const aberto = new Map(), sequencias = [];
    [...doMes].sort((a, b) => String(a.data_caixa).localeCompare(String(b.data_caixa))).forEach((m) => {
      const k = chave(m);
      if (Number(m.valor) < R.duplicadaMin || orc.classes[k]?.classe === "parcelada") return;
      const id = k + "|" + cent(m.valor), d = new Date(String(m.data_caixa).slice(0, 10) + "T12:00:00"), r = aberto.get(id);
      if (r && (d - r.ultimo) / 864e5 <= R.duplicadaDias) { r.qtd++; r.ultimo = d; r.ids.push(m.id); return; }
      const nova = { k, m, ultimo: d, qtd: 1, ids: [m.id] };
      aberto.set(id, nova); sequencias.push(nova);
    });
    sequencias.forEach((r) => {
      if (r.qtd > 1) sug.push({ tipo: "duplicada", chave: r.k + "|" + r.ids[0], rotulo: rotulo(r.m), categoria: r.m.categoria_nome || "Sem categoria",
        economia: Number(r.m.valor) * (r.qtd - 1), recorrente: false, valor: Number(r.m.valor), qtd: r.qtd, ids: r.ids });
    });
    // Conta nova: só aparece neste mês, com ao menos 2 meses anteriores de dados (≥ R$ 30)
    const historico = new Set(linhas.filter((r) => r.mes < ate).map((r) => r.mes));
    // (fora as que já viraram gasto formiga ou duplicata, para não aparecer duas vezes)
    const jaSugeridas = new Set(sug.map((x) => x.chave.split("|")[0]));
    if (historico.size >= R.novaHistorico) orc.itens.filter((i) => i.meses === 1 && i.total >= R.novaMin && i.classe !== "parcelada" && !jaSugeridas.has(i.chave)).forEach((i) =>
      sug.push({ tipo: "nova", chave: i.chave, rotulo: i.rotulo, categoria: i.categoria, economia: i.total, recorrente: false, valor: i.total, qtd: i.qtd }));

    const dec = new Map(decisoes.map((d) => [d.tipo + "|" + d.chave, d]));
    sug.forEach((s) => (s.decisao = dec.get(s.tipo + "|" + s.chave) || null));
    sug.sort((a, b) => (a.recorrente !== b.recorrente ? (a.recorrente ? -1 : 1) : b.economia - a.economia));
    return { meses, matriz, sugestoes: sug, temHistorico: historico.size };
  }

  /* Economia realizada de cada "Cancelei": mês a mês, depois da decisão, a cobrança sumiu? */
  function economiaRealizada(movs, decisao, custoMensal, hojeMes) {
    const meses = mesesEntre(somarMes(mesDe(decisao.em), 1), hojeMes);
    const linhas = porChaveMes(movs, -1).filter((r) => r.chave === decisao.chave);
    let confirmados = 0, voltou = false;
    for (const m of meses) {
      const gasto = soma(linhas.filter((r) => r.mes === m), (r) => r.total);
      if (gasto >= custoMensal / 2) { voltou = true; break; }
      if (m < hojeMes) confirmados++;
    }
    return { situacao: voltou ? "voltou" : confirmados ? "confirmado" : "pendente", meses: confirmados, economia: custoMensal * confirmados };
  }

  /* Projeção de N meses a partir do mês atual.
     Fixas e variáveis: média dos últimos 3 meses completos com dados. Renda: mediana dos últimos 6.
     Contas já lançadas em aberto entram no mês do vencimento (vencidas, no mês atual), menos as fixas,
     que já estão na média. Empréstimos a receber/pagar com vencimento também entram. */
  function projecao(movs, regras, inicio, n, saldoInicial = 0, extras = [], ajuste = {}) {
    const ate = somarMes(inicio, -1);
    const orc = orcamento(movs, regras, ate);
    const usados = orc.serie.filter((s) => s.fixa + s.parcelada + s.variavel > 0).slice(-3);
    const calculado = { fixa: media(usados.map((s) => s.fixa)), variavel: media(usados.map((s) => s.variavel)), renda: rendaTipica(movs, inicio) };
    const fixa = ajuste.fixa ?? calculado.fixa, variavel = ajuste.variavel ?? calculado.variavel;
    const renda = { valor: ajuste.renda ?? calculado.renda.valor, meses: calculado.renda.meses };
    const fim = somarMes(inicio, n - 1);
    const meses = mesesEntre(inicio, fim).map((mes) => ({ mes, renda: renda.valor, fixa, variavel, parcelas: 0, outras: 0, receber: 0, pagar: 0, extra: 0 }));
    const idx = new Map(meses.map((m, i) => [m.mes, i]));
    let semVencimento = 0;
    for (const m of movs) {
      if (m.status !== "pendente") continue;
      if (!m.vencimento) { semVencimento += Number(m.valor); continue; }
      const mes = mesDe(m.vencimento) < inicio ? inicio : mesDe(m.vencimento);
      if (!idx.has(mes)) continue;
      const p = meses[idx.get(mes)], v = Number(m.valor), dir = Number(m.direcao);
      if (m.grupo === "emprestimo") { if (dir === 1) p.receber += v; else p.pagar += v; continue; }
      if (dir === 1) { p.receber += v; continue; }
      if (parcelaDe(m)) p.parcelas += v;
      else if (orc.classes[chave(m)]?.classe !== "fixa") p.outras += v;
    }
    extras.forEach((e) => e.valores.forEach((v, i) => { if (meses[i]) meses[i].extra += v; }));
    let saldo = saldoInicial;
    meses.forEach((p) => {
      p.sobra = p.renda + p.receber - p.fixa - p.variavel - p.parcelas - p.outras - p.pagar - p.extra;
      saldo += p.sobra; p.saldo = saldo;
    });
    return { meses, semVencimento, premissas: { renda: renda.valor, mesesRenda: renda.meses, fixa, variavel, mesesBase: usados.length,
      calculado: { renda: calculado.renda.valor, fixa: calculado.fixa, variavel: calculado.variavel } } };
  }

  /* Financiamento pela tabela Price: parcela fixa para principal P, taxa i ao mês e n parcelas */
  function parcelaPrice(principal, taxaPct, n) {
    const i = taxaPct / 100;
    if (n <= 0) return 0;
    return i === 0 ? principal / n : (principal * i) / (1 - Math.pow(1 + i, -n));
  }
  function simulacao(s, inicioProjecao, n) {
    const p = parcelaPrice(s.valor - (s.entrada || 0), s.taxa, s.parcelas);
    const desloc = diffMeses(inicioProjecao, s.inicio);
    const valores = Array.from({ length: n }, (_, i) => {
      const k = i - desloc;
      return (k === 0 ? (s.entrada || 0) : 0) + (k >= 0 && k < s.parcelas ? p : 0);
    });
    return { parcela: p, total: p * s.parcelas + (s.entrada || 0), juros: p * s.parcelas - (s.valor - (s.entrada || 0)), valores };
  }

  /* Metas. Patrimônio = saldo disponível hoje (todas as contas). */
  function progressoMeta(g, { patrimonio, projecao: pj, movs, hojeIso }) {
    const mes = mesDe(hojeIso), dia = Number(hojeIso.slice(8, 10));
    const diasNoMes = new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
    if (g.tipo === "juntar") {
      const faltam = Math.max(0, diffMeses(mes, mesDe(g.data_alvo)));
      const falta = Math.max(0, g.valor_alvo - patrimonio);
      const porMes = falta / Math.max(faltam, 1);
      const sobra = pj && pj.premissas.mesesBase ? media(pj.meses.slice(0, Math.max(faltam, 1)).map((m) => m.sobra)) : null;
      return { atual: patrimonio, alvo: Number(g.valor_alvo), feito: patrimonio >= g.valor_alvo, faltamMeses: faltam, porMes, sobra, cabe: sobra === null ? null : porMes <= sobra };
    }
    if (g.tipo === "reserva") {
      const fixa = pj ? pj.premissas.fixa : 0, alvo = g.meses * fixa;
      return { atual: patrimonio, alvo, feito: fixa > 0 && patrimonio >= alvo, cobertura: fixa > 0 ? patrimonio / fixa : null };
    }
    // reduzir: teto = média dos 3 meses antes da criação × (1 − %), fixada ao criar a meta
    const teto = Number(g.base) * (1 - Number(g.percentual) / 100);
    const totais = new Map();
    porChaveMes(movs, -1).filter((r) => r.categoria === g.categoria_nome).forEach((r) => totais.set(r.mes, (totais.get(r.mes) || 0) + r.total));
    const historico = mesesEntre(mesDe(g.criado_em), mes).slice(-12).map((m) => ({ mes: m, total: totais.get(m) || 0, ok: (totais.get(m) || 0) <= teto }));
    const atual = totais.get(mes) || 0;
    return { atual, alvo: teto, historico, ritmo: dia >= 7 ? (atual * diasNoMes) / dia : null, feito: false };
  }
  function baseReducao(movs, categoria, hojeIso) {
    const mes = mesDe(hojeIso), totais = new Map();
    porChaveMes(movs, -1).filter((r) => r.categoria === categoria && r.mes < mes && r.mes >= somarMes(mes, -3))
      .forEach((r) => totais.set(r.mes, (totais.get(r.mes) || 0) + r.total));
    const v = [...totais.values()].filter((x) => x > 0);
    return v.length ? media(v) : null;
  }

  /* Comparação de dois meses por categoria (despesas e receitas) */
  function comparar(movs, mesA, mesB, direcao = -1) {
    const tot = new Map();
    porChaveMes(movs, direcao).filter((r) => r.mes === mesA || r.mes === mesB).forEach((r) => {
      const t = tot.get(r.categoria) || { categoria: r.categoria, a: 0, b: 0 };
      if (r.mes === mesA) t.a = (cent(t.a) + cent(r.total)) / 100; else t.b = (cent(t.b) + cent(r.total)) / 100;
      tot.set(r.categoria, t);
    });
    return [...tot.values()].map((t) => ({ ...t, dif: (cent(t.b) - cent(t.a)) / 100, pct: t.a ? ((t.b - t.a) / t.a) * 100 : null }))
      .sort((x, y) => Math.abs(y.dif) - Math.abs(x.dif));
  }

  /* Mês mais recente com despesas baixadas, até "ate" (abre as telas num mês com dados) */
  function ultimoMesComDados(movs, ate) {
    const meses = porChaveMes(movs, -1).map((r) => r.mes).filter((m) => m <= ate).sort();
    return meses.length ? meses[meses.length - 1] : ate;
  }

  return { ultimoMesComDados, chave, rotulo, parcelaDe, porChaveMes, classificar, orcamento, rendaTipica, revisao, economiaRealizada,
           projecao, parcelaPrice, simulacao, progressoMeta, baseReducao, comparar, somarMes, mesesEntre, diffMeses, mediana };
})();

/* Lançamentos de receitas e despesas desde "desde" (data da baixa ou vencimento), em páginas de 1000 */
async function carregarMovimentos(desde) {
  const campos = "id,tipo,valor,data,vencimento,descricao,status,liquidado_em,data_caixa,forma,parcela,grupo,direcao,categoria_id,categoria_nome,categoria_cor,pessoa_nome";
  const todos = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await db.from("v_movimentacoes").select(campos)
      .or(`data_caixa.gte.${desde},status.eq.pendente`).order("id").range(de, de + 999);
    if (error) throw error;
    todos.push(...data);
    if (data.length < 1000) return todos;
  }
}
async function carregarRegras() {
  const { data } = await db.from("regras_despesa").select("chave,classe");
  return Object.fromEntries((data || []).map((r) => [r.chave, r.classe]));
}

if (typeof module !== "undefined") module.exports = Plan;
