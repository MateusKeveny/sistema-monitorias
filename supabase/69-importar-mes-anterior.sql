-- ============================================================================
-- 69 · Importar mês anterior (planilha "Dashboard Expansão")
--
-- Os meses antes do sistema (junho e julho/2026) entram pela tela
-- Importar › Mês anterior (planilha), lidos no computador do gestor, e caem
-- nas MESMAS tabelas dos meses de hoje — por isso o comparativo, os gráficos
-- e o histórico passam a enxergá-los sem nenhum caminho à parte:
--
--   avaliações (uma por atendimento) → avaliacoes
--   volume por pessoa e semana        → volume_semanal (+ transferidos e fila)
--   resultado da planilha             → fechamentos_cota + fechamento_linhas,
--                                       CONGELADO como estava: nada é
--                                       recalculado com os pesos de hoje.
--
-- Tudo o que a importação grava leva o id dela (importacao_id), e "Desfazer"
-- apaga a importação inteira de uma vez (on delete cascade).
--
-- E-mail da planilha sem cadastro: o gestor escolhe na prévia uma pessoa
-- existente ou "Cadastrar como histórico" — a pessoa é criada inativa, sem
-- login e fora das monitorias, e os dados dela contam como os de qualquer um
-- (inclusive na C-SAT da equipe). Decisão do gestor, 19/10/2026.
--
-- Transferidos e enviados para fila passam a ser guardados no volume (não
-- pontuam; servem à leitura de volume).
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo. No fim ele confere o que foi criado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. As importações
-- ---------------------------------------------------------------------------
create table if not exists public.importacoes_mes (
  id                 uuid primary key default uuid_generate_v4(),
  mes_competencia    date not null unique,
  arquivo            text not null,
  -- Os totais conferidos na prévia (finalizados, avaliações, C-SAT…), para a
  -- tela mostrar o que entrou sem recontar.
  resumo             jsonb not null default '{}'::jsonb,
  importado_por      uuid references public.pessoas (id) on delete set null,
  importado_por_nome text,
  importado_em       timestamptz not null default now()
);

alter table public.importacoes_mes enable row level security;
drop policy if exists importacoes_mes_leitura on public.importacoes_mes;
-- Todos leem: só diz que mês veio de planilha (o Comparativo do atendente
-- também começa nele).
create policy importacoes_mes_leitura on public.importacoes_mes
  for select using (auth.uid() is not null);

-- O que cada importação gravou.
alter table public.avaliacoes       add column if not exists importacao_id uuid references public.importacoes_mes (id) on delete cascade;
alter table public.volume_semanal   add column if not exists importacao_id uuid references public.importacoes_mes (id) on delete cascade;
alter table public.fechamentos_cota add column if not exists importacao_id uuid references public.importacoes_mes (id) on delete cascade;
create index if not exists avaliacoes_importacao_idx       on public.avaliacoes (importacao_id) where importacao_id is not null;
create index if not exists volume_semanal_importacao_idx   on public.volume_semanal (importacao_id) where importacao_id is not null;
create index if not exists fechamentos_cota_importacao_idx on public.fechamentos_cota (importacao_id) where importacao_id is not null;

-- Quem foi cadastrado como histórico por uma importação (o "Desfazer" tenta
-- apagar, se a pessoa não tiver ficado com outros dados).
alter table public.pessoas add column if not exists criada_pela_importacao uuid
  references public.importacoes_mes (id) on delete set null;

-- Transferidos e enviados para fila, como vêm do relatório do Huggy.
alter table public.volume_semanal add column if not exists transferidos  integer;
alter table public.volume_semanal add column if not exists enviados_fila integer;

-- ---------------------------------------------------------------------------
-- 2. Mês importado não avisa o Teams
--
-- O fechamento grava em fechamentos_cota, e o gatilho da migração 41 mandaria
-- "Junho fechado" ao canal da equipe. Mês da planilha não é fechamento novo.
-- (Corpo igual ao da 41, com a guarda no começo.)
-- ---------------------------------------------------------------------------
create or replace function public.aviso_mes_fechado()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_comp   date := new.mes_competencia;
  v_titulo text := format('%s fechado', initcap(public.nome_do_mes(new.mes_competencia)));
begin
  if new.importacao_id is not null then
    return null;
  end if;
  perform public.enviar_aviso_teams('semana_encerrada', 'fechamento/' || v_comp, v_titulo,
    public.cartao_teams('Mês fechado', 'Good', v_titulo,
      format('O gestor fechou o ciclo de %s (%s a %s). Os pontos do mês já estão definitivos no seu extrato.',
             public.nome_do_mes(v_comp), to_char((v_comp - interval '1 month')::date + 25, 'DD/MM'),
             to_char(v_comp + 24, 'DD/MM')),
      jsonb_build_array(jsonb_build_object('title', 'Fechado por', 'value',
        format('%s, %s', coalesce(new.fechado_por_nome, 'gestor'),
               to_char(new.fechado_em at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI')))),
      'Ver meu extrato',
      public.endereco_do_site('performance') || '/cota/extrato?mes=' || to_char(v_comp, 'YYYY-MM')));
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Importar
--
-- p = {
--   mes: 'AAAA-MM-01', arquivo: '…xlsx', resumo: {…},
--   vinculos:   [{ chave, pessoa_id } | { chave, novo: { nome, email } }],
--   pessoas:    [{ chave, resultado, meta,
--                  volume: [{ semana, canal, finalizados, transferidos, enviados_fila, tma_seg, tme_seg }],
--                  linhas: [{ semana, origem, regra, rotulo, grupo, ordem, quantidade, peso, cota }] }],
--   avaliacoes: [{ chave, data, protocolo, nota, tabulacao }]
-- }
-- `chave` é o e-mail (ou o nome) da planilha; todo dado aponta para uma chave,
-- e toda chave precisa de vínculo — nada entra sem pessoa.
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
         transferidos, enviados_fila, origem_arquivo, importado_por, importacao_id)
      select v_pessoa, v_mes, (x->>'semana')::smallint, x->>'canal', coalesce((x->>'finalizados')::integer, 0),
             (x->>'tma_seg')::integer, (x->>'tme_seg')::integer,
             (x->>'transferidos')::integer, (x->>'enviados_fila')::integer, v_arquivo, v_eu, v_imp
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

revoke all on function public.importar_mes_anterior(jsonb) from public, anon;
grant execute on function public.importar_mes_anterior(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Desfazer
--
-- Apaga tudo o que a importação gravou (cascata) e, das pessoas que ela
-- cadastrou como histórico, as que não ficaram com nenhum outro dado.
-- ---------------------------------------------------------------------------
create or replace function public.desfazer_importacao_mes(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_mes     date;
  v_pessoas uuid[];
  v_id      uuid;
  v_apagadas integer := 0;
begin
  if public.eh_gestor() is not true then
    raise exception 'Só o gestor desfaz importações.';
  end if;
  select mes_competencia into v_mes from public.importacoes_mes where id = p_id;
  if v_mes is null then
    raise exception 'Importação não encontrada (talvez já desfeita).';
  end if;

  select array_agg(id) into v_pessoas from public.pessoas where criada_pela_importacao = p_id;
  delete from public.importacoes_mes where id = p_id;

  foreach v_id in array coalesce(v_pessoas, '{}') loop
    begin
      delete from public.pessoas where id = v_id and auth_id is null;
      if found then v_apagadas := v_apagadas + 1; end if;
    exception when foreign_key_violation then
      null; -- ficou com outros dados: continua no cadastro
    end;
  end loop;

  return jsonb_build_object('mes', v_mes, 'pessoas_apagadas', v_apagadas);
end;
$$;

revoke all on function public.desfazer_importacao_mes(uuid) from public, anon;
grant execute on function public.desfazer_importacao_mes(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname in ('importar_mes_anterior', 'desfazer_importacao_mes')) as funcoes_criadas,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and column_name = 'importacao_id'
      and table_name in ('avaliacoes', 'volume_semanal', 'fechamentos_cota')) as tabelas_marcadas,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'volume_semanal'
      and column_name in ('transferidos', 'enviados_fila')) as colunas_de_volume,
  (select min(mes_competencia) from public.fechamentos_cota where importacao_id is null) as primeiro_mes_do_sistema;
