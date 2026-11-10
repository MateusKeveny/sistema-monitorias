-- 103 (Performance 4.2.0): TMA em faixas, por fila.
--
-- O Hub já traz o TMA de cada pessoa por semana (volume_semanal.tma_seg), mas
-- nenhuma regra o usava. Agora cada fila pode apontar para um grupo de faixas
-- de TMA (canais_do_setor.grupo_tma), como já aponta para as de TME, C-SAT e
-- notas. Sem grupo (o padrão, e o caso de todas as filas de hoje), nada muda.
--
-- 1. Coluna nova grupo_tma (vazia).
-- 2. vw_extrato_quantidades: o mesmo texto de hoje, com um bloco a mais no fim
--    (UNION ALL) para o TMA. Os outros blocos não mudam; como nenhuma fila tem
--    grupo_tma, o resultado de todos os meses fica idêntico.
-- 3. grupo_csat e grupo_nota passam a aceitar vazio: a fila que "não mede"
--    C-SAT ou notas (Métricas por fila). Hoje todas as filas têm os dois
--    preenchidos, e o cálculo já trata vazio como "nada a contar".

alter table public.canais_do_setor add column if not exists grupo_tma text;
comment on column public.canais_do_setor.grupo_tma is
  '103: grupo de regras das faixas de TMA da fila (null = não mede TMA).';
alter table public.canais_do_setor alter column grupo_csat drop not null;
alter table public.canais_do_setor alter column grupo_nota drop not null;

create or replace view public.vw_extrato_quantidades with (security_invoker = true) as SELECT v.pessoa_id,
    v.mes_competencia,
    v.semana,
    v.canal AS origem,
    r.chave AS regra,
    (v.finalizados)::numeric AS quantidade,
    NULL::numeric AS pontos_manuais
   FROM ((volume_semanal v
     JOIN canais_do_setor f ON ((f.id = v.canal_id)))
     JOIN regras r ON (((r.chave = f.regra_finalizado) AND r.ativo)))
UNION ALL
 SELECT v.pessoa_id,
    v.mes_competencia,
    v.semana,
    v.canal AS origem,
    r.chave AS regra,
    (v.finalizados)::numeric AS quantidade,
    NULL::numeric AS pontos_manuais
   FROM ((((volume_semanal v
     JOIN canais_do_setor f ON ((f.id = v.canal_id)))
     LEFT JOIN vw_tme_equipe t ON (((t.mes_competencia = v.mes_competencia) AND (t.semana = v.semana) AND (t.canal_id = v.canal_id))))
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN ((f.tme_por_pessoa_desde IS NOT NULL) AND (v.mes_competencia >= f.tme_por_pessoa_desde)) THEN COALESCE(v.tme_seg, 0)
                    ELSE t.tme_seg
                END AS tme_seg) x)
     JOIN regras r ON (((r.grupo = f.grupo_tme) AND r.ativo AND ((r.faixa_min IS NULL) OR ((x.tme_seg)::numeric >= r.faixa_min)) AND ((r.faixa_max IS NULL) OR ((x.tme_seg)::numeric < r.faixa_max)) AND (NOT metrica_desligada_na_fila(v.mes_competencia, (v.semana)::integer, v.canal_id)))))
UNION ALL
 SELECT b.pessoa_id,
    b.mes_competencia,
    b.semana,
    b.origem,
    r.chave AS regra,
    b.quantidade,
    NULL::numeric AS pontos_manuais
   FROM (((vw_base_do_csat b
     JOIN canais_do_setor f ON ((f.id = b.canal_id)))
     JOIN vw_csat_semanal c ON (((c.pessoa_id = b.pessoa_id) AND (c.canal_id = b.canal_id) AND (c.mes_competencia = b.mes_competencia) AND (c.semana = b.semana))))
     JOIN regras r ON (((r.grupo = f.grupo_csat) AND r.ativo AND ((r.faixa_min IS NULL) OR (c.csat >= r.faixa_min)) AND ((r.faixa_max IS NULL) OR (c.csat < r.faixa_max)))))
UNION ALL
 SELECT a.pessoa_id,
    a.mes_competencia,
    a.semana,
    a.origem,
    r.chave AS regra,
    (count(*))::numeric AS quantidade,
    NULL::numeric AS pontos_manuais
   FROM ((vw_avaliacoes_validas a
     JOIN canais_do_setor f ON ((f.id = a.canal_id)))
     JOIN regras r ON (((r.grupo = f.grupo_nota) AND r.ativo AND (r.faixa_min = (a.nota)::numeric))))
  GROUP BY a.pessoa_id, a.mes_competencia, a.semana, a.origem, r.chave
UNION ALL
 SELECT m.operador_id AS pessoa_id,
    m.mes_referencia AS mes_competencia,
    m.semana_mes AS semana,
    NULL::text AS origem,
    r.chave AS regra,
    round(avg(m.nota_final), 4) AS quantidade,
    NULL::numeric AS pontos_manuais
   FROM ((monitorias m
     JOIN setores s ON (((s.id = setor_na_competencia(m.operador_id, m.mes_referencia)) AND s.monitorias)))
     JOIN regras r ON (((r.chave = s.regra_monitoria) AND r.ativo)))
  GROUP BY m.operador_id, m.mes_referencia, m.semana_mes, r.chave
UNION ALL
 SELECT l.pessoa_id,
    l.mes_competencia,
    l.semana,
    l.canal AS origem,
    r.chave AS regra,
    l.quantidade,
    l.pontos_manuais
   FROM (lancamentos l
     JOIN regras r ON (((r.chave = l.regra) AND r.ativo)))
UNION ALL
 SELECT a.pessoa_id,
    mes_de_competencia(a.data) AS mes_competencia,
    semana_do_ciclo(a.data) AS semana,
    NULL::text AS origem,
    r.chave AS regra,
    (count(*))::numeric AS quantidade,
    NULL::numeric AS pontos_manuais
   FROM (atendimentos_presenciais a
     JOIN regras r ON (((r.chave = 'presencial'::text) AND r.ativo)))
  WHERE (a.data >= '2026-08-26'::date)
  GROUP BY a.pessoa_id, (mes_de_competencia(a.data)), (semana_do_ciclo(a.data)), r.chave
UNION ALL
 SELECT c.pessoa_id,
    c.mes_competencia,
    c.semana,
    'huggy'::text AS origem,
    r.chave AS regra,
    (count(*))::numeric AS quantidade,
    NULL::numeric AS pontos_manuais
   FROM ((chamados_elo c
     CROSS JOIN LATERAL ( VALUES ('chamados_tratados'::text,true), ('chamados_sla_ate_2d'::text,(c.tempo_util < (3)::numeric)), ('chamados_sla_acima_2d'::text,((c.tempo_util >= (3)::numeric) AND (c.decisao = 'manter'::text)))) x(regra, conta))
     JOIN regras r ON (((r.chave = x.regra) AND r.ativo)))
  WHERE ((c.pessoa_id IS NOT NULL) AND (c.concluido_em IS NOT NULL) AND (c.status <> 'Cancelado'::text) AND x.conta AND (c.mes_competencia >= '2026-10-01'::date))
  GROUP BY c.pessoa_id, c.mes_competencia, c.semana, r.chave
UNION ALL
 -- 103: TMA em faixas. O TMA é da pessoa (a duração do atendimento é dela),
 -- e cada finalizado da semana pontua na faixa em que o TMA da semana caiu.
 SELECT v.pessoa_id,
    v.mes_competencia,
    v.semana,
    v.canal AS origem,
    r.chave AS regra,
    (v.finalizados)::numeric AS quantidade,
    NULL::numeric AS pontos_manuais
   FROM ((volume_semanal v
     JOIN canais_do_setor f ON ((f.id = v.canal_id)))
     JOIN regras r ON (((r.grupo = f.grupo_tma) AND r.ativo AND (v.tma_seg IS NOT NULL) AND (v.tma_seg > 0)
       AND ((r.faixa_min IS NULL) OR ((v.tma_seg)::numeric >= r.faixa_min))
       AND ((r.faixa_max IS NULL) OR ((v.tma_seg)::numeric < r.faixa_max))
       AND (NOT metrica_desligada_na_fila(v.mes_competencia, (v.semana)::integer, v.canal_id)))));
