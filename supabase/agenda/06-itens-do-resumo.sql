-- ===========================================================================
-- Agenda · 06 · Itens do resumo (projeto da AGENDA)
--
-- O resumo das 8h no Telegram passa a listar o que está agendado, não só as
-- contagens: os itens de hoje (com horário ou "dia inteiro") e os atrasados.
-- O site pede a lista com o segredo, como nas outras chamadas sem sessão;
-- a notificação do celular continua curta.
--
-- Rode no SQL Editor do projeto da AGENDA (hijvzvtoffbduuhqeqwm), inteiro.
-- Pode rodar de novo.
-- ===========================================================================

create or replace function public.agenda_itens_do_resumo(p_segredo text, p_usuarios uuid[])
returns table (usuario_id uuid, titulo text, dia date, hora text, hora_fim text,
               dia_inteiro boolean, atrasado boolean, prioridade smallint, regra text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.agenda_segredo_confere(p_segredo) then raise exception 'Não autorizado'; end if;
  return query
    select i.usuario_id, i.titulo,
           (i.lembrar_em at time zone 'America/Sao_Paulo')::date,
           case when i.dia_inteiro then null else to_char(i.lembrar_em at time zone 'America/Sao_Paulo', 'HH24:MI') end,
           to_char(i.hora_fim, 'HH24:MI'),
           i.dia_inteiro,
           (i.lembrar_em at time zone 'America/Sao_Paulo')::date < v_hoje,
           i.prioridade, i.regra
      from public.agenda_itens i
     where i.usuario_id = any (p_usuarios)
       and i.concluido_em is null
       and i.lembrar_em is not null
       and (i.lembrar_em at time zone 'America/Sao_Paulo')::date <= v_hoje
     order by i.usuario_id,
              ((i.lembrar_em at time zone 'America/Sao_Paulo')::date < v_hoje) desc,   -- atrasados primeiro
              i.dia_inteiro, i.lembrar_em, i.prioridade
     limit 200;
end;
$$;
revoke all on function public.agenda_itens_do_resumo(text, uuid[]) from public, authenticated;
grant execute on function public.agenda_itens_do_resumo(text, uuid[]) to anon;

select (select count(*) from pg_proc where proname = 'agenda_itens_do_resumo') as funcao_criada;   -- 1
