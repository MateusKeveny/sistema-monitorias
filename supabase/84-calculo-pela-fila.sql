-- ============================================================================
-- 84 · Setores e filas em árvore — etapa 3, parte 2 (o cálculo pela fila)
--
-- Até aqui o cálculo sabia as filas de cor: "se o canal é 'huggy', a regra de
-- finalizado é huggy_atendimento e o TME é o grupo tme; senão, diretores".
-- A partir desta migração a FILA diz quais regras usa, e o cálculo lê a fila
-- pelo id (canal_id, migração 82):
--
--   canais_do_setor.regra_finalizado   regra do volume finalizado
--   canais_do_setor.grupo_tme          faixas de TME (vazio = não pontua TME)
--   canais_do_setor.grupo_csat         faixas de C-SAT  (hoje as duas: csat)
--   canais_do_setor.grupo_nota         notas de 1 a 5   (hoje as duas: nota)
--
-- Fila que copia as métricas de outra aponta para as MESMAS regras, então
-- acompanha a original: mudou o peso lá, muda nela. Fila com regras próprias
-- ganha regras novas (parte 3, junto com a tela).
--
-- Nada muda de valor. Tudo roda numa transação só:
--   1. tira uma foto nova do cálculo ('na-troca-da-etapa-3'), porque o mês
--      aberto muda todo dia e a foto da 83 já pode estar velha;
--   2. troca o cálculo;
--   3. compara com a foto. QUALQUER diferença (1 centavo que seja) aborta a
--      transação e desfaz a troca inteira — o banco fica como estava.
--
-- Meses fechados não são tocados: o fechamento guarda as linhas congeladas.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo.
-- ============================================================================

begin;

-- 1. A foto de agora, antes de qualquer troca.
select * from public.tirar_foto_da_cota('na-troca-da-etapa-3');

-- 2. As regras de cada fila.
alter table public.canais_do_setor add column if not exists regra_finalizado text references public.regras (chave);
alter table public.canais_do_setor add column if not exists grupo_tme  text;
alter table public.canais_do_setor add column if not exists grupo_csat text not null default 'csat';
alter table public.canais_do_setor add column if not exists grupo_nota text not null default 'nota';

update public.canais_do_setor set regra_finalizado = 'huggy_atendimento',     grupo_tme = 'tme'
 where apelido = 'huggy';
update public.canais_do_setor set regra_finalizado = 'diretores_atendimento', grupo_tme = 'tme_diretores'
 where apelido = 'diretores';

-- O cálculo lê o id: volume e avaliação sem fila não podem existir. O gatilho
-- da 82 preenche o id antes desta trava ser conferida.
alter table public.volume_semanal alter column canal_id set not null;
alter table public.avaliacoes     alter column canal_id set not null;

-- Métrica desligada, pela fila.
create or replace function public.metrica_desligada_na_fila(p_mes date, p_semana integer, p_canal_id smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.metricas_desligadas
                  where mes_competencia = p_mes and semana = p_semana and canal_id = p_canal_id);
$$;

-- 3. As views que alimentam o cálculo ganham o canal_id no fim (as colunas de
-- antes ficam iguais, na mesma ordem).
create or replace view public.vw_avaliacoes_validas with (security_invoker = true) as
  select a.id, a.pessoa_id, a.origem,
         mes_de_competencia(a.data) as mes_competencia,
         semana_do_ciclo(a.data) as semana,
         a.data, a.nota, a.canal_id
    from public.avaliacoes a
   where a.nota >= 1 and a.nota <= 5;

create or replace view public.vw_base_do_csat with (security_invoker = true) as
  select pessoa_id, canal as origem, mes_competencia, semana,
         finalizados::numeric as quantidade, canal_id
    from public.volume_semanal;

create or replace view public.vw_csat_semanal with (security_invoker = true) as
  select pessoa_id, origem, mes_competencia, semana,
         count(*) as avaliacoes,
         count(*) filter (where nota >= 4) as positivas,
         round(count(*) filter (where nota >= 4)::numeric / count(*)::numeric, 6) as csat,
         canal_id
    from public.vw_avaliacoes_validas
   group by pessoa_id, origem, canal_id, mes_competencia, semana;

-- Sem security_invoker, como antes: o TME médio é da equipe inteira.
create or replace view public.vw_tme_equipe with (security_invoker = false) as
  select mes_competencia, semana,
         round(avg(tme_seg) filter (where tme_seg > 0))::integer as tme_seg,
         canal, canal_id
    from public.volume_semanal
   group by mes_competencia, semana, canal, canal_id;

-- 4. A quantidade de cada regra. Só os quatro primeiros blocos mudam (volume,
-- TME, C-SAT e notas): a regra vem da fila. Os outros são os de antes.
create or replace view public.vw_extrato_quantidades with (security_invoker = true) as
 select v.pessoa_id, v.mes_competencia, v.semana, v.canal as origem, r.chave as regra,
        v.finalizados::numeric as quantidade, null::numeric as pontos_manuais
   from public.volume_semanal v
   join public.canais_do_setor f on f.id = v.canal_id
   join public.regras r on r.chave = f.regra_finalizado and r.ativo
union all
 select v.pessoa_id, v.mes_competencia, v.semana, v.canal as origem, r.chave as regra,
        v.finalizados::numeric as quantidade, null::numeric as pontos_manuais
   from public.volume_semanal v
   join public.canais_do_setor f on f.id = v.canal_id
   join public.vw_tme_equipe t on t.mes_competencia = v.mes_competencia and t.semana = v.semana and t.canal_id = v.canal_id
   join public.regras r on r.grupo = f.grupo_tme and r.ativo
    and (r.faixa_min is null or t.tme_seg::numeric >= r.faixa_min)
    and (r.faixa_max is null or t.tme_seg::numeric <  r.faixa_max)
    and not public.metrica_desligada_na_fila(v.mes_competencia, v.semana::integer, v.canal_id)
union all
 select b.pessoa_id, b.mes_competencia, b.semana, b.origem, r.chave as regra,
        b.quantidade, null::numeric as pontos_manuais
   from public.vw_base_do_csat b
   join public.canais_do_setor f on f.id = b.canal_id
   join public.vw_csat_semanal c on c.pessoa_id = b.pessoa_id and c.canal_id = b.canal_id
    and c.mes_competencia = b.mes_competencia and c.semana = b.semana
   join public.regras r on r.grupo = f.grupo_csat and r.ativo
    and (r.faixa_min is null or c.csat >= r.faixa_min)
    and (r.faixa_max is null or c.csat <  r.faixa_max)
union all
 select a.pessoa_id, a.mes_competencia, a.semana, a.origem, r.chave as regra,
        count(*)::numeric as quantidade, null::numeric as pontos_manuais
   from public.vw_avaliacoes_validas a
   join public.canais_do_setor f on f.id = a.canal_id
   join public.regras r on r.grupo = f.grupo_nota and r.ativo and r.faixa_min = a.nota::numeric
  group by a.pessoa_id, a.mes_competencia, a.semana, a.origem, r.chave
union all
 select m.operador_id as pessoa_id, m.mes_referencia as mes_competencia, m.semana_mes as semana,
        null::text as origem, r.chave as regra,
        round(avg(m.nota_final), 4) as quantidade, null::numeric as pontos_manuais
   from public.monitorias m
   join public.regras r on r.chave = 'monitoria'::text and r.ativo
  group by m.operador_id, m.mes_referencia, m.semana_mes, r.chave
union all
 select l.pessoa_id, l.mes_competencia, l.semana, l.canal as origem, r.chave as regra,
        l.quantidade, l.pontos_manuais
   from public.lancamentos l
   join public.regras r on r.chave = l.regra and r.ativo
union all
 select a.pessoa_id, mes_de_competencia(a.data) as mes_competencia, semana_do_ciclo(a.data) as semana,
        null::text as origem, r.chave as regra,
        count(*)::numeric as quantidade, null::numeric as pontos_manuais
   from public.atendimentos_presenciais a
   join public.regras r on r.chave = 'presencial'::text and r.ativo
  where a.data >= '2026-08-26'::date
  group by a.pessoa_id, (mes_de_competencia(a.data)), (semana_do_ciclo(a.data)), r.chave
union all
 select c.pessoa_id, c.mes_competencia, c.semana, 'huggy'::text as origem, r.chave as regra,
        count(*)::numeric as quantidade, null::numeric as pontos_manuais
   from public.chamados_elo c
   cross join lateral (values
     ('chamados_tratados'::text, true),
     ('chamados_sla_ate_2d'::text, c.tempo_util < 3::numeric),
     ('chamados_sla_acima_2d'::text, c.tempo_util >= 3::numeric and c.decisao = 'manter'::text)
   ) x(regra, conta)
   join public.regras r on r.chave = x.regra and r.ativo
  where c.pessoa_id is not null and c.concluido_em is not null and c.status <> 'Cancelado'::text
    and x.conta and c.mes_competencia >= '2026-10-01'::date
  group by c.pessoa_id, c.mes_competencia, c.semana, r.chave;

-- 5. A conferência: o cálculo novo contra a foto de agora há pouco.
do $$
declare
  v_qtd     integer;
  v_amostra text;
begin
  select count(*), string_agg(format('%s %s sem %s %s: %s → %s', x.nivel, x.mes_competencia, x.semana,
                                     coalesce(x.origem, '-'), x.antes, x.depois), '; ')
    into v_qtd, v_amostra
    from (select * from public.comparar_com_a_foto('na-troca-da-etapa-3') limit 5) x;
  if v_qtd > 0 then
    raise exception 'A troca mudou a cota (% diferença(s), até 5 mostradas): %. Nada foi gravado.', v_qtd, v_amostra;
  end if;
end;
$$;

commit;

-- Conferência: as filas com as regras, e a comparação com as duas fotos.
-- As duas contagens têm de dar 0. ('antes-da-etapa-3' pode dar diferença só
-- no mês aberto, se entrou volume ou avaliação nova desde a migração 83.)
select id, nome, apelido, regra_finalizado, grupo_tme, grupo_csat, grupo_nota
  from public.canais_do_setor order by ordem;
select 'na-troca-da-etapa-3' as foto, count(*) as diferencas from public.comparar_com_a_foto('na-troca-da-etapa-3')
union all
select 'antes-da-etapa-3', count(*) from public.comparar_com_a_foto('antes-da-etapa-3');
