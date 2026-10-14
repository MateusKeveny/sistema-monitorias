-- ===========================================================================
-- 60 · Semanas sem chamados
--
-- Os chamados do ELO (migração 53) são importados por semana do ciclo, como as
-- avaliações. Esta migração faz a semana encerrada sem nenhum chamado
-- importado virar pendência — no "Precisa de você" do Performance e na Agenda
-- da Gestão, que lembra no dia seguinte ao fim de cada semana até o relatório
-- subir.
--
-- Semana que de fato não teve chamado: o gestor marca "Sem chamados" em
-- Importar → Chamados (ELO), e a pendência some. Desfazer volta a cobrar.
--
-- Rodar no SQL Editor do projeto dos PAINÉIS. Pode rodar de novo.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Semanas marcadas como sem chamados
-- ---------------------------------------------------------------------------
create table if not exists public.semanas_sem_chamados (
  mes_competencia  date not null,
  semana           smallint not null check (semana between 1 and 4),
  marcado_por      uuid references public.pessoas (id) on delete set null,
  marcado_por_nome text,
  marcado_em       timestamptz not null default now(),
  primary key (mes_competencia, semana)
);
alter table public.semanas_sem_chamados enable row level security;
revoke all on public.semanas_sem_chamados from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Chamados por semana do ciclo: quantos, se a semana já acabou e se foi
--    marcada. "Encerrada" segue a mesma conta das semanas sem volume: no mês
--    corrente, as anteriores à semana de hoje; nos meses passados, todas.
-- ---------------------------------------------------------------------------
create or replace function public.chamados_por_semana_interno(p_mes date, p_hoje date)
returns table (semana smallint, quantidade int, encerrada boolean, marcada boolean,
               marcado_por_nome text, marcado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select s.semana::smallint,
         (select count(*)::int from public.chamados_elo c
           where c.mes_competencia = p_mes and c.semana = s.semana),
         p_mes < public.mes_de_competencia(p_hoje) or s.semana < public.semana_do_ciclo(p_hoje),
         m.semana is not null, m.marcado_por_nome, m.marcado_em
    from generate_series(1, 4) as s (semana)
    left join public.semanas_sem_chamados m on m.mes_competencia = p_mes and m.semana = s.semana
   order by s.semana;
$$;
revoke all on function public.chamados_por_semana_interno(date, date) from public, anon, authenticated;

-- Para as telas do Performance (gestor).
create or replace function public.chamados_por_semana(p_mes date)
returns table (semana smallint, quantidade int, encerrada boolean, marcada boolean,
               marcado_por_nome text, marcado_em timestamptz)
language sql stable security definer set search_path = public as $$
  select * from public.chamados_por_semana_interno(p_mes, (now() at time zone 'America/Sao_Paulo')::date)
   where public.eh_gestor();
$$;
revoke all on function public.chamados_por_semana(date) from public, anon;
grant execute on function public.chamados_por_semana(date) to authenticated;

-- Botão "Sem chamados" / "Desfazer".
create or replace function public.marcar_semana_sem_chamados(p_mes date, p_semana smallint, p_marcar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_pessoa public.pessoas;
begin
  if not public.eh_gestor() then raise exception 'Só o gestor marca semana sem chamados'; end if;
  if p_semana not between 1 and 4 then raise exception 'Semana inválida'; end if;
  if p_marcar then
    if exists (select 1 from public.chamados_elo c where c.mes_competencia = p_mes and c.semana = p_semana) then
      raise exception 'Esta semana já tem chamados importados';
    end if;
    select * into v_pessoa from public.pessoas where auth_id = auth.uid();
    insert into public.semanas_sem_chamados (mes_competencia, semana, marcado_por, marcado_por_nome)
    values (p_mes, p_semana, v_pessoa.id, v_pessoa.nome)
    on conflict (mes_competencia, semana) do nothing;
  else
    delete from public.semanas_sem_chamados where mes_competencia = p_mes and semana = p_semana;
  end if;
end;
$$;
revoke all on function public.marcar_semana_sem_chamados(date, smallint, boolean) from public, anon;
grant execute on function public.marcar_semana_sem_chamados(date, smallint, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Pendências (migração 59) com as semanas sem chamados
-- ---------------------------------------------------------------------------
create or replace function public.agenda_pendencias_internas()
returns table (chave text, texto text, acao text, href text, grave boolean, quantidade int)
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_atual  date := public.mes_de_competencia(v_hoje);
  v_ant    date := (v_atual - interval '1 month')::date;
  v_meses  date[];
  v_m      date;
  v_n      int;
  v_lista  text;
  v_nome   text;
  v_resumo boolean;
begin
  -- Mês anterior entra enquanto não for fechado.
  v_meses := case when exists (select 1 from public.fechamentos_cota f where f.mes_competencia = v_ant)
                  then array[v_atual] else array[v_ant, v_atual] end;

  foreach v_m in array v_meses loop
    v_nome := initcap(public.nome_do_mes(v_m));

    -- Semanas sem volume (Huggy): no mês corrente, as que já terminaram.
    select string_agg(s::text, ', ' order by s), count(*) into v_lista, v_n
      from generate_series(1, case when v_m < v_atual then 4
                                   else greatest(0, public.semana_do_ciclo(v_hoje) - 1) end) s
     where not exists (select 1 from public.volume_semanal v
                        where v.mes_competencia = v_m and v.canal = 'huggy' and v.semana = s);
    if v_n > 0 then
      chave := 'sem_volume:' || v_m; grave := false; quantidade := v_n;
      texto := format('%s: %s sem volume lançado', v_nome,
                      case when v_n = 1 then 'semana ' || v_lista
                           else 'semanas ' || regexp_replace(v_lista, ', (\d)$', ' e \1') end);
      acao := 'Importar'; href := '/cota/importar';
      return next;
    end if;

    -- Semanas encerradas sem chamados importados (migração 60). A semana que
    -- de fato não teve chamado sai quando o gestor a marca em Importar →
    -- Chamados (semanas_sem_chamados).
    select string_agg(c.semana::text, ', ' order by c.semana), count(*) into v_lista, v_n
      from public.chamados_por_semana_interno(v_m, v_hoje) c
     where c.encerrada and c.quantidade = 0 and not c.marcada;
    if v_n > 0 then
      chave := 'sem_chamados:' || v_m; grave := false; quantidade := v_n;
      texto := format('%s: %s sem chamados importados', v_nome,
                      case when v_n = 1 then 'semana ' || v_lista
                           else 'semanas ' || regexp_replace(v_lista, ', (\d)$', ' e \1') end);
      acao := 'Importar'; href := '/cota/importar?aba=chamados';
      return next;
    end if;

    -- Pessoas sem cargo: do resumo quando estiver em dia (migração 58).
    v_resumo := exists (select 1 from public.resumo_estado e
                         where e.mes_competencia = v_m and e.atualizado_em > now() - interval '40 minutes');
    if v_resumo then
      select count(*) into v_n from public.resumo_sem_cargo r where r.mes_competencia = v_m;
    else
      select count(*) into v_n from public.vw_sem_cargo r where r.mes_competencia = v_m;
    end if;
    if v_n > 0 then
      chave := 'sem_cargo:' || v_m; grave := true; quantidade := v_n;
      texto := format('%s: %s pessoa%s sem cargo', v_nome, v_n, case when v_n > 1 then 's' else '' end);
      acao := 'Definir'; href := '/cota/atendentes';
      return next;
    end if;

    if exists (select 1 from public.vw_lancamentos_a_conferir c where c.mes_competencia = v_m) then
      chave := 'conferir:' || v_m; grave := false; quantidade := 1;
      texto := format('%s: lançamento com faixas que não fecham com o total', v_nome);
      acao := 'Conferir'; href := '/cota/lancamentos?mes=' || to_char(v_m, 'YYYY-MM');
      return next;
    end if;
  end loop;

  -- Fechamento atrasado.
  if not exists (select 1 from public.fechamentos_cota f where f.mes_competencia = v_ant) then
    v_n := v_hoje - (v_ant + 24);
    chave := 'fechamento:' || v_ant; grave := false; quantidade := 1;
    texto := format('%s aguardando fechamento (ciclo acabou há %s dia%s)',
                    initcap(public.nome_do_mes(v_ant)), v_n, case when v_n > 1 then 's' else '' end);
    acao := 'Fechar'; href := '/cota/fechamento?mes=' || to_char(v_ant, 'YYYY-MM');
    return next;
  end if;

  -- Valor por ponto não informado, nos meses fechados.
  foreach v_m in array array[v_ant, v_atual] loop
    if exists (select 1 from public.fechamentos_cota f where f.mes_competencia = v_m)
       and not exists (select 1 from public.valores_da_cota w where w.mes_competencia = v_m) then
      chave := 'valor:' || v_m; grave := true; quantidade := 1;
      texto := format('Valor por ponto de %s não informado', public.nome_do_mes(v_m));
      acao := 'Informar'; href := '/cota/fechamento?mes=' || to_char(v_m, 'YYYY-MM');
      return next;
    end if;
  end loop;

  select count(*) into v_n from public.diario_registros r where r.situacao = 'aguardando';
  if v_n > 0 then
    chave := 'diario_aguardando'; grave := false; quantidade := v_n;
    texto := format('%s registro%s do diário aguardando aprovação', v_n, case when v_n > 1 then 's' else '' end);
    acao := 'Revisar'; href := '/cota/diario?filtro=aguardando';
    return next;
  end if;

  select count(*) into v_n from public.reportes r where r.situacao = 'novo';
  if v_n > 0 then
    chave := 'reportes'; grave := true; quantidade := v_n;
    texto := format('%s problema%s reportado%2$s sem resposta', v_n, case when v_n > 1 then 's' else '' end);
    acao := 'Ver'; href := '/reportes';
    return next;
  end if;

  select count(*) into v_n from public.diario_privados r where r.situacao = 'aguardando';
  if v_n > 0 then
    chave := 'diario_privados'; grave := false; quantidade := v_n;
    texto := format('%s registro%s de atendente%2$s aguardando aprovação', v_n, case when v_n > 1 then 's' else '' end);
    acao := 'Revisar'; href := '/cota/diario?cat=gestao';
    return next;
  end if;

  -- Leitura obrigatória: a mesma conta de leituras_do_diario (migração 38),
  -- sem o filtro de quem pergunta.
  select count(distinct p.id) into v_n
    from public.diario_registros r
    join public.pessoas p
      on p.ativo and p.desligado_em is null and p.auth_id is not null
     and p.papel <> 'gestor' and p.id <> r.pessoa_id
    left join public.diario_leituras l on l.registro_id = r.id and l.pessoa_id = p.id
   where r.tipo in ('processo', 'treinamento') and r.situacao = 'concluido'
     and (r.valido_ate >= v_hoje or (r.valido_ate is null and r.data >= v_hoje - 30))
     and l.ciente_em is null;
  if v_n > 0 then
    chave := 'leitura'; grave := false; quantidade := v_n;
    texto := format('%s pessoa%s com leitura pendente no diário', v_n, case when v_n > 1 then 's' else '' end);
    acao := 'Ver'; href := '/cota/diario?filtro=leitura';
    return next;
  end if;

  -- Validade nos próximos 7 dias (DIAS_PARA_RENOVAR em lib/diario.ts).
  select count(*) into v_n from public.diario_registros r
   where r.valido_ate >= v_hoje and r.valido_ate <= v_hoje + 7;
  if v_n > 0 then
    chave := 'diario_vencendo'; grave := false; quantidade := v_n;
    texto := format('%s registro%s do diário vence%s em até 7 dias', v_n,
                    case when v_n > 1 then 's' else '' end, case when v_n > 1 then 'm' else '' end);
    acao := 'Renovar'; href := '/cota/diario?filtro=vencendo';
    return next;
  end if;

  select count(*) into v_n from public.chamados_elo c
   where c.tempo_util >= 3 and c.concluido_em is not null and c.status <> 'Cancelado'
     and c.pessoa_id is not null and c.decisao is null;
  if v_n > 0 then
    chave := 'chamados'; grave := false; quantidade := v_n;
    texto := format('%s chamado%s fora do prazo esperando decisão', v_n, case when v_n > 1 then 's' else '' end);
    acao := 'Decidir'; href := '/cota/importar?aba=chamados';
    return next;
  end if;
end;
$$;
revoke all on function public.agenda_pendencias_internas() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: as semanas deste mês (chamados e marcação) e as pendências de hoje.
-- ---------------------------------------------------------------------------
select * from public.chamados_por_semana_interno(
  public.mes_de_competencia((now() at time zone 'America/Sao_Paulo')::date),
  (now() at time zone 'America/Sao_Paulo')::date);
