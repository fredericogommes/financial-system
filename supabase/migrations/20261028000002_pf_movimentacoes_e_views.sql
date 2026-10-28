-- Um lançamento pode não ter pessoa (uma conta de luz, por exemplo)
alter table public.movimentacoes alter column pessoa_id drop not null;

alter table public.movimentacoes
  add column if not exists categoria_id bigint references public.categorias(id) on delete set null,
  add column if not exists conta_id bigint references public.contas(id) on delete set null,
  add column if not exists status text not null default 'liquidado'
    check (status in ('pendente','liquidado')),
  add column if not exists liquidado_em date,
  add column if not exists forma text;

create index if not exists movimentacoes_status_idx on public.movimentacoes (status, vencimento);
create index if not exists movimentacoes_data_idx on public.movimentacoes (data desc);
create index if not exists movimentacoes_categoria_idx on public.movimentacoes (categoria_id);

-- +1 entra dinheiro, -1 sai dinheiro
create or replace function public.direcao_movimentacao(t public.tipo_movimentacao)
returns int language sql immutable
set search_path = ''
as $$
  select case when t in ('recebi','peguei_emprestado','receita') then 1 else -1 end;
$$;

create or replace view public.v_movimentacoes with (security_invoker = on) as
select m.id, m.pessoa_id, m.tipo, m.valor, m.data, m.vencimento, m.descricao,
       m.referente_a, m.origem, m.criado_em, m.categoria_id, m.conta_id,
       m.status, m.liquidado_em, m.forma,
       p.nome  as pessoa_nome,
       c.nome  as categoria_nome,
       c.natureza as categoria_natureza,
       c.cor   as categoria_cor,
       ct.nome as conta_nome,
       public.direcao_movimentacao(m.tipo) as direcao,
       (public.direcao_movimentacao(m.tipo) * m.valor)::numeric(12,2) as valor_com_sinal,
       coalesce(m.vencimento, m.data) as competencia
from public.movimentacoes m
left join public.pessoas   p  on p.id  = m.pessoa_id
left join public.categorias c on c.id  = m.categoria_id
left join public.contas    ct on ct.id = m.conta_id;

create or replace view public.v_resumo_financeiro with (security_invoker = on) as
select
  ((select coalesce(sum(saldo_inicial),0) from public.contas where ativa)
    + coalesce(sum(valor_com_sinal) filter (where status = 'liquidado'), 0))::numeric(12,2) as saldo_atual,
  coalesce(sum(valor) filter (where status = 'pendente' and direcao =  1), 0)::numeric(12,2) as a_receber,
  coalesce(sum(valor) filter (where status = 'pendente' and direcao = -1), 0)::numeric(12,2) as a_pagar,
  count(*) filter (where status = 'pendente' and direcao =  1 and vencimento < current_date) as receber_vencidos,
  count(*) filter (where status = 'pendente' and direcao = -1 and vencimento < current_date) as pagar_vencidos,
  count(*) filter (where status = 'pendente' and vencimento between current_date and current_date + 7) as vence_em_7_dias,
  coalesce(sum(valor) filter (where status = 'liquidado' and direcao =  1
           and date_trunc('month', data) = date_trunc('month', current_date)), 0)::numeric(12,2) as entradas_mes,
  coalesce(sum(valor) filter (where status = 'liquidado' and direcao = -1
           and date_trunc('month', data) = date_trunc('month', current_date)), 0)::numeric(12,2) as saidas_mes
from public.v_movimentacoes;

create or replace view public.v_fluxo_mensal with (security_invoker = on) as
select date_trunc('month', data)::date as mes,
       coalesce(sum(valor) filter (where direcao =  1), 0)::numeric(12,2) as entradas,
       coalesce(sum(valor) filter (where direcao = -1), 0)::numeric(12,2) as saidas,
       coalesce(sum(valor_com_sinal), 0)::numeric(12,2) as resultado
from public.v_movimentacoes
where status = 'liquidado'
group by 1
order by 1;

create or replace view public.v_por_categoria with (security_invoker = on) as
select date_trunc('month', data)::date as mes,
       coalesce(categoria_nome, 'Sem categoria') as categoria,
       coalesce(categoria_natureza, case when direcao = 1 then 'receita' else 'despesa' end) as natureza,
       coalesce(categoria_cor, '#6b7280') as cor,
       sum(valor)::numeric(12,2) as total,
       count(*) as lancamentos
from public.v_movimentacoes
where status = 'liquidado'
group by 1,2,3,4;
