-- Todo empréstimo ("emprestei") gera uma conta a receber em aberto ("recebi" pendente)
-- vinculada ao devedor (referente_a = id do empréstimo). Vale para o painel e para o bot.

-- 1) O empréstimo em si é dinheiro que já saiu: sempre baixado.
create or replace function public.emprestimo_sempre_baixado()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.tipo = 'emprestei' then
    new.status := 'liquidado';
    new.liquidado_em := coalesce(new.liquidado_em, new.data);
  end if;
  return new;
end $$;

drop trigger if exists tg_emprestimo_sempre_baixado on public.movimentacoes;
create trigger tg_emprestimo_sempre_baixado
  before insert or update on public.movimentacoes
  for each row execute function public.emprestimo_sempre_baixado();

-- 2) Cria, acompanha e remove a conta a receber do empréstimo.
create or replace function public.emprestimo_conta_a_receber()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.tipo = 'emprestei' then
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

  elsif tg_op = 'DELETE' and old.tipo = 'emprestei' then
    delete from public.movimentacoes
     where referente_a = old.id and tipo = 'recebi' and status = 'pendente';
    return old;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists tg_emprestimo_conta_a_receber on public.movimentacoes;
create trigger tg_emprestimo_conta_a_receber
  after insert or update on public.movimentacoes
  for each row execute function public.emprestimo_conta_a_receber();

drop trigger if exists tg_emprestimo_conta_a_receber_del on public.movimentacoes;
create trigger tg_emprestimo_conta_a_receber_del
  before delete on public.movimentacoes
  for each row execute function public.emprestimo_conta_a_receber();

-- 3) Um "recebi" já baixado e solto (bot /recebi, botão Recebi em Pessoas) abate
--    as contas a receber em aberto da pessoa, do vencimento mais antigo ao mais novo.
create or replace function public.recebimento_abate_contas()
returns trigger language plpgsql set search_path = '' as $$
declare
  resta numeric := new.valor;
  c record;
begin
  if new.tipo <> 'recebi' or new.status <> 'liquidado'
     or new.pessoa_id is null or new.referente_a is not null then
    return new;
  end if;
  for c in
    select id, valor from public.movimentacoes
     where pessoa_id = new.pessoa_id and tipo = 'recebi' and status = 'pendente'
       and referente_a is not null
     order by vencimento nulls last, data, id
  loop
    exit when resta <= 0;
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

drop trigger if exists tg_recebimento_abate_contas on public.movimentacoes;
create trigger tg_recebimento_abate_contas
  after insert on public.movimentacoes
  for each row execute function public.recebimento_abate_contas();

-- 4) Saldo por pessoa conta só o que já aconteceu (o que está em aberto não mexe no saldo).
create or replace view public.saldo_por_pessoa with (security_invoker = true) as
select p.id as pessoa_id,
       p.nome,
       coalesce(sum(case m.tipo
                      when 'emprestei' then m.valor
                      when 'peguei_emprestado' then -m.valor
                      when 'recebi' then -m.valor
                      when 'paguei' then m.valor
                    end), 0)::numeric(12,2) as saldo,
       coalesce(sum(m.valor) filter (where m.tipo = 'emprestei'), 0)::numeric(12,2) as total_emprestado,
       coalesce(sum(m.valor) filter (where m.tipo = 'recebi'), 0)::numeric(12,2) as total_recebido,
       coalesce(sum(m.valor) filter (where m.tipo = 'paguei'), 0)::numeric(12,2) as total_pago,
       coalesce(sum(m.valor) filter (where m.tipo = 'peguei_emprestado'), 0)::numeric(12,2) as total_pego_emprestado,
       max(m.data) as ultima_movimentacao
  from public.pessoas p
  left join public.movimentacoes m on m.pessoa_id = p.id and m.status = 'liquidado'
 group by p.id, p.nome;

-- 5) Empréstimos já cadastrados: baixa os que estavam "em aberto" e cria a conta a receber de cada um.
update public.movimentacoes set status = 'liquidado'
 where tipo = 'emprestei' and status = 'pendente';

insert into public.movimentacoes
  (tipo, pessoa_id, valor, data, vencimento, descricao, conta_id, status, origem, referente_a)
select 'recebi', e.pessoa_id, e.valor, e.data, e.vencimento,
       coalesce(e.descricao, 'Empréstimo'), e.conta_id, 'pendente', e.origem, e.id
  from public.movimentacoes e
 where e.tipo = 'emprestei'
   and not exists (select 1 from public.movimentacoes r where r.referente_a = e.id and r.tipo = 'recebi');
