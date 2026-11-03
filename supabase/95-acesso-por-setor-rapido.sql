-- ============================================================================
-- 95 · Acesso por setor sem custo por linha (Performance 3.3.2) — URGENTE
--
-- A 94 deixou algumas regras de acesso chamando uma função POR LINHA
-- (cuida_do_cargo, cuida_do_canal, tem_setor). Os pesos por cargo entram no
-- cálculo do extrato milhares de vezes, e cada chamada recalculava o setor de
-- quem está logado: o extrato completo passou do limite de 8 s da consulta e
-- a exportação de outubro saiu vazia (só o cabeçalho), em 03/11/2026.
--
-- Agora essas regras usam listas calculadas UMA vez por consulta
-- (meus_cargos, minhas_filas, pessoas_com_setor), como as demais da 94.
-- A regra é a mesma: a prova compara o que gestor, qualidade, atendente e o
-- admin enxergam antes e depois; diferença desfaz tudo.
-- ============================================================================

begin;

create temp table acesso_antes (papel text, objeto text, hash text) on commit drop;
create temp table acesso_depois (papel text, objeto text, hash text) on commit drop;
create temp table quem_testa (papel text, auth_id uuid) on commit drop;
grant all on acesso_antes, acesso_depois, quem_testa to authenticated;
insert into quem_testa
select 'admin', p.auth_id from public.pessoas p where p.papel = 'administrador' and p.auth_id is not null
union all
select x.papel, (select p.auth_id from public.pessoas p where p.papel = x.papel and p.ativo and p.auth_id is not null order by p.id limit 1)
  from (values ('gestor'), ('qualidade'), ('operador')) x(papel);

create or replace function pg_temp.medir(p_papel text, p_tabela text) returns void language plpgsql as $$
declare o text; h text; v_auth uuid;
begin
  select auth_id into v_auth from quem_testa where papel = p_papel;
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', v_auth)::text, true);
  set local role authenticated;
  foreach o in array array['pessoas', 'pesos_por_cargo', 'cargos_referencia', 'pesos_historico', 'cargos_da_pessoa',
                           'avaliacoes_guardadas', 'metricas_desligadas', 'cargos', 'regras', 'setores'] loop
    execute format('select md5(coalesce(string_agg(t::text, '''' order by t::text), '''')) from public.%I t', o) into h;
    execute format('insert into %I values ($1, $2, $3)', p_tabela) using p_papel, o, h;
  end loop;
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end $$;
select pg_temp.medir(papel, 'acesso_antes') from quem_testa;

-- Funções de apoio que as visões chamam a cada linha: leem por dentro, sem
-- reaplicar as regras de acesso a cada chamada (devolvem só o cargo de uma
-- pessoa no mês e um sim/não).
alter function public.cargo_na_competencia(uuid, date) security definer set search_path = public;
alter function public.mes_inteiro_na_operacao(uuid, date) security definer set search_path = public;

-- As listas, uma vez por consulta.
create or replace function public.meus_cargos() returns smallint[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.cargos where setor_id = any (public.meus_setores());
$$;
create or replace function public.minhas_filas() returns smallint[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from public.canais_do_setor where setor_id = any (public.meus_setores());
$$;
create or replace function public.pessoas_com_setor() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct pessoa_id), '{}') from public.setores_da_pessoa;
$$;
grant execute on function public.meus_cargos(), public.minhas_filas(), public.pessoas_com_setor() to authenticated;

alter policy "pesos_leitura" on public.pesos_por_cargo
  using (cargo_id = any ((select public.meus_cargos())::smallint[]));
alter policy "pesos_gestor" on public.pesos_por_cargo
  using ((select public.eh_gestor()) and cargo_id = any ((select public.meus_cargos())::smallint[]))
  with check ((select public.eh_gestor()) and cargo_id = any ((select public.meus_cargos())::smallint[]));
alter policy "pesos_historico_leitura" on public.pesos_historico
  using ((select public.eh_gestor()) and cargo_id = any ((select public.meus_cargos())::smallint[]));
alter policy "cargos_referencia_leitura" on public.cargos_referencia
  using (cargo_id = any ((select public.meus_cargos())::smallint[]));
alter policy "cargos_referencia_gestor" on public.cargos_referencia
  using ((select public.eh_gestor()) and cargo_id = any ((select public.meus_cargos())::smallint[]))
  with check ((select public.eh_gestor()) and cargo_id = any ((select public.meus_cargos())::smallint[]));
alter policy "cargos_pessoa_gestor" on public.cargos_da_pessoa
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
  with check ((select public.eh_gestor()) and cargo_id = any ((select public.meus_cargos())::smallint[]));
alter policy "guardadas_gestor" on public.avaliacoes_guardadas
  using ((select public.eh_gestor()) and (pessoa_id = any ((select public.pessoas_que_vejo())::uuid[])
         or (pessoa_id is null and (canal_id is null or canal_id = any ((select public.minhas_filas())::smallint[])))))
  with check ((select public.eh_gestor()) and (pessoa_id = any ((select public.pessoas_que_vejo())::uuid[])
         or (pessoa_id is null and (canal_id is null or canal_id = any ((select public.minhas_filas())::smallint[])))));
alter policy "metricas_desligadas_leitura" on public.metricas_desligadas
  using ((select public.eh_gestor()) and ((canal_id is null and 1::smallint = any ((select public.meus_setores())::smallint[]))
                                         or canal_id = any ((select public.minhas_filas())::smallint[])));
alter policy "pessoas_leitura" on public.pessoas
  using (((select public.ve_o_time()) and (id = any ((select public.pessoas_que_vejo())::uuid[])
            or not (id = any ((select public.pessoas_com_setor())::uuid[]))))
         or id = (select public.pessoa_atual()));
alter policy "pessoas_gestor" on public.pessoas
  using ((select public.eh_gestor()) and (id = any ((select public.pessoas_que_vejo())::uuid[])
            or not (id = any ((select public.pessoas_com_setor())::uuid[]))))
  with check ((select public.eh_gestor()));

select pg_temp.medir(papel, 'acesso_depois') from quem_testa;

do $$
declare v_lista text; v_n integer;
begin
  select count(*), string_agg(coalesce(a.papel, d.papel) || '/' || coalesce(a.objeto, d.objeto), ', ') into v_n, v_lista
    from acesso_antes a full join acesso_depois d on d.papel = a.papel and d.objeto = a.objeto
   where a.hash is distinct from d.hash;
  if (select count(*) from quem_testa where auth_id is not null) < 4 then
    raise exception 'A prova precisa dos quatro perfis com login. Nada foi gravado.';
  end if;
  if v_n > 0 then raise exception 'A 95 mudou o acesso (%). Nada foi gravado.', v_lista; end if;
end $$;

commit;
