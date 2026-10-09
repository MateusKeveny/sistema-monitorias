-- ============================================================================
-- 53 · Chamados do Analista importados do painel ELO
--
-- Até aqui, tratativas e SLA do Analista eram lançados à mão em Lançamentos.
-- Agora vêm da exportação do ELO (aba "Chamados"), importada em Importar →
-- Chamados (ELO), no mesmo modelo do Hub:
--
--   - o protocolo é a chave: nunca repete, e uma importação nova atualiza só
--     o que mudou no chamado (status, conclusão, tempos, motivo);
--   - o chamado entra no ciclo pela abertura (26 a 25), e só conta resolvido:
--     com data de conclusão e não cancelado. Recusado conta (foi analisado);
--     cancelado não (não houve tratativa);
--   - prazo de 2 dias úteis completos sobre o tempo total, da abertura à
--     conclusão: no prazo com menos de 3,0 dias úteis (o ELO conta o dia útil
--     como 24 h, sem sábado e domingo);
--   - o que passa do prazo vai para a fila da gestão, que decide se o desconto
--     vale (manter) ou não (retirar). Pendente não soma nem desconta.
--
-- Os pontos continuam saindo das regras de sempre (chamados_tratados,
-- chamados_sla_ate_2d, chamados_sla_acima_2d) e dos pesos do cargo: a
-- importação escreve as quantidades em `lancamentos`, marcadas como geradas,
-- e refaz essas linhas a cada importação ou decisão. Mês já fechado não muda.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

-- 1. Nome da pessoa no ELO (o Analista aparece lá como "Matheus Scariot").
alter table public.pessoas add column if not exists nome_elo text;
update public.pessoas set nome_elo = 'Matheus Scariot'
 where nome = 'Matheus Camargo' and nome_elo is null;

-- 2. Os chamados, um por protocolo.
create table if not exists public.chamados_elo (
  protocolo          bigint primary key,
  titulo             text,
  categoria          text,
  status             text not null,
  prioridade         text,
  aberto_por         text,
  responsavel        text,
  pessoa_id          uuid references public.pessoas (id) on delete set null,
  aberto_em          timestamptz not null,
  concluido_em       timestamptz,
  aberto_clickup_em  timestamptz,
  tempo_util         numeric(10,2),
  tempo_interno      numeric(10,2),
  tempo_ti           numeric(10,2),
  motivo_atraso      text,
  observacao         text,
  mes_competencia    date not null,
  semana             smallint not null,
  -- Justificativa escrita no painel por quem tratou o chamado. Separada do
  -- motivo do ELO: a importação nunca a apaga.
  justificativa      text,
  justificado_por_nome text,
  justificado_em     timestamptz,
  decisao            text check (decisao in ('manter', 'retirar')),
  decidido_por       uuid references public.pessoas (id) on delete set null,
  decidido_por_nome  text,
  decidido_em        timestamptz,
  importado_em       timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

create index if not exists chamados_elo_pessoa_mes_idx
  on public.chamados_elo (pessoa_id, mes_competencia);

alter table public.chamados_elo enable row level security;

-- Gestor e quem vê o time leem tudo; o Analista lê os próprios. Gravar, só
-- pelas funções abaixo.
drop policy if exists chamados_elo_leitura on public.chamados_elo;
create policy chamados_elo_leitura on public.chamados_elo
  for select using (public.ve_o_time() or pessoa_id = public.pessoa_atual());

-- 3. Linhas de lançamento geradas pela importação.
alter table public.lancamentos add column if not exists gerado_por text;

-- A conferência "tratativas = soma das faixas de SLA" vale para o lançamento
-- manual. Na importação, atraso pendente ou com desconto retirado não cai em
-- faixa nenhuma, de propósito.
create or replace view public.vw_lancamentos_a_conferir with (security_invoker = true) as
  select pessoa_id, mes_competencia, bloco, atendimentos, soma_das_faixas,
         soma_das_faixas - atendimentos as diferenca
    from (
      select pessoa_id, mes_competencia, 'chamados'::text as bloco,
             coalesce(sum(quantidade) filter (where regra = 'chamados_tratados'), 0) as atendimentos,
             coalesce(sum(quantidade) filter (where regra in ('chamados_sla_ate_2d',
                                                              'chamados_sla_acima_2d')), 0) as soma_das_faixas
        from public.lancamentos
       where regra like 'chamados%' and gerado_por is null
       group by pessoa_id, mes_competencia
    ) t
   where soma_das_faixas <> atendimentos;

-- 4. Refaz as linhas geradas de uma competência, menos de quem já fechou.
create or replace function public.recalcular_chamados(p_mes date)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.lancamentos l
   where l.gerado_por = 'chamados_elo' and l.mes_competencia = p_mes
     and not exists (select 1 from public.fechamentos_cota f
                      where f.pessoa_id = l.pessoa_id and f.mes_competencia = p_mes);

  insert into public.lancamentos
    (pessoa_id, mes_competencia, semana, regra, quantidade, observacao, canal, gerado_por, lancado_por_nome)
  select c.pessoa_id, p_mes, c.semana, x.regra, count(*), 'Importado do painel ELO', 'huggy', 'chamados_elo', 'Importação ELO'
    from public.chamados_elo c
   cross join lateral (values
       ('chamados_tratados', true),
       ('chamados_sla_ate_2d', c.tempo_util < 3),
       ('chamados_sla_acima_2d', c.tempo_util >= 3 and c.decisao = 'manter')
     ) x (regra, conta)
   where c.mes_competencia = p_mes and c.pessoa_id is not null
     and c.concluido_em is not null and c.status <> 'Cancelado' and x.conta
     and not exists (select 1 from public.fechamentos_cota f
                      where f.pessoa_id = c.pessoa_id and f.mes_competencia = p_mes)
   group by c.pessoa_id, c.semana, x.regra;
end;
$$;

revoke all on function public.recalcular_chamados(date) from public, anon, authenticated;

-- 5. Importação: recebe as linhas já lidas no navegador, em JSON.
create or replace function public.importar_chamados(p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_linha   jsonb;
  v_antes   public.chamados_elo;
  v_aberto  timestamptz;
  v_mes     date;
  v_pessoa  uuid;
  v_novos   int := 0;
  v_atual   int := 0;
  v_iguais  int := 0;
  v_meses   date[] := '{}';
  v_sem_pessoa int := 0;
begin
  if not public.eh_gestor() then
    raise exception 'Só o gestor importa chamados.';
  end if;

  for v_linha in select * from jsonb_array_elements(p_linhas) loop
    v_aberto := (v_linha->>'aberto_em')::timestamptz;
    v_mes := public.mes_de_competencia((v_aberto at time zone 'America/Sao_Paulo')::date);
    select id into v_pessoa from public.pessoas
     where lower(trim(coalesce(nome_elo, nome))) = lower(trim(v_linha->>'responsavel'))
     order by nome_elo is null limit 1;
    if v_pessoa is null then v_sem_pessoa := v_sem_pessoa + 1; end if;

    select * into v_antes from public.chamados_elo where protocolo = (v_linha->>'protocolo')::bigint;

    if not found then
      insert into public.chamados_elo (protocolo, titulo, categoria, status, prioridade, aberto_por,
        responsavel, pessoa_id, aberto_em, concluido_em, aberto_clickup_em, tempo_util, tempo_interno,
        tempo_ti, motivo_atraso, observacao, mes_competencia, semana)
      values ((v_linha->>'protocolo')::bigint, v_linha->>'titulo', v_linha->>'categoria', v_linha->>'status',
        v_linha->>'prioridade', v_linha->>'aberto_por', v_linha->>'responsavel', v_pessoa, v_aberto,
        (v_linha->>'concluido_em')::timestamptz, (v_linha->>'aberto_clickup_em')::timestamptz,
        (v_linha->>'tempo_util')::numeric, (v_linha->>'tempo_interno')::numeric, (v_linha->>'tempo_ti')::numeric,
        nullif(trim(v_linha->>'motivo_atraso'), ''), nullif(trim(v_linha->>'observacao'), ''),
        v_mes, public.semana_do_ciclo((v_aberto at time zone 'America/Sao_Paulo')::date));
      v_novos := v_novos + 1;
      v_meses := array_append(v_meses, v_mes);
    elsif (v_antes.status, v_antes.concluido_em, v_antes.aberto_clickup_em, v_antes.tempo_util,
           v_antes.tempo_interno, v_antes.tempo_ti, v_antes.motivo_atraso, v_antes.observacao,
           v_antes.responsavel, v_antes.pessoa_id)
          is distinct from
          (v_linha->>'status', (v_linha->>'concluido_em')::timestamptz, (v_linha->>'aberto_clickup_em')::timestamptz,
           (v_linha->>'tempo_util')::numeric(10,2), (v_linha->>'tempo_interno')::numeric(10,2),
           (v_linha->>'tempo_ti')::numeric(10,2), nullif(trim(v_linha->>'motivo_atraso'), ''),
           nullif(trim(v_linha->>'observacao'), ''), v_linha->>'responsavel', v_pessoa) then
      update public.chamados_elo set
        titulo = v_linha->>'titulo', categoria = v_linha->>'categoria', status = v_linha->>'status',
        prioridade = v_linha->>'prioridade', responsavel = v_linha->>'responsavel', pessoa_id = v_pessoa,
        concluido_em = (v_linha->>'concluido_em')::timestamptz,
        aberto_clickup_em = (v_linha->>'aberto_clickup_em')::timestamptz,
        tempo_util = (v_linha->>'tempo_util')::numeric, tempo_interno = (v_linha->>'tempo_interno')::numeric,
        tempo_ti = (v_linha->>'tempo_ti')::numeric,
        motivo_atraso = nullif(trim(v_linha->>'motivo_atraso'), ''),
        observacao = nullif(trim(v_linha->>'observacao'), ''),
        atualizado_em = now()
       where protocolo = v_antes.protocolo;
      v_atual := v_atual + 1;
      v_meses := array_append(v_meses, v_antes.mes_competencia);
    else
      v_iguais := v_iguais + 1;
    end if;
  end loop;

  perform public.recalcular_chamados(m) from (select distinct unnest(v_meses) as m) t;

  -- Lançamento manual de chamados no mesmo mês somaria em dobro com o importado.
  return jsonb_build_object('novos', v_novos, 'atualizados', v_atual, 'sem_mudanca', v_iguais,
    'sem_pessoa', v_sem_pessoa, 'meses', (select jsonb_agg(distinct m) from unnest(v_meses) m),
    'manuais', (select count(*) from public.lancamentos l
                  where l.regra like 'chamados%' and l.gerado_por is null
                    and l.mes_competencia = any (v_meses)
                    and l.pessoa_id in (select pessoa_id from public.chamados_elo where pessoa_id is not null)
                    -- Mês já fechado da pessoa não recebe o importado: não há dobra.
                    and not exists (select 1 from public.fechamentos_cota f
                                     where f.pessoa_id = l.pessoa_id and f.mes_competencia = l.mes_competencia)));
end;
$$;

revoke all on function public.importar_chamados(jsonb) from public, anon;
grant execute on function public.importar_chamados(jsonb) to authenticated;

-- 6. Justificativa de quem tratou o chamado, direto no painel: vai para a
--    fila da gestão na hora, sem esperar a próxima importação do ELO. Só para
--    chamado fora do prazo ainda sem decisão.
create or replace function public.justificar_atraso_chamado(p_protocolo bigint, p_texto text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.chamados_elo;
begin
  select * into v from public.chamados_elo where protocolo = p_protocolo;
  if not found then raise exception 'Chamado % não encontrado.', p_protocolo; end if;
  if v.pessoa_id is distinct from public.pessoa_atual() and not public.eh_gestor() then
    raise exception 'Só quem tratou o chamado justifica o atraso.';
  end if;
  if v.decisao is not null then raise exception 'A gestão já decidiu este atraso.'; end if;
  if v.concluido_em is null or v.tempo_util < 3 then raise exception 'Este chamado não está fora do prazo.'; end if;
  if length(trim(coalesce(p_texto, ''))) < 5 then raise exception 'Escreva a justificativa.'; end if;
  update public.chamados_elo
     set justificativa = trim(p_texto), justificado_em = now(),
         justificado_por_nome = (select nome from public.pessoas where id = public.pessoa_atual())
   where protocolo = p_protocolo;
end;
$$;

revoke all on function public.justificar_atraso_chamado(bigint, text) from public, anon;
grant execute on function public.justificar_atraso_chamado(bigint, text) to authenticated;

-- 7. Decisão da gestão sobre um chamado fora do prazo.
create or replace function public.decidir_atraso_chamado(p_protocolo bigint, p_decisao text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_mes date;
begin
  if not public.eh_gestor() then
    raise exception 'Só o gestor decide o desconto de prazo.';
  end if;
  if p_decisao not in ('manter', 'retirar') then
    raise exception 'Decisão inválida: %', p_decisao;
  end if;
  update public.chamados_elo
     set decisao = p_decisao, decidido_por = public.pessoa_atual(),
         decidido_por_nome = (select nome from public.pessoas where id = public.pessoa_atual()),
         decidido_em = now()
   where protocolo = p_protocolo
  returning mes_competencia into v_mes;
  if v_mes is null then
    raise exception 'Chamado % não encontrado.', p_protocolo;
  end if;
  perform public.recalcular_chamados(v_mes);
end;
$$;

revoke all on function public.decidir_atraso_chamado(bigint, text) from public, anon;
grant execute on function public.decidir_atraso_chamado(bigint, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: a tabela, a coluna nova, o Analista ligado ao nome do ELO e as
-- quatro funções
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.chamados_elo) as chamados,
  (select nome from public.pessoas where nome_elo = 'Matheus Scariot') as analista_no_elo,
  (select count(*) from information_schema.columns
    where table_name = 'lancamentos' and column_name = 'gerado_por') as coluna_gerado_por,
  (select count(*) from pg_proc where proname in
    ('recalcular_chamados', 'importar_chamados', 'justificar_atraso_chamado', 'decidir_atraso_chamado')) as funcoes_criadas;
