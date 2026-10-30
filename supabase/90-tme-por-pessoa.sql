-- ============================================================================
-- 90 · TME avaliado por pessoa (Performance 3.0)
--
-- Até aqui a faixa de TME saía da média do TME de todos da fila na semana
-- (vw_tme_equipe), e todo mundo da fila ganhava os pontos daquela faixa.
-- Decisão do gestor (29/10/2026): a partir da competência novembro/2026, nas
-- duas filas (Expansão e Diretores-Expansão), a faixa sai do TME da própria
-- pessoa na semana (volume_semanal.tme_seg, colado do Hub).
--
--   · canais_do_setor.tme_por_pessoa_desde — a partir de qual competência a
--     fila avalia o TME por pessoa (nulo = da equipe, como sempre).
--   · Semana em que a pessoa tem volume mas não tem TME (nulo ou zero): conta
--     como abaixo do limite — melhor faixa (decisão do gestor).
--   · Faixas, pesos e o "desligar o TME da semana" continuam iguais.
--   · Meses antes de novembro não mudam: a prova compara a cota de todas as
--     pessoas e meses com a foto de antes; diferença antes de novembro desfaz.
--
-- RODAR SÓ DEPOIS DO FECHAMENTO DE OUTUBRO.
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez.
-- ============================================================================

begin;

select public.tirar_foto_da_cota('antes-da-90');

alter table public.canais_do_setor add column if not exists tme_por_pessoa_desde date
  check (tme_por_pessoa_desde is null or extract(day from tme_por_pessoa_desde) = 1);

create or replace view public.vw_extrato_quantidades with (security_invoker = true) as
SELECT v.pessoa_id,
    v.mes_competencia,
    v.semana,
    v.canal AS origem,
    r.chave AS regra,
    v.finalizados::numeric AS quantidade,
    NULL::numeric AS pontos_manuais
   FROM volume_semanal v
     JOIN canais_do_setor f ON f.id = v.canal_id
     JOIN regras r ON r.chave = f.regra_finalizado AND r.ativo
UNION ALL
 SELECT v.pessoa_id,
    v.mes_competencia,
    v.semana,
    v.canal AS origem,
    r.chave AS regra,
    v.finalizados::numeric AS quantidade,
    NULL::numeric AS pontos_manuais
   FROM volume_semanal v
     JOIN canais_do_setor f ON f.id = v.canal_id
     -- O TME que cai na faixa (90): o da equipe; ou, a partir do mês em que a
     -- fila passou a avaliar por pessoa, o da própria pessoa na semana — sem
     -- TME, conta como abaixo do limite (melhor faixa).
     LEFT JOIN vw_tme_equipe t ON t.mes_competencia = v.mes_competencia AND t.semana = v.semana AND t.canal_id = v.canal_id
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN f.tme_por_pessoa_desde IS NOT NULL AND v.mes_competencia >= f.tme_por_pessoa_desde THEN COALESCE(v.tme_seg, 0)
                    ELSE t.tme_seg
                END AS tme_seg) x
     JOIN regras r ON r.grupo = f.grupo_tme AND r.ativo AND (r.faixa_min IS NULL OR x.tme_seg::numeric >= r.faixa_min) AND (r.faixa_max IS NULL OR x.tme_seg::numeric < r.faixa_max) AND NOT metrica_desligada_na_fila(v.mes_competencia, v.semana::integer, v.canal_id)
UNION ALL
 SELECT b.pessoa_id,
    b.mes_competencia,
    b.semana,
    b.origem,
    r.chave AS regra,
    b.quantidade,
    NULL::numeric AS pontos_manuais
   FROM vw_base_do_csat b
     JOIN canais_do_setor f ON f.id = b.canal_id
     JOIN vw_csat_semanal c ON c.pessoa_id = b.pessoa_id AND c.canal_id = b.canal_id AND c.mes_competencia = b.mes_competencia AND c.semana = b.semana
     JOIN regras r ON r.grupo = f.grupo_csat AND r.ativo AND (r.faixa_min IS NULL OR c.csat >= r.faixa_min) AND (r.faixa_max IS NULL OR c.csat < r.faixa_max)
UNION ALL
 SELECT a.pessoa_id,
    a.mes_competencia,
    a.semana,
    a.origem,
    r.chave AS regra,
    count(*)::numeric AS quantidade,
    NULL::numeric AS pontos_manuais
   FROM vw_avaliacoes_validas a
     JOIN canais_do_setor f ON f.id = a.canal_id
     JOIN regras r ON r.grupo = f.grupo_nota AND r.ativo AND r.faixa_min = a.nota::numeric
  GROUP BY a.pessoa_id, a.mes_competencia, a.semana, a.origem, r.chave
UNION ALL
 SELECT m.operador_id AS pessoa_id,
    m.mes_referencia AS mes_competencia,
    m.semana_mes AS semana,
    NULL::text AS origem,
    r.chave AS regra,
    round(avg(m.nota_final), 4) AS quantidade,
    NULL::numeric AS pontos_manuais
   FROM monitorias m
     JOIN setores s ON s.id = setor_na_competencia(m.operador_id, m.mes_referencia) AND s.monitorias
     JOIN regras r ON r.chave = s.regra_monitoria AND r.ativo
  GROUP BY m.operador_id, m.mes_referencia, m.semana_mes, r.chave
UNION ALL
 SELECT l.pessoa_id,
    l.mes_competencia,
    l.semana,
    l.canal AS origem,
    r.chave AS regra,
    l.quantidade,
    l.pontos_manuais
   FROM lancamentos l
     JOIN regras r ON r.chave = l.regra AND r.ativo
UNION ALL
 SELECT a.pessoa_id,
    mes_de_competencia(a.data) AS mes_competencia,
    semana_do_ciclo(a.data) AS semana,
    NULL::text AS origem,
    r.chave AS regra,
    count(*)::numeric AS quantidade,
    NULL::numeric AS pontos_manuais
   FROM atendimentos_presenciais a
     JOIN regras r ON r.chave = 'presencial'::text AND r.ativo
  WHERE a.data >= '2026-08-26'::date
  GROUP BY a.pessoa_id, (mes_de_competencia(a.data)), (semana_do_ciclo(a.data)), r.chave
UNION ALL
 SELECT c.pessoa_id,
    c.mes_competencia,
    c.semana,
    'huggy'::text AS origem,
    r.chave AS regra,
    count(*)::numeric AS quantidade,
    NULL::numeric AS pontos_manuais
   FROM chamados_elo c
     CROSS JOIN LATERAL ( VALUES ('chamados_tratados'::text,true), ('chamados_sla_ate_2d'::text,c.tempo_util < 3::numeric), ('chamados_sla_acima_2d'::text,c.tempo_util >= 3::numeric AND c.decisao = 'manter'::text)) x(regra, conta)
     JOIN regras r ON r.chave = x.regra AND r.ativo
  WHERE c.pessoa_id IS NOT NULL AND c.concluido_em IS NOT NULL AND c.status <> 'Cancelado'::text AND x.conta AND c.mes_competencia >= '2026-10-01'::date
  GROUP BY c.pessoa_id, c.mes_competencia, c.semana, r.chave;

-- Os nomes das faixas deixam de dizer "TME Médio Equipe" (o atendente vê o
-- nome no extrato e, agora, o TME é o dele). Só o nome: chave, faixa e peso
-- são os mesmos; meses fechados guardam o nome da época.
update public.regras set rotulo = regexp_replace(rotulo, '^TME Médio Equipe', 'TME')
 where grupo like 'tme%' and rotulo like 'TME Médio Equipe%';

-- As duas filas da Conexão Expansão, a partir de novembro/2026.
update public.canais_do_setor set tme_por_pessoa_desde = '2026-11-01'
 where apelido in ('huggy', 'diretores') and tme_por_pessoa_desde is null;

-- A prova: nenhum mês antes de novembro mudou.
do $$
declare
  v_qtd integer;
begin
  select count(*) into v_qtd from public.comparar_com_a_foto('antes-da-90')
   where mes_competencia < '2026-11-01';
  if v_qtd > 0 then
    raise exception 'A 90 mudou % linha(s) antes de novembro. Nada foi gravado.', v_qtd;
  end if;
end;
$$;

commit;

-- Conferência: as filas e o que mudou (só pode aparecer novembro em diante).
select id, nome, apelido, tme_por_pessoa_desde from public.canais_do_setor order by id;
select mes_competencia, count(*) as linhas_diferentes
  from public.comparar_com_a_foto('antes-da-90') group by 1 order by 1;
