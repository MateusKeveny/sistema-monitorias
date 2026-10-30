-- ============================================================================
-- 92 · Fila de cálculo por setor (Performance 3.0 / Monitorias 6.0)
--
-- Até aqui, a cada minuto, o resumo recalculava o mês inteiro de TODOS os
-- setores sempre que qualquer coisa mudava em qualquer lugar; e o "Fechar"
-- rodava na hora, dentro do limite de 8 s das consultas do site. No teste de
-- carga (30/10/2026), com vários setores, os dois passavam do limite.
--
-- Agora há uma fila (fila_de_calculo):
--   · Cada mudança pede "recalcular o setor X no mês Y" — o setor da pessoa
--     no mês. Pedido igual pendente não se repete: 200 avaliações importadas
--     viram 1 pedido. Mudança de regra, peso, cargo ou fila pede todos.
--   · Um trabalhador único (o agendamento "resumo-do-mes", agora a cada 10 s)
--     consome a fila, um pedido por vez, fechamentos primeiro. Recalcula só
--     as pessoas daquele setor.
--   · "Fechar" vira pedido (pedir_fechamento): o trabalhador fecha dentro do
--     banco, sem o limite de 8 s, em nome de quem pediu, e avisa no sino.
--   · As telas leem o resumo pronto e mostram quando ele foi atualizado
--     (situacao_do_resumo, situacao_da_fila).
--
-- Prova: o resumo feito pela fila (setor a setor) é idêntico ao de hoje
-- (todos de uma vez), nos meses mantidos. Diferença desfaz tudo.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez.
-- ============================================================================

begin;

-- 0. O resumo de hoje, feito do jeito antigo, para a prova.
create temp table resumo_antigo_extrato on commit drop as
  select * from public.vw_extrato_cota
   where mes_competencia = any (array[public.mes_de_competencia((now() at time zone 'America/Sao_Paulo')::date),
                                      (public.mes_de_competencia((now() at time zone 'America/Sao_Paulo')::date) - interval '1 month')::date]);
create temp table resumo_antigo_mensal on commit drop as
  select * from public.vw_cota_mensal
   where mes_competencia = any (array[public.mes_de_competencia((now() at time zone 'America/Sao_Paulo')::date),
                                      (public.mes_de_competencia((now() at time zone 'America/Sao_Paulo')::date) - interval '1 month')::date]);

-- 1. A fila.
create table if not exists public.fila_de_calculo (
  id              bigint generated always as identity primary key,
  setor_id        smallint not null references public.setores (id),
  mes_competencia date not null,
  tipo            text not null check (tipo in ('recalcular', 'fechar')),
  situacao        text not null default 'na_fila' check (situacao in ('na_fila', 'calculando', 'pronto', 'erro')),
  pedido_em       timestamptz not null default now(),
  pedido_por      uuid references public.pessoas (id) on delete set null,
  iniciado_em     timestamptz,
  concluido_em    timestamptz,
  resultado       integer,
  erro            text
);
create unique index if not exists fila_pendente_unica on public.fila_de_calculo (setor_id, mes_competencia, tipo)
  where situacao = 'na_fila';
create index if not exists fila_situacao_idx on public.fila_de_calculo (situacao, pedido_em);
alter table public.fila_de_calculo enable row level security;
drop policy if exists fila_leitura on public.fila_de_calculo;
create policy fila_leitura on public.fila_de_calculo for select
  using ((select public.ve_o_time()) or pedido_por = (select public.pessoa_atual()));

-- Quando cada setor teve o resumo atualizado.
create table if not exists public.resumo_por_setor (
  setor_id        smallint not null references public.setores (id),
  mes_competencia date not null,
  atualizado_em   timestamptz,
  duracao_ms      integer,
  primary key (setor_id, mes_competencia)
);
alter table public.resumo_por_setor enable row level security;
drop policy if exists resumo_por_setor_leitura on public.resumo_por_setor;
create policy resumo_por_setor_leitura on public.resumo_por_setor for select using ((select auth.uid()) is not null);

-- 2. Os meses que o resumo mantém: o aberto e o anterior (como antes).
create or replace function public.meses_do_resumo()
returns date[] language sql stable set search_path = public as $$
  select array[public.mes_de_competencia((now() at time zone 'America/Sao_Paulo')::date),
               (public.mes_de_competencia((now() at time zone 'America/Sao_Paulo')::date) - interval '1 month')::date];
$$;

-- 3. Pedir.
create or replace function public.pedir_recalculo(p_setor smallint, p_mes date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_setor is null or p_mes is null or p_mes <> all (public.meses_do_resumo()) then return; end if;
  insert into public.fila_de_calculo (setor_id, mes_competencia, tipo)
  values (p_setor, p_mes, 'recalcular')
  on conflict (setor_id, mes_competencia, tipo) where situacao = 'na_fila' do nothing;
end;
$$;

create or replace function public.pedir_recalculo_da_pessoa(p_pessoa uuid, p_mes date default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_mes date;
begin
  if p_pessoa is null then return; end if;
  foreach v_mes in array (case when p_mes is null then public.meses_do_resumo() else array[p_mes] end) loop
    perform public.pedir_recalculo(coalesce(public.setor_na_competencia(p_pessoa, v_mes), 1::smallint), v_mes);
  end loop;
end;
$$;

create or replace function public.pedir_recalculo_de_tudo()
returns void language plpgsql security definer set search_path = public as $$
declare v_setor smallint; v_mes date;
begin
  for v_setor in select id from public.setores where ativo loop
    foreach v_mes in array public.meses_do_resumo() loop
      perform public.pedir_recalculo(v_setor, v_mes);
    end loop;
  end loop;
end;
$$;
revoke all on function public.pedir_recalculo(smallint, date) from public, anon, authenticated;
revoke all on function public.pedir_recalculo_da_pessoa(uuid, date) from public, anon, authenticated;
revoke all on function public.pedir_recalculo_de_tudo() from public, anon, authenticated;

-- 4. Quem pede: as mudanças. Por pessoa (o setor dela no mês) ou de tudo.
create or replace function public.mudanca_pede_recalculo()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  foreach r in array array[new, old] loop
    continue when r is null;
    case tg_table_name
      when 'volume_semanal', 'lancamentos', 'chamados_elo' then
        perform public.pedir_recalculo_da_pessoa((to_jsonb(r) ->> 'pessoa_id')::uuid, (to_jsonb(r) ->> 'mes_competencia')::date);
      when 'avaliacoes', 'atendimentos_presenciais' then
        perform public.pedir_recalculo_da_pessoa((to_jsonb(r) ->> 'pessoa_id')::uuid,
                                                 public.mes_de_competencia((to_jsonb(r) ->> 'data')::date));
      when 'monitorias' then
        perform public.pedir_recalculo_da_pessoa((to_jsonb(r) ->> 'operador_id')::uuid, (to_jsonb(r) ->> 'mes_referencia')::date);
      when 'cargos_da_pessoa', 'setores_da_pessoa' then
        perform public.pedir_recalculo_da_pessoa((to_jsonb(r) ->> 'pessoa_id')::uuid);
      when 'pessoas' then
        perform public.pedir_recalculo_da_pessoa((to_jsonb(r) ->> 'id')::uuid);
    end case;
  end loop;
  return null;
end;
$$;

create or replace function public.mudanca_pede_tudo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.pedir_recalculo_de_tudo();
  return null;
end;
$$;

do $$
declare t text;
begin
  -- O aviso antigo ("algo mudou em algum lugar") sai; a fila o substitui.
  foreach t in array array['atendimentos_presenciais', 'avaliacoes', 'cargos', 'cargos_da_pessoa', 'cargos_referencia',
                           'chamados_elo', 'lancamentos', 'metricas_desligadas', 'monitorias', 'pesos_por_cargo',
                           'pessoas', 'regras', 'volume_semanal'] loop
    execute format('drop trigger if exists resumo_mudou on public.%I', t);
  end loop;
  foreach t in array array['volume_semanal', 'lancamentos', 'chamados_elo', 'avaliacoes', 'atendimentos_presenciais',
                           'monitorias', 'cargos_da_pessoa', 'setores_da_pessoa', 'pessoas'] loop
    execute format('drop trigger if exists pede_recalculo on public.%I', t);
    execute format('create trigger pede_recalculo after insert or update or delete on public.%I
                    for each row execute function public.mudanca_pede_recalculo()', t);
  end loop;
  foreach t in array array['cargos', 'cargos_referencia', 'metricas_desligadas', 'pesos_por_cargo', 'regras',
                           'canais_do_setor', 'setores'] loop
    execute format('drop trigger if exists pede_recalculo on public.%I', t);
    execute format('create trigger pede_recalculo after insert or update or delete or truncate on public.%I
                    for each statement execute function public.mudanca_pede_tudo()', t);
  end loop;
end $$;

-- 5. Recalcular um setor num mês: só as pessoas dele.
create or replace function public.recalcular_setor(p_setor smallint, p_mes date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_pessoas uuid[];
  v_inicio timestamptz := clock_timestamp();
begin
  select array_agg(p.id) into v_pessoas from public.pessoas p
   where coalesce(public.setor_na_competencia(p.id, p_mes), 1::smallint) = p_setor;
  v_pessoas := coalesce(v_pessoas, '{}');
  delete from public.resumo_extrato     where mes_competencia = p_mes and pessoa_id = any (v_pessoas);
  delete from public.resumo_cota_mensal where mes_competencia = p_mes and pessoa_id = any (v_pessoas);
  delete from public.resumo_sem_cargo   where mes_competencia = p_mes and pessoa_id = any (v_pessoas);
  insert into public.resumo_extrato     select * from public.vw_extrato_cota where mes_competencia = p_mes and pessoa_id = any (v_pessoas);
  insert into public.resumo_cota_mensal select * from public.vw_cota_mensal  where mes_competencia = p_mes and pessoa_id = any (v_pessoas);
  insert into public.resumo_sem_cargo   select * from public.vw_sem_cargo    where mes_competencia = p_mes and pessoa_id = any (v_pessoas);
  insert into public.resumo_por_setor (setor_id, mes_competencia, atualizado_em, duracao_ms)
  values (p_setor, p_mes, clock_timestamp(), (extract(epoch from clock_timestamp() - v_inicio) * 1000)::integer)
  on conflict (setor_id, mes_competencia)
  do update set atualizado_em = excluded.atualizado_em, duracao_ms = excluded.duracao_ms;
  return cardinality(v_pessoas);
end;
$$;
revoke all on function public.recalcular_setor(smallint, date) from public, anon, authenticated;

-- 6. O trabalhador: o mesmo agendamento de antes ("select public.atualizar_resumo()").
create or replace function public.atualizar_resumo(p_forcar boolean default false)
returns integer language plpgsql security definer set search_path = public set statement_timeout = '120s' as $$
declare
  v_meses  date[] := public.meses_do_resumo();
  v_item   public.fila_de_calculo;
  v_auth   uuid;
  v_feitos integer := 0;
  v_fim    timestamptz := clock_timestamp() + interval '45 seconds';
  v_n      integer;
begin
  -- Um trabalhador por vez: se o anterior ainda está trabalhando, este sai.
  if not pg_try_advisory_xact_lock(hashtext('atualizar_resumo')) then
    return 0;
  end if;

  -- Meses que saíram da janela deixam de ser mantidos.
  delete from public.resumo_extrato     where mes_competencia <> all (v_meses);
  delete from public.resumo_cota_mensal where mes_competencia <> all (v_meses);
  delete from public.resumo_sem_cargo   where mes_competencia <> all (v_meses);
  delete from public.resumo_estado      where mes_competencia <> all (v_meses);
  delete from public.resumo_por_setor   where mes_competencia <> all (v_meses);
  insert into public.resumo_estado (mes_competencia) select unnest(v_meses) on conflict do nothing;
  delete from public.resumo_mudancas;
  delete from public.fila_de_calculo where concluido_em < now() - interval '7 days';

  -- Forçado, setor sem resumo ou resumo com mais de 30 min: recalcula
  -- (o que depende da data de hoje, como semanas que fecham, fica em dia).
  if p_forcar then
    perform public.pedir_recalculo_de_tudo();
  else
    perform public.pedir_recalculo(s.id, m.mes)
       from public.setores s cross join unnest(v_meses) as m(mes)
       left join public.resumo_por_setor r on r.setor_id = s.id and r.mes_competencia = m.mes
      where s.ativo and (r.atualizado_em is null or r.atualizado_em < now() - interval '30 minutes');
  end if;

  loop
    exit when clock_timestamp() > v_fim;
    -- Fechamento passa na frente; depois, o pedido mais antigo.
    select * into v_item from public.fila_de_calculo
     where situacao = 'na_fila'
     order by (tipo = 'fechar') desc, pedido_em
     limit 1 for update skip locked;
    exit when not found;
    update public.fila_de_calculo set situacao = 'calculando', iniciado_em = clock_timestamp() where id = v_item.id;
    begin
      if v_item.tipo = 'recalcular' then
        v_n := public.recalcular_setor(v_item.setor_id, v_item.mes_competencia);
      else
        -- O fechamento roda em nome de quem pediu (a conferência de gestor e
        -- o "fechado por" são os dele).
        select auth_id into v_auth from public.pessoas where id = v_item.pedido_por;
        perform set_config('request.jwt.claims', json_build_object('sub', v_auth, 'role', 'authenticated')::text, true);
        v_n := public.fechar_ciclo(v_item.mes_competencia, v_item.setor_id);
        perform set_config('request.jwt.claims', '{}', true);
        perform public.pedir_recalculo(v_item.setor_id, v_item.mes_competencia);
        insert into public.avisos_da_pessoa (pessoa_id, chave, titulo, texto, link)
        values (v_item.pedido_por, 'fechamento/' || v_item.id,
                format('Fechamento de %s concluído', public.nome_do_mes(v_item.mes_competencia)),
                format('%s %s fechada%s em %s.', v_n, case when v_n = 1 then 'pessoa' else 'pessoas' end,
                       case when v_n = 1 then '' else 's' end, (select nome from public.setores where id = v_item.setor_id)),
                '/cota/fechamento?mes=' || to_char(v_item.mes_competencia, 'YYYY-MM') || '&setor=' || v_item.setor_id)
        on conflict (chave) do nothing;
      end if;
      update public.fila_de_calculo
         set situacao = 'pronto', concluido_em = clock_timestamp(), resultado = v_n
       where id = v_item.id;
      v_feitos := v_feitos + 1;
    exception when others then
      perform set_config('request.jwt.claims', '{}', true);
      update public.fila_de_calculo
         set situacao = 'erro', concluido_em = clock_timestamp(), erro = sqlerrm
       where id = v_item.id;
      if v_item.tipo = 'fechar' and v_item.pedido_por is not null then
        insert into public.avisos_da_pessoa (pessoa_id, chave, titulo, texto, link)
        values (v_item.pedido_por, 'fechamento/' || v_item.id,
                format('O fechamento de %s não foi concluído', public.nome_do_mes(v_item.mes_competencia)), sqlerrm,
                '/cota/fechamento?mes=' || to_char(v_item.mes_competencia, 'YYYY-MM') || '&setor=' || v_item.setor_id)
        on conflict (chave) do nothing;
      end if;
    end;
  end loop;

  -- O mês está atualizado até o setor mais atrasado (as telas de antes leem daqui).
  update public.resumo_estado e
     set atualizado_em = (select min(r.atualizado_em) from public.resumo_por_setor r
                           join public.setores s on s.id = r.setor_id and s.ativo
                          where r.mes_competencia = e.mes_competencia)
   where e.mes_competencia = any (v_meses);

  return v_feitos;
end;
$$;

-- 7. As telas: pedir o fechamento e ver a fila.
create or replace function public.pedir_fechamento(p_mes date, p_setor smallint)
returns text language plpgsql security definer set search_path = public as $$
declare v_setor smallint; v_novos integer := 0; v_n integer;
begin
  if (select public.eh_gestor()) is not true then raise exception 'Apenas gestores fecham o ciclo.'; end if;
  for v_setor in select id from public.setores where ativo and (p_setor is null or id = p_setor) loop
    insert into public.fila_de_calculo (setor_id, mes_competencia, tipo, pedido_por)
    values (v_setor, p_mes, 'fechar', public.pessoa_atual())
    on conflict (setor_id, mes_competencia, tipo) where situacao = 'na_fila' do nothing;
    get diagnostics v_n = row_count;
    v_novos := v_novos + v_n;
  end loop;
  return case when v_novos = 0 then 'ja_na_fila' else 'na_fila' end;
end;
$$;
revoke all on function public.pedir_fechamento(date, smallint) from public, anon;
grant execute on function public.pedir_fechamento(date, smallint) to authenticated;

-- Pedidos ainda na fila ou concluídos há pouco (para a tela mostrar o andamento).
create or replace function public.situacao_da_fila()
returns table (id bigint, setor_id smallint, mes_competencia date, tipo text, situacao text,
               pedido_em timestamptz, concluido_em timestamptz, resultado integer, erro text)
language sql stable security definer set search_path = public as $$
  select f.id, f.setor_id, f.mes_competencia, f.tipo, f.situacao, f.pedido_em, f.concluido_em, f.resultado,
         case when (select public.ve_o_time()) then f.erro end
    from public.fila_de_calculo f
   where f.situacao in ('na_fila', 'calculando') or f.concluido_em > now() - interval '15 minutes'
   order by f.pedido_em desc;
$$;
grant execute on function public.situacao_da_fila() to authenticated;

-- O resumo do mês: "pendente" agora é haver recálculo na fila para o mês.
create or replace function public.situacao_do_resumo()
returns table (mes_competencia date, atualizado_em timestamptz, pendente boolean)
language sql stable security definer set search_path = public as $$
  select e.mes_competencia, e.atualizado_em,
         exists (select 1 from public.fila_de_calculo f
                  where f.mes_competencia = e.mes_competencia and f.tipo = 'recalcular'
                    and f.situacao in ('na_fila', 'calculando')) as pendente
    from public.resumo_estado e;
$$;

-- 8. A prova: o resumo setor a setor igual ao de hoje (todos de uma vez).
do $$
declare v_setor smallint; v_mes date; v_dif integer;
begin
  delete from public.resumo_extrato; delete from public.resumo_cota_mensal; delete from public.resumo_sem_cargo;
  for v_setor in select id from public.setores where ativo loop
    foreach v_mes in array public.meses_do_resumo() loop
      perform public.recalcular_setor(v_setor, v_mes);
    end loop;
  end loop;
  select count(*) into v_dif from (
    (select * from resumo_antigo_extrato except all select * from public.resumo_extrato)
    union all (select * from public.resumo_extrato except all select * from resumo_antigo_extrato)) d;
  select v_dif + count(*) into v_dif from (
    (select * from resumo_antigo_mensal except all select * from public.resumo_cota_mensal)
    union all (select * from public.resumo_cota_mensal except all select * from resumo_antigo_mensal)) d;
  if v_dif > 0 then
    raise exception 'O resumo por setor saiu diferente do de hoje (% linha(s)). Nada foi gravado.', v_dif;
  end if;
  -- Os pedidos que a própria prova gerou não precisam rodar de novo.
  delete from public.fila_de_calculo;
end $$;

-- 9. O trabalhador passa a cada 10 segundos: ajusta o agendamento que já
-- existe (criar outro com o mesmo nome duplicaria, se o dono for outro).
do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'resumo-do-mes' order by jobid limit 1;
  if v_job is null then
    perform cron.schedule('resumo-do-mes', '10 seconds', 'select public.atualizar_resumo()');
  else
    perform cron.alter_job(v_job, schedule := '10 seconds');
  end if;
end $$;

commit;

-- Conferência
select s.id, s.nome, r.mes_competencia, r.atualizado_em, r.duracao_ms
  from public.resumo_por_setor r join public.setores s on s.id = r.setor_id order by 1, 3;
select jobname, schedule from cron.job where jobname = 'resumo-do-mes';
