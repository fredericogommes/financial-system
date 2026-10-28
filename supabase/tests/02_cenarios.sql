-- Cenários com resultado conhecido. Qualquer divergência interrompe com ERRO.
\set ON_ERROR_STOP 1
create or replace function pg_temp.confere(ok boolean, msg text) returns void language plpgsql as $$
begin
  if ok is not true then raise exception 'FALHOU: %', msg; end if;
  raise notice 'ok: %', msg;
end $$;

-- A) Dados reais: nada muda de valor e a conferência aponta os problemas certos
select pg_temp.confere((select saldo_atual from v_resumo_financeiro) = 0, 'saldo atual = 105.969 inicial - 105.969 emprestados');
select pg_temp.confere((select a_receber from v_resumo_financeiro) = 96369, 'a receber = soma das contas em aberto (sem Mageste)');
select pg_temp.confere((select a_pagar from v_resumo_financeiro) = 3600, 'a pagar = 2.750 + 850');
select pg_temp.confere((select saldo from saldo_por_pessoa where pessoa_id = 8) = 9600, 'saldo de empréstimo da Mageste continua 9.600');
select pg_temp.confere((select em_aberto from saldo_por_pessoa where pessoa_id = 8) = 0, 'Mageste sem conta em aberto');
select pg_temp.confere((select sum(em_aberto) from saldo_por_pessoa) = (select a_receber from v_resumo_financeiro), 'Pessoas em aberto = Contas a receber');
select pg_temp.confere((select count(*) from v_inconsistencias where problema = 'emprestimo_sem_conta' and movimentacao_id = 9 and valor = 9600) = 1, 'conferência aponta o empréstimo da Mageste sem conta');
select pg_temp.confere((select count(*) from v_inconsistencias where problema = 'aberto_sem_vencimento') = 2, 'conferência aponta as 2 despesas sem vencimento');
select pg_temp.confere((select count(*) from v_movimentacoes where grupo = 'emprestimo') = 13, 'empréstimos e contas deles estão no grupo empréstimo');
select pg_temp.confere((select coalesce(sum(total),0) from v_por_categoria) = 0, 'empréstimo não aparece como despesa por categoria');

-- B) Recebimento avulso do Pablo abate a conta do empréstimo e fica ligado a ele
insert into movimentacoes (tipo, pessoa_id, valor, data, status) values ('recebi', 4, 10000, hoje_br(), 'liquidado');
select pg_temp.confere((select valor from movimentacoes where id = 12) = 35844, 'conta do Pablo caiu para 35.844');
select pg_temp.confere((select referente_a from movimentacoes where tipo = 'recebi' and status = 'liquidado' and pessoa_id = 4) = 3, 'recebimento ficou ligado ao empréstimo');
select pg_temp.confere((select saldo from saldo_por_pessoa where pessoa_id = 4) = 35844, 'saldo do Pablo = 35.844');
select pg_temp.confere((select em_aberto from saldo_por_pessoa where pessoa_id = 4) = 35844, 'em aberto do Pablo = 35.844');
select pg_temp.confere((select receitas_mes from v_resumo_financeiro) = 0, 'devolução de empréstimo não é receita');
select pg_temp.confere((select emprestimos_entrada_mes from v_resumo_financeiro) = 10000, 'devolução aparece como entrada de empréstimo');

-- C) Pagamento avulso a uma pessoa (serviço) é despesa e não vira dívida dela
insert into movimentacoes (tipo, pessoa_id, valor, data, status) values ('paguei', 4, 300, hoje_br(), 'liquidado');
select pg_temp.confere((select saldo from saldo_por_pessoa where pessoa_id = 4) = 35844, 'pagar um serviço ao Pablo não mexe no saldo dele');
select pg_temp.confere((select despesas_mes from v_resumo_financeiro) = 300, 'serviço pago entra como despesa');

-- D) Peguei emprestado gera conta a pagar ao credor
insert into movimentacoes (tipo, pessoa_id, valor, data, vencimento, status) values ('peguei_emprestado', 6, 1000, hoje_br(), hoje_br() + 10, 'pendente');
select pg_temp.confere((select status from movimentacoes where tipo = 'peguei_emprestado') = 'liquidado', 'empréstimo tomado fica como já recebido');
select pg_temp.confere((select count(*) from movimentacoes where tipo = 'paguei' and status = 'pendente' and pessoa_id = 6 and valor = 1000) = 1, 'conta a pagar de 1.000 criada');
select pg_temp.confere((select saldo from saldo_por_pessoa where pessoa_id = 6) = 600, 'Matheus: deve 1.600, eu devo 1.000 -> 600');
select pg_temp.confere((select em_aberto from saldo_por_pessoa where pessoa_id = 6) = 600, 'em aberto do Matheus = 600');

-- E) Pagamento avulso ao credor abate a conta a pagar
insert into movimentacoes (tipo, pessoa_id, valor, data, status) values ('paguei', 6, 400, hoje_br(), 'liquidado');
select pg_temp.confere((select valor from movimentacoes where tipo = 'paguei' and status = 'pendente' and pessoa_id = 6) = 600, 'conta a pagar caiu para 600');
select pg_temp.confere((select saldo from saldo_por_pessoa where pessoa_id = 6) = 1000, 'saldo do Matheus = 1.600 - 1.000 + 400');
select pg_temp.confere((select despesas_mes from v_resumo_financeiro) = 300, 'devolução de empréstimo não é despesa');

-- F) Baixa parcial como o painel faz (lança o pago ligado ao empréstimo e reduz o aberto)
insert into movimentacoes (tipo, pessoa_id, valor, data, liquidado_em, status, referente_a) values ('recebi', 7, 1000.10, hoje_br(), hoje_br(), 'liquidado', 7);
update movimentacoes set valor = valor - 1000.10 where id = 13;
select pg_temp.confere((select valor from movimentacoes where id = 13) = 5249.90, 'parcial com centavos: 6.250 - 1.000,10 = 5.249,90');
select pg_temp.confere((select saldo from saldo_por_pessoa where pessoa_id = 7) = (select em_aberto from saldo_por_pessoa where pessoa_id = 7), 'Dieguinho: saldo = em aberto depois da parcial');

-- G) Trocar o tipo e excluir empréstimo
insert into movimentacoes (tipo, pessoa_id, valor, data, status) values ('emprestei', 5, 50, hoje_br(), 'liquidado');
update movimentacoes set tipo = 'peguei_emprestado' where tipo = 'emprestei' and valor = 50;
select pg_temp.confere((select count(*) from movimentacoes m where m.referente_a = (select id from movimentacoes where valor = 50 and tipo = 'peguei_emprestado') and m.status = 'pendente' and m.tipo = 'paguei') = 1, 'trocar emprestei por peguei troca a conta a receber por conta a pagar');
delete from movimentacoes where tipo = 'peguei_emprestado' and valor = 50;
select pg_temp.confere((select count(*) from movimentacoes where valor = 50) = 0, 'excluir o empréstimo remove a conta em aberto');

-- H) Centavos: 0,10 + 0,20 = 0,30 exatos
insert into movimentacoes (tipo, valor, data, status) values ('receita', 0.10, hoje_br(), 'liquidado'), ('receita', 0.20, hoje_br(), 'liquidado');
select pg_temp.confere((select receitas_mes from v_resumo_financeiro) = 0.30, 'receitas do mês = 0,30');

-- I) Auditoria registrou as mudanças
select pg_temp.confere((select count(*) from auditoria where tabela = 'movimentacoes' and acao = 'delete') >= 2, 'auditoria guardou exclusões');
select pg_temp.confere((select antes->>'valor' from auditoria where tabela = 'movimentacoes' and registro_id = 13 and acao = 'update' order by id limit 1) = '6250.00', 'auditoria guarda o valor anterior');

-- J) Acesso: só o usuário autorizado enxerga e altera
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
select pg_temp.confere((select count(*) from movimentacoes) = 0, 'outro usuário não vê lançamentos');
select pg_temp.confere((select count(*) from v_resumo_financeiro where a_receber > 0) = 0, 'outro usuário não vê indicadores');
do $$ begin
  begin
    insert into movimentacoes (tipo, valor, data, status) values ('receita', 1, current_date, 'liquidado');
    raise exception 'FALHOU: outro usuário conseguiu inserir';
  exception when insufficient_privilege then raise notice 'ok: outro usuário não consegue inserir';
  end;
end $$;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f4ed', false);
select pg_temp.confere((select count(*) from movimentacoes) > 0, 'Fred vê os lançamentos');
insert into movimentacoes (tipo, valor, data, status) values ('despesa', 5, current_date, 'liquidado');
select pg_temp.confere((select usuario from auditoria order by id desc limit 1) = '00000000-0000-0000-0000-00000000f4ed', 'auditoria registra quem alterou');
reset role;
\echo TODOS OS CENARIOS PASSARAM
