-- ===========================================================================
-- Agenda da Gestão · 02 — avisos pelo Telegram
--
-- Para quem não pode receber notificação do navegador (bloqueada no aparelho):
-- os mesmos lembretes e o resumo do dia chegam como mensagem de um bot do
-- Telegram, com os botões "Concluir" e "Adiar 15 min".
--
-- Rodar no SQL Editor do projeto da AGENDA, depois do 01-agenda.sql.
-- Pode rodar de novo sem estragar nada.
--
-- Como a conta é ligada: em Ajustes, "Conectar Telegram" gera um código de
-- 15 minutos (agenda_telegram_codigo) e abre o bot com ele. O bot recebe
-- "/start <código>" em /api/agenda/telegram, que chama agenda_telegram_vincular
-- com o segredo do envio. Ninguém digita número de conversa.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Conversas ligadas (uma por usuário) e códigos de ligação
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_telegram (
  usuario_id uuid primary key references public.usuarios (id) on delete cascade,
  chat_id    bigint not null unique,
  nome       text,
  criado_em  timestamptz not null default now()
);

create table if not exists public.agenda_telegram_codigos (
  codigo     text primary key,
  usuario_id uuid not null references public.usuarios (id) on delete cascade,
  expira_em  timestamptz not null
);

alter table public.agenda_telegram         enable row level security;
alter table public.agenda_telegram_codigos enable row level security;

drop policy if exists agenda_telegram_dono on public.agenda_telegram;
create policy agenda_telegram_dono on public.agenda_telegram for select to authenticated
  using (usuario_id = auth.uid());

revoke all on public.agenda_telegram from anon;
revoke insert, update, delete on public.agenda_telegram from authenticated;
revoke all on public.agenda_telegram_codigos from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Ligar e desligar
-- ---------------------------------------------------------------------------

-- Botão "Conectar Telegram": código de uso único, válido por 15 minutos.
create or replace function public.agenda_telegram_codigo()
returns text language plpgsql security definer set search_path = public as $$
declare
  v_codigo text := replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'Sem sessão'; end if;
  delete from public.agenda_telegram_codigos where usuario_id = auth.uid() or expira_em < now();
  insert into public.agenda_telegram_codigos (codigo, usuario_id, expira_em)
  values (v_codigo, auth.uid(), now() + interval '15 minutes');
  return v_codigo;
end;
$$;
revoke all on function public.agenda_telegram_codigo() from public, anon;
grant execute on function public.agenda_telegram_codigo() to authenticated;

-- Chamada pelo site quando o bot recebe "/start <código>". Devolve o nome de
-- quem foi ligado, ou null se o código não vale (vencido ou já usado).
create or replace function public.agenda_telegram_vincular(p_segredo text, p_codigo text, p_chat bigint, p_nome text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_usuario uuid;
begin
  if not public.agenda_segredo_confere(p_segredo) then raise exception 'Não autorizado'; end if;
  delete from public.agenda_telegram_codigos
   where codigo = p_codigo and expira_em >= now()
  returning usuario_id into v_usuario;
  if v_usuario is null then return null; end if;

  -- A mesma conversa ligada a outro usuário passa para este.
  delete from public.agenda_telegram where chat_id = p_chat and usuario_id <> v_usuario;
  insert into public.agenda_telegram (usuario_id, chat_id, nome)
  values (v_usuario, p_chat, left(p_nome, 120))
  on conflict (usuario_id) do update set chat_id = excluded.chat_id, nome = excluded.nome, criado_em = now();
  insert into public.agenda_preferencias (usuario_id) values (v_usuario) on conflict do nothing;

  return (select nome from public.usuarios where id = v_usuario);
end;
$$;
revoke all on function public.agenda_telegram_vincular(text, text, bigint, text) from public, authenticated;
grant execute on function public.agenda_telegram_vincular(text, text, bigint, text) to anon;

-- Botão "Desconectar" dos Ajustes.
create or replace function public.agenda_telegram_desvincular()
returns void language sql security definer set search_path = public as $$
  delete from public.agenda_telegram where usuario_id = auth.uid();
$$;
revoke all on function public.agenda_telegram_desvincular() from public, anon;
grant execute on function public.agenda_telegram_desvincular() to authenticated;

-- Conversa que o Telegram recusou (bot bloqueado ou conversa apagada).
create or replace function public.agenda_telegram_remover(p_segredo text, p_chats bigint[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.agenda_segredo_confere(p_segredo) then raise exception 'Não autorizado'; end if;
  delete from public.agenda_telegram where chat_id = any (p_chats);
end;
$$;
revoke all on function public.agenda_telegram_remover(text, bigint[]) from public, authenticated;
grant execute on function public.agenda_telegram_remover(text, bigint[]) to anon;

-- Botões da mensagem: só valem para item de quem está ligado àquela conversa.
-- Devolve o título do item, ou null se não for dele (ou já concluído).
create or replace function public.agenda_telegram_acao(p_segredo text, p_chat bigint, p_item uuid, p_acao text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_titulo text;
begin
  if not public.agenda_segredo_confere(p_segredo) then raise exception 'Não autorizado'; end if;
  select i.titulo into v_titulo
    from public.agenda_itens i
    join public.agenda_telegram t on t.usuario_id = i.usuario_id
   where i.id = p_item and t.chat_id = p_chat and i.concluido_em is null;
  if v_titulo is null then return null; end if;
  perform public.agenda_acao_do_aviso(p_segredo, p_item, p_acao);
  return v_titulo;
end;
$$;
revoke all on function public.agenda_telegram_acao(text, bigint, uuid, text) from public, authenticated;
grant execute on function public.agenda_telegram_acao(text, bigint, uuid, text) to anon;

-- ---------------------------------------------------------------------------
-- 3. Destinos de um usuário: aparelhos (Web Push) e a conversa do Telegram
-- ---------------------------------------------------------------------------
create or replace function public.agenda_destinos(p_usuario uuid)
returns setof jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)
    from public.agenda_inscricoes s where s.usuario_id = p_usuario
  union all
  select jsonb_build_object('telegram', t.chat_id)
    from public.agenda_telegram t where t.usuario_id = p_usuario;
$$;
revoke all on function public.agenda_destinos(uuid) from public, anon, authenticated;

create or replace function public.agenda_tem_destino(p_usuario uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.agenda_inscricoes where usuario_id = p_usuario)
      or exists (select 1 from public.agenda_telegram where usuario_id = p_usuario);
$$;
revoke all on function public.agenda_tem_destino(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Envio: o mesmo do 01, trocando "aparelhos inscritos" por "destinos"
-- ---------------------------------------------------------------------------
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

  -- Lembretes com hora que chegaram. Janela de 6 horas: um destino ligado
  -- hoje não recebe de uma vez tudo o que venceu na semana.
  with vencidos as (
    update public.agenda_itens i set avisado_em = now()
     where i.concluido_em is null and not i.dia_inteiro
       and i.lembrar_em <= now() and i.lembrar_em > now() - interval '6 hours'
       and (i.avisado_em is null or i.avisado_em < i.lembrar_em)
       and public.agenda_tem_destino(i.usuario_id)
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
       and public.agenda_tem_destino(pr.usuario_id)
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

  -- Uma entrega por destino de cada usuário.
  select jsonb_agg(m || d)
    into v_envios
    from jsonb_array_elements(v_msgs) m
    cross join lateral public.agenda_destinos((m ->> 'usuario_id')::uuid) d;

  perform public.agenda_postar(v_envios);
end;
$$;
revoke all on function public.agenda_disparar() from public, anon, authenticated;

-- Botão "Enviar teste" dos Ajustes: para todos os destinos de quem pediu.
create or replace function public.agenda_testar()
returns int language plpgsql security definer set search_path = public as $$
declare
  v_envios jsonb;
begin
  select jsonb_agg(d || jsonb_build_object(
           'tag', 'teste', 'titulo', 'Agenda da Gestão',
           'corpo', 'Aviso de teste: está funcionando.', 'url', '/agenda/ajustes'))
    into v_envios
    from public.agenda_destinos(auth.uid()) d;
  if v_envios is null then return 0; end if;
  if public.agenda_postar(v_envios) is null then raise exception 'Envio não configurado (agenda_config)'; end if;
  return jsonb_array_length(v_envios);
end;
$$;
revoke all on function public.agenda_testar() from public, anon;
grant execute on function public.agenda_testar() to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name like 'agenda\_telegram%') as tabelas_telegram,  -- 2
  (select count(*) from public.agenda_telegram) as conversas_ligadas;
