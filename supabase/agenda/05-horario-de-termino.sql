-- ===========================================================================
-- Agenda · 05 · Horário de término (projeto da AGENDA)
--
-- Compromisso com começo e fim: "das 14h00 às 16h00". O item guarda o fim
-- como hora do dia (hora_fim) — vale também para os que se repetem —, e o
-- aviso passa a dizer "Das 14:00 às 16:00" (com a observação embaixo).
--
-- Só muda o texto do aviso em agenda_disparar; o resto é o mesmo do 02.
-- Rode no SQL Editor do projeto da AGENDA, inteiro. Pode rodar de novo.
-- ===========================================================================

alter table public.agenda_itens add column if not exists hora_fim time;
comment on column public.agenda_itens.hora_fim is
  'Hora de término (local), para compromissos com começo e fim. Nulo = só o horário de início.';

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
           -- Com horário de término (05): "Das 14:00 às 16:00", e a observação embaixo.
           'corpo', concat_ws(E'\n',
                    case when v.hora_fim is not null
                         then 'Das ' || to_char(v.lembrar_em at time zone 'America/Sao_Paulo', 'HH24:MI')
                              || ' às ' || to_char(v.hora_fim, 'HH24:MI')
                         else 'Marcado para ' || to_char(v.lembrar_em at time zone 'America/Sao_Paulo', 'HH24:MI') end,
                    nullif(btrim(v.observacao), '')),
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


select (select count(*) from information_schema.columns
         where table_name = 'agenda_itens' and column_name = 'hora_fim') as coluna_hora_fim;   -- 1
