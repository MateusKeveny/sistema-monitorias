-- ===========================================================================
-- Agenda da Gestão · banco próprio (projeto Supabase "agenda-gestao")
--
-- Este arquivo é do projeto da AGENDA, não do banco dos painéis. Lá fica só
-- a ponte de leitura das pendências (supabase/59-ponte-da-agenda.sql).
--
-- Lembretes (de trabalho e pessoais), aparelhos, preferências e o disparo das
-- notificações. Quem dispara é o banco: o pg_cron roda a cada minuto, junta o
-- que venceu e, só quando há algo, o pg_net chama o site da agenda, que cifra
-- e entrega (Web Push).
--
-- Acesso: um perfil só, "usuário". O login é por nome de usuário; por baixo,
-- o Supabase guarda `<usuario>@agenda.local` (lib/agenda/usuario.ts). Cada
-- usuário só enxerga a própria agenda (RLS por auth.uid()).
--
-- Criar um usuário: Authentication → Users → Add user → Create new user,
-- e-mail `<usuario>@agenda.local`, a senha, "Auto Confirm User" marcado. A
-- linha em `usuarios` nasce sozinha (gatilho abaixo). Depois, se for ver as
-- pendências do Performance:
--   update public.usuarios set nome = 'Mateus', ve_pendencias = true where usuario = 'mateus';
-- ===========================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- 1. Usuários
-- ---------------------------------------------------------------------------
create table if not exists public.usuarios (
  id            uuid primary key references auth.users (id) on delete cascade,
  usuario       text not null unique check (usuario ~ '^[a-z0-9._-]{2,40}$'),
  nome          text not null,
  -- Recebe no plano do dia as pendências do Performance (pela ponte).
  ve_pendencias boolean not null default false,
  criado_em     timestamptz not null default now()
);

create or replace function public.criar_usuario_da_agenda()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_usuario text := lower(split_part(new.email, '@', 1));
begin
  insert into public.usuarios (id, usuario, nome)
  values (new.id, v_usuario,
          coalesce(nullif(new.raw_user_meta_data ->> 'nome', ''), initcap(v_usuario)))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists criar_usuario_da_agenda on auth.users;
create trigger criar_usuario_da_agenda after insert on auth.users
  for each row execute function public.criar_usuario_da_agenda();

-- Quem já existia antes do gatilho.
insert into public.usuarios (id, usuario, nome)
select u.id, lower(split_part(u.email, '@', 1)), initcap(split_part(u.email, '@', 1))
  from auth.users u
 where u.email is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Itens da agenda
--
-- vence_em   — a ocorrência marcada. Base da repetição: concluir um item
--              recorrente leva vence_em para a próxima ocorrência.
-- lembrar_em — quando lembrar. Nasce igual a vence_em; "Adiar" mexe só nele,
--              para a repetição não escorregar.
-- dia_inteiro — sem hora: não toca sozinho, entra no resumo do dia.
-- regra      — diaria | dias_uteis | semanal:1,3 (1 = segunda) | mensal:5 |
--              mensal:ultimo | mensal:ultimo_util. Dias úteis = segunda a
--              sexta; feriados não entram.
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_itens (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null default auth.uid() references public.usuarios (id) on delete cascade,
  titulo        text not null check (length(btrim(titulo)) between 1 and 200),
  observacao    text check (observacao is null or length(observacao) <= 2000),
  categoria     text not null default 'geral'
                check (categoria in ('monitorias', 'cota', 'equipe', 'reuniao', 'pessoal', 'geral')),
  prioridade    smallint not null default 2 check (prioridade between 1 and 3),
  vence_em      timestamptz,
  lembrar_em    timestamptz,
  dia_inteiro   boolean not null default false,
  regra         text check (regra is null or regra ~
                  '^(diaria|dias_uteis|semanal:[1-7](,[1-7])*|mensal:([1-9]|[12][0-9]|3[01]|ultimo|ultimo_util))$'),
  concluido_em  timestamptz,
  avisado_em    timestamptz,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (regra is null or vence_em is not null)
);
create index if not exists agenda_itens_usuario on public.agenda_itens (usuario_id, concluido_em, lembrar_em);
create index if not exists agenda_itens_aviso on public.agenda_itens (lembrar_em)
  where concluido_em is null and not dia_inteiro;

-- Mudou a data marcada: o lembrete acompanha e volta a poder tocar.
create or replace function public.agenda_ajustar_item()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.vence_em is distinct from old.vence_em then
    new.lembrar_em := new.vence_em;
    new.avisado_em := null;
  end if;
  if tg_op = 'UPDATE' and new.lembrar_em is distinct from old.lembrar_em then
    new.avisado_em := null;
  end if;
  new.atualizado_em := now();
  return new;
end;
$$;
drop trigger if exists agenda_ajustar_item on public.agenda_itens;
create trigger agenda_ajustar_item before insert or update on public.agenda_itens
  for each row execute function public.agenda_ajustar_item();

-- ---------------------------------------------------------------------------
-- 3. O que foi feito (uma linha por conclusão, inclusive de recorrentes)
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_concluidos (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid references public.agenda_itens (id) on delete set null,
  usuario_id   uuid not null references public.usuarios (id) on delete cascade,
  titulo       text not null,
  categoria    text not null,
  vence_em     timestamptz,
  lembrar_em   timestamptz,
  concluido_em timestamptz not null default now()
);
create index if not exists agenda_concluidos_usuario on public.agenda_concluidos (usuario_id, concluido_em desc);

-- ---------------------------------------------------------------------------
-- 4. Aparelhos inscritos para receber notificação (um por navegador)
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_inscricoes (
  endpoint   text primary key,
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  aparelho   text,
  criado_em  timestamptz not null default now()
);
create index if not exists agenda_inscricoes_usuario on public.agenda_inscricoes (usuario_id);

-- ---------------------------------------------------------------------------
-- 5. Preferências
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_preferencias (
  usuario_id         uuid primary key default auth.uid() references public.usuarios (id) on delete cascade,
  resumo_ativo       boolean not null default true,
  resumo_hora        time not null default '08:00',
  resumo_fim_semana  boolean not null default false,
  pendencias         boolean not null default true,
  resumo_enviado_em  date
);

-- ---------------------------------------------------------------------------
-- 6. Configuração do envio — endereço do site e segredo compartilhado.
--    Sem política de acesso: só as funções leem.
--    `node scripts/chaves-da-agenda.js sql` escreve o insert pronto.
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_config (
  chave text primary key check (chave in ('endereco', 'segredo')),
  valor text not null
);

-- ---------------------------------------------------------------------------
-- 7. Segurança: cada um com a sua agenda
-- ---------------------------------------------------------------------------
alter table public.usuarios            enable row level security;
alter table public.agenda_itens        enable row level security;
alter table public.agenda_concluidos   enable row level security;
alter table public.agenda_inscricoes   enable row level security;
alter table public.agenda_preferencias enable row level security;
alter table public.agenda_config       enable row level security;

drop policy if exists usuarios_proprio on public.usuarios;
create policy usuarios_proprio on public.usuarios for select to authenticated using (id = auth.uid());

drop policy if exists agenda_itens_dono on public.agenda_itens;
create policy agenda_itens_dono on public.agenda_itens for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

drop policy if exists agenda_concluidos_dono on public.agenda_concluidos;
create policy agenda_concluidos_dono on public.agenda_concluidos for select to authenticated
  using (usuario_id = auth.uid());

drop policy if exists agenda_inscricoes_dono on public.agenda_inscricoes;
create policy agenda_inscricoes_dono on public.agenda_inscricoes for select to authenticated
  using (usuario_id = auth.uid());

drop policy if exists agenda_preferencias_dono on public.agenda_preferencias;
create policy agenda_preferencias_dono on public.agenda_preferencias for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

revoke all on public.agenda_config from anon, authenticated;
revoke all on public.usuarios, public.agenda_itens, public.agenda_concluidos, public.agenda_inscricoes,
              public.agenda_preferencias from anon;
-- O próprio usuário não muda nome nem a liberação das pendências.
revoke insert, update, delete on public.usuarios from authenticated;

-- ---------------------------------------------------------------------------
-- 8. Repetição
-- ---------------------------------------------------------------------------
create or replace function public.agenda_regra_casa(p_regra text, p_dia date)
returns boolean language plpgsql immutable as $$
declare
  v_tipo text := split_part(p_regra, ':', 1);
  v_arg  text := split_part(p_regra, ':', 2);
  v_dow  int  := extract(isodow from p_dia)::int;
  v_fim  date := (date_trunc('month', p_dia) + interval '1 month - 1 day')::date;
  v_util date;
begin
  if v_tipo = 'diaria' then return true; end if;
  if v_tipo = 'dias_uteis' then return v_dow <= 5; end if;
  if v_tipo = 'semanal' then return v_dow::text = any (string_to_array(v_arg, ',')); end if;
  if v_tipo = 'mensal' then
    if v_arg = 'ultimo' then return p_dia = v_fim; end if;
    if v_arg = 'ultimo_util' then
      v_util := v_fim - case extract(isodow from v_fim)::int when 6 then 1 when 7 then 2 else 0 end;
      return p_dia = v_util;
    end if;
    -- Dia 31 em mês de 30 cai no último dia.
    return extract(day from p_dia)::int = least(v_arg::int, extract(day from v_fim)::int);
  end if;
  return false;
end;
$$;

-- Próxima ocorrência depois de p_depois (data local), mantendo a hora.
create or replace function public.agenda_proxima(p_regra text, p_vence timestamptz, p_depois date)
returns timestamptz language plpgsql immutable as $$
declare
  v_hora time := (p_vence at time zone 'America/Sao_Paulo')::time;
  v_dia  date := p_depois + 1;
begin
  for i in 1..400 loop
    if public.agenda_regra_casa(p_regra, v_dia) then
      return (v_dia + v_hora) at time zone 'America/Sao_Paulo';
    end if;
    v_dia := v_dia + 1;
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Concluir, adiar e desfazer
-- ---------------------------------------------------------------------------

-- Núcleo, sem conferir o dono. Devolve a conclusão, para o "Desfazer".
create or replace function public.agenda_concluir_interno(p_item uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v public.agenda_itens;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_id   uuid;
begin
  select * into v from public.agenda_itens where id = p_item and concluido_em is null for update;
  if not found then return null; end if;

  insert into public.agenda_concluidos (item_id, usuario_id, titulo, categoria, vence_em, lembrar_em)
  values (v.id, v.usuario_id, v.titulo, v.categoria, v.vence_em, v.lembrar_em)
  returning id into v_id;

  if v.regra is null then
    update public.agenda_itens set concluido_em = now() where id = v.id;
  else
    -- Recorrente: pula para a próxima ocorrência no futuro. Concluir hoje um
    -- item atrasado de segunda não traz de volta a ocorrência de hoje.
    update public.agenda_itens
       set vence_em = public.agenda_proxima(v.regra, v.vence_em,
                        greatest((v.vence_em at time zone 'America/Sao_Paulo')::date, v_hoje))
     where id = v.id;
  end if;
  return v_id;
end;
$$;
revoke all on function public.agenda_concluir_interno(uuid) from public, anon, authenticated;

create or replace function public.agenda_concluir(p_item uuid)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.agenda_itens where id = p_item and usuario_id = auth.uid()) then
    raise exception 'Item não encontrado';
  end if;
  return public.agenda_concluir_interno(p_item);
end;
$$;
revoke all on function public.agenda_concluir(uuid) from public, anon;
grant execute on function public.agenda_concluir(uuid) to authenticated;

-- Volta uma conclusão: reabre (pontual) ou volta à ocorrência concluída (recorrente).
create or replace function public.agenda_desfazer(p_concluido uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.agenda_concluidos;
begin
  select * into c from public.agenda_concluidos where id = p_concluido and usuario_id = auth.uid();
  if not found then raise exception 'Registro não encontrado'; end if;
  if c.item_id is not null then
    update public.agenda_itens set concluido_em = null, vence_em = c.vence_em where id = c.item_id;
    update public.agenda_itens set lembrar_em = c.lembrar_em where id = c.item_id;
    -- Já tocou antes de concluir: desfazer não faz tocar de novo.
    update public.agenda_itens set avisado_em = now() where id = c.item_id and lembrar_em <= now();
  end if;
  delete from public.agenda_concluidos where id = c.id;
end;
$$;
revoke all on function public.agenda_desfazer(uuid) from public, anon;
grant execute on function public.agenda_desfazer(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Inscrição do aparelho
--     Por função: o mesmo navegador pode trocar de usuário, e a linha de
--     outro usuário não passaria pela política de acesso.
-- ---------------------------------------------------------------------------
create or replace function public.agenda_inscrever(p_endpoint text, p_p256dh text, p_auth text, p_aparelho text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sem sessão'; end if;
  if p_endpoint !~ '^https://' then raise exception 'Endereço inválido'; end if;
  insert into public.agenda_inscricoes (endpoint, usuario_id, p256dh, auth, aparelho)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth, left(p_aparelho, 120))
  on conflict (endpoint) do update
    set usuario_id = excluded.usuario_id, p256dh = excluded.p256dh, auth = excluded.auth,
        aparelho = excluded.aparelho, criado_em = now();
  insert into public.agenda_preferencias (usuario_id) values (auth.uid()) on conflict do nothing;
end;
$$;
revoke all on function public.agenda_inscrever(text, text, text, text) from public, anon;
grant execute on function public.agenda_inscrever(text, text, text, text) to authenticated;

create or replace function public.agenda_desinscrever(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.agenda_inscricoes where endpoint = p_endpoint and usuario_id = auth.uid();
$$;
revoke all on function public.agenda_desinscrever(text) from public, anon;
grant execute on function public.agenda_desinscrever(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Envio das notificações
-- ---------------------------------------------------------------------------

-- Entrega a lista ao site da agenda. Cada envio já leva o aparelho.
create or replace function public.agenda_postar(p_envios jsonb)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare
  v_end text := (select valor from public.agenda_config where chave = 'endereco');
  v_seg text := (select valor from public.agenda_config where chave = 'segredo');
begin
  if v_end is null or v_seg is null or coalesce(jsonb_array_length(p_envios), 0) = 0 then return null; end if;
  return net.http_post(
    url := rtrim(v_end, '/') || '/api/agenda/enviar',
    body := jsonb_build_object('envios', p_envios),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-agenda-segredo', v_seg),
    timeout_milliseconds := 15000);
end;
$$;
revoke all on function public.agenda_postar(jsonb) from public, anon, authenticated;

-- Roda a cada minuto (pg_cron). Só chama o site quando há o que entregar.
create or replace function public.agenda_disparar()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_local  timestamp := now() at time zone 'America/Sao_Paulo';
  v_hoje   date := v_local::date;
  v_msgs   jsonb := '[]'::jsonb;
  v_envios jsonb;
  p        record;
  v_hj     int;
  v_atr    int;
  v_partes text[];
begin
  if not exists (select 1 from public.agenda_config where chave = 'segredo') then return; end if;

  -- Lembretes com hora que chegaram. Janela de 6 horas: um aparelho inscrito
  -- hoje não recebe de uma vez tudo o que venceu na semana.
  with vencidos as (
    update public.agenda_itens i set avisado_em = now()
     where i.concluido_em is null and not i.dia_inteiro
       and i.lembrar_em <= now() and i.lembrar_em > now() - interval '6 hours'
       and (i.avisado_em is null or i.avisado_em < i.lembrar_em)
       and exists (select 1 from public.agenda_inscricoes s where s.usuario_id = i.usuario_id)
    returning i.*)
  select coalesce(jsonb_agg(jsonb_build_object(
           'usuario_id', v.usuario_id, 'item_id', v.id, 'tag', 'item-' || v.id,
           'titulo', v.titulo,
           'corpo', coalesce(nullif(btrim(v.observacao), ''),
                    'Marcado para ' || to_char(v.lembrar_em at time zone 'America/Sao_Paulo', 'HH24:MI')),
           'url', '/agenda')), '[]'::jsonb)
    into v_msgs from vencidos v;

  -- Resumo do dia, na hora escolhida (até 30 min de atraso). As pendências
  -- do Performance quem soma é o site, pela ponte: este banco não as conhece.
  for p in
    select pr.*, u.nome, u.ve_pendencias from public.agenda_preferencias pr
      join public.usuarios u on u.id = pr.usuario_id
     where pr.resumo_ativo
       and pr.resumo_enviado_em is distinct from v_hoje
       and v_local::time >= pr.resumo_hora and v_local::time < pr.resumo_hora + interval '30 minutes'
       and (pr.resumo_fim_semana or extract(isodow from v_hoje) <= 5)
       and exists (select 1 from public.agenda_inscricoes s where s.usuario_id = pr.usuario_id)
  loop
    select count(*) filter (where (i.lembrar_em at time zone 'America/Sao_Paulo')::date = v_hoje),
           count(*) filter (where (i.lembrar_em at time zone 'America/Sao_Paulo')::date < v_hoje)
      into v_hj, v_atr
      from public.agenda_itens i
     where i.usuario_id = p.usuario_id and i.concluido_em is null and i.lembrar_em is not null;

    v_partes := array_remove(array[
      case when v_hj > 0 then format('%s para hoje', v_hj) end,
      case when v_atr > 0 then format('%s atrasado%s', v_atr, case when v_atr > 1 then 's' else '' end) end
    ], null);

    v_msgs := v_msgs || jsonb_build_object(
      'usuario_id', p.usuario_id, 'tag', 'resumo-' || v_hoje,
      'titulo', format('Bom dia, %s', split_part(p.nome, ' ', 1)),
      'corpo', array_to_string(v_partes, ' · '),
      'pendencias', p.ve_pendencias and p.pendencias,
      'url', '/agenda');

    update public.agenda_preferencias set resumo_enviado_em = v_hoje where usuario_id = p.usuario_id;
  end loop;

  if jsonb_array_length(v_msgs) = 0 then return; end if;

  -- Uma entrega por aparelho de cada usuário.
  select jsonb_agg(m || jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
    into v_envios
    from jsonb_array_elements(v_msgs) m
    join public.agenda_inscricoes s on s.usuario_id = (m ->> 'usuario_id')::uuid;

  perform public.agenda_postar(v_envios);
end;
$$;
revoke all on function public.agenda_disparar() from public, anon, authenticated;

-- Botão "Enviar teste" dos Ajustes: para os aparelhos de quem pediu.
create or replace function public.agenda_testar()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_envios jsonb;
begin
  select jsonb_agg(jsonb_build_object(
           'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'tag', 'teste',
           'titulo', 'Agenda da Gestão', 'corpo', 'Notificação de teste: está funcionando.', 'url', '/agenda/ajustes'))
    into v_envios
    from public.agenda_inscricoes s where s.usuario_id = auth.uid();
  if v_envios is null then return 0; end if;
  if public.agenda_postar(v_envios) is null then raise exception 'Envio não configurado (agenda_config)'; end if;
  return jsonb_array_length(v_envios);
end;
$$;
revoke all on function public.agenda_testar() from public, anon;
grant execute on function public.agenda_testar() to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Chamadas do site com o segredo (sem sessão de usuário)
-- ---------------------------------------------------------------------------
create or replace function public.agenda_segredo_confere(p_segredo text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(p_segredo is not null and length(p_segredo) >= 32
                  and p_segredo = (select valor from public.agenda_config where chave = 'segredo'), false);
$$;
revoke all on function public.agenda_segredo_confere(text) from public, anon, authenticated;

-- Aparelhos que o serviço de notificação recusou (desinstalado, permissão tirada).
create or replace function public.agenda_remover_inscricoes(p_segredo text, p_endpoints text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.agenda_segredo_confere(p_segredo) then raise exception 'Não autorizado'; end if;
  delete from public.agenda_inscricoes where endpoint = any (p_endpoints);
end;
$$;
revoke all on function public.agenda_remover_inscricoes(text, text[]) from public, authenticated;
grant execute on function public.agenda_remover_inscricoes(text, text[]) to anon;

-- Botões da própria notificação: Concluir e Adiar 15 min.
create or replace function public.agenda_acao_do_aviso(p_segredo text, p_item uuid, p_acao text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.agenda_segredo_confere(p_segredo) then raise exception 'Não autorizado'; end if;
  if p_acao = 'concluir' then
    perform public.agenda_concluir_interno(p_item);
  elsif p_acao = 'adiar' then
    update public.agenda_itens set lembrar_em = now() + interval '15 minutes'
     where id = p_item and concluido_em is null;
  else
    raise exception 'Ação desconhecida';
  end if;
end;
$$;
revoke all on function public.agenda_acao_do_aviso(text, uuid, text) from public, authenticated;
grant execute on function public.agenda_acao_do_aviso(text, uuid, text) to anon;

-- ---------------------------------------------------------------------------
-- 13. Agendamento: a cada minuto
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule('agenda-avisos') where exists (select 1 from cron.job where jobname = 'agenda-avisos');
  perform cron.schedule('agenda-avisos', '* * * * *', 'select public.agenda_disparar()');
end $$;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and (table_name like 'agenda\_%' or table_name = 'usuarios')) as tabelas,  -- 6
  (select schedule from cron.job where jobname = 'agenda-avisos') as agendamento,                          -- * * * * *
  (select count(*) from public.usuarios) as usuarios,
  public.agenda_proxima('mensal:ultimo_util', '2026-10-01 09:00-03', '2026-10-14') as teste;               -- 2026-10-30 12:00+00
