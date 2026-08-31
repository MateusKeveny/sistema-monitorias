-- ============================================================================
-- Views de relatório. Rode DEPOIS de 02-seguranca.sql.
-- As views usam security_invoker, então herdam a RLS das tabelas base: um
-- operador que consultar qualquer uma delas enxerga apenas os próprios números.
-- ============================================================================

-- Monitoria "achatada" — base de todos os relatórios e da exportação bruta.
create or replace view public.vw_monitorias with (security_invoker = true) as
select
  m.id,
  m.protocolo,
  m.data_atendimento,
  m.mes_referencia,
  extract(year  from m.data_atendimento)::int   as ano,
  extract(month from m.data_atendimento)::int   as mes,
  m.semana_mes,
  m.numero_monitoria,
  o.id   as operador_id,
  o.nome as operador,
  c.nome as canal,
  m.tempo_atendimento_seg,
  m.nota_final,
  m.zerado,
  m.motivo_zeramento,
  m.parecer,
  p.nome as monitor,
  m.criado_em
from public.monitorias m
join public.operadores o on o.id = m.operador_id
left join public.canais c on c.id = m.canal_id
left join public.perfis p on p.id = m.monitor_id;

-- Relatório 1: ranking mensal por operador.
create or replace view public.vw_ranking_mensal with (security_invoker = true) as
select
  mes_referencia,
  operador_id,
  operador,
  count(*)::int                               as total_monitorias,
  round(avg(nota_final), 4)                   as nota_media,
  min(nota_final)                             as nota_minima,
  max(nota_final)                             as nota_maxima,
  count(*) filter (where zerado)::int         as zeradas,
  count(*) filter (where nota_final = 1)::int as impecaveis,
  round(avg(nota_final) filter (where not zerado), 4) as nota_media_sem_zeradas
from public.vw_monitorias
group by mes_referencia, operador_id, operador;

-- Relatório 3: critérios mais reprovados, com o impacto real na nota do time.
create or replace view public.vw_criterios_reprovados with (security_invoker = true) as
select
  m.mes_referencia,
  cr.id   as criterio_id,
  cr.nome as criterio,
  cr.peso,
  count(*)::int                              as avaliacoes,
  count(*) filter (where not i.conforme)::int as reprovacoes,
  round(
    count(*) filter (where not i.conforme)::numeric / nullif(count(*), 0),
    4)                                       as taxa_reprovacao,
  round(count(*) filter (where not i.conforme) * cr.peso, 4) as pontos_perdidos
from public.monitoria_itens i
join public.monitorias m  on m.id  = i.monitoria_id
join public.criterios  cr on cr.id = i.criterio_id
group by 1, cr.id, cr.nome, cr.peso;

-- Relatório 2: base do feedback individual — cada critério avaliado da pessoa.
create or replace view public.vw_feedback_individual with (security_invoker = true) as
select
  m.id   as monitoria_id,
  o.id   as operador_id,
  o.nome as operador,
  m.protocolo,
  m.data_atendimento,
  m.mes_referencia,
  m.semana_mes,
  m.numero_monitoria,
  m.nota_final,
  m.zerado,
  m.parecer,
  cr.ordem as criterio_ordem,
  cr.nome  as criterio,
  cr.peso,
  i.conforme,
  i.observacao
from public.monitorias m
join public.operadores o      on o.id = m.operador_id
join public.monitoria_itens i on i.monitoria_id = m.id
join public.criterios cr      on cr.id = i.criterio_id;
