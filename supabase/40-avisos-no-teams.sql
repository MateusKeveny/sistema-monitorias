-- ============================================================================
-- 40 · Avisos no Teams
--
-- Três avisos postados no Teams por Workflows ("Postar em um canal quando uma
-- solicitação de webhook for recebida"). O endereço de cada um é colado pelo
-- gestor em Configuração › Avisos no Teams; campo vazio desliga o aviso.
--
--   semana_encerrada      canal da equipe · 8h do dia seguinte ao fim da semana
--   monitorias_liberadas  Pleno e qualidade · quando o gestor importa o relatório
--   lembrete_fechamento   só o gestor · 8h, todo dia depois do fim do ciclo,
--                         até o mês ser fechado
--
-- Quem posta é o banco: pg_net faz a chamada, pg_cron dispara a rotina das 8h.
-- Não depende de ninguém estar com o painel aberto.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- Endereços dos sites, para os botões dos cartões.
create or replace function public.endereco_do_site(p_site text)
returns text language sql immutable as $$
  select case p_site
    when 'monitorias' then 'https://painel-monitorias.expansao.workers.dev'
    else 'https://painel-performance.expansao.workers.dev' end;
$$;

-- ---------------------------------------------------------------------------
-- Para onde vai cada aviso. O endereço funciona como senha: só o gestor lê.
-- ---------------------------------------------------------------------------
create table if not exists public.avisos_teams (
  chave          text primary key check (chave in ('semana_encerrada', 'monitorias_liberadas', 'lembrete_fechamento')),
  url            text check (url is null or url ~ '^https://'),
  atualizado_em  timestamptz not null default now()
);

insert into public.avisos_teams (chave) values
  ('semana_encerrada'), ('monitorias_liberadas'), ('lembrete_fechamento')
on conflict (chave) do nothing;

alter table public.avisos_teams enable row level security;
drop policy if exists avisos_gestor on public.avisos_teams;
create policy avisos_gestor on public.avisos_teams
  for all using (public.eh_gestor()) with check (public.eh_gestor());

-- O que foi enviado. `referencia` evita repetir o mesmo aviso (a mesma
-- semana, o mesmo dia de lembrete); o teste não tem referência.
create table if not exists public.avisos_enviados (
  id           bigint generated always as identity primary key,
  chave        text not null,
  referencia   text,
  titulo       text not null,
  requisicao   bigint,
  enviado_em   timestamptz not null default now(),
  unique (chave, referencia)
);

alter table public.avisos_enviados enable row level security;
drop policy if exists enviados_gestor on public.avisos_enviados;
create policy enviados_gestor on public.avisos_enviados
  for select using (public.eh_gestor());

-- ---------------------------------------------------------------------------
-- O cartão (Adaptive Card, o formato que o Workflows do Teams recebe)
-- ---------------------------------------------------------------------------
create or replace function public.cartao_teams(
  p_rotulo text, p_cor text, p_titulo text, p_texto text, p_fatos jsonb, p_botao text, p_link text)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'type', 'message',
    'attachments', jsonb_build_array(jsonb_build_object(
      'contentType', 'application/vnd.microsoft.card.adaptive',
      'contentUrl', null,
      'content', jsonb_build_object(
        '$schema', 'http://adaptivecards.io/schemas/adaptive-card.json',
        'type', 'AdaptiveCard',
        'version', '1.4',
        'msteams', jsonb_build_object('width', 'Full'),
        'body', jsonb_build_array(
          jsonb_build_object('type', 'TextBlock', 'text', upper(p_rotulo), 'size', 'Small',
                             'weight', 'Bolder', 'color', p_cor, 'spacing', 'None'),
          jsonb_build_object('type', 'TextBlock', 'text', p_titulo, 'size', 'Medium',
                             'weight', 'Bolder', 'wrap', true, 'spacing', 'Small'),
          jsonb_build_object('type', 'TextBlock', 'text', p_texto, 'wrap', true, 'spacing', 'Small')
        ) || case when p_fatos is null or jsonb_array_length(p_fatos) = 0 then '[]'::jsonb
                  else jsonb_build_array(jsonb_build_object('type', 'FactSet', 'facts', p_fatos)) end,
        'actions', jsonb_build_array(jsonb_build_object('type', 'Action.OpenUrl', 'title', p_botao, 'url', p_link))
      )
    ))
  );
$$;

-- ---------------------------------------------------------------------------
-- Enviar: posta se o aviso tem endereço e se a mesma referência ainda não foi.
-- Devolve true quando postou.
-- ---------------------------------------------------------------------------
create or replace function public.enviar_aviso_teams(p_chave text, p_referencia text, p_titulo text, p_cartao jsonb)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url text;
  v_id  bigint;
begin
  select url into v_url from public.avisos_teams where chave = p_chave;
  if v_url is null then return false; end if;

  insert into public.avisos_enviados (chave, referencia, titulo)
  values (p_chave, p_referencia, p_titulo)
  on conflict (chave, referencia) do nothing
  returning id into v_id;
  if v_id is null then return false; end if;   -- já enviado

  update public.avisos_enviados
     set requisicao = net.http_post(url := v_url, body := p_cartao,
                                    headers := '{"Content-Type": "application/json"}'::jsonb)
   where id = v_id;
  return true;
end;
$$;

revoke all on function public.enviar_aviso_teams(text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Datas do ciclo (26 a 25; semanas 26–02, 03–10, 11–18, 19–25)
-- ---------------------------------------------------------------------------
create or replace function public.nome_do_mes(p_data date)
returns text language sql immutable as $$
  select (array['janeiro','fevereiro','março','abril','maio','junho','julho','agosto',
                'setembro','outubro','novembro','dezembro'])[extract(month from p_data)::int];
$$;

-- Início e fim de uma semana do ciclo da competência (competência = dia 1 do mês).
create or replace function public.periodo_da_semana(p_competencia date, p_semana int)
returns table (inicio date, fim date) language sql immutable as $$
  select case p_semana when 1 then (p_competencia - interval '1 month')::date + 25
                       when 2 then p_competencia + 2
                       when 3 then p_competencia + 10
                       else p_competencia + 18 end,
         case p_semana when 1 then p_competencia + 1
                       when 2 then p_competencia + 9
                       when 3 then p_competencia + 17
                       else p_competencia + 24 end;
$$;

-- ---------------------------------------------------------------------------
-- Rotina das 8h: semana encerrada e lembrete de fechamento
-- ---------------------------------------------------------------------------
create or replace function public.avisos_das_oito()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_hoje    date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ontem   date := v_hoje - 1;
  v_comp    date;
  v_semana  int;
  v_p       record;
  v_prox    record;
  v_fatos   jsonb;
  v_titulo  text;
  v_fim     date;
  v_dias    int;
begin
  -- Semana encerrada: ontem foi o último dia de uma semana do ciclo.
  if public.semana_do_ciclo(v_ontem) <> public.semana_do_ciclo(v_hoje) then
    v_comp   := public.mes_de_competencia(v_ontem);
    v_semana := public.semana_do_ciclo(v_ontem);
    select * into v_p from public.periodo_da_semana(v_comp, v_semana);
    select * into v_prox from public.periodo_da_semana(public.mes_de_competencia(v_hoje), public.semana_do_ciclo(v_hoje));
    v_titulo := format('Semana %s do ciclo de %s encerrada', v_semana, public.nome_do_mes(v_comp));
    v_fatos := jsonb_build_array(
      jsonb_build_object('title', 'Ciclo', 'value', format('%s · %s a %s', initcap(public.nome_do_mes(v_comp)),
        to_char((v_comp - interval '1 month')::date + 25, 'DD/MM'), to_char(v_comp + 24, 'DD/MM'))),
      jsonb_build_object('title', 'Próxima', 'value', format('Semana %s · %s a %s', public.semana_do_ciclo(v_hoje),
        to_char(v_prox.inicio, 'DD/MM'), to_char(v_prox.fim, 'DD/MM'))));
    perform public.enviar_aviso_teams('semana_encerrada', format('%s/%s', v_comp, v_semana), v_titulo,
      public.cartao_teams('Semana encerrada', 'Good', v_titulo,
        format('A semana de %s a %s terminou%s. Os números entram no painel assim que o relatório da semana for importado.',
               to_char(v_p.inicio, 'DD/MM'), to_char(v_p.fim, 'DD/MM'),
               case when v_semana = 4 then format(', e com ela o ciclo de %s', public.nome_do_mes(v_comp)) else '' end),
        v_fatos, 'Abrir o painel', public.endereco_do_site('performance') || '/cota'));
  end if;

  -- Lembrete de fechamento: o ciclo anterior acabou e ainda não foi fechado.
  v_comp := (public.mes_de_competencia(v_hoje) - interval '1 month')::date;
  if not exists (select 1 from public.fechamentos_cota where mes_competencia = v_comp) then
    v_fim  := v_comp + 24;
    v_dias := v_hoje - v_fim;
    v_titulo := format('O ciclo de %s terminou e o mês ainda não foi fechado', public.nome_do_mes(v_comp));
    perform public.enviar_aviso_teams('lembrete_fechamento', v_hoje::text, v_titulo,
      public.cartao_teams('Lembrete de fechamento', 'Warning', v_titulo,
        format('O ciclo acabou em %s. O aviso se repete todo dia às 8h até o fechamento.', to_char(v_fim, 'DD/MM')),
        jsonb_build_array(jsonb_build_object('title', 'Em aberto há', 'value',
          format('%s dia%s', v_dias, case when v_dias > 1 then 's' else '' end))),
        format('Fechar %s', public.nome_do_mes(v_comp)),
        public.endereco_do_site('performance') || '/cota/fechamento?mes=' || to_char(v_comp, 'YYYY-MM')));
  end if;
end;
$$;

revoke all on function public.avisos_das_oito() from public, anon, authenticated;

-- 11h UTC = 8h em Brasília (sem horário de verão desde 2019).
do $$
begin
  perform cron.unschedule('avisos-das-oito') where exists (select 1 from cron.job where jobname = 'avisos-das-oito');
  perform cron.schedule('avisos-das-oito', '0 11 * * *', 'select public.avisos_das_oito()');
end $$;

-- ---------------------------------------------------------------------------
-- Monitorias liberadas: chamada pela tela de importação, depois de importar
-- ---------------------------------------------------------------------------
create or replace function public.aviso_relatorio_importado(p_ate date, p_quantidade int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_comp    date := public.mes_de_competencia(p_ate);
  v_semana  int  := public.semana_do_ciclo(p_ate);
  v_p       record;
  v_titulo  text := 'Relatório de atendimentos importado';
begin
  if public.eh_gestor() is not true then
    raise exception 'Só o gestor importa o relatório.';
  end if;
  select * into v_p from public.periodo_da_semana(v_comp, v_semana);
  return public.enviar_aviso_teams('monitorias_liberadas', format('%s/%s', p_ate, p_quantidade), v_titulo,
    public.cartao_teams('Monitorias liberadas', 'Accent', v_titulo,
      format('O gestor importou o relatório até %s. As monitorias da semana %s de %s podem começar.',
             to_char(p_ate, 'DD/MM'), v_semana, public.nome_do_mes(v_comp)),
      jsonb_build_array(
        jsonb_build_object('title', 'Semana', 'value', format('%s · %s a %s', v_semana, to_char(v_p.inicio, 'DD/MM'), to_char(v_p.fim, 'DD/MM'))),
        jsonb_build_object('title', 'Importado por', 'value', format('%s, %s', (select nome from public.pessoas where id = public.pessoa_atual()),
          to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI'))),
        jsonb_build_object('title', 'Avaliações novas', 'value', p_quantidade::text)),
      'Nova monitoria', public.endereco_do_site('monitorias') || '/monitorias/nova'));
end;
$$;

revoke all on function public.aviso_relatorio_importado(date, int) from public, anon;
grant execute on function public.aviso_relatorio_importado(date, int) to authenticated;

-- ---------------------------------------------------------------------------
-- Tela de Configuração: situação de cada aviso e o botão "Enviar teste"
-- ---------------------------------------------------------------------------
create or replace function public.situacao_dos_avisos()
returns table (chave text, url text, ultimo_envio timestamptz, ultimo_titulo text, status_http int, erro text)
language sql stable security definer set search_path = public, net as $$
  select a.chave, a.url, e.enviado_em, e.titulo, r.status_code, r.error_msg
    from public.avisos_teams a
    left join lateral (select * from public.avisos_enviados x where x.chave = a.chave
                        order by x.enviado_em desc limit 1) e on true
    left join net._http_response r on r.id = e.requisicao
   where public.eh_gestor();
$$;

revoke all on function public.situacao_dos_avisos() from public, anon;
grant execute on function public.situacao_dos_avisos() to authenticated;

create or replace function public.testar_aviso_teams(p_chave text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_titulo text := 'Teste do Painel de Performance';
begin
  if public.eh_gestor() is not true then
    raise exception 'Só o gestor testa os avisos.';
  end if;
  -- Referência única por teste: cada clique envia de novo.
  return public.enviar_aviso_teams(p_chave, 'teste ' || clock_timestamp()::text, v_titulo,
    public.cartao_teams('Teste', 'Accent', v_titulo,
      format('Se este cartão chegou, o aviso "%s" está configurado neste destino.',
             case p_chave when 'semana_encerrada' then 'Semana encerrada'
                          when 'monitorias_liberadas' then 'Monitorias liberadas'
                          else 'Lembrete de fechamento' end),
      '[]'::jsonb, 'Abrir o painel', public.endereco_do_site('performance') || '/cota'));
end;
$$;

revoke all on function public.testar_aviso_teams(text) from public, anon;
grant execute on function public.testar_aviso_teams(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: extensões, os três avisos e a rotina agendada
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_extension where extname in ('pg_net', 'pg_cron')) as extensoes,
  (select count(*) from public.avisos_teams) as avisos,
  (select schedule from cron.job where jobname = 'avisos-das-oito') as agenda;
