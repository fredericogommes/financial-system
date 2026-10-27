# Finanças do Fred

Sistema de finanças **pessoais** com painel web, no mesmo padrão visual do painel da Tech4You, mas sem CRM e sem WhatsApp. Tudo com ferramentas gratuitas.

- **Banco de dados:** Supabase (plano grátis), projeto `financial-system`.
- **Painel web:** pasta `docs/`, publicada de graça no GitHub Pages.
- **Bot do Telegram:** [@fred_financas_bot](https://t.me/fred_financas_bot), uma Edge Function do Supabase em `supabase/functions/telegram-bot`.

## Telas

| Página | Para quê |
| --- | --- |
| `docs/index.html` | Dashboard: saldo, a pagar, a receber, resultado do mês, gráfico de fluxo, vencimentos e últimos lançamentos |
| `docs/pagar.html` | Contas a pagar: tudo que sai, em aberto, vencido ou baixado |
| `docs/receber.html` | Contas a receber: tudo que entra |
| `docs/caixa.html` | Extrato do que já aconteceu, com filtros e exportação em CSV |
| `docs/pessoas.html` | Quem te deve e para quem você deve, com ficha e extrato por pessoa |
| `docs/relatorios.html` | Ano fechado: entradas e saídas mês a mês e por categoria |
| `docs/configuracoes.html` | Contas/carteiras, categorias e informações do bot |

## Como os dados ficam guardados

| Tabela / view | Para quê |
| --- | --- |
| `pessoas` | Nome, apelido, CPF, telefone, e-mail, chave Pix, observações |
| `contas` | Contas, carteiras e cartões, com saldo inicial |
| `categorias` | Categorias de receita e de despesa, com cor |
| `movimentacoes` | Cada lançamento: tipo, valor, data, vencimento, categoria, conta, situação, origem |
| `saldo_por_pessoa` | Saldo de cada pessoa. Positivo: ela te deve. Negativo: você deve a ela |
| `v_movimentacoes` | Lançamentos já com nome de pessoa, categoria, conta e direção (+1 entra, -1 sai) |
| `v_resumo_financeiro` | Números do dashboard: saldo atual, a pagar, a receber, mês corrente |
| `v_fluxo_mensal` | Entradas, saídas e resultado por mês |
| `v_por_categoria` | Totais por categoria e por mês |
| `buscar_pessoas(termo)` | Busca que ignora acentos e maiúsculas ("joao conc" acha "João da Conceição") |

Tipos de movimentação: `receita`, `despesa` (sem pessoa envolvida) e `recebi`, `paguei`, `emprestei`, `peguei_emprestado` (com pessoa).
Situação: `liquidado` (já aconteceu) ou `pendente` (conta em aberto).

## Configuração (uma vez só)

### 1. Seu usuário para o formulário
Supabase > **Authentication > Users > Add user > Create new user**. Use seu e-mail e uma senha. Depois, em **Authentication > Sign In / Providers**, desligue **Allow new users to sign up** para ninguém mais criar conta.

### 2. Token do bot
Supabase > **Edge Functions > Secrets > Add new secret**:
- Nome: `TELEGRAM_BOT_TOKEN`
- Valor: o token que o @BotFather mandou

### 3. Ligar o bot
Abra no navegador uma vez:
https://nbwozmphkejikpkmfaqh.supabase.co/functions/v1/telegram-bot?setup=1

Deve aparecer `"webhook_configurado": true`. Em seguida mande `/start` para o [@fred_financas_bot](https://t.me/fred_financas_bot). **O primeiro chat que manda /start vira o dono do bot**, e qualquer outra pessoa recebe "Este bot é privado".

### 4. Publicar o painel
GitHub > repositório > **Settings > Pages** > Source: *Deploy from a branch*, Branch: `main`, pasta `/docs`. O endereço fica https://fredericogommes.github.io/financial-system/

## Usando o bot

```
/nova João da Silva
/emprestei 500 João conserto do carro
/recebi 200 João - parcela 1
/paguei 150,90 Maria faxina
/peguei 1.000 Pedro
/pessoa joao      → saldo
/extrato joao     → últimas 10 movimentações
/saldos           → quem te deve e quem você deve
```

Se o nome bater com mais de uma pessoa, o bot mostra botões para você escolher.

## Mudanças no banco
As migrações ficam em `supabase/migrations/`. A função do bot é publicada com `supabase functions deploy telegram-bot --no-verify-jwt`.
