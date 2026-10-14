-- ===========================================================================
-- 59 · Ponte para a Agenda da Gestão
--
-- A agenda (painel-agenda) tem banco próprio, num projeto Supabase separado
-- (supabase/agenda/): lembretes de trabalho e pessoais não ficam aqui.
--
-- Daqui ela só lê as pendências do gestor — as mesmas regras do "Precisa de
-- você" do Performance (componentes/PainelGestor.tsx), agora no banco. A
-- leitura é numa direção só: o site da agenda chama, no servidor, a função
-- `pendencias_para_agenda` com um segredo; nada da agenda é gravado aqui.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Pendências do gestor — as mesmas regras do "Precisa de você" do
--     Performance (componentes/PainelGestor.tsx), agora no banco, para a
--     agenda usar (pela ponte, abaixo) e o painel, no futuro.
--
--     Olha o mês corrente e, enquanto não for fechado, o anterior.
--     `href` é caminho do site de Performance.
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

create or replace function public.pendencias_do_gestor()
returns table (chave text, texto text, acao text, href text, grave boolean, quantidade int)
language sql stable security definer set search_path = public as $$
  select * from public.agenda_pendencias_internas() where public.eh_gestor();
$$;
revoke all on function public.pendencias_do_gestor() from public, anon;
grant execute on function public.pendencias_do_gestor() to authenticated;

-- ---------------------------------------------------------------------------
-- A ponte: o segredo que o site da agenda apresenta (PONTE_SEGREDO no
-- Worker painel-agenda). Sem política de acesso: só as funções leem.
--
--   insert into public.agenda_ponte values ('segredo', '<o segredo>')
--   on conflict (chave) do update set valor = excluded.valor;
--
-- (`node scripts/chaves-da-agenda.js sql` escreve esse insert pronto.)
-- ---------------------------------------------------------------------------
create table if not exists public.agenda_ponte (
  chave text primary key check (chave = 'segredo'),
  valor text not null check (length(valor) >= 32)
);
alter table public.agenda_ponte enable row level security;
revoke all on public.agenda_ponte from anon, authenticated;

-- Chamada sem sessão (o login da agenda é de outro projeto): o segredo é a porta.
-- Só textos e contagens; nenhum nome de pessoa sai daqui.
create or replace function public.pendencias_para_agenda(p_segredo text)
returns table (chave text, texto text, acao text, href text, grave boolean, quantidade int)
language plpgsql stable security definer set search_path = public as $$
begin
  if p_segredo is null or p_segredo is distinct from (select valor from public.agenda_ponte where agenda_ponte.chave = 'segredo') then
    raise exception 'Não autorizado';
  end if;
  return query select * from public.agenda_pendencias_internas();
end;
$$;
revoke all on function public.pendencias_para_agenda(text) from public, authenticated;
grant execute on function public.pendencias_para_agenda(text) to anon;

-- ---------------------------------------------------------------------------
-- Conferência: a lista de hoje, como a agenda vai ver.
-- ---------------------------------------------------------------------------
select chave, texto, grave, quantidade from public.agenda_pendencias_internas();
