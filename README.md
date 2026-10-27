# Finanças do Fred

Sistema de finanças pessoais para registrar com quem você movimenta dinheiro: quem você paga, para quem empresta, quem te pagou e de quem pegou emprestado. Tudo com ferramentas gratuitas.

- **Banco de dados:** Supabase (plano grátis), projeto `financial-system`.
- **Formulário web:** `docs/index.html`, publicado de graça no GitHub Pages.
- **Bot do Telegram:** [@fred_financas_bot](https://t.me/fred_financas_bot), uma Edge Function do Supabase em `supabase/functions/telegram-bot`.

## Como os dados ficam guardados

| Tabela / view | Para quê |
| --- | --- |
| `pessoas` | Nome, apelido, CPF, telefone, e-mail, chave Pix, observações |
| `movimentacoes` | Cada lançamento: tipo, valor, data, vencimento, descrição, origem (formulário ou Telegram) |
| `saldo_por_pessoa` | Saldo de cada pessoa. Positivo: ela te deve. Negativo: você deve a ela |
| `buscar_pessoas(termo)` | Busca que ignora acentos e maiúsculas ("joao conc" acha "João da Conceição") |

Tipos de movimentação: `emprestei`, `recebi`, `paguei`, `peguei_emprestado`.

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

### 4. Publicar o formulário
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
