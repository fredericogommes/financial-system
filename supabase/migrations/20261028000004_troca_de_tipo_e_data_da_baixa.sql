-- Trocar o tipo de um lançamento também mexe na conta a receber:
--   virou "emprestei"  -> cria a conta a receber do empréstimo;
--   deixou de ser "emprestei" -> remove a conta a receber que ainda estava em aberto.
create or replace function public.emprestimo_conta_a_receber()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tipo = 'emprestei'
     and (tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.tipo <> 'emprestei')) then
    insert into public.movimentacoes
      (tipo, pessoa_id, valor, data, vencimento, descricao, conta_id, status, origem, referente_a)
    values
      ('recebi', new.pessoa_id, new.valor, new.data, new.vencimento,
       coalesce(new.descricao, 'Empréstimo'), new.conta_id, 'pendente', new.origem, new.id);

  elsif tg_op = 'UPDATE' and new.tipo = 'emprestei' and old.tipo = 'emprestei' then
    -- Ajusta o que ainda está em aberto pela diferença do valor do empréstimo.
    update public.movimentacoes r
       set pessoa_id = new.pessoa_id,
           vencimento = new.vencimento,
           valor = r.valor + (new.valor - old.valor)
     where r.referente_a = new.id and r.tipo = 'recebi' and r.status = 'pendente'
       and r.valor + (new.valor - old.valor) > 0;
    delete from public.movimentacoes r
     where r.referente_a = new.id and r.tipo = 'recebi' and r.status = 'pendente'
       and r.valor + (new.valor - old.valor) <= 0;

  elsif tg_op = 'UPDATE' and old.tipo = 'emprestei' then
    delete from public.movimentacoes
     where referente_a = new.id and tipo = 'recebi' and status = 'pendente';

  elsif tg_op = 'DELETE' and old.tipo = 'emprestei' then
    delete from public.movimentacoes
     where referente_a = old.id and tipo = 'recebi' and status = 'pendente';
    return old;
  end if;
  return coalesce(new, old);
end $$;

-- Contas a receber que foram trocadas para "emprestei" no formulário viraram um segundo
-- empréstimo (duplicando a dívida). Elas voltam a ser contas a receber em aberto.
update public.movimentacoes m
   set tipo = 'recebi', status = 'pendente', liquidado_em = null
 where m.tipo = 'emprestei'
   and m.referente_a is not null
   and exists (select 1 from public.movimentacoes e
                where e.id = m.referente_a and e.tipo = 'emprestei' and e.pessoa_id = m.pessoa_id);

-- Datas: "data" é a data do lançamento e "liquidado_em" a data da baixa (quando o dinheiro
-- entrou ou saiu). Caixa, dashboard e relatórios passam a usar a data da baixa.
update public.movimentacoes set liquidado_em = data
 where status = 'liquidado' and liquidado_em is null;

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
       coalesce(m.vencimento, m.data) as competencia,
       coalesce(m.liquidado_em, m.data) as data_caixa
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
           and date_trunc('month', data_caixa) = date_trunc('month', current_date)), 0)::numeric(12,2) as entradas_mes,
  coalesce(sum(valor) filter (where status = 'liquidado' and direcao = -1
           and date_trunc('month', data_caixa) = date_trunc('month', current_date)), 0)::numeric(12,2) as saidas_mes
from public.v_movimentacoes;

create or replace view public.v_fluxo_mensal with (security_invoker = on) as
select date_trunc('month', data_caixa)::date as mes,
       coalesce(sum(valor) filter (where direcao =  1), 0)::numeric(12,2) as entradas,
       coalesce(sum(valor) filter (where direcao = -1), 0)::numeric(12,2) as saidas,
       coalesce(sum(valor_com_sinal), 0)::numeric(12,2) as resultado
from public.v_movimentacoes
where status = 'liquidado'
group by 1
order by 1;

create or replace view public.v_por_categoria with (security_invoker = on) as
select date_trunc('month', data_caixa)::date as mes,
       coalesce(categoria_nome, 'Sem categoria') as categoria,
       coalesce(categoria_natureza, case when direcao = 1 then 'receita' else 'despesa' end) as natureza,
       coalesce(categoria_cor, '#6b7280') as cor,
       sum(valor)::numeric(12,2) as total,
       count(*) as lancamentos
from public.v_movimentacoes
where status = 'liquidado'
group by 1,2,3,4;
