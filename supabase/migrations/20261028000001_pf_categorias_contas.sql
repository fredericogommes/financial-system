-- Lançamentos avulsos (sem pessoa envolvida): receita e despesa
alter type public.tipo_movimentacao add value if not exists 'despesa';
alter type public.tipo_movimentacao add value if not exists 'receita';

-- Contas / carteiras onde o dinheiro fica
create table if not exists public.contas (
  id bigint generated always as identity primary key,
  nome text not null,
  tipo text not null default 'conta_corrente'
    check (tipo in ('conta_corrente','poupanca','carteira','cartao','investimento')),
  instituicao text,
  saldo_inicial numeric(12,2) not null default 0,
  ativa boolean not null default true,
  criado_em timestamptz not null default now()
);

-- Categorias de receita e despesa
create table if not exists public.categorias (
  id bigint generated always as identity primary key,
  nome text not null,
  natureza text not null check (natureza in ('receita','despesa')),
  cor text not null default '#6b7280',
  criado_em timestamptz not null default now(),
  unique (nome, natureza)
);

alter table public.contas enable row level security;
alter table public.categorias enable row level security;

drop policy if exists "logado acessa contas" on public.contas;
create policy "logado acessa contas" on public.contas
  for all to authenticated using (true) with check (true);

drop policy if exists "logado acessa categorias" on public.categorias;
create policy "logado acessa categorias" on public.categorias
  for all to authenticated using (true) with check (true);

insert into public.categorias (nome, natureza, cor) values
  ('Salário','receita','#2ecc40'),
  ('Freelance','receita','#3ddc55'),
  ('Rendimentos','receita','#1aa334'),
  ('Outras receitas','receita','#6b7280'),
  ('Moradia','despesa','#e74c3c'),
  ('Alimentação','despesa','#f0a11c'),
  ('Transporte','despesa','#2563eb'),
  ('Saúde','despesa','#ec4899'),
  ('Educação','despesa','#8b5cf6'),
  ('Lazer','despesa','#06b6d4'),
  ('Impostos e taxas','despesa','#78716c'),
  ('Assinaturas','despesa','#0ea5e9'),
  ('Outras despesas','despesa','#6b7280')
on conflict (nome, natureza) do nothing;

insert into public.contas (nome, tipo, saldo_inicial)
select 'Carteira', 'carteira', 0
where not exists (select 1 from public.contas);
