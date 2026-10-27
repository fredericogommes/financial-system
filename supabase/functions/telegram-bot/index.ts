// Bot do Telegram do sistema de finanças.
// Recebe as mensagens do Telegram (webhook) e grava pessoas e movimentações no Supabase.
//
// Segredos necessários (Supabase > Edge Functions > Secrets):
//   TELEGRAM_BOT_TOKEN  token entregue pelo @BotFather
// SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY já vêm prontos no ambiente.
//
// Para registrar o webhook, abra uma vez no navegador:
//   https://<projeto>.supabase.co/functions/v1/telegram-bot?setup=1

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Tipo = "paguei" | "recebi" | "emprestei" | "peguei_emprestado";

const COMANDOS_TIPO: Record<string, Tipo> = {
  paguei: "paguei",
  recebi: "recebi",
  emprestei: "emprestei",
  peguei: "peguei_emprestado",
};

const ROTULO: Record<Tipo, string> = {
  paguei: "💸 Paguei",
  recebi: "💰 Recebi",
  emprestei: "🤝 Emprestei",
  peguei_emprestado: "🏦 Peguei emprestado",
};

const AJUDA = `*Comandos*

*Lançar movimentação*
/emprestei 500 João conserto do carro
/recebi 200 João
/paguei 150,90 Maria faxina
/peguei 1.000 Pedro

O nome pode ser só parte dele (ex.: "joao"). Se tiver mais de uma pessoa parecida, eu pergunto qual é.
O que vier depois de " - " vira descrição: /recebi 50 João - parcela 1

*Pessoas*
/nova João da Silva
/pessoa joao (busca e mostra o saldo)
/extrato joao (últimas 10 movimentações)
/saldos (quem te deve e quem você deve)`;

// O secret do webhook é derivado do token, assim não precisa de outro segredo.
async function segredoWebhook(): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(TOKEN));
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 48);
}

async function telegram(metodo: string, corpo: Record<string, unknown>) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${metodo}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  return r.json();
}

function responder(chatId: number, texto: string, extra: Record<string, unknown> = {}) {
  return telegram("sendMessage", { chat_id: chatId, text: texto, parse_mode: "Markdown", ...extra });
}

const brl = (v: number) => Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (d: string) => d.split("-").reverse().join("/");

// Aceita "500", "150,90", "1.000", "1.234,56", "R$ 50"
export function lerValor(texto: string): number | null {
  const limpo = texto.replace(/^r\$/i, "").trim();
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(limpo)) return null;
  const normalizado = /,\d{1,2}$/.test(limpo) || /\.\d{3}/.test(limpo)
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo.replace(",", ".");
  const v = Number(normalizado);
  return v > 0 ? Math.round(v * 100) / 100 : null;
}

async function buscarPessoas(termo: string) {
  const { data, error } = await db.rpc("buscar_pessoas", { termo });
  if (error) throw error;
  return (data ?? []) as { id: number; nome: string }[];
}

async function saldoDe(pessoaId: number) {
  const { data } = await db.from("saldo_por_pessoa").select("*").eq("pessoa_id", pessoaId).single();
  return data;
}

function textoSaldo(nome: string, saldo: number) {
  if (saldo > 0) return `*${nome}* te deve ${brl(saldo)}`;
  if (saldo < 0) return `Você deve ${brl(-saldo)} para *${nome}*`;
  return `*${nome}* está quite com você`;
}

async function gravar(chatId: number, pessoa: { id: number; nome: string }, tipo: Tipo, valor: number, descricao: string | null) {
  const { error } = await db.from("movimentacoes").insert({
    pessoa_id: pessoa.id, tipo, valor, descricao, origem: "telegram",
  });
  if (error) throw error;
  const s = await saldoDe(pessoa.id);
  await responder(chatId, `✅ ${ROTULO[tipo]} ${brl(valor)} — ${pessoa.nome}${descricao ? `\n_${descricao}_` : ""}\n\n${textoSaldo(pessoa.nome, Number(s?.saldo ?? 0))}`);
}

async function lancar(chatId: number, tipo: Tipo, args: string) {
  const [principal, ...resto] = args.split(" - ");
  const partes = principal.trim().split(/\s+/);
  const valor = lerValor(partes[0] ?? "");
  const nome = partes.slice(1).join(" ");
  if (valor === null || !nome) {
    return responder(chatId, `Não entendi. Use assim: /${tipo === "peguei_emprestado" ? "peguei" : tipo} 500 João`);
  }

  // Tenta o nome inteiro; se não achar, usa as primeiras palavras como nome e o resto como descrição
  let descricao = resto.join(" - ").trim() || null;
  let pessoas = await buscarPessoas(nome);
  if (pessoas.length === 0 && !descricao) {
    const palavras = nome.split(" ");
    for (let n = palavras.length - 1; n >= 1 && pessoas.length === 0; n--) {
      pessoas = await buscarPessoas(palavras.slice(0, n).join(" "));
      if (pessoas.length) descricao = palavras.slice(n).join(" ");
    }
  }

  if (pessoas.length === 0) {
    return responder(chatId, `Não achei ninguém com "${nome}". Cadastre com /nova Nome Completo e lance de novo.`);
  }
  if (pessoas.length === 1) return gravar(chatId, pessoas[0], tipo, valor, descricao);

  const { data: pend, error } = await db.from("telegram_pendentes")
    .insert({ tipo, valor, descricao }).select("id").single();
  if (error) throw error;
  return responder(chatId, `Achei mais de uma pessoa. Para quem foi ${ROTULO[tipo].toLowerCase()} ${brl(valor)}?`, {
    reply_markup: {
      inline_keyboard: [
        ...pessoas.slice(0, 8).map((p) => [{ text: p.nome, callback_data: `p:${pend.id}:${p.id}` }]),
        [{ text: "Cancelar", callback_data: `x:${pend.id}` }],
      ],
    },
  });
}

async function escolherPessoa(chatId: number, callbackId: string, dados: string) {
  await telegram("answerCallbackQuery", { callback_query_id: callbackId });
  const [acao, pendId, pessoaId] = dados.split(":");
  const { data: pend } = await db.from("telegram_pendentes").delete().eq("id", pendId).select().single();
  if (!pend) return responder(chatId, "Esse lançamento já foi resolvido.");
  if (acao === "x") return responder(chatId, "Lançamento cancelado.");
  const { data: pessoa } = await db.from("pessoas").select("id, nome").eq("id", pessoaId).single();
  if (!pessoa) return responder(chatId, "Pessoa não encontrada.");
  return gravar(chatId, pessoa, pend.tipo, Number(pend.valor), pend.descricao);
}

async function novaPessoa(chatId: number, nome: string) {
  if (!nome) return responder(chatId, "Use assim: /nova João da Silva");
  const existentes = await buscarPessoas(nome);
  const { data, error } = await db.from("pessoas").insert({ nome }).select("id, nome").single();
  if (error) throw error;
  const aviso = existentes.length ? `\n\n⚠️ Já existia alguém parecido: ${existentes.map((p) => p.nome).join(", ")}` : "";
  return responder(chatId, `👤 *${data.nome}* cadastrado(a).${aviso}`);
}

async function verPessoa(chatId: number, termo: string) {
  if (!termo) return responder(chatId, "Use assim: /pessoa joao");
  const pessoas = await buscarPessoas(termo);
  if (!pessoas.length) return responder(chatId, `Ninguém encontrado com "${termo}".`);
  const linhas = await Promise.all(pessoas.slice(0, 10).map(async (p) => {
    const s = await saldoDe(p.id);
    return `• ${textoSaldo(p.nome, Number(s?.saldo ?? 0))}`;
  }));
  return responder(chatId, linhas.join("\n"));
}

async function extrato(chatId: number, termo: string) {
  if (!termo) return responder(chatId, "Use assim: /extrato joao");
  const pessoas = await buscarPessoas(termo);
  if (pessoas.length !== 1) {
    return responder(chatId, pessoas.length
      ? `Seja mais específico, achei: ${pessoas.map((p) => p.nome).join(", ")}`
      : `Ninguém encontrado com "${termo}".`);
  }
  const p = pessoas[0];
  const { data } = await db.from("movimentacoes").select("tipo, valor, data, descricao")
    .eq("pessoa_id", p.id).order("data", { ascending: false }).order("id", { ascending: false }).limit(10);
  const s = await saldoDe(p.id);
  const linhas = (data ?? []).map((m) =>
    `${dataBR(m.data)} ${ROTULO[m.tipo as Tipo]} ${brl(Number(m.valor))}${m.descricao ? ` — ${m.descricao}` : ""}`);
  return responder(chatId, `*Extrato de ${p.nome}*\n\n${linhas.join("\n") || "Sem movimentações."}\n\n${textoSaldo(p.nome, Number(s?.saldo ?? 0))}`);
}

async function saldos(chatId: number) {
  const { data } = await db.from("saldo_por_pessoa").select("nome, saldo").neq("saldo", 0).order("saldo", { ascending: false });
  if (!data?.length) return responder(chatId, "Ninguém te deve e você não deve a ninguém. 🎉");
  const meDevem = data.filter((s) => Number(s.saldo) > 0);
  const devo = data.filter((s) => Number(s.saldo) < 0);
  const soma = (l: typeof data) => l.reduce((t, s) => t + Math.abs(Number(s.saldo)), 0);
  let texto = "";
  if (meDevem.length) texto += `*Te devem (${brl(soma(meDevem))})*\n${meDevem.map((s) => `• ${s.nome}: ${brl(Number(s.saldo))}`).join("\n")}\n\n`;
  if (devo.length) texto += `*Você deve (${brl(soma(devo))})*\n${devo.map((s) => `• ${s.nome}: ${brl(-Number(s.saldo))}`).join("\n")}`;
  return responder(chatId, texto.trim());
}

// Só o dono pode usar o bot. O primeiro chat que mandar /start vira o dono.
async function autorizado(chatId: number, texto: string): Promise<boolean> {
  const { data } = await db.from("telegram_dono").select("chat_id").maybeSingle();
  if (data) return data.chat_id === chatId;
  if (!texto.startsWith("/start")) return false;
  await db.from("telegram_dono").insert({ chat_id: chatId });
  return true;
}

async function tratarMensagem(chatId: number, texto: string) {
  const [cmdBruto, ...resto] = texto.trim().split(/\s+/);
  const cmd = cmdBruto.replace(/^\//, "").replace(/@\w+$/, "").toLowerCase();
  const args = resto.join(" ").trim();

  if (cmd in COMANDOS_TIPO) return lancar(chatId, COMANDOS_TIPO[cmd], args);
  switch (cmd) {
    case "start":
    case "ajuda":
    case "help":
      return responder(chatId, `Olá! Eu registro suas finanças.\n\n${AJUDA}`);
    case "nova":
      return novaPessoa(chatId, args);
    case "pessoa":
      return verPessoa(chatId, args);
    case "extrato":
      return extrato(chatId, args);
    case "saldos":
    case "saldo":
      return args ? verPessoa(chatId, args) : saldos(chatId);
    default:
      return responder(chatId, `Não entendi.\n\n${AJUDA}`);
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  if (req.method === "GET" && url.searchParams.has("setup")) {
    const webhook = `${Deno.env.get("SUPABASE_URL")}/functions/v1/telegram-bot`;
    const r = await telegram("setWebhook", {
      url: webhook,
      secret_token: await segredoWebhook(),
      allowed_updates: ["message", "callback_query"],
    });
    await telegram("setMyCommands", {
      commands: [
        { command: "emprestei", description: "Emprestei dinheiro: /emprestei 500 João" },
        { command: "recebi", description: "Recebi de alguém: /recebi 200 João" },
        { command: "paguei", description: "Paguei alguém: /paguei 150 Maria" },
        { command: "peguei", description: "Peguei emprestado: /peguei 1000 Pedro" },
        { command: "nova", description: "Cadastrar pessoa: /nova João da Silva" },
        { command: "pessoa", description: "Buscar pessoa e ver saldo" },
        { command: "extrato", description: "Últimas movimentações de alguém" },
        { command: "saldos", description: "Quem te deve e quem você deve" },
        { command: "ajuda", description: "Ver todos os comandos" },
      ],
    });
    return Response.json({ webhook_configurado: r.ok, detalhe: r.description });
  }

  if (req.method !== "POST" || req.headers.get("x-telegram-bot-api-secret-token") !== await segredoWebhook()) {
    return new Response("não autorizado", { status: 401 });
  }

  const update = await req.json();
  const chatId: number | undefined = update.message?.chat?.id ?? update.callback_query?.message?.chat?.id;
  if (!chatId) return new Response("ok");

  try {
    const texto: string = update.message?.text ?? "";
    if (!(await autorizado(chatId, texto))) {
      await responder(chatId, "Este bot é privado.");
      return new Response("ok");
    }
    if (update.callback_query) await escolherPessoa(chatId, update.callback_query.id, update.callback_query.data);
    else if (texto) await tratarMensagem(chatId, texto);
  } catch (e) {
    console.error(e);
    await responder(chatId, "❌ Deu erro ao salvar. Tente de novo em instantes.");
  }
  return new Response("ok");
});
