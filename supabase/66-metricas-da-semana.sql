-- ============================================================================
-- 66 · Métricas da semana: desligar o TME de uma semana, com justificativa
--
-- O TME é da equipe: a faixa sai do TME médio do canal na semana e vale para
-- os atendimentos de todos (vw_extrato_quantidades). Numa semana atípica — uma
-- pane no sistema de atendimento, por exemplo — a gestão pode desligar o TME
-- daquela semana e canal: a faixa deixa de entrar no extrato da equipe toda
-- do canal. O motivo é obrigatório, e a tela pergunta se houve registro no
-- diário de bordo (e qual). Só a gestão vê o motivo. Mês fechado não muda: o
-- fechamento está congelado, e desligar pede mês sem fechamento.
--
-- "Tempo de resposta dos Diretores" é o próprio TME Diretores (regras
-- diretores_ate_30 / _ate_1h / _acima_1h, grupo tme_diretores): a chave do
-- canal Diretores cobre as duas coisas.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo. No fim ele confere que a view nova dá exatamente o mesmo de antes
-- (nada está desligado ainda) e recalcula o resumo do mês.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Foto da view antes da troca, para a conferência no fim
-- ---------------------------------------------------------------------------
drop table if exists pg_temp.quantidades_antes;
create temp table quantidades_antes as
  select * from public.vw_extrato_quantidades where mes_competencia >= date '2026-08-01';

-- ---------------------------------------------------------------------------
-- 1. As semanas desligadas
-- ---------------------------------------------------------------------------
create table if not exists public.metricas_desligadas (
  mes_competencia     date not null,
  semana              smallint not null check (semana between 1 and 4),
  canal               text not null check (canal in ('huggy', 'diretores')),
  motivo              text not null check (length(trim(motivo)) > 0),
  -- Houve registro no diário de bordo? Se sim, qual.
  tem_registro_diario boolean not null,
  diario_registro_id  uuid references public.diario_registros (id) on delete set null,
  desligado_por       uuid references public.pessoas (id) on delete set null,
  desligado_por_nome  text,
  desligado_em        timestamptz not null default now(),
  primary key (mes_competencia, semana, canal),
  constraint metrica_diario_coerente check (tem_registro_diario or diario_registro_id is null)
);

-- Só a gestão lê (o motivo é dela); gravar, só pelas funções abaixo.
alter table public.metricas_desligadas enable row level security;
drop policy if exists metricas_desligadas_leitura on public.metricas_desligadas;
create policy metricas_desligadas_leitura on public.metricas_desligadas
  for select using (public.eh_gestor());
revoke all on public.metricas_desligadas from anon;
revoke insert, update, delete, truncate on public.metricas_desligadas from authenticated;
grant select on public.metricas_desligadas to authenticated;

-- O cálculo pergunta por uma função (security definer): a view é calculada
-- com as permissões de quem olha, e o atendente não lê a tabela — sem isto, o
-- extrato dele continuaria contando o TME desligado.
create or replace function public.metrica_desligada(p_mes date, p_semana integer, p_canal text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.metricas_desligadas
                  where mes_competencia = p_mes and semana = p_semana and canal = p_canal);
$$;
revoke all on function public.metrica_desligada(date, integer, text) from public, anon;
grant execute on function public.metrica_desligada(date, integer, text) to authenticated;

-- Mudou o cálculo: o resumo do mês (migração 58) precisa saber.
drop trigger if exists resumo_mudou on public.metricas_desligadas;
create trigger resumo_mudou after insert or update or delete or truncate on public.metricas_desligadas
  for each statement execute function public.marcar_mudanca_no_resumo();

-- Quais semanas estão desligadas num mês, sem o motivo: o Extrato de cada um
-- mostra "TME não contabilizado" (o motivo é só da gestão).
create or replace function public.semanas_sem_tme(p_mes date)
returns table (semana smallint, canal text)
language sql stable security definer set search_path = public as $$
  select semana, canal from public.metricas_desligadas where mes_competencia = p_mes;
$$;
revoke all on function public.semanas_sem_tme(date) from public, anon;
grant execute on function public.semanas_sem_tme(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Desligar e religar (só gestor, só mês sem fechamento)
-- ---------------------------------------------------------------------------
create or replace function public.desligar_metrica(
  p_mes date, p_semana smallint, p_canal text, p_motivo text,
  p_tem_registro_diario boolean, p_diario_registro_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_gestor() then
    raise exception 'Só a gestão desliga métricas da semana.';
  end if;
  if exists (select 1 from public.fechamentos_cota where mes_competencia = p_mes) then
    raise exception 'Este mês já foi fechado: os valores estão congelados.';
  end if;
  if length(trim(coalesce(p_motivo, ''))) = 0 then
    raise exception 'Escreva o motivo.';
  end if;
  if p_tem_registro_diario and p_diario_registro_id is null then
    raise exception 'Escolha o registro do diário de bordo.';
  end if;
  insert into public.metricas_desligadas (mes_competencia, semana, canal, motivo, tem_registro_diario,
                                          diario_registro_id, desligado_por, desligado_por_nome)
  values (p_mes, p_semana, p_canal, trim(p_motivo), p_tem_registro_diario,
          case when p_tem_registro_diario then p_diario_registro_id end,
          public.pessoa_atual(), (select nome from public.pessoas where id = public.pessoa_atual()))
  on conflict (mes_competencia, semana, canal) do update
     set motivo = excluded.motivo, tem_registro_diario = excluded.tem_registro_diario,
         diario_registro_id = excluded.diario_registro_id, desligado_por = excluded.desligado_por,
         desligado_por_nome = excluded.desligado_por_nome, desligado_em = now();
end;
$$;
revoke all on function public.desligar_metrica(date, smallint, text, text, boolean, uuid) from public, anon;
grant execute on function public.desligar_metrica(date, smallint, text, text, boolean, uuid) to authenticated;

create or replace function public.religar_metrica(p_mes date, p_semana smallint, p_canal text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_gestor() then
    raise exception 'Só a gestão religa métricas da semana.';
  end if;
  if exists (select 1 from public.fechamentos_cota where mes_competencia = p_mes) then
    raise exception 'Este mês já foi fechado: os valores estão congelados.';
  end if;
  delete from public.metricas_desligadas
   where mes_competencia = p_mes and semana = p_semana and canal = p_canal;
end;
$$;
revoke all on function public.religar_metrica(date, smallint, text) from public, anon;
grant execute on function public.religar_metrica(date, smallint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. O cálculo: o mesmo texto da migração 55, com o filtro no trecho do TME
-- ---------------------------------------------------------------------------
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
     -- Semana em que a gestão desligou o TME do canal (migração 66).
     and not public.metrica_desligada(v.mes_competencia, v.semana, v.canal)

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

-- ---------------------------------------------------------------------------
-- 4. Conferência: com nada desligado, a view nova é idêntica à de antes.
--    Zero nas duas colunas = idênticas. E o resumo do mês, recalculado.
-- ---------------------------------------------------------------------------
select public.atualizar_resumo(true) as meses_do_resumo_recalculados;

select
  (select count(*) from (select * from quantidades_antes
     except all select * from public.vw_extrato_quantidades where mes_competencia >= date '2026-08-01') x) as so_antes,
  (select count(*) from (select * from public.vw_extrato_quantidades where mes_competencia >= date '2026-08-01'
     except all select * from quantidades_antes) x) as so_depois;
