-- 108 · Agenda da Gestão por setor (Performance 4.7.0)
--
-- A lista "Precisa de você" da Agenda (agenda_pendencias_internas) ainda era
-- do tempo de um setor só:
--   · semana sem volume olhava só a fila 'huggy' (Expansão) — o Telecom nunca
--     aparecia, e o Expansão sumia se outra fila tivesse volume;
--   · fechamento atrasado e valor por ponto olhavam qualquer setor: o Expansão
--     fechado escondia o Telecom aberto (e vice-versa);
--   · a leitura pendente do diário contava administrador e diretoria e gente
--     de outro setor (a 105 corrigiu a tela do diário, não a agenda).
--
-- Agora as três primeiras são por setor, com o nome do setor na frente quando
-- há mais de um ativo; a de leitura usa as mesmas regras da leituras_do_diario
-- (105). O resto da função fica igual, palavra por palavra.
--
-- Guarda: só troca se a função for exatamente a de hoje (md5 da definição).

do $guarda$
begin
  if md5(pg_get_functiondef('public.agenda_pendencias_internas()'::regprocedure)) <> '1c073cb1a06a93ea96e893250cc1030e' then
    raise exception 'agenda_pendencias_internas mudou desde a conferência: revisar a 108 antes de aplicar.';
  end if;
end $guarda$;

create or replace function public.agenda_pendencias_internas()
 returns table(chave text, texto text, acao text, href text, grave boolean, quantidade integer)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
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
  v_s      record;
  v_pre    text;
  v_varios boolean := (select count(*) from public.setores where ativo) > 1;
begin
  -- 108: volume, fechamento e valor por ponto, setor a setor (os setores com fila).
  for v_s in
    select s.id, s.nome,
           array(select c.apelido from public.canais_do_setor c
                  where c.setor_id = s.id and c.ativo and c.apelido is not null) as filas
      from public.setores s
     where s.ativo
       and exists (select 1 from public.canais_do_setor c where c.setor_id = s.id and c.ativo and c.apelido is not null)
     order by s.ordem
  loop
    v_pre := case when v_varios then v_s.nome || ' · ' else '' end;

    -- Mês anterior entra enquanto o setor não o fechar (e se o setor teve volume nele).
    v_meses := case when exists (select 1 from public.fechamentos_cota f where f.mes_competencia = v_ant and f.setor_id = v_s.id)
                      or not exists (select 1 from public.volume_semanal v where v.mes_competencia = v_ant and v.canal = any (v_s.filas))
                    then array[v_atual] else array[v_ant, v_atual] end;

    foreach v_m in array v_meses loop
      -- Semanas sem volume em nenhuma fila do setor: no mês corrente, as que já terminaram.
      select string_agg(s::text, ', ' order by s), count(*) into v_lista, v_n
        from generate_series(1, case when v_m < v_atual then 4
                                     else greatest(0, public.semana_do_ciclo(v_hoje) - 1) end) s
       where not exists (select 1 from public.volume_semanal v
                          where v.mes_competencia = v_m and v.canal = any (v_s.filas) and v.semana = s);
      if v_n > 0 then
        chave := 'sem_volume:' || v_m || ':' || v_s.id; grave := false; quantidade := v_n;
        texto := format('%s%s: %s sem volume lançado', v_pre, initcap(public.nome_do_mes(v_m)),
                        case when v_n = 1 then 'semana ' || v_lista
                             else 'semanas ' || regexp_replace(v_lista, ', (\d)$', ' e \1') end);
        acao := 'Importar'; href := '/cota/importar';
        return next;
      end if;
    end loop;

    -- Fechamento atrasado: o setor teve volume no mês anterior e não fechou.
    if not exists (select 1 from public.fechamentos_cota f where f.mes_competencia = v_ant and f.setor_id = v_s.id)
       and exists (select 1 from public.volume_semanal v where v.mes_competencia = v_ant and v.canal = any (v_s.filas)) then
      v_n := v_hoje - (v_ant + 24);
      chave := 'fechamento:' || v_ant || ':' || v_s.id; grave := false; quantidade := 1;
      texto := format('%s%s aguardando fechamento (ciclo acabou há %s dia%s)', v_pre,
                      initcap(public.nome_do_mes(v_ant)), v_n, case when v_n > 1 then 's' else '' end);
      acao := 'Fechar'; href := '/cota/fechamento?mes=' || to_char(v_ant, 'YYYY-MM') || '&setor=' || v_s.id;
      return next;
    end if;

    -- Valor por ponto não informado, nos meses que o setor fechou.
    foreach v_m in array array[v_ant, v_atual] loop
      if exists (select 1 from public.fechamentos_cota f where f.mes_competencia = v_m and f.setor_id = v_s.id)
         and not exists (select 1 from public.valores_da_cota w where w.mes_competencia = v_m and w.setor_id = v_s.id)
         -- Com o valor do RH informado, o valor por ponto não é cobrado (painel 2.3.1).
         and not exists (select 1 from public.valores_rh r
                           join public.fechamentos_cota f on f.pessoa_id = r.pessoa_id and f.mes_competencia = r.mes_competencia
                          where r.mes_competencia = v_m and f.setor_id = v_s.id) then
        chave := 'valor:' || v_m || ':' || v_s.id; grave := true; quantidade := 1;
        texto := format('%sValor por ponto de %s não informado', v_pre, public.nome_do_mes(v_m));
        acao := 'Informar'; href := '/cota/fechamento?mes=' || to_char(v_m, 'YYYY-MM') || '&setor=' || v_s.id;
        return next;
      end if;
    end loop;
  end loop;

  -- Mês anterior entra enquanto não for fechado (por algum setor).
  v_meses := case when exists (select 1 from public.fechamentos_cota f where f.mes_competencia = v_ant)
                  then array[v_atual] else array[v_ant, v_atual] end;

  foreach v_m in array v_meses loop
    v_nome := initcap(public.nome_do_mes(v_m));

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

  -- Leitura obrigatória: as mesmas regras de leituras_do_diario (38, 67 e
  -- 105), sem o filtro de quem pergunta — 108: sem administrador, diretoria e
  -- perfil de teste, só de quem vê o registro e está no setor do autor.
  select count(distinct p.id) into v_n
    from public.diario_registros r
    join public.pessoas p
      on p.ativo and p.desligado_em is null and p.auth_id is not null
     and p.papel not in ('gestor', 'administrador', 'diretoria') and p.id <> r.pessoa_id and not p.perfil_de_teste
    left join public.diario_leituras l on l.registro_id = r.id and l.pessoa_id = p.id
   where r.tipo in ('processo', 'treinamento') and r.situacao = 'concluido'
     and (r.valido_ate >= v_hoje or (r.valido_ate is null and r.data >= v_hoje - 30))
     and public.pessoa_ve_diario(p.id, r.tipo, r.pessoa_id)
     and coalesce(public.setor_na_competencia(r.pessoa_id, r.data) = public.setor_na_competencia(p.id, v_hoje),
                  public.setor_na_competencia(r.pessoa_id, r.data) is null)
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

  select count(*), string_agg(to_char(f.data, 'DD/MM') || ' (' || f.nome || ')', ', ' order by f.data)
    into v_n, v_lista
    from public.feriados f
   where f.facultativo and f.confirmado is null and f.data between v_hoje and v_hoje + 15;
  if v_n > 0 then
    chave := 'facultativo'; grave := false; quantidade := v_n;
    texto := format('Ponto facultativo a confirmar: %s', v_lista);
    acao := 'Confirmar'; href := '/cota/escala';
    return next;
  end if;

  select count(*) into v_n from public.chamados_elo c
   where c.faixa_sla = 'chamados_sla_acima_2d' and c.concluido_em is not null and c.status <> 'Cancelado'
     and c.pessoa_id is not null and c.decisao is null;
  if v_n > 0 then
    chave := 'chamados'; grave := false; quantidade := v_n;
    texto := format('%s chamado%s fora do prazo esperando decisão', v_n, case when v_n > 1 then 's' else '' end);
    acao := 'Decidir'; href := '/cota/importar?aba=chamados';
    return next;
  end if;
end;
$function$;
