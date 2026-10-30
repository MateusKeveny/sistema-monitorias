-- ===========================================================================
-- Agenda · 07 · Reagendar pelo Telegram (projeto da AGENDA)
--
-- O bot passa a reagendar: botão "Reagendar" no aviso, resposta a um aviso
-- com a nova data ("amanhã 10h") ou o comando "/reagendar <nome> para
-- <quando>". Quem lê a frase é o site (o mesmo intérprete da agenda); aqui
-- ficam só as duas portas, com o segredo e a conversa do dono:
--   - agenda_telegram_itens: os itens em aberto de quem conversa, para achar
--     o lembrete pelo nome;
--   - agenda_telegram_reagendar: muda a data. No pontual, muda a ocorrência
--     (vence_em, e com ela o aviso); no que se repete, só esta vez
--     (lembrar_em, como o "Adiar") — a série segue igual.
--
-- Rode no SQL Editor do projeto da AGENDA (hijvzvtoffbduuhqeqwm), inteiro.
-- Pode rodar de novo.
-- ===========================================================================

create or replace function public.agenda_telegram_itens(p_segredo text, p_chat bigint)
returns table (id uuid, titulo text, lembrar_em timestamptz, dia_inteiro boolean, hora_fim time, regra text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.agenda_segredo_confere(p_segredo) then raise exception 'Não autorizado'; end if;
  return query
    select i.id, i.titulo, i.lembrar_em, i.dia_inteiro, i.hora_fim, i.regra
      from public.agenda_itens i
      join public.agenda_telegram t on t.usuario_id = i.usuario_id
     where t.chat_id = p_chat and i.concluido_em is null
     order by i.lembrar_em nulls last
     limit 300;
end;
$$;
revoke all on function public.agenda_telegram_itens(text, bigint) from public, authenticated;
grant execute on function public.agenda_telegram_itens(text, bigint) to anon;

create or replace function public.agenda_telegram_reagendar(p_segredo text, p_chat bigint, p_item uuid,
  p_quando timestamptz, p_dia_inteiro boolean, p_hora_fim time)
returns text language plpgsql security definer set search_path = public as $$
declare
  v public.agenda_itens;
begin
  if not public.agenda_segredo_confere(p_segredo) then raise exception 'Não autorizado'; end if;
  select i.* into v
    from public.agenda_itens i
    join public.agenda_telegram t on t.usuario_id = i.usuario_id
   where i.id = p_item and t.chat_id = p_chat and i.concluido_em is null;
  if not found or p_quando is null then return null; end if;

  if v.regra is null then
    -- Pontual: a data marcada muda, e o aviso vai junto (gatilho do 01).
    update public.agenda_itens
       set vence_em = p_quando, dia_inteiro = coalesce(p_dia_inteiro, false),
           hora_fim = case when coalesce(p_dia_inteiro, false) then null else p_hora_fim end
     where id = v.id;
  else
    -- Repetição: só esta ocorrência, sem mexer na série.
    update public.agenda_itens set lembrar_em = p_quando where id = v.id;
  end if;
  return v.titulo;
end;
$$;
revoke all on function public.agenda_telegram_reagendar(text, bigint, uuid, timestamptz, boolean, time) from public, authenticated;
grant execute on function public.agenda_telegram_reagendar(text, bigint, uuid, timestamptz, boolean, time) to anon;

select (select count(*) from pg_proc
         where proname in ('agenda_telegram_itens', 'agenda_telegram_reagendar')) as funcoes_criadas;   -- 2
