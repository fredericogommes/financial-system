create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create table public.pessoas (
  id bigint generated always as identity primary key,
  nome text not null,
  apelido text,
  cpf text unique,
  telefone text,
  email text,
  chave_pix text,
  observacoes text,
  criado_em timestamptz not null default now()
);

create type public.tipo_movimentacao as enum (
  'paguei',            -- eu paguei a pessoa
  'recebi',            -- a pessoa me pagou
  'emprestei',         -- eu emprestei dinheiro à pessoa
  'peguei_emprestado'  -- a pessoa me emprestou
);

create table public.movimentacoes (
  id bigint generated always as identity primary key,
  pessoa_id bigint not null references public.pessoas(id) on delete restrict,
  tipo public.tipo_movimentacao not null,
  valor numeric(12,2) not null check (valor > 0),
  data date not null default current_date,
  vencimento date,
  descricao text,
  referente_a bigint references public.movimentacoes(id) on delete set null, -- ex.: recebimento que quita um empréstimo
  origem text not null default 'formulario' check (origem in ('formulario','telegram')),
  criado_em timestamptz not null default now()
);

create index movimentacoes_pessoa_idx on public.movimentacoes (pessoa_id, data desc);
create index movimentacoes_referente_idx on public.movimentacoes (referente_a);
create index pessoas_nome_trgm_idx on public.pessoas using gin (nome extensions.gin_trgm_ops);

-- Saldo por pessoa: positivo = a pessoa me deve; negativo = eu devo a ela
create view public.saldo_por_pessoa with (security_invoker = on) as
select p.id as pessoa_id,
       p.nome,
       coalesce(sum(case m.tipo when 'emprestei' then m.valor when 'peguei_emprestado' then -m.valor
                                when 'recebi' then -m.valor when 'paguei' then m.valor end), 0)::numeric(12,2) as saldo,
       coalesce(sum(m.valor) filter (where m.tipo = 'emprestei'), 0)::numeric(12,2) as total_emprestado,
       coalesce(sum(m.valor) filter (where m.tipo = 'recebi'), 0)::numeric(12,2) as total_recebido,
       coalesce(sum(m.valor) filter (where m.tipo = 'paguei'), 0)::numeric(12,2) as total_pago,
       coalesce(sum(m.valor) filter (where m.tipo = 'peguei_emprestado'), 0)::numeric(12,2) as total_pego_emprestado,
       max(m.data) as ultima_movimentacao
from public.pessoas p
left join public.movimentacoes m on m.pessoa_id = p.id
group by p.id, p.nome;

-- Segurança: só usuários logados acessam (o bot do Telegram usa a chave de serviço)
alter table public.pessoas enable row level security;
alter table public.movimentacoes enable row level security;

create policy "logado acessa pessoas" on public.pessoas
  for all to authenticated using (true) with check (true);
create policy "logado acessa movimentacoes" on public.movimentacoes
  for all to authenticated using (true) with check (true);
