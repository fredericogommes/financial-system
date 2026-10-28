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
