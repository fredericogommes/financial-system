-- Planejamento: correções de classe do orçamento, decisões da revisão de gastos e metas.
-- Depende da migração 5 (função autorizado() e auditoria). Não altera lançamentos.

-- Correção manual da classe de uma conta (fixa, parcelada ou variável), pela chave da descrição
create table if not exists public.regras_despesa (
  chave text primary key,
  classe text not null check (classe in ('fixa', 'parcelada', 'variavel')),
  atualizado_em timestamptz not null default now()
);

-- O que você decidiu sobre cada sugestão da revisão: dispensar ou "cancelei"
create table if not exists public.revisao_decisoes (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('aumento', 'fixa', 'formiga', 'duplicada', 'nova')),
  chave text not null,
  acao text not null check (acao in ('dispensar', 'cancelei')),
  rotulo text,
  custo_mensal numeric(12,2),
  em timestamptz not null default now(),
  unique (tipo, chave)
);

-- Metas: juntar um valor até uma data, reduzir uma categoria em X% ou manter reserva de N meses
create table if not exists public.metas (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('juntar', 'reduzir', 'reserva')),
  nome text not null,
  valor_alvo numeric(12,2) check (valor_alvo > 0),
  data_alvo date,
  categoria_id bigint references public.categorias(id) on delete cascade,
  percentual numeric(5,2) check (percentual > 0 and percentual < 100),
  base numeric(12,2),
  meses int check (meses between 1 and 60),
  criado_em timestamptz not null default now(),
  check (
    (tipo = 'juntar'  and valor_alvo is not null and data_alvo is not null) or
    (tipo = 'reduzir' and categoria_id is not null and percentual is not null and base is not null) or
    (tipo = 'reserva' and meses is not null)
  )
);
create index if not exists metas_categoria_idx on public.metas (categoria_id);

alter table public.regras_despesa enable row level security;
alter table public.revisao_decisoes enable row level security;
alter table public.metas enable row level security;

drop policy if exists "autorizado acessa regras_despesa" on public.regras_despesa;
drop policy if exists "autorizado acessa revisao_decisoes" on public.revisao_decisoes;
drop policy if exists "autorizado acessa metas" on public.metas;
create policy "autorizado acessa regras_despesa" on public.regras_despesa
  for all to authenticated using (public.autorizado()) with check (public.autorizado());
create policy "autorizado acessa revisao_decisoes" on public.revisao_decisoes
  for all to authenticated using (public.autorizado()) with check (public.autorizado());
create policy "autorizado acessa metas" on public.metas
  for all to authenticated using (public.autorizado()) with check (public.autorizado());

drop trigger if exists tg_auditoria on public.metas;
create trigger tg_auditoria after insert or update or delete on public.metas
  for each row execute function public.registrar_auditoria();
