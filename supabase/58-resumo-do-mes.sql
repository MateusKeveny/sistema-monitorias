-- ============================================================================
-- 58 · Resumo do mês aberto: o cálculo guardado pronto
--
-- Toda abertura do Início ou do Extrato recalculava o mês inteiro de todo
-- mundo (vw_cota_mensal de todos: ~2 s; o extrato de uma pessoa: ~0,6–1 s),
-- mesmo sem nada ter mudado. Agora o resultado do mês aberto fica guardado em
-- tabelas de resumo, com as mesmas colunas das views, e as telas leem dali.
--
-- Como o resumo se mantém em dia:
--   - gatilhos nas tabelas que entram no cálculo só registram "houve
--     mudança" (uma linha em resumo_mudancas, sem travar nada);
--   - uma tarefa do pg_cron roda a cada minuto: havendo mudança, recalcula os
--     meses do resumo (o atual e o anterior) uma vez; sem mudança, não faz
--     nada — a não ser a cada 30 minutos, a rede de segurança;
--   - as telas mostram "Atualizado às HH:MM" e, com mudança pendente,
--     "Atualizando…", trocando os números sozinhas quando o resumo fica pronto.
--
-- O que NÃO passa pelo resumo: o fechamento e a exportação continuam no
-- cálculo ao vivo — o congelado é sempre o exato. Mês fechado lê o congelado.
-- Se o resumo de um mês não existir ou tiver mais de 40 minutos, as telas
-- voltam ao cálculo ao vivo, como antes.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo. No fim ele já
-- calcula o resumo (~6 s) e mostra a conferência com o cálculo ao vivo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. As tabelas: mesmas colunas e tipos das views (criadas a partir delas,
--    sem dados — "with no data" não executa a view).
-- ---------------------------------------------------------------------------
create table if not exists public.resumo_extrato as
  select * from public.vw_extrato_cota with no data;
create table if not exists public.resumo_cota_mensal as
  select * from public.vw_cota_mensal with no data;
create table if not exists public.resumo_sem_cargo as
  select * from public.vw_sem_cargo with no data;

create index if not exists resumo_extrato_idx on public.resumo_extrato (mes_competencia, pessoa_id);
create index if not exists resumo_cota_mensal_idx on public.resumo_cota_mensal (mes_competencia, pessoa_id);
create index if not exists resumo_sem_cargo_idx on public.resumo_sem_cargo (mes_competencia);

-- Os meses mantidos e quando foram calculados.
create table if not exists public.resumo_estado (
  mes_competencia date primary key,
  atualizado_em   timestamptz,
  duracao_ms      integer
);

-- "Houve mudança": uma linha por comando que alterou uma tabela do cálculo.
-- A tarefa apaga as que viu antes de recalcular; o que chegar durante o
-- cálculo fica para a próxima rodada (nada se perde, nada trava).
create table if not exists public.resumo_mudancas (
  id     bigint generated always as identity primary key,
  tabela text not null,
  em     timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------------------
-- 2. Quem lê: as mesmas regras das tabelas de origem — o time vê todos, cada
--    um vê a si mesmo. Gravar, só as funções abaixo.
-- ---------------------------------------------------------------------------
alter table public.resumo_extrato     enable row level security;
alter table public.resumo_cota_mensal enable row level security;
alter table public.resumo_sem_cargo   enable row level security;
alter table public.resumo_estado      enable row level security;
alter table public.resumo_mudancas    enable row level security;

drop policy if exists resumo_extrato_leitura on public.resumo_extrato;
create policy resumo_extrato_leitura on public.resumo_extrato
  for select using (public.ve_o_time() or pessoa_id = public.pessoa_atual());
drop policy if exists resumo_cota_mensal_leitura on public.resumo_cota_mensal;
create policy resumo_cota_mensal_leitura on public.resumo_cota_mensal
  for select using (public.ve_o_time() or pessoa_id = public.pessoa_atual());
drop policy if exists resumo_sem_cargo_leitura on public.resumo_sem_cargo;
create policy resumo_sem_cargo_leitura on public.resumo_sem_cargo
  for select using (public.ve_o_time() or pessoa_id = public.pessoa_atual());

revoke all on public.resumo_extrato, public.resumo_cota_mensal, public.resumo_sem_cargo,
              public.resumo_estado, public.resumo_mudancas from anon;
revoke insert, update, delete, truncate on public.resumo_extrato, public.resumo_cota_mensal,
              public.resumo_sem_cargo, public.resumo_estado, public.resumo_mudancas from authenticated;
grant select on public.resumo_extrato, public.resumo_cota_mensal, public.resumo_sem_cargo to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Os gatilhos: qualquer comando numa tabela do cálculo marca mudança.
-- ---------------------------------------------------------------------------
create or replace function public.marcar_mudanca_no_resumo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.resumo_mudancas (tabela) values (tg_table_name);
  return null;
end;
$$;

revoke all on function public.marcar_mudanca_no_resumo() from public, anon, authenticated;

do $$
declare
  v_tabela text;
begin
  -- Tudo o que entra em vw_extrato_cota, vw_cota_mensal e vw_sem_cargo:
  -- as fontes (volume, avaliações, monitorias, lançamentos — o atestado
  -- inclusive —, presencial, chamados) e a configuração (regras, pesos,
  -- cargos, histórico de cargos, referências da média, pessoas).
  foreach v_tabela in array array[
    'volume_semanal', 'avaliacoes', 'monitorias', 'lancamentos', 'atendimentos_presenciais',
    'chamados_elo', 'regras', 'pesos_por_cargo', 'cargos', 'cargos_da_pessoa',
    'cargos_referencia', 'pessoas'
  ] loop
    execute format('drop trigger if exists resumo_mudou on public.%I', v_tabela);
    execute format('create trigger resumo_mudou after insert or update or delete or truncate on public.%I
                    for each statement execute function public.marcar_mudanca_no_resumo()', v_tabela);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. O recálculo. Mantém o mês de competência atual e o anterior (este até o
--    fechamento, ou enquanto as telas o mostrarem por padrão).
-- ---------------------------------------------------------------------------
create or replace function public.atualizar_resumo(p_forcar boolean default false)
returns integer language plpgsql security definer set search_path = public
set statement_timeout = '120s' as $$
declare
  v_atual  date := public.mes_de_competencia((now() at time zone 'America/Sao_Paulo')::date);
  v_meses  date[];
  v_mudou  boolean;
  v_mes    date;
  v_inicio timestamptz;
  v_feitos integer := 0;
begin
  -- Uma rodada por vez: se a anterior ainda está calculando, esta sai.
  if not pg_try_advisory_xact_lock(hashtext('atualizar_resumo')) then
    return 0;
  end if;

  v_meses := array[v_atual, (v_atual - interval '1 month')::date];

  -- Meses que saíram da janela deixam de ser mantidos (as telas voltam ao
  -- congelado ou ao cálculo ao vivo para eles).
  delete from public.resumo_extrato     where mes_competencia <> all (v_meses);
  delete from public.resumo_cota_mensal where mes_competencia <> all (v_meses);
  delete from public.resumo_sem_cargo   where mes_competencia <> all (v_meses);
  delete from public.resumo_estado      where mes_competencia <> all (v_meses);
  insert into public.resumo_estado (mes_competencia)
    select unnest(v_meses) on conflict do nothing;

  -- As mudanças vistas agora saem antes do cálculo: o que for gravado
  -- durante ele fica marcado para a próxima rodada.
  with vistas as (delete from public.resumo_mudancas returning 1)
  select count(*) > 0 into v_mudou from vistas;

  for v_mes in
    select mes_competencia from public.resumo_estado
     where p_forcar or v_mudou or atualizado_em is null
        or atualizado_em < now() - interval '30 minutes'
     order by mes_competencia desc
  loop
    v_inicio := clock_timestamp();
    delete from public.resumo_extrato where mes_competencia = v_mes;
    insert into public.resumo_extrato select * from public.vw_extrato_cota where mes_competencia = v_mes;
    delete from public.resumo_cota_mensal where mes_competencia = v_mes;
    insert into public.resumo_cota_mensal select * from public.vw_cota_mensal where mes_competencia = v_mes;
    delete from public.resumo_sem_cargo where mes_competencia = v_mes;
    insert into public.resumo_sem_cargo select * from public.vw_sem_cargo where mes_competencia = v_mes;
    update public.resumo_estado
       set atualizado_em = clock_timestamp(),
           duracao_ms = (extract(epoch from clock_timestamp() - v_inicio) * 1000)::integer
     where mes_competencia = v_mes;
    v_feitos := v_feitos + 1;
  end loop;

  return v_feitos;
end;
$$;

revoke all on function public.atualizar_resumo(boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. O que as telas leem: quando cada mês foi calculado e se há mudança
--    esperando a próxima rodada.
-- ---------------------------------------------------------------------------
create or replace function public.situacao_do_resumo()
returns table (mes_competencia date, atualizado_em timestamptz, pendente boolean)
language sql stable security definer set search_path = public as $$
  select e.mes_competencia, e.atualizado_em,
         exists (select 1 from public.resumo_mudancas) as pendente
    from public.resumo_estado e;
$$;

revoke all on function public.situacao_do_resumo() from public, anon;
grant execute on function public.situacao_do_resumo() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Conferência: o resumo contra o cálculo ao vivo, linha por linha.
--    Zero em todas as colunas = idênticos.
-- ---------------------------------------------------------------------------
create or replace function public.conferir_resumo()
returns table (mes date, quadro text, so_no_resumo bigint, so_ao_vivo bigint)
language plpgsql security definer set search_path = public
set statement_timeout = '120s' as $$
declare
  v_mes date;
begin
  for v_mes in select e.mes_competencia from public.resumo_estado e order by 1 loop
    mes := v_mes;

    quadro := 'extrato';
    select count(*) into so_no_resumo from (
      select * from public.resumo_extrato where mes_competencia = v_mes
      except all select * from public.vw_extrato_cota where mes_competencia = v_mes) x;
    select count(*) into so_ao_vivo from (
      select * from public.vw_extrato_cota where mes_competencia = v_mes
      except all select * from public.resumo_extrato where mes_competencia = v_mes) x;
    return next;

    quadro := 'resultado do mês';
    select count(*) into so_no_resumo from (
      select * from public.resumo_cota_mensal where mes_competencia = v_mes
      except all select * from public.vw_cota_mensal where mes_competencia = v_mes) x;
    select count(*) into so_ao_vivo from (
      select * from public.vw_cota_mensal where mes_competencia = v_mes
      except all select * from public.resumo_cota_mensal where mes_competencia = v_mes) x;
    return next;

    quadro := 'sem cargo';
    select count(*) into so_no_resumo from (
      select * from public.resumo_sem_cargo where mes_competencia = v_mes
      except all select * from public.vw_sem_cargo where mes_competencia = v_mes) x;
    select count(*) into so_ao_vivo from (
      select * from public.vw_sem_cargo where mes_competencia = v_mes
      except all select * from public.resumo_sem_cargo where mes_competencia = v_mes) x;
    return next;
  end loop;
end;
$$;

revoke all on function public.conferir_resumo() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. A tarefa de cada minuto.
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('resumo-do-mes') where exists (select 1 from cron.job where jobname = 'resumo-do-mes');
  perform cron.schedule('resumo-do-mes', '* * * * *', 'select public.atualizar_resumo()');
end $$;

-- ---------------------------------------------------------------------------
-- 8. O primeiro cálculo e a conferência.
-- ---------------------------------------------------------------------------
select public.atualizar_resumo(true) as meses_calculados;
select * from public.conferir_resumo();
