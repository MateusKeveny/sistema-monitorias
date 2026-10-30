-- ============================================================================
-- 91 · Desempenho (Performance 3.0 / Monitorias 6.0) — teste de carga de 30/10/2026
--
-- No banco local, com 5 setores do tamanho da Conexão Expansão, o sistema
-- passaria do limite de 8 s das consultas (fechar o ciclo: 55 s; atualizar o
-- resumo: 58 s; extrato do atendente: 8 s). Três mudanças resolveram, sem mudar
-- nenhum valor nem o que cada um enxerga:
--
--   1. As regras de acesso (políticas) perguntam "quem é você" UMA vez por
--      consulta, e não a cada linha: as funções de quem está logado passam a
--      ser chamadas como (select ...), como a Supabase recomenda. A regra é a
--      mesma, palavra por palavra.
--   2. A média da equipe (media_do_cargo) calcula só as pessoas que a compõem,
--      e não o extrato do mês de todo mundo.
--   3. Índices nas avaliações pelo mês de competência (eram lidas inteiras a
--      cada cálculo).
--
-- Resultado no ensaio (5 setores): fechar 55 s → 3,5 s; resumo 58 s → 3,0 s;
-- extrato do atendente 8,0 s → 0,13 s.
--
-- Provas dentro da migração (diferença desfaz tudo):
--   · a cota de todas as pessoas e meses igual à foto de antes;
--   · gestor, qualidade e atendente enxergam exatamente as mesmas linhas de
--     17 tabelas e visões, antes e depois.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez.
-- ============================================================================

begin;

select public.tirar_foto_da_cota('antes-da-91');

create temp table acesso_antes (papel text, objeto text, hash text) on commit drop;
create temp table acesso_depois (papel text, objeto text, hash text) on commit drop;
grant all on acesso_antes, acesso_depois to authenticated;

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub',
  (select auth_id from public.pessoas where papel = 'gestor' and ativo and auth_id is not null order by id limit 1))::text, true);
set local role authenticated;
do $$
declare o text; h text;
begin
  foreach o in array array['pessoas', 'avaliacoes', 'volume_semanal', 'lancamentos', 'monitorias', 'monitoria_itens', 'cargos_da_pessoa', 'setores_da_pessoa', 'regras', 'pesos_por_cargo', 'criterios', 'fechamentos_cota', 'canais_do_setor', 'setores', 'vw_monitorias', 'vw_ranking_mensal', 'vw_criterios_reprovados'] loop
    execute format('select md5(coalesce(string_agg(t::text, '''' order by t::text), '''')) from public.%I t', o) into h;
    insert into acesso_antes values ('gestor', o, h);
  end loop;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub',
  (select auth_id from public.pessoas where papel = 'qualidade' and ativo and auth_id is not null order by id limit 1))::text, true);
set local role authenticated;
do $$
declare o text; h text;
begin
  foreach o in array array['pessoas', 'avaliacoes', 'volume_semanal', 'lancamentos', 'monitorias', 'monitoria_itens', 'cargos_da_pessoa', 'setores_da_pessoa', 'regras', 'pesos_por_cargo', 'criterios', 'fechamentos_cota', 'canais_do_setor', 'setores', 'vw_monitorias', 'vw_ranking_mensal', 'vw_criterios_reprovados'] loop
    execute format('select md5(coalesce(string_agg(t::text, '''' order by t::text), '''')) from public.%I t', o) into h;
    insert into acesso_antes values ('qualidade', o, h);
  end loop;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub',
  (select auth_id from public.pessoas where papel = 'operador' and ativo and auth_id is not null order by id limit 1))::text, true);
set local role authenticated;
do $$
declare o text; h text;
begin
  foreach o in array array['pessoas', 'avaliacoes', 'volume_semanal', 'lancamentos', 'monitorias', 'monitoria_itens', 'cargos_da_pessoa', 'setores_da_pessoa', 'regras', 'pesos_por_cargo', 'criterios', 'fechamentos_cota', 'canais_do_setor', 'setores', 'vw_monitorias', 'vw_ranking_mensal', 'vw_criterios_reprovados'] loop
    execute format('select md5(coalesce(string_agg(t::text, '''' order by t::text), '''')) from public.%I t', o) into h;
    insert into acesso_antes values ('operador', o, h);
  end loop;
end $$;
reset role;

-- ---------------------------------------------------------------- 1. Políticas
alter policy "acessos_leitura" on public.acessos to public using ((select public.eh_gestor()));
alter policy "acessos_criados_leitura" on public.acessos_criados to public using ((select public.eh_gestor()));
alter policy "atendimentos_historico" on public.atendimentos to public using ((select public.ve_o_time()));
alter policy "atendimentos_outro_setor_gestor" on public.atendimentos_outro_setor to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "presenciais_registro" on public.atendimentos_presenciais to public with check (((pessoa_id = (select public.pessoa_atual())) OR (select public.eh_gestor())));
alter policy "presenciais_leitura" on public.atendimentos_presenciais to public using (((select public.ve_o_time()) OR (pessoa_id = (select public.pessoa_atual()))));
alter policy "presenciais_exclusao" on public.atendimentos_presenciais to public using (((select public.eh_gestor()) OR ((pessoa_id = (select public.pessoa_atual())) AND (data >= '2026-09-26'::date) AND (NOT (EXISTS ( SELECT 1
   FROM fechamentos_cota f
  WHERE ((f.pessoa_id = atendimentos_presenciais.pessoa_id) AND (f.mes_competencia = mes_de_competencia(atendimentos_presenciais.data)))))))));
alter policy "avaliacoes_leitura" on public.avaliacoes to public using (((select public.ve_o_time()) OR (pessoa_id = (select public.pessoa_atual()))));
alter policy "avaliacoes_gestor" on public.avaliacoes to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "guardadas_gestor" on public.avaliacoes_guardadas to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "canais_do_setor_leitura" on public.canais_do_setor to public using (((select auth.uid()) IS NOT NULL));
alter policy "canais_do_setor_gestor" on public.canais_do_setor to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "avisos_da_pessoa_leitura" on public.avisos_da_pessoa to public using ((pessoa_id = (select public.pessoa_atual())));
alter policy "enviados_gestor" on public.avisos_enviados to public using ((select public.eh_gestor()));
alter policy "avisos_gestor" on public.avisos_teams to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "canais_leitura" on public.canais to public using (((select auth.uid()) IS NOT NULL));
alter policy "canais_gestor" on public.canais to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "cargos_leitura" on public.cargos to public using (((select public.papel_atual()) IS NOT NULL));
alter policy "cargos_gestor" on public.cargos to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "criterios_leitura" on public.criterios to public using (((select auth.uid()) IS NOT NULL));
alter policy "criterios_gestor" on public.criterios to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "cargos_pessoa_leitura" on public.cargos_da_pessoa to public using (((select public.ve_o_time()) OR (pessoa_id = (select public.pessoa_atual()))));
alter policy "cargos_pessoa_gestor" on public.cargos_da_pessoa to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "cargos_referencia_leitura" on public.cargos_referencia to public using (((select public.papel_atual()) IS NOT NULL));
alter policy "cargos_referencia_gestor" on public.cargos_referencia to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "chamados_elo_leitura" on public.chamados_elo to public using (((select public.ve_o_time()) OR (pessoa_id = (select public.pessoa_atual()))));
alter policy "conferencias_leitura" on public.conferencias_calculo to public using ((select public.eh_gestor()));
alter policy "cotas_historico" on public.cotas to public using ((select public.ve_o_time()));
alter policy "anotacoes_leitura" on public.diario_anotacoes to public using ((select public.eh_gestor()));
alter policy "anotacoes_exclusao" on public.diario_anotacoes to public using (((select public.eh_gestor()) AND (autor_id = (select public.pessoa_atual()))));
alter policy "anotacoes_escrita" on public.diario_anotacoes to public with check (((select public.eh_gestor()) AND (autor_id = (select public.pessoa_atual()))));
alter policy "anotacoes_edicao" on public.diario_anotacoes to public using (((select public.eh_gestor()) AND (autor_id = (select public.pessoa_atual())))) with check (((select public.eh_gestor()) AND (autor_id = (select public.pessoa_atual()))));
alter policy "citacoes_monitor" on public.diario_citacoes to public using ((select public.pode_monitorar())) with check ((select public.pode_monitorar()));
alter policy "citacoes_leitura" on public.diario_citacoes to public using ((select public.ve_o_time()));
alter policy "leituras_leitura" on public.diario_leituras to public using (((pessoa_id = (select public.pessoa_atual())) OR aprova_diario()));
alter policy "leituras_confirmar" on public.diario_leituras to public with check ((pessoa_id = (select public.pessoa_atual())));
alter policy "privados_registro" on public.diario_privados to public with check ((((select public.pessoa_atual()) IS NOT NULL) AND (pessoa_id = (select public.pessoa_atual()))));
alter policy "privados_leitura" on public.diario_privados to public using (((pessoa_id = (select public.pessoa_atual())) OR aprova_diario()));
alter policy "privados_exclusao" on public.diario_privados to public using ((select public.eh_gestor()));
alter policy "privados_correcao" on public.diario_privados to public using (((pessoa_id = (select public.pessoa_atual())) AND (situacao = 'devolvido'::text))) with check ((pessoa_id = (select public.pessoa_atual())));
alter policy "diario_registro" on public.diario_registros to public with check ((((select public.pessoa_atual()) IS NOT NULL) AND (pessoa_id = (select public.pessoa_atual())) AND ((tipo <> 'problema'::text) OR aprova_diario())));
alter policy "diario_leitura" on public.diario_registros to public using ((((select public.papel_atual()) IS NOT NULL) AND pessoa_ve_diario((select public.pessoa_atual()), tipo, pessoa_id)));
alter policy "diario_exclusao" on public.diario_registros to public using ((select public.eh_gestor()));
alter policy "diario_correcao" on public.diario_registros to public using (((pessoa_id = (select public.pessoa_atual())) AND (situacao = 'devolvido'::text))) with check (((pessoa_id = (select public.pessoa_atual())) AND ((tipo <> 'problema'::text) OR aprova_diario())));
alter policy "renovacoes_leitura" on public.diario_renovacoes to public using (((select public.papel_atual()) IS NOT NULL));
alter policy "subcategorias_leitura" on public.diario_subcategorias to public using (((select public.papel_atual()) IS NOT NULL));
alter policy "subcategorias_gestor" on public.diario_subcategorias to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "diario_visibilidade_leitura" on public.diario_visibilidade to public using (((select public.papel_atual()) IS NOT NULL));
alter policy "fechamento_alteracoes_leitura" on public.fechamento_alteracoes to public using (((select public.ve_o_time()) OR (pessoa_id = (select public.pessoa_atual()))));
alter policy "fechamento_linhas_leitura" on public.fechamento_linhas to public using ((EXISTS ( SELECT 1
   FROM fechamentos_cota f
  WHERE ((f.id = fechamento_linhas.fechamento_id) AND ((select public.ve_o_time()) OR (f.pessoa_id = (select public.pessoa_atual())))))));
alter policy "fechamentos_leitura" on public.fechamentos_cota to public using (((select public.ve_o_time()) OR (pessoa_id = (select public.pessoa_atual()))));
alter policy "ferias_gestor_grava" on public.ferias to authenticated with check ((select public.eh_gestor()));
alter policy "ferias_gestor_exclui" on public.ferias to authenticated using ((select public.eh_gestor()));
alter policy "ferias_gestor_altera" on public.ferias to authenticated using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "importacoes_mes_leitura" on public.importacoes_mes to public using (((select auth.uid()) IS NOT NULL));
alter policy "inscricoes_push_dono" on public.inscricoes_push to public using ((pessoa_id = (select public.pessoa_atual()))) with check ((pessoa_id = (select public.pessoa_atual())));
alter policy "lancamentos_leitura" on public.lancamentos to public using (((select public.ve_o_time()) OR (pessoa_id = (select public.pessoa_atual()))));
alter policy "lancamentos_gestor" on public.lancamentos to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "monitorias_leitura" on public.monitorias to public using (((select public.ve_o_time()) OR (operador_id = (select public.operador_atual()))));
alter policy "monitorias_escrita" on public.monitorias to public using ((select public.pode_monitorar())) with check ((select public.pode_monitorar()));
alter policy "lancamentos_substituidos_leitura" on public.lancamentos_substituidos to public using ((select public.eh_gestor()));
alter policy "metricas_desligadas_leitura" on public.metricas_desligadas to public using ((select public.eh_gestor()));
alter policy "alteracoes_leitura" on public.monitoria_alteracoes to public using ((EXISTS ( SELECT 1
   FROM monitorias m
  WHERE ((m.id = monitoria_alteracoes.monitoria_id) AND ((select public.ve_o_time()) OR (m.operador_id = (select public.operador_atual())))))));
alter policy "itens_leitura" on public.monitoria_itens to public using ((EXISTS ( SELECT 1
   FROM monitorias m
  WHERE ((m.id = monitoria_itens.monitoria_id) AND ((select public.ve_o_time()) OR (m.operador_id = (select public.operador_atual())))))));
alter policy "itens_escrita" on public.monitoria_itens to public using ((select public.pode_monitorar())) with check ((select public.pode_monitorar()));
alter policy "excluidas_leitura" on public.monitorias_excluidas to public using ((select public.ve_o_time()));
alter policy "pesos_historico_leitura" on public.pesos_historico to public using ((select public.eh_gestor()));
alter policy "pesos_leitura" on public.pesos_por_cargo to public using (((select public.papel_atual()) IS NOT NULL));
alter policy "pesos_gestor" on public.pesos_por_cargo to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "pessoas_leitura" on public.pessoas to public using (((select public.ve_o_time()) OR (id = (select public.pessoa_atual()))));
alter policy "pessoas_gestor" on public.pessoas to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "realocacoes_leitura" on public.realocacoes to public using ((select public.eh_gestor()));
alter policy "redefinicoes_leitura" on public.redefinicoes_de_senha to public using ((select public.eh_gestor()));
alter policy "regras_leitura" on public.regras to public using (((select public.papel_atual()) IS NOT NULL));
alter policy "regras_gestor" on public.regras to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "reportes_leitura" on public.reportes to public using (((pessoa_id = (select public.pessoa_atual())) OR (select public.eh_gestor())));
alter policy "reportes_gestor" on public.reportes to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "reportes_exclusao" on public.reportes to public using ((select public.eh_gestor()));
alter policy "reportes_envio" on public.reportes to public with check ((((select public.pessoa_atual()) IS NOT NULL) AND (pessoa_id = (select public.pessoa_atual()))));
alter policy "resumo_cota_mensal_leitura" on public.resumo_cota_mensal to public using (((select public.ve_o_time()) OR (pessoa_id = (select public.pessoa_atual()))));
alter policy "resumo_extrato_leitura" on public.resumo_extrato to public using (((select public.ve_o_time()) OR (pessoa_id = (select public.pessoa_atual()))));
alter policy "resumo_sem_cargo_leitura" on public.resumo_sem_cargo to public using (((select public.ve_o_time()) OR (pessoa_id = (select public.pessoa_atual()))));
alter policy "setores_leitura" on public.setores to public using (((select auth.uid()) IS NOT NULL));
alter policy "setores_gestor" on public.setores to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "saidas_leitura" on public.saidas to public using ((select public.ve_o_time()));
alter policy "saidas_gestor" on public.saidas to public with check ((select public.eh_gestor()));
alter policy "setores_pessoa_leitura" on public.setores_da_pessoa to public using (((select public.ve_o_time()) OR (pessoa_id = (select public.pessoa_atual()))));
alter policy "setores_pessoa_gestor" on public.setores_da_pessoa to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "solicitacoes_leitura" on public.solicitacoes_exclusao to public using ((select public.ve_o_time()));
alter policy "valores_alteracoes_leitura" on public.valores_alteracoes to public using ((select public.ve_o_time()));
alter policy "valores_leitura" on public.valores_da_cota to public using (((select public.papel_atual()) IS NOT NULL));
alter policy "valores_gestor" on public.valores_da_cota to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "valores_rh_leitura" on public.valores_rh to public using (((select public.eh_gestor()) OR (pessoa_id = (select public.pessoa_atual()))));
alter policy "valores_rh_alteracoes_leitura" on public.valores_rh_alteracoes to public using ((select public.eh_gestor()));
alter policy "volume_outro_setor_gestor" on public.volume_outro_setor to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));
alter policy "volume_leitura" on public.volume_semanal to public using (((select public.ve_o_time()) OR (pessoa_id = (select public.pessoa_atual()))));
alter policy "volume_gestor" on public.volume_semanal to public using ((select public.eh_gestor())) with check ((select public.eh_gestor()));

-- ---------------------------------------------------------- 2. Média da equipe
create or replace function public.media_do_cargo(p_cargo smallint, p_mes date, p_nivel integer DEFAULT 0)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_media numeric;
  v_alvo uuid[];
begin
  -- Trava extra além do bloqueio de configuração circular.
  if p_nivel > 5 then
    return null;
  end if;

  -- Quem compõe a média, numa lista: o filtro "pessoa = uma da lista" desce
  -- até dentro do extrato, que então calcula só essas pessoas — e não o mês
  -- de todo mundo (com vários setores, era o que tornava o cálculo lento).
  select array_agg(m.pessoa_id) into v_alvo
    from (select distinct cp.pessoa_id, public.cargo_na_competencia(cp.pessoa_id, p_mes) as cargo_id
            from public.cargos_da_pessoa cp) m
   where m.cargo_id in (select referencia_id from public.cargos_referencia where cargo_id = p_cargo)
     and public.mes_inteiro_na_operacao(m.pessoa_id, p_mes);
  if v_alvo is null then
    return null;
  end if;

  with alvo as (
    select p.pessoa_id, public.cargo_na_competencia(p.pessoa_id, p_mes) as cargo_id
      from unnest(v_alvo) as p(pessoa_id)
  ),
  diretos as (
    select e.pessoa_id, sum(e.cota) as pontos
      from public.vw_extrato_direto e
     where e.mes_competencia = p_mes
       and e.pessoa_id = any (v_alvo)
     group by e.pessoa_id
  ),
  -- Quando o cargo de referência também recebe por média, ela é a mesma para
  -- todos daquele cargo: calcula uma vez.
  medias as (
    select c.cargo_id, pc.peso,
           round(public.media_do_cargo(c.cargo_id, p_mes, p_nivel + 1) * pc.peso, 4) as pontos
      from (select distinct cargo_id from alvo) c
      join public.pesos_por_cargo pc
        on pc.cargo_id = c.cargo_id and pc.regra = 'media_da_equipe' and pc.ativo
      join public.regras r on r.chave = 'media_da_equipe' and r.ativo
  )
  select round(avg(coalesce(d.pontos, 0) * coalesce(md.peso, 1) + coalesce(md.pontos, 0)), 4)
    into v_media
    from alvo a
    left join diretos d on d.pessoa_id = a.pessoa_id
    left join medias md on md.cargo_id = a.cargo_id
   where d.pontos is not null or md.pontos is not null;

  return v_media;
end;
$function$;

-- ------------------------------------------------------------------ 3. Índices
create index if not exists avaliacoes_mes_idx on public.avaliacoes (public.mes_de_competencia(data));
create index if not exists avaliacoes_pessoa_mes_idx on public.avaliacoes (pessoa_id, public.mes_de_competencia(data));



select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub',
  (select auth_id from public.pessoas where papel = 'gestor' and ativo and auth_id is not null order by id limit 1))::text, true);
set local role authenticated;
do $$
declare o text; h text;
begin
  foreach o in array array['pessoas', 'avaliacoes', 'volume_semanal', 'lancamentos', 'monitorias', 'monitoria_itens', 'cargos_da_pessoa', 'setores_da_pessoa', 'regras', 'pesos_por_cargo', 'criterios', 'fechamentos_cota', 'canais_do_setor', 'setores', 'vw_monitorias', 'vw_ranking_mensal', 'vw_criterios_reprovados'] loop
    execute format('select md5(coalesce(string_agg(t::text, '''' order by t::text), '''')) from public.%I t', o) into h;
    insert into acesso_depois values ('gestor', o, h);
  end loop;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub',
  (select auth_id from public.pessoas where papel = 'qualidade' and ativo and auth_id is not null order by id limit 1))::text, true);
set local role authenticated;
do $$
declare o text; h text;
begin
  foreach o in array array['pessoas', 'avaliacoes', 'volume_semanal', 'lancamentos', 'monitorias', 'monitoria_itens', 'cargos_da_pessoa', 'setores_da_pessoa', 'regras', 'pesos_por_cargo', 'criterios', 'fechamentos_cota', 'canais_do_setor', 'setores', 'vw_monitorias', 'vw_ranking_mensal', 'vw_criterios_reprovados'] loop
    execute format('select md5(coalesce(string_agg(t::text, '''' order by t::text), '''')) from public.%I t', o) into h;
    insert into acesso_depois values ('qualidade', o, h);
  end loop;
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub',
  (select auth_id from public.pessoas where papel = 'operador' and ativo and auth_id is not null order by id limit 1))::text, true);
set local role authenticated;
do $$
declare o text; h text;
begin
  foreach o in array array['pessoas', 'avaliacoes', 'volume_semanal', 'lancamentos', 'monitorias', 'monitoria_itens', 'cargos_da_pessoa', 'setores_da_pessoa', 'regras', 'pesos_por_cargo', 'criterios', 'fechamentos_cota', 'canais_do_setor', 'setores', 'vw_monitorias', 'vw_ranking_mensal', 'vw_criterios_reprovados'] loop
    execute format('select md5(coalesce(string_agg(t::text, '''' order by t::text), '''')) from public.%I t', o) into h;
    insert into acesso_depois values ('operador', o, h);
  end loop;
end $$;
reset role;

-- As provas.
do $$
declare
  v_cota integer;
  v_acesso integer;
  v_perfis integer;
begin
  select count(*) into v_cota from public.comparar_com_a_foto('antes-da-91');
  select count(*) into v_acesso from acesso_antes a
    full join acesso_depois d on d.papel = a.papel and d.objeto = a.objeto
   where a.hash is distinct from d.hash;
  select count(distinct papel) into v_perfis from acesso_antes;
  if v_perfis < 3 then
    raise exception 'A prova de acesso precisa dos três perfis (achei %). Nada foi gravado.', v_perfis;
  end if;
  if v_cota + v_acesso > 0 then
    raise exception 'A 91 mudou algo (cota: % linha(s); acesso: % tabela(s)). Nada foi gravado.', v_cota, v_acesso;
  end if;
end $$;

commit;

analyze public.avaliacoes;

-- Conferência
select count(*) as diferencas_da_cota from public.comparar_com_a_foto('antes-da-91');
select count(*) as politicas_com_select from pg_policies
 where schemaname = 'public' and (qual ilike '%SELECT eh_gestor()%' or qual ilike '%SELECT pessoa_atual()%' or qual ilike '%SELECT ve_o_time()%');
