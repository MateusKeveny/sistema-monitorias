-- ============================================================================
-- Painel de Cota — volume e lançamentos por canal
-- Rode DEPOIS de 19-importacao-do-hub.sql. Pode ser executado mais de uma vez.
-- (Sem bloco `do $$`: o SQL Editor do Supabase corta o bloco ao colar.)
--
-- Quem atende os dois canais tem pontuação separada em cada um. O volume
-- semanal e os lançamentos manuais passam a ter canal:
--   'huggy'     = Expansão
--   'diretores' = Diretores-Expansão
--
-- Regras do volume, por canal (decisão do gestor, 16/09/2026):
--   Expansão           — 4 por finalizado; faixa de TME pela média da equipe
--                        do canal (pesos hoje zerados).
--   Diretores-Expansão — 5 por finalizado; faixa de TME pela média da equipe
--                        do canal: < 15 min +3 · 15 a 30 min +2 · > 30 min −1,5,
--                        aplicada aos finalizados de cada pessoa.
--   Nos dois canais, a faixa de C-SAT multiplica os finalizados do canal.
--
-- As regras de diretores deixam de ser lançadas à mão: saem do volume.
-- ============================================================================

-- 1. Canal no volume semanal
alter table public.volume_semanal
  add column if not exists canal text not null default 'huggy';
alter table public.volume_semanal drop constraint if exists volume_semanal_canal_valido;
alter table public.volume_semanal
  add constraint volume_semanal_canal_valido check (canal in ('huggy', 'diretores'));

alter table public.volume_semanal drop constraint if exists volume_semanal_pessoa_id_mes_competencia_semana_key;
alter table public.volume_semanal drop constraint if exists volume_semanal_unico_por_canal;
alter table public.volume_semanal
  add constraint volume_semanal_unico_por_canal unique (pessoa_id, mes_competencia, semana, canal);

-- 2. Canal nos lançamentos manuais
alter table public.lancamentos
  add column if not exists canal text not null default 'huggy';
alter table public.lancamentos drop constraint if exists lancamentos_canal_valido;
alter table public.lancamentos
  add constraint lancamentos_canal_valido check (canal in ('huggy', 'diretores'));

-- 3. Regras de diretores viram automáticas, a partir do volume do canal.
--    Mesmas chaves, para os pesos já configurados por cargo continuarem valendo.
update public.regras
   set grupo = 'atendimento', rotulo = 'Finalizado Diretores-Expansão',
       manual = false, peso = 5
 where chave = 'diretores_atendimento';

update public.regras
   set grupo = 'atendimento', rotulo = 'Finalizado Expansão'
 where chave = 'huggy_atendimento';

update public.regras r
   set grupo = 'tme_diretores', manual = false, rotulo = v.rotulo,
       faixa_min = v.minimo, faixa_max = v.maximo, peso = v.peso
  from (values
    ('diretores_ate_30',   'TME Diretores - abaixo de 15 min', 0,    900,  3.0),
    ('diretores_ate_1h',   'TME Diretores - de 15 a 30 min',   900,  1800, 2.0),
    ('diretores_acima_1h', 'TME Diretores - acima de 30 min',  1800, null, -1.5)
  ) as v (chave, rotulo, minimo, maximo, peso)
 where r.chave = v.chave;

-- Pesos já configurados no cargo acompanham a decisão (5 · 3 · 2 · −1,5).
update public.pesos_por_cargo pc
   set peso = v.peso, atualizado_em = now()
  from (values ('diretores_atendimento', 5.0), ('diretores_ate_30', 3.0),
               ('diretores_ate_1h', 2.0), ('diretores_acima_1h', -1.5)) as v (regra, peso)
 where pc.regra = v.regra;

-- 4. Views do cálculo (mesmas colunas; só a lógica muda)

-- TME da equipe, por canal. `canal` entra no fim: `create or replace view`
-- só aceita coluna nova depois das existentes.
create or replace view public.vw_tme_equipe with (security_invoker = false) as
  select mes_competencia, semana,
         round(avg(tme_seg) filter (where tme_seg > 0))::integer as tme_seg,
         canal
    from public.volume_semanal
   group by mes_competencia, semana, canal;

-- Base do C-SAT: os finalizados do próprio canal, nos dois canais.
create or replace view public.vw_base_do_csat with (security_invoker = true) as
  select pessoa_id, canal as origem, mes_competencia, semana,
         finalizados::numeric as quantidade
    from public.volume_semanal;

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
    join public.regras r on r.chave = l.regra and r.ativo;

-- Conferência: só chamados. As faixas de diretores agora vêm do TME da equipe.
create or replace view public.vw_lancamentos_a_conferir with (security_invoker = true) as
  select pessoa_id, mes_competencia, bloco, atendimentos, soma_das_faixas,
         soma_das_faixas - atendimentos as diferenca
    from (
      select pessoa_id, mes_competencia, 'chamados'::text as bloco,
             coalesce(sum(quantidade) filter (where regra = 'chamados_tratados'), 0) as atendimentos,
             coalesce(sum(quantidade) filter (where regra in ('chamados_sla_ate_2d',
                                                              'chamados_sla_acima_2d')), 0) as soma_das_faixas
        from public.lancamentos
       where regra like 'chamados%'
       group by pessoa_id, mes_competencia
    ) t
   where soma_das_faixas <> atendimentos;
