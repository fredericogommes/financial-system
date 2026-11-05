# Instruções para agentes

## Stack
- Painel estático em `docs/` (HTML + JS puro, sem build, sem npm); publicado pelo GitHub Pages a partir de `main` `/docs`.
- Banco: Supabase (Postgres), migrações em `supabase/migrations/`.
- Bot do Telegram: Edge Function Deno em `supabase/functions/telegram-bot/index.ts`.
- Textos, nomes de variáveis, commits e mensagens ao usuário em português do Brasil.

## Comandos
| Tarefa | Comando |
|--------|---------|
| Testes JS (regras de planejamento) | `node --test tests/*.test.js` |
| Um arquivo de teste | `node --test tests/planejamento.test.js` |
| Testes SQL (Postgres local, migrações aplicadas) | `psql -f supabase/tests/00_stub_supabase.sql`, migrações em ordem, `01_dados_reais.sql`, `02_cenarios.sql`, `03_planejamento.sql` |
| Publicar o bot | `supabase functions deploy telegram-bot --no-verify-jwt` |

- `node --test tests/` (sem glob) falha no Node 22.
- `supabase/tests/01_dados_reais.sql` é cópia de dados reais: está no `.gitignore`, nunca versionar. Sem ela, `02_cenarios.sql` não fecha os valores esperados.

## Referências
| Preciso de | Arquivo |
|------------|---------|
| Telas, tabelas, views, tipos de movimentação, configuração | `README.md` |
| Licença das regras de planejamento (FinAssist, MIT) | `THIRD_PARTY_NOTICES.md` |
| Regras de orçamento, revisão, projeção e metas | `docs/js/planejamento.js` |
| Layout, login, helpers comuns (`$`, `esc`, `brl`, `dataBR`, `hoje`) | `docs/js/app.js` |

## Convenções
- Cada página `docs/X.html` tem seu script `docs/js/X.js`; `vendor/supabase.js` e `js/app.js` carregam antes dele.
- Ao mudar CSS ou JS, atualize o `?v=AAAAMMDDx` em todas as tags `<script>`/`<link>` de `docs/*.html` (cache do GitHub Pages).
- Escape todo texto vindo do banco com `esc()` antes de pôr em `innerHTML`.
- `docs/vendor/` são bibliotecas de terceiros copiadas: não editar.
- Lógica pura que precisa de teste fica em módulo com `if (typeof module !== "undefined") module.exports = ...` (como `planejamento.js`), testável no Node.
- Dinheiro: some em centavos inteiros (veja `cent`/`soma` em `planejamento.js`); nunca some floats direto.
- A chave publicável em `app.js` é pública de propósito; a proteção é RLS. Nunca coloque a service role key no painel.
- Banco: nunca edite migração já aplicada; crie nova `AAAAMMDD00000N_descricao.sql` com o próximo número.
- Toda tabela nova precisa de RLS liberando só o usuário autorizado e de cenário em `supabase/tests/`.
- Data "de hoje" no banco: use `hoje_br()` (fuso de Brasília), não `current_date`.
- Empréstimos (`emprestei`, `peguei_emprestado` e seus recebimentos) não são receita nem despesa: ficam no grupo `emprestimo`.
- Ao adicionar tela, tabela ou comando do bot, atualize as tabelas do `README.md`.

## Commits de IA
Incluir no fim da mensagem:
```
Co-Authored-By: (nome do agente e assinatura de atribuição)
```
