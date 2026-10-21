-- ============================================================================
-- 72 · Conferência do cálculo e fim de transferidos/fila
--
-- 1. Transferidos e enviados para fila saem do banco (decisão do gestor,
--    21/10/2026: não são mais métrica no Hub). As três funções que os
--    gravavam (importar_mes_anterior, importar_volume_mes, mover_volume) são
--    refeitas sem eles, e as colunas saem de volume_semanal.
--
-- 2. Conferência do cálculo, de setembro/2026 em diante (o primeiro mês
--    calculado inteiro pelo sistema). Todo dia às 06:00 (pg_cron) e quando o
--    gestor pede, `registrar_conferencia()` grava o resultado de:
--      · resumo do mês aberto = cálculo completo (conferir_resumo);
--      · em cada mês fechado pelo sistema, a soma das linhas de cada pessoa =
--        o resultado congelado (fechamento ajustado à mão fica de fora — o
--        ajuste está registrado);
--      · ninguém pontuando fora: atendimento de quem está sem cargo e
--        registros pendentes de realocação nos meses abertos.
--    A quarta verificação (a simulação sem cenário reproduz o resultado de
--    hoje) roda na tela, porque a simulação é calculada no navegador.
--    Nada é corrigido sozinho: divergência vira pendência na tela inicial.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo. No fim ele mostra a primeira conferência.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Sem transferidos e fila
-- ---------------------------------------------------------------------------
create or replace function public.importar_mes_anterior(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_mes      date := (p->>'mes')::date;
  v_eu       uuid := public.pessoa_atual();
  v_eu_nome  text;
  v_limite   date;
  v_imp      uuid;
  v_v        jsonb;
  v_p        jsonb;
  v_pessoa   uuid;
  v_fech     uuid;
  v_novas    integer := 0;
  v_fechados integer := 0;
  v_volume   integer := 0;
  v_aval     integer := 0;
  v_arquivo  text := left(coalesce(p->>'arquivo', 'planilha'), 200);
  -- chave da planilha → pessoa (sem tabela temporária: o plano da função
  -- ficaria preso a uma tabela apagada no fim da transação anterior).
  v_mapa     jsonb := '{}'::jsonb;
begin
  if public.eh_gestor() is not true then
    raise exception 'Só o gestor importa meses anteriores.';
  end if;
  if v_mes is null or extract(day from v_mes) <> 1 then
    raise exception 'Competência inválida.';
  end if;

  -- Só antes do primeiro mês que o próprio sistema fechou (agosto/2026): mês
  -- do sistema tem dado de verdade e não se sobrescreve por planilha.
  select min(mes_competencia) into v_limite from public.fechamentos_cota where importacao_id is null;
  v_limite := coalesce(v_limite, (public.mes_de_competencia((now() at time zone 'America/Sao_Paulo')::date) - interval '1 month')::date);
  if v_mes >= v_limite then
    raise exception 'Só dá para importar meses antes de %/%: a partir dele os dados são do sistema.',
      to_char(v_limite, 'MM'), to_char(v_limite, 'YYYY');
  end if;
  if exists (select 1 from public.importacoes_mes where mes_competencia = v_mes) then
    raise exception 'Este mês já foi importado. Para importar de novo, desfaça a importação anterior.';
  end if;
  if exists (select 1 from public.fechamentos_cota where mes_competencia = v_mes) then
    raise exception 'Este mês já está fechado no sistema.';
  end if;
  if exists (select 1 from public.volume_semanal where mes_competencia = v_mes) then
    raise exception 'Este mês já tem volume lançado no sistema. Confira em Lançamentos antes de importar.';
  end if;

  select nome into v_eu_nome from public.pessoas where id = v_eu;

  insert into public.importacoes_mes (mes_competencia, arquivo, resumo, importado_por, importado_por_nome)
  values (v_mes, v_arquivo, coalesce(p->'resumo', '{}'::jsonb), v_eu, v_eu_nome)
  returning id into v_imp;

  -- Vínculos: pessoa existente ou cadastro de histórico.

  for v_v in select * from jsonb_array_elements(coalesce(p->'vinculos', '[]'::jsonb)) loop
    if v_v ? 'novo' then
      if exists (select 1 from public.pessoas where public.nome_comparavel(nome) = public.nome_comparavel(v_v->'novo'->>'nome')) then
        raise exception 'Já existe uma pessoa chamada "%". Escolha ela na lista em vez de cadastrar.', v_v->'novo'->>'nome';
      end if;
      if nullif(trim(v_v->'novo'->>'email'), '') is not null
         and exists (select 1 from public.pessoas where lower(trim(email)) = lower(trim(v_v->'novo'->>'email'))) then
        raise exception 'O e-mail % já é de outra pessoa. Escolha ela na lista em vez de cadastrar.', v_v->'novo'->>'email';
      end if;
      insert into public.pessoas (nome, email, ativo, avaliado, criada_pela_importacao)
      values (trim(v_v->'novo'->>'nome'), nullif(lower(trim(v_v->'novo'->>'email')), ''), false, false, v_imp)
      returning id into v_pessoa;
      v_novas := v_novas + 1;
    else
      v_pessoa := (v_v->>'pessoa_id')::uuid;
      if not exists (select 1 from public.pessoas where id = v_pessoa) then
        raise exception 'Pessoa não encontrada no cadastro (%).', v_v->>'chave';
      end if;
    end if;
    v_mapa := v_mapa || jsonb_build_object(v_v->>'chave', v_pessoa);
  end loop;

  -- Pessoas: volume e resultado congelado.
  for v_p in select * from jsonb_array_elements(coalesce(p->'pessoas', '[]'::jsonb)) loop
    v_pessoa := (v_mapa->>(v_p->>'chave'))::uuid;
    if v_pessoa is null then
      raise exception 'Falta escolher a pessoa de "%".', v_p->>'chave';
    end if;

    begin
      insert into public.volume_semanal
        (pessoa_id, mes_competencia, semana, canal, finalizados, tma_seg, tme_seg,
         origem_arquivo, importado_por, importacao_id)
      select v_pessoa, v_mes, (x->>'semana')::smallint, x->>'canal', coalesce((x->>'finalizados')::integer, 0),
             (x->>'tma_seg')::integer, (x->>'tme_seg')::integer,
             v_arquivo, v_eu, v_imp
        from jsonb_array_elements(coalesce(v_p->'volume', '[]'::jsonb)) x;
    exception when unique_violation then
      raise exception 'Duas linhas da planilha foram ligadas à mesma pessoa (%). Confira as escolhas.',
        (select nome from public.pessoas where id = v_pessoa);
    end;
    v_volume := v_volume + jsonb_array_length(coalesce(v_p->'volume', '[]'::jsonb));

    if v_p ? 'resultado' and v_p->>'resultado' is not null then
      insert into public.fechamentos_cota
        (pessoa_id, pessoa_nome, mes_competencia, cargo, resultado, meta,
         fechado_por, fechado_por_nome, importacao_id)
      select v_pessoa, ps.nome, v_mes,
             (select c.nome from public.cargos c where c.id = public.cargo_na_competencia(v_pessoa, v_mes)),
             (v_p->>'resultado')::numeric, (v_p->>'meta')::numeric,
             v_eu, coalesce(v_eu_nome, 'gestor') || ' · planilha', v_imp
        from public.pessoas ps where ps.id = v_pessoa
      returning id into v_fech;

      insert into public.fechamento_linhas
        (fechamento_id, semana, origem, regra, rotulo, grupo, ordem, quantidade, peso, cota)
      select v_fech, (l->>'semana')::smallint, l->>'origem', l->>'regra', l->>'rotulo', l->>'grupo',
             (l->>'ordem')::integer, (l->>'quantidade')::numeric, (l->>'peso')::numeric, (l->>'cota')::numeric
        from jsonb_array_elements(coalesce(v_p->'linhas', '[]'::jsonb)) l;
      v_fechados := v_fechados + 1;
    end if;
  end loop;

  -- Avaliações: uma por atendimento. A mesma (data + protocolo) não entra duas vezes.
  if exists (select 1 from jsonb_array_elements(coalesce(p->'avaliacoes', '[]'::jsonb)) a
              where not (v_mapa ? (a->>'chave'))) then
    raise exception 'Há avaliações de um e-mail sem pessoa escolhida.';
  end if;

  with novas as (
    insert into public.avaliacoes
      (pessoa_id, origem, data, protocolo, nota, tabulacao, origem_arquivo, importado_por, importado_em, importacao_id)
    select (v_mapa->>(a->>'chave'))::uuid, 'huggy', (a->>'data')::date, a->>'protocolo', (a->>'nota')::smallint,
           a->>'tabulacao', v_arquivo, v_eu, now(), v_imp
      from jsonb_array_elements(coalesce(p->'avaliacoes', '[]'::jsonb)) a
     where public.mes_de_competencia((a->>'data')::date) = v_mes
    on conflict (data, protocolo) do nothing
    returning 1
  )
  select count(*) into v_aval from novas;

  return jsonb_build_object('importacao', v_imp, 'pessoas_novas', v_novas, 'fechados', v_fechados,
                            'volume', v_volume, 'avaliacoes', v_aval);
end;
$$;

create or replace function public.importar_volume_mes(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_mes     date := (p->>'mes')::date;
  v_eu      uuid := public.pessoa_atual();
  v_eu_nome text;
  v_imp     uuid;
  v_v       jsonb;
  v_p       jsonb;
  v_pessoa  uuid;
  v_mapa    jsonb := '{}'::jsonb;
  v_volume  integer := 0;
  v_arquivo text := left(coalesce(p->>'arquivo', 'planilha'), 200);
begin
  if public.eh_gestor() is not true then
    raise exception 'Só o gestor importa volume.';
  end if;
  if v_mes is null or extract(day from v_mes) <> 1 then
    raise exception 'Competência inválida.';
  end if;
  if not exists (select 1 from public.fechamentos_cota where mes_competencia = v_mes and importacao_id is null) then
    raise exception 'Só o volume de um mês já fechado pelo sistema. Mês aberto se lança em Lançamentos.';
  end if;
  if exists (select 1 from public.volume_semanal where mes_competencia = v_mes) then
    raise exception 'Este mês já tem volume no sistema. Nada foi importado.';
  end if;
  if exists (select 1 from public.importacoes_mes where mes_competencia = v_mes) then
    raise exception 'Este mês já tem uma importação. Desfaça a anterior para importar de novo.';
  end if;

  select nome into v_eu_nome from public.pessoas where id = v_eu;
  insert into public.importacoes_mes (mes_competencia, arquivo, resumo, importado_por, importado_por_nome, tipo)
  values (v_mes, v_arquivo, coalesce(p->'resumo', '{}'::jsonb), v_eu, v_eu_nome, 'volume')
  returning id into v_imp;

  -- Vínculos: só pessoa existente (mês do sistema: quem tem volume já tem cadastro).
  for v_v in select * from jsonb_array_elements(coalesce(p->'vinculos', '[]'::jsonb)) loop
    v_pessoa := (v_v->>'pessoa_id')::uuid;
    if v_pessoa is null or not exists (select 1 from public.pessoas where id = v_pessoa) then
      raise exception 'Escolha uma pessoa do cadastro para "%".', v_v->>'chave';
    end if;
    v_mapa := v_mapa || jsonb_build_object(v_v->>'chave', v_pessoa);
  end loop;

  for v_p in select * from jsonb_array_elements(coalesce(p->'pessoas', '[]'::jsonb)) loop
    v_pessoa := (v_mapa->>(v_p->>'chave'))::uuid;
    if v_pessoa is null then
      raise exception 'Falta escolher a pessoa de "%".', v_p->>'chave';
    end if;
    begin
      insert into public.volume_semanal
        (pessoa_id, mes_competencia, semana, canal, finalizados, tma_seg, tme_seg,
         origem_arquivo, importado_por, importacao_id)
      select v_pessoa, v_mes, (x->>'semana')::smallint, x->>'canal', coalesce((x->>'finalizados')::integer, 0),
             (x->>'tma_seg')::integer, (x->>'tme_seg')::integer,
             v_arquivo, v_eu, v_imp
        from jsonb_array_elements(coalesce(v_p->'volume', '[]'::jsonb)) x;
    exception when unique_violation then
      raise exception 'Duas linhas da planilha foram ligadas à mesma pessoa (%). Confira as escolhas.',
        (select nome from public.pessoas where id = v_pessoa);
    end;
    v_volume := v_volume + jsonb_array_length(coalesce(v_p->'volume', '[]'::jsonb));
  end loop;

  return jsonb_build_object('importacao', v_imp, 'volume', v_volume);
end;
$$;

create or replace function public.mover_volume(p_id bigint, p_pessoa uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.volume_semanal;
  d public.volume_semanal;
  total integer;
begin
  if public.eh_gestor() is not true then raise exception 'Só o gestor move lançamentos.'; end if;
  select * into v from public.volume_semanal where id = p_id;
  if v.id is null then raise exception 'Volume não encontrado (talvez já movido).'; end if;
  if public.mes_fechado(v.mes_competencia) then raise exception 'Mês fechado: o volume não muda mais.'; end if;
  if v.pessoa_id = p_pessoa then raise exception 'Escolha outra pessoa.'; end if;
  if not exists (select 1 from public.pessoas where id = p_pessoa) then raise exception 'Pessoa não encontrada.'; end if;

  insert into public.realocacoes (tipo, acao, registro, de_pessoa, para_pessoa, feito_por)
  values ('volume', 'mover', to_jsonb(v), v.pessoa_id, p_pessoa, public.pessoa_atual());

  select * into d from public.volume_semanal
   where pessoa_id = p_pessoa and mes_competencia = v.mes_competencia and semana = v.semana and canal = v.canal;
  if d.id is null then
    update public.volume_semanal set pessoa_id = p_pessoa, sem_cota_ok = false, atualizado_em = now() where id = v.id;
    return jsonb_build_object('somou', false);
  end if;

  total := coalesce(d.finalizados, 0) + coalesce(v.finalizados, 0);
  update public.volume_semanal set
    finalizados   = total,
    tma_seg = case when d.tma_seg is null then v.tma_seg when v.tma_seg is null or total = 0 then d.tma_seg
                   else round((d.tma_seg * d.finalizados + v.tma_seg * v.finalizados)::numeric / total) end,
    tme_seg = case when d.tme_seg is null then v.tme_seg when v.tme_seg is null or total = 0 then d.tme_seg
                   else round((d.tme_seg * d.finalizados + v.tme_seg * v.finalizados)::numeric / total) end,
    atualizado_em = now()
   where id = d.id;
  delete from public.volume_semanal where id = v.id;
  return jsonb_build_object('somou', true);
end;
$$;

alter table public.volume_semanal drop column if exists transferidos;
alter table public.volume_semanal drop column if exists enviados_fila;

-- ---------------------------------------------------------------------------
-- 2. Conferência do cálculo
-- ---------------------------------------------------------------------------
create table if not exists public.conferencias_calculo (
  id         bigint generated always as identity primary key,
  rodada_em  timestamptz not null default now(),
  por        text not null default 'sistema',   -- 'sistema' (06:00) ou o nome de quem pediu
  falhas     integer not null,
  resultado  jsonb not null                      -- [{ chave, titulo, ok, detalhe, itens: [texto] }]
);
alter table public.conferencias_calculo enable row level security;
drop policy if exists conferencias_leitura on public.conferencias_calculo;
create policy conferencias_leitura on public.conferencias_calculo for select using (public.eh_gestor());

-- As verificações, sem gravar.
create or replace function public.conferir_calculo()
returns jsonb language plpgsql security definer set search_path = public
set statement_timeout = '120s' as $$
declare
  v_inicio date := date '2026-09-01';
  v_itens  text[];
  v_saida  jsonb := '[]'::jsonb;
  v_n      integer;
begin
  -- 1. Resumo do mês aberto = cálculo completo. Com mudança ainda na fila (a
  -- tarefa de cada minuto não passou), o resumo está legitimamente atrás: a
  -- comparação espera a próxima rodada. (Pôr o resumo em dia aqui não dá: a
  -- tela chama pela API, que barra o apagar sem filtro que a atualização faz.)
  if exists (select 1 from public.resumo_mudancas) then
    v_saida := v_saida || jsonb_build_object('chave', 'resumo', 'titulo', 'Resumo do mês aberto = cálculo completo',
      'ok', true, 'itens', '[]'::jsonb, 'detalhe', 'há mudança sendo atualizada agora; confere na próxima rodada');
  else
    select coalesce(array_agg(format('%s · %s: %s só no resumo, %s só no cálculo',
                                     to_char(mes, 'MM/YYYY'), quadro, so_no_resumo, so_ao_vivo)), '{}')
      into v_itens
      from public.conferir_resumo()
     where so_no_resumo + so_ao_vivo > 0;
    v_saida := v_saida || jsonb_build_object('chave', 'resumo', 'titulo', 'Resumo do mês aberto = cálculo completo',
      'ok', cardinality(v_itens) = 0, 'itens', to_jsonb(v_itens),
      'detalhe', (select string_agg(distinct to_char(mes_competencia, 'MM/YYYY'), ', ') from public.resumo_estado));
  end if;

  -- 2. Fechamentos: soma das linhas = resultado congelado.
  select coalesce(array_agg(format('%s · %s: linhas somam %s, resultado %s',
                                   to_char(f.mes_competencia, 'MM/YYYY'), f.pessoa_nome,
                                   round(coalesce(l.soma, 0), 2), round(f.resultado, 2))
                            order by f.mes_competencia, f.pessoa_nome), '{}'),
         count(*)
    into v_itens, v_n
    from public.fechamentos_cota f
    left join lateral (select sum(cota) as soma from public.fechamento_linhas where fechamento_id = f.id) l on true
   where f.importacao_id is null
     and f.mes_competencia >= v_inicio
     and abs(coalesce(l.soma, 0) - f.resultado) >= 0.01
     and not exists (select 1 from public.fechamento_alteracoes a
                      where a.fechamento_id = f.id and a.campo = 'resultado');
  v_saida := v_saida || jsonb_build_object('chave', 'fechamentos', 'titulo', 'Fechamentos: soma das linhas = resultado congelado',
    'ok', cardinality(v_itens) = 0, 'itens', to_jsonb(v_itens),
    'detalhe', (select format('%s pessoa(s) conferidas em %s', count(*),
                              coalesce(string_agg(distinct to_char(mes_competencia, 'MM/YYYY'), ', '), 'nenhum mês'))
                  from public.fechamentos_cota where importacao_id is null and mes_competencia >= v_inicio));

  -- 3. Ninguém pontuando fora, nos meses abertos.
  select coalesce(array_agg(x order by x), '{}') into v_itens from (
    select format('%s · %s: tem atendimento e está sem cargo', to_char(s.mes_competencia, 'MM/YYYY'), s.nome) as x
      from public.vw_sem_cargo s
     where s.mes_competencia >= v_inicio and not public.mes_fechado(s.mes_competencia)
    union all
    select format('%s · %s: %s %s pendente(s) de realocação', to_char(p.mes_competencia, 'MM/YYYY'), p.pessoa, count(*), p.tipo)
      from public.vw_lancamentos_pendentes p
     group by p.mes_competencia, p.pessoa, p.tipo
  ) q;
  v_saida := v_saida || jsonb_build_object('chave', 'fora', 'titulo', 'Ninguém pontuando fora',
    'ok', cardinality(v_itens) = 0, 'itens', to_jsonb(v_itens),
    'detalhe', 'atendimento sem cargo e registros pendentes de realocação');

  return v_saida;
end;
$$;
revoke all on function public.conferir_calculo() from public, anon, authenticated;

-- Roda e grava. Pelo pg_cron ou pelo gestor ("Conferir agora").
create or replace function public.registrar_conferencia()
returns jsonb language plpgsql security definer set search_path = public
set statement_timeout = '120s' as $$
declare
  v_r jsonb;
  v_por text := 'sistema';
begin
  if auth.uid() is not null then
    if public.eh_gestor() is not true then raise exception 'Só o gestor confere o cálculo.'; end if;
    select nome into v_por from public.pessoas where id = public.pessoa_atual();
  end if;
  v_r := public.conferir_calculo();
  insert into public.conferencias_calculo (por, falhas, resultado)
  values (coalesce(v_por, 'gestor'),
          (select count(*) from jsonb_array_elements(v_r) e where (e->>'ok')::boolean is not true), v_r);
  -- Guarda 90 dias.
  delete from public.conferencias_calculo where rodada_em < now() - interval '90 days';
  return v_r;
end;
$$;
revoke all on function public.registrar_conferencia() from public, anon;
grant execute on function public.registrar_conferencia() to authenticated;

-- Todo dia às 06:00 de Brasília (09:00 UTC).
do $$
begin
  perform cron.unschedule('conferencia-do-calculo') where exists (select 1 from cron.job where jobname = 'conferencia-do-calculo');
  perform cron.schedule('conferencia-do-calculo', '0 9 * * *', 'select public.registrar_conferencia()');
end $$;

-- ---------------------------------------------------------------------------
-- Conferência: a primeira rodada
-- ---------------------------------------------------------------------------
select e->>'titulo' as verificacao, case when (e->>'ok')::boolean then 'ok' else 'DIVERGÊNCIA' end as situacao,
       coalesce(nullif(e->>'itens', '[]'), e->>'detalhe') as detalhe
  from jsonb_array_elements(public.registrar_conferencia()) e;
