-- ============================================================================
-- 55 · Chamados do ELO lidos direto pela cota, como as avaliações do Hub
--
-- Na 53, a importação gravava as quantidades de chamados em `lancamentos`
-- (linhas geradas). Elas apareciam na tela de Lançamentos e podiam ser
-- editadas ou apagadas por engano até a próxima importação. O pedido era o
-- modelo do Hub: a cota lê a tabela importada, e nada passa por Lançamentos.
--
-- Agora `vw_extrato_quantidades` lê `chamados_elo` direto — com as mesmas
-- regras de antes:
--   - chamados_tratados: resolvido (com conclusão e não Cancelado; Recusado
--     conta);
--   - chamados_sla_ate_2d: resolvido em menos de 3,0 dias úteis (2 dias
--     úteis completos);
--   - chamados_sla_acima_2d: fora do prazo com a gestão mantendo o desconto.
-- A partir da competência de outubro/2026, a primeira importada; setembro
-- continua com o lançamento manual, já fechado.
--
-- As linhas geradas pela 53 são apagadas, e `recalcular_chamados` passa a
-- não gravar nada (a importação e a decisão continuam chamando).
--
-- Mesmo corpo da view da migração 29, mais a parte dos chamados no fim.
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

create or replace view public.vw_extrato_quantidades with (security_invoker = true) as

  -- Finalizados: a regra depende do canal.
  select v.pessoa_id, v.mes_competencia, v.semana, v.canal as origem,
         r.chave as regra, v.finalizados::numeric as quantidade,
         null::numeric as pontos_manuais
    from public.volume_semanal v
    join public.regras r
      on r.chave = case v.canal when 'huggy' then 'huggy_atendimento'
                                else 'diretores_atendimento' end
     and r.ativo

  union all

  -- Faixa pelo TME médio da equipe do canal, aplicada aos finalizados da
  -- pessoa. Cada canal tem o seu grupo de faixas.
  select v.pessoa_id, v.mes_competencia, v.semana, v.canal,
         r.chave, v.finalizados::numeric, null
    from public.volume_semanal v
    join public.vw_tme_equipe t
      on t.mes_competencia = v.mes_competencia and t.semana = v.semana
     and t.canal = v.canal
    join public.regras r
      on r.grupo = case v.canal when 'huggy' then 'tme' else 'tme_diretores' end
     and r.ativo
     and (r.faixa_min is null or t.tme_seg >= r.faixa_min)
     and (r.faixa_max is null or t.tme_seg <  r.faixa_max)

  union all

  select b.pessoa_id, b.mes_competencia, b.semana, b.origem,
         r.chave, b.quantidade, null
    from public.vw_base_do_csat b
    join public.vw_csat_semanal c
      on c.pessoa_id = b.pessoa_id and c.origem = b.origem
     and c.mes_competencia = b.mes_competencia and c.semana = b.semana
    join public.regras r
      on r.grupo = 'csat' and r.ativo
     and (r.faixa_min is null or c.csat >= r.faixa_min)
     and (r.faixa_max is null or c.csat <  r.faixa_max)

  union all

  select a.pessoa_id, a.mes_competencia, a.semana, a.origem,
         r.chave, count(*)::numeric, null
    from public.vw_avaliacoes_validas a
    join public.regras r
      on r.grupo = 'nota' and r.ativo and r.faixa_min = a.nota
   group by a.pessoa_id, a.mes_competencia, a.semana, a.origem, r.chave

  union all

  select m.operador_id, m.mes_referencia, m.semana_mes, null,
         r.chave, round(avg(m.nota_final), 4), null
    from public.monitorias m
    join public.regras r on r.chave = 'monitoria' and r.ativo
   group by m.operador_id, m.mes_referencia, m.semana_mes, r.chave

  union all

  -- Lançamentos manuais, com o canal em que foram lançados.
  select l.pessoa_id, l.mes_competencia, l.semana, l.canal,
         r.chave, l.quantidade, l.pontos_manuais
    from public.lancamentos l
    join public.regras r on r.chave = l.regra and r.ativo

  union all

  -- Presencial registrado: uma linha por atendimento, contadas por semana.
  --
  -- A partir de 26/08/2026, início da competência de setembro — a primeira
  -- em que o registro substituiu o lançamento manual (migração 29).
  select a.pessoa_id,
         public.mes_de_competencia(a.data),
         public.semana_do_ciclo(a.data),
         null,
         r.chave, count(*)::numeric, null
    from public.atendimentos_presenciais a
    join public.regras r on r.chave = 'presencial' and r.ativo
   where a.data >= date '2026-08-26'
   group by a.pessoa_id, public.mes_de_competencia(a.data), public.semana_do_ciclo(a.data), r.chave
  union all

  -- Chamados do painel ELO (migrações 53 e 55), lidos direto da tabela
  -- importada, como as avaliações do Hub. Contam no canal Expansão.
  select c.pessoa_id, c.mes_competencia, c.semana, 'huggy',
         r.chave, count(*)::numeric, null
    from public.chamados_elo c
   cross join lateral (values
       ('chamados_tratados', true),
       ('chamados_sla_ate_2d', c.tempo_util < 3),
       ('chamados_sla_acima_2d', c.tempo_util >= 3 and c.decisao = 'manter')
     ) x (regra, conta)
    join public.regras r on r.chave = x.regra and r.ativo
   where c.pessoa_id is not null and c.concluido_em is not null
     and c.status <> 'Cancelado' and x.conta
     and c.mes_competencia >= date '2026-10-01'
   group by c.pessoa_id, c.mes_competencia, c.semana, r.chave;

-- Os nomes das regras de SLA eram os do lançamento manual ("SLA menor ou
-- igual a 2 dias"). Mês já fechado guarda o nome da época no fechamento.
update public.regras set rotulo = 'Resolvidos no prazo (2 dias úteis)'
 where chave = 'chamados_sla_ate_2d';
update public.regras set rotulo = 'Resolvidos fora do prazo'
 where chave = 'chamados_sla_acima_2d';

-- As linhas que a 53 gerou em Lançamentos saem: a cota já lê os chamados.
delete from public.lancamentos where gerado_por = 'chamados_elo';

create or replace function public.recalcular_chamados(p_mes date)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Desde a 55 a cota lê chamados_elo direto; não há o que refazer. Fica
  -- para a importação e a decisão continuarem chamando sem mudança.
  delete from public.lancamentos where gerado_por = 'chamados_elo' and mes_competencia = p_mes;
end;
$$;

revoke all on function public.recalcular_chamados(date) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: outubro do Analista pela view nova — deve dar 232 tratativas e
-- 230 no prazo (os números de antes) —, nenhuma linha gerada sobrando e o
-- nome novo da regra de prazo.
-- ---------------------------------------------------------------------------
select
  (select sum(quantidade) from public.vw_extrato_quantidades
    where regra = 'chamados_tratados' and mes_competencia = date '2026-10-01') as tratativas_outubro,
  (select sum(quantidade) from public.vw_extrato_quantidades
    where regra = 'chamados_sla_ate_2d' and mes_competencia = date '2026-10-01') as no_prazo_outubro,
  (select count(*) from public.lancamentos where gerado_por = 'chamados_elo') as linhas_geradas,
  (select rotulo from public.regras where chave = 'chamados_sla_ate_2d') as nome_no_prazo;
