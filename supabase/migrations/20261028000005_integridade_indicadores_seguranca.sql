-- Revisão de integridade, indicadores e segurança.
-- Não altera valores, datas nem tipos de lançamentos já gravados.

------------------------------------------------------------------------------
-- 1) Data de hoje no fuso do Brasil. O banco roda em UTC: depois das 21h,
--    current_date já é "amanhã" e os vencidos do dashboard não batiam com as listas.
------------------------------------------------------------------------------
create or replace function public.hoje_br()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

------------------------------------------------------------------------------
-- 2) Novos campos: desconto e juros/multa na baixa, parcela e orçamento por categoria
------------------------------------------------------------------------------
alter table public.movimentacoes
  add column if not exists desconto numeric(12,2) not null default 0 check (desconto >= 0),
  add column if not exists juros    numeric(12,2) not null default 0 check (juros >= 0),
  add column if not exists parcela  text;

alter table public.categorias
  add column if not exists orcamento_mensal numeric(12,2) check (orcamento_mensal >= 0);

create index if not exists movimentacoes_conta_idx on public.movimentacoes (conta_id);
create index if not exists movimentacoes_status_venc_idx on public.movimentacoes (status, vencimento);

------------------------------------------------------------------------------
-- 3) Empréstimos nos dois sentidos.
--    emprestei         -> conta a receber ("recebi" em aberto) do devedor
--    peguei_emprestado -> conta a pagar   ("paguei" em aberto) ao credor
------------------------------------------------------------------------------
create or replace function public.contrapartida(t public.tipo_movimentacao)
returns public.tipo_movimentacao language sql immutable set search_path = '' as $$
  select case t when 'emprestei' then 'recebi'::public.tipo_movimentacao
                when 'peguei_emprestado' then 'paguei'::public.tipo_movimentacao end
$$;

create or replace function public.emprestimo_sempre_baixado()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tipo in ('emprestei', 'peguei_emprestado') then
    new.status := 'liquidado';
    new.liquidado_em := coalesce(new.liquidado_em, new.data);
  end if;
  return new;
end $$;

create or replace function public.emprestimo_conta_a_receber()
returns trigger language plpgsql set search_path = '' as $$
declare
  novo  public.tipo_movimentacao;
  velho public.tipo_movimentacao;
begin
  if tg_op <> 'DELETE' then novo := public.contrapartida(new.tipo); end if;
  if tg_op <> 'INSERT' then velho := public.contrapartida(old.tipo); end if;

  if tg_op = 'DELETE' then
    if velho is not null then
      delete from public.movimentacoes
       where referente_a = old.id and tipo = velho and status = 'pendente';
    end if;
    return old;
  end if;

  if novo is not null and (tg_op = 'INSERT' or old.tipo <> new.tipo) then
    -- Virou empréstimo (ou trocou de sentido): cria a conta em aberto
    if velho is not null then
      delete from public.movimentacoes
       where referente_a = new.id and tipo = velho and status = 'pendente';
    end if;
    insert into public.movimentacoes
      (tipo, pessoa_id, valor, data, vencimento, descricao, conta_id, status, origem, referente_a)
    values
      (novo, new.pessoa_id, new.valor, new.data, new.vencimento,
       coalesce(new.descricao, 'Empréstimo'), new.conta_id, 'pendente', new.origem, new.id);

  elsif novo is not null then
    -- Mesmo empréstimo editado: ajusta o que ainda está em aberto pela diferença de valor
    update public.movimentacoes r
       set pessoa_id = new.pessoa_id,
           vencimento = new.vencimento,
           valor = r.valor + (new.valor - old.valor)
     where r.referente_a = new.id and r.tipo = novo and r.status = 'pendente'
       and r.valor + (new.valor - old.valor) > 0;
    delete from public.movimentacoes r
     where r.referente_a = new.id and r.tipo = novo and r.status = 'pendente'
       and r.valor + (new.valor - old.valor) <= 0;

  elsif velho is not null then
    -- Deixou de ser empréstimo: some a conta que ainda estava em aberto
    delete from public.movimentacoes
     where referente_a = new.id and tipo = velho and status = 'pendente';
  end if;
  return new;
end $$;

-- Recebimento (ou pagamento) avulso de uma pessoa abate as contas em aberto de empréstimo
-- dela, do vencimento mais antigo ao mais novo, e fica ligado ao empréstimo (referente_a).
-- Sem empréstimo em aberto, ele continua avulso (é receita ou despesa comum).
-- Passa a rodar ANTES de gravar, para já salvar o vínculo.
drop trigger if exists tg_recebimento_abate_contas on public.movimentacoes;

create or replace function public.recebimento_abate_contas()
returns trigger language plpgsql set search_path = '' as $$
declare
  resta numeric := new.valor;
  c record;
begin
  if new.tipo not in ('recebi', 'paguei') or new.status <> 'liquidado'
     or new.pessoa_id is null or new.referente_a is not null then
    return new;
  end if;
  for c in
    select r.id, r.valor, r.referente_a
      from public.movimentacoes r
      join public.movimentacoes e on e.id = r.referente_a
     where r.pessoa_id = new.pessoa_id and r.tipo = new.tipo and r.status = 'pendente'
       and e.tipo in ('emprestei', 'peguei_emprestado')
     order by r.vencimento nulls last, r.data, r.id
  loop
    exit when resta <= 0;
    new.referente_a := coalesce(new.referente_a, c.referente_a);
    if c.valor <= resta then
      delete from public.movimentacoes where id = c.id;
      resta := resta - c.valor;
    else
      update public.movimentacoes set valor = c.valor - resta where id = c.id;
      resta := 0;
    end if;
  end loop;
  return new;
end $$;

create trigger tg_recebimento_abate_contas
  before insert on public.movimentacoes
  for each row execute function public.recebimento_abate_contas();

------------------------------------------------------------------------------
-- 4) v_movimentacoes: novas colunas no fim (as antigas continuam iguais)
--    grupo: 'emprestimo' para empréstimos e as devoluções ligadas a eles;
--           'resultado'  para receitas e despesas de verdade.
------------------------------------------------------------------------------
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
       coalesce(m.liquidado_em, m.data) as data_caixa,
       m.desconto, m.juros, m.parcela,
       case when m.tipo in ('emprestei', 'peguei_emprestado')
              or l.tipo in ('emprestei', 'peguei_emprestado') then 'emprestimo'
            else 'resultado' end as grupo,
       case when m.status = 'pendente' and m.vencimento < public.hoje_br()
            then public.hoje_br() - m.vencimento end as dias_atraso,
       (m.valor - m.juros + m.desconto)::numeric(12,2) as valor_previsto
from public.movimentacoes m
left join public.movimentacoes l  on l.id  = m.referente_a
left join public.pessoas   p  on p.id  = m.pessoa_id
left join public.categorias c on c.id  = m.categoria_id
left join public.contas    ct on ct.id = m.conta_id;

------------------------------------------------------------------------------
-- 5) Saldo por pessoa
--    saldo     = empréstimos (concedidos − tomados) − devoluções já baixadas.
--                Pagamento ou recebimento avulso (serviço, compra) não vira dívida.
--    a_receber / a_pagar / em_aberto = contas em aberto da pessoa (batem com as listas)
------------------------------------------------------------------------------
create or replace view public.saldo_por_pessoa with (security_invoker = on) as
select p.id as pessoa_id,
       p.nome,
       coalesce(sum(case
                  when m.status <> 'liquidado' then 0
                  when m.tipo = 'emprestei' then m.valor
                  when m.tipo = 'peguei_emprestado' then -m.valor
                  when m.grupo = 'emprestimo' and m.tipo = 'recebi' then -m.valor
                  when m.grupo = 'emprestimo' and m.tipo = 'paguei' then m.valor
                  else 0 end), 0)::numeric(12,2) as saldo,
       coalesce(sum(m.valor) filter (where m.status = 'liquidado' and m.tipo = 'emprestei'), 0)::numeric(12,2) as total_emprestado,
       coalesce(sum(m.valor) filter (where m.status = 'liquidado' and m.tipo = 'recebi'), 0)::numeric(12,2) as total_recebido,
       coalesce(sum(m.valor) filter (where m.status = 'liquidado' and m.tipo = 'paguei'), 0)::numeric(12,2) as total_pago,
       coalesce(sum(m.valor) filter (where m.status = 'liquidado' and m.tipo = 'peguei_emprestado'), 0)::numeric(12,2) as total_pego_emprestado,
       max(m.data) as ultima_movimentacao,
       coalesce(sum(m.valor) filter (where m.status = 'pendente' and m.direcao = 1), 0)::numeric(12,2) as a_receber,
       coalesce(sum(m.valor) filter (where m.status = 'pendente' and m.direcao = -1), 0)::numeric(12,2) as a_pagar,
       (coalesce(sum(m.valor) filter (where m.status = 'pendente' and m.direcao = 1), 0)
        - coalesce(sum(m.valor) filter (where m.status = 'pendente' and m.direcao = -1), 0))::numeric(12,2) as em_aberto
  from public.pessoas p
  left join public.v_movimentacoes m on m.pessoa_id = p.id
 group by p.id, p.nome;

------------------------------------------------------------------------------
-- 6) Indicadores do dashboard (colunas antigas mantidas; novas no fim)
------------------------------------------------------------------------------
create or replace view public.v_resumo_financeiro with (security_invoker = on) as
with base as (
  select v.*,
         date_trunc('month', v.data_caixa) = date_trunc('month', public.hoje_br()) as no_mes,
         date_trunc('month', v.data_caixa) = date_trunc('month', public.hoje_br()) - interval '1 month' as mes_anterior
    from public.v_movimentacoes v
)
select
  ((select coalesce(sum(saldo_inicial),0) from public.contas where ativa)
    + coalesce(sum(valor_com_sinal) filter (where status = 'liquidado'), 0))::numeric(12,2) as saldo_atual,
  coalesce(sum(valor) filter (where status = 'pendente' and direcao =  1), 0)::numeric(12,2) as a_receber,
  coalesce(sum(valor) filter (where status = 'pendente' and direcao = -1), 0)::numeric(12,2) as a_pagar,
  count(*) filter (where status = 'pendente' and direcao =  1 and vencimento < public.hoje_br()) as receber_vencidos,
  count(*) filter (where status = 'pendente' and direcao = -1 and vencimento < public.hoje_br()) as pagar_vencidos,
  count(*) filter (where status = 'pendente' and vencimento between public.hoje_br() and public.hoje_br() + 7) as vence_em_7_dias,
  coalesce(sum(valor) filter (where status = 'liquidado' and direcao =  1 and no_mes), 0)::numeric(12,2) as entradas_mes,
  coalesce(sum(valor) filter (where status = 'liquidado' and direcao = -1 and no_mes), 0)::numeric(12,2) as saidas_mes,
  -- Resultado (só receitas e despesas; empréstimos ficam de fora)
  coalesce(sum(valor) filter (where status = 'liquidado' and grupo = 'resultado' and direcao =  1 and no_mes), 0)::numeric(12,2) as receitas_mes,
  coalesce(sum(valor) filter (where status = 'liquidado' and grupo = 'resultado' and direcao = -1 and no_mes), 0)::numeric(12,2) as despesas_mes,
  coalesce(sum(valor) filter (where status = 'liquidado' and grupo = 'resultado' and direcao =  1 and mes_anterior), 0)::numeric(12,2) as receitas_mes_anterior,
  coalesce(sum(valor) filter (where status = 'liquidado' and grupo = 'resultado' and direcao = -1 and mes_anterior), 0)::numeric(12,2) as despesas_mes_anterior,
  -- Empréstimos no mês (movimento de caixa, não é resultado)
  coalesce(sum(valor) filter (where status = 'liquidado' and grupo = 'emprestimo' and direcao = -1 and no_mes), 0)::numeric(12,2) as emprestimos_saida_mes,
  coalesce(sum(valor) filter (where status = 'liquidado' and grupo = 'emprestimo' and direcao =  1 and no_mes), 0)::numeric(12,2) as emprestimos_entrada_mes,
  -- Valores vencidos e projeção de 30 dias (inclui vencidos; não inclui o que não tem vencimento)
  coalesce(sum(valor) filter (where status = 'pendente' and direcao =  1 and vencimento < public.hoje_br()), 0)::numeric(12,2) as receber_vencido_valor,
  coalesce(sum(valor) filter (where status = 'pendente' and direcao = -1 and vencimento < public.hoje_br()), 0)::numeric(12,2) as pagar_vencido_valor,
  coalesce(sum(valor) filter (where status = 'pendente' and direcao =  1 and vencimento <= public.hoje_br() + 30), 0)::numeric(12,2) as receber_30_dias,
  coalesce(sum(valor) filter (where status = 'pendente' and direcao = -1 and vencimento <= public.hoje_br() + 30), 0)::numeric(12,2) as pagar_30_dias,
  coalesce(sum(valor) filter (where status = 'pendente' and direcao =  1 and vencimento is null), 0)::numeric(12,2) as receber_sem_vencimento,
  coalesce(sum(valor) filter (where status = 'pendente' and direcao = -1 and vencimento is null), 0)::numeric(12,2) as pagar_sem_vencimento
from base;

create or replace view public.v_fluxo_mensal with (security_invoker = on) as
select date_trunc('month', data_caixa)::date as mes,
       coalesce(sum(valor) filter (where direcao =  1), 0)::numeric(12,2) as entradas,
       coalesce(sum(valor) filter (where direcao = -1), 0)::numeric(12,2) as saidas,
       coalesce(sum(valor_com_sinal), 0)::numeric(12,2) as resultado,
       coalesce(sum(valor) filter (where grupo = 'resultado' and direcao =  1), 0)::numeric(12,2) as receitas,
       coalesce(sum(valor) filter (where grupo = 'resultado' and direcao = -1), 0)::numeric(12,2) as despesas
from public.v_movimentacoes
where status = 'liquidado'
group by 1
order by 1;

-- Por categoria: só receitas e despesas (empréstimo não é gasto)
create or replace view public.v_por_categoria with (security_invoker = on) as
select date_trunc('month', data_caixa)::date as mes,
       coalesce(categoria_nome, 'Sem categoria') as categoria,
       coalesce(categoria_natureza, case when direcao = 1 then 'receita' else 'despesa' end) as natureza,
       coalesce(categoria_cor, '#6b7280') as cor,
       sum(valor)::numeric(12,2) as total,
       count(*) as lancamentos
from public.v_movimentacoes
where status = 'liquidado' and grupo = 'resultado'
group by 1,2,3,4;

-- Saldo de cada conta/carteira
create or replace view public.v_saldo_contas with (security_invoker = on) as
select ct.id as conta_id, ct.nome, ct.tipo, ct.saldo_inicial, ct.ativa,
       (ct.saldo_inicial + coalesce(sum(v.valor_com_sinal) filter (where v.status = 'liquidado'), 0))::numeric(12,2) as saldo
  from public.contas ct
  left join public.v_movimentacoes v on v.conta_id = ct.id
 group by ct.id;

------------------------------------------------------------------------------
-- 7) Conferência de dados: lista o que precisa de atenção (não corrige nada sozinho)
------------------------------------------------------------------------------
create or replace view public.v_inconsistencias with (security_invoker = on) as
-- Empréstimo cujo valor ainda não devolvido não bate com a conta em aberto
select 'emprestimo_sem_conta'::text as problema, e.id as movimentacao_id, e.pessoa_id, p.nome as pessoa_nome,
       (e.valor - coalesce(dev.pago, 0) - coalesce(ab.aberto, 0))::numeric(12,2) as valor,
       format('Empréstimo de %s: o valor ainda não devolvido não está todo em aberto', to_char(e.data, 'DD/MM/YYYY')) as detalhe
  from public.movimentacoes e
  join public.pessoas p on p.id = e.pessoa_id
  left join lateral (select sum(r.valor) pago from public.movimentacoes r
                      where r.referente_a = e.id and r.status = 'liquidado'
                        and r.tipo = public.contrapartida(e.tipo)) dev on true
  left join lateral (select sum(r.valor) aberto from public.movimentacoes r
                      where r.referente_a = e.id and r.status = 'pendente'
                        and r.tipo = public.contrapartida(e.tipo)) ab on true
 where e.tipo in ('emprestei', 'peguei_emprestado')
   and abs((e.valor - coalesce(dev.pago, 0)) - coalesce(ab.aberto, 0)) >= 0.01
   and e.valor - coalesce(dev.pago, 0) > 0
union all
select 'aberto_sem_vencimento', v.id, v.pessoa_id, v.pessoa_nome, v.valor,
       format('%s em aberto sem data de vencimento (lançado em %s)',
              coalesce(v.descricao, v.categoria_nome, v.tipo::text), to_char(v.data, 'DD/MM/YYYY'))
  from public.v_movimentacoes v
 where v.status = 'pendente' and v.vencimento is null and v.grupo = 'resultado'
union all
select 'sem_pessoa', m.id, null, null, m.valor,
       format('Lançamento do tipo %s sem pessoa', m.tipo)
  from public.movimentacoes m
 where m.tipo in ('recebi','paguei','emprestei','peguei_emprestado') and m.pessoa_id is null
union all
select 'baixado_no_futuro', v.id, v.pessoa_id, v.pessoa_nome, v.valor,
       format('%s baixado com data futura (%s)', coalesce(v.descricao, v.tipo::text), to_char(v.data_caixa, 'DD/MM/YYYY'))
  from public.v_movimentacoes v
 where v.status = 'liquidado' and v.data_caixa > public.hoje_br()
union all
select 'possivel_duplicado', min(m.id), m.pessoa_id, min(p.nome), m.valor,
       format('%s lançamentos iguais (%s em %s)', count(*), m.tipo, to_char(m.data, 'DD/MM/YYYY'))
  from public.movimentacoes m
  left join public.pessoas p on p.id = m.pessoa_id
 where m.referente_a is null
 group by m.tipo, m.pessoa_id, m.valor, m.data, coalesce(m.descricao, ''), m.status
having count(*) > 1;

------------------------------------------------------------------------------
-- 8) Histórico de alterações (quem, quando, antes e depois)
------------------------------------------------------------------------------
create table if not exists public.auditoria (
  id bigint generated always as identity primary key,
  tabela text not null,
  registro_id bigint,
  acao text not null,
  antes jsonb,
  depois jsonb,
  usuario uuid default auth.uid(),
  em timestamptz not null default now()
);
create index if not exists auditoria_registro_idx on public.auditoria (tabela, registro_id, em desc);

create or replace function public.registrar_auditoria()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.auditoria (tabela, registro_id, acao, antes, depois)
  values (tg_table_name,
          coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end) ->> 'id', null)::bigint,
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

drop trigger if exists tg_auditoria on public.movimentacoes;
create trigger tg_auditoria after insert or update or delete on public.movimentacoes
  for each row execute function public.registrar_auditoria();
drop trigger if exists tg_auditoria on public.pessoas;
create trigger tg_auditoria after insert or update or delete on public.pessoas
  for each row execute function public.registrar_auditoria();
drop trigger if exists tg_auditoria on public.contas;
create trigger tg_auditoria after insert or update or delete on public.contas
  for each row execute function public.registrar_auditoria();
drop trigger if exists tg_auditoria on public.categorias;
create trigger tg_auditoria after insert or update or delete on public.categorias
  for each row execute function public.registrar_auditoria();

------------------------------------------------------------------------------
-- 9) Acesso: só usuários autorizados (hoje, o Fred). Antes, qualquer conta criada
--    no Supabase com a chave pública conseguia ler e alterar tudo.
------------------------------------------------------------------------------
create table if not exists public.usuarios_autorizados (
  user_id uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.usuarios_autorizados enable row level security;

insert into public.usuarios_autorizados (user_id)
select id from auth.users where email = 'fredericogommes@gmail.com'
on conflict do nothing;

create or replace function public.autorizado()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.usuarios_autorizados where user_id = auth.uid())
$$;

drop policy if exists "logado acessa pessoas" on public.pessoas;
drop policy if exists "logado acessa movimentacoes" on public.movimentacoes;
drop policy if exists "logado acessa contas" on public.contas;
drop policy if exists "logado acessa categorias" on public.categorias;
drop policy if exists "autorizado acessa pessoas" on public.pessoas;
drop policy if exists "autorizado acessa movimentacoes" on public.movimentacoes;
drop policy if exists "autorizado acessa contas" on public.contas;
drop policy if exists "autorizado acessa categorias" on public.categorias;
drop policy if exists "autorizado le auditoria" on public.auditoria;
drop policy if exists "autorizado ve a si" on public.usuarios_autorizados;

create policy "autorizado acessa pessoas" on public.pessoas
  for all to authenticated using (public.autorizado()) with check (public.autorizado());
create policy "autorizado acessa movimentacoes" on public.movimentacoes
  for all to authenticated using (public.autorizado()) with check (public.autorizado());
create policy "autorizado acessa contas" on public.contas
  for all to authenticated using (public.autorizado()) with check (public.autorizado());
create policy "autorizado acessa categorias" on public.categorias
  for all to authenticated using (public.autorizado()) with check (public.autorizado());

alter table public.auditoria enable row level security;
create policy "autorizado le auditoria" on public.auditoria
  for select to authenticated using (public.autorizado());
create policy "autorizado ve a si" on public.usuarios_autorizados
  for select to authenticated using (user_id = auth.uid());
