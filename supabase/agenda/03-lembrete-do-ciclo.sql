-- ===========================================================================
-- Agenda da Gestão · 03 — lembrete dos relatórios do ciclo
--
-- Toda semana do ciclo (26–2, 3–10, 11–18, 19–25) termina com dois
-- relatórios para subir no Performance: atendimentos e chamados. No horário
-- do resumo, quem vê as pendências do Performance recebe "Relatórios do ciclo"
-- com as semanas que faltam. No dia seguinte ao fim da semana é o primeiro
-- aviso, e ele se repete a cada dia até o relatório subir (ou, nos chamados,
-- até o gestor marcar "Sem chamados" — migração 60 dos painéis).
--
-- Este banco não conhece as pendências: ele só chama o site na hora certa, e
-- o site pergunta à ponte. Sem nada faltando, o site não envia nada.
--
-- Rodar no SQL Editor do projeto da AGENDA, depois do 02-telegram.sql.
-- Pode rodar de novo sem estragar nada.
-- ===========================================================================

alter table public.agenda_preferencias add column if not exists ciclo_enviado_em date;

create or replace function public.agenda_disparar_ciclo()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_local  timestamp := now() at time zone 'America/Sao_Paulo';
  v_hoje   date := v_local::date;
  v_envios jsonb;
begin
  if not exists (select 1 from public.agenda_config where chave = 'segredo') then return; end if;

  -- Mesma hora e mesmos dias do resumo, mas não depende de o resumo estar ligado:
  -- quem desliga é a chave "Pendências do Performance".
  with quem as (
    update public.agenda_preferencias pr set ciclo_enviado_em = v_hoje
      from public.usuarios u
     where u.id = pr.usuario_id and u.ve_pendencias and pr.pendencias
       and pr.ciclo_enviado_em is distinct from v_hoje
       and v_local::time >= pr.resumo_hora and v_local::time < pr.resumo_hora + interval '30 minutes'
       and (pr.resumo_fim_semana or extract(isodow from v_hoje) <= 5)
       and public.agenda_tem_destino(pr.usuario_id)
    returning pr.usuario_id)
  select jsonb_agg(d || jsonb_build_object(
           'tag', 'ciclo-' || v_hoje, 'titulo', 'Relatórios do ciclo', 'corpo', '',
           'pendencias', true, 'url', '/agenda'))
    into v_envios
    from quem q
    cross join lateral public.agenda_destinos(q.usuario_id) d;

  if v_envios is not null then perform public.agenda_postar(v_envios); end if;
end;
$$;
revoke all on function public.agenda_disparar_ciclo() from public, anon, authenticated;

do $$
begin
  perform cron.unschedule('agenda-ciclo') where exists (select 1 from cron.job where jobname = 'agenda-ciclo');
  perform cron.schedule('agenda-ciclo', '* * * * *', 'select public.agenda_disparar_ciclo()');
end $$;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select
  (select schedule from cron.job where jobname = 'agenda-ciclo') as agendamento,           -- * * * * *
  (select count(*) from information_schema.columns
    where table_name = 'agenda_preferencias' and column_name = 'ciclo_enviado_em') as coluna;  -- 1
