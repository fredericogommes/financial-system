-- Busca de pessoas ignorando acentos e maiúsculas; cada palavra do termo precisa aparecer
-- no nome ou apelido ("joao conc" acha "João da Conceição"). CPF e telefone: igualdade exata.
create or replace function public.buscar_pessoas(termo text)
returns setof public.pessoas
language sql stable
set search_path = ''
as $$
  select p.* from public.pessoas p
  where p.cpf = termo or p.telefone = termo
     or not exists (
       select 1 from unnest(regexp_split_to_array(trim(termo), '\s+')) as palavra
       where extensions.unaccent(p.nome || ' ' || coalesce(p.apelido,'')) not ilike '%' || extensions.unaccent(palavra) || '%'
     )
  order by p.nome
  limit 20;
$$;

revoke execute on function public.buscar_pessoas(text) from anon, public;
grant execute on function public.buscar_pessoas(text) to authenticated;
