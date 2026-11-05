-- Cenários da migração 6 (planejamento). Rodar depois de 02_cenarios.sql.
\set ON_ERROR_STOP 1
create or replace function pg_temp.confere(ok boolean, nome text) returns void language plpgsql as $$
begin if not ok then raise exception 'FALHOU: %', nome; end if; raise notice 'ok: %', nome; end $$;

-- Restrições das metas
insert into metas (tipo, nome, valor_alvo, data_alvo) values ('juntar', 'Viagem', 10000, '2027-06-01');
insert into metas (tipo, nome, meses) values ('reserva', 'Reserva', 6);
insert into metas (tipo, nome, categoria_id, percentual, base) values ('reduzir', 'Menos lazer', (select id from categorias limit 1), 20, 500);
do $$ begin
  begin insert into metas (tipo, nome) values ('juntar', 'Sem valor'); raise exception 'FALHOU: meta sem valor aceita';
  exception when check_violation then raise notice 'ok: meta juntar exige valor e data'; end;
end $$;
insert into regras_despesa (chave, classe) values ('internet', 'fixa');
insert into revisao_decisoes (tipo, chave, acao, custo_mensal) values ('fixa', 'internet', 'cancelei', 99.9);
do $$ begin
  begin insert into revisao_decisoes (tipo, chave, acao) values ('fixa', 'internet', 'dispensar'); raise exception 'FALHOU: decisão repetida';
  exception when unique_violation then raise notice 'ok: uma decisão por sugestão'; end;
end $$;
select pg_temp.confere((select count(*) from auditoria where tabela = 'metas' and acao = 'insert') = 3, 'auditoria guarda as metas');

-- Acesso: só o usuário autorizado
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000aa', false);
select pg_temp.confere((select count(*) from metas) + (select count(*) from regras_despesa) + (select count(*) from revisao_decisoes) = 0, 'outro usuário não vê planejamento');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000f4ed', false);
select pg_temp.confere((select count(*) from metas) = 3, 'Fred vê as metas');
update regras_despesa set classe = 'variavel' where chave = 'internet';
select pg_temp.confere((select classe from regras_despesa where chave = 'internet') = 'variavel', 'Fred corrige a classe');
reset role;
\echo PLANEJAMENTO OK
