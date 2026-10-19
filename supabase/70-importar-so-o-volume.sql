-- ============================================================================
-- 70 · Importar só o volume de um mês do sistema
--
-- Agosto/2026 entrou no sistema pelo resultado (cálculo externo) e pelas
-- avaliações, mas o volume semanal nunca foi lançado: no Comparativo, volume
-- e TME de agosto aparecem "sem dado". O backup da planilha de agosto tem
-- esse volume.
--
-- A aba Importar › Mês anterior ganha o modo "Só o volume": para um mês já
-- FECHADO pelo sistema e sem nenhum volume, grava só volume_semanal
-- (finalizados, transferidos, fila, TMA, TME; Diretores e Executivos no canal
-- Diretores-Expansão). Não toca no fechamento nem nas avaliações. A
-- importação fica registrada como tipo 'volume', e o "Desfazer" (migração 69)
-- apaga só esse volume.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo. No fim ele confere o que foi criado.
-- ============================================================================

alter table public.importacoes_mes add column if not exists tipo text not null default 'completo';
alter table public.importacoes_mes drop constraint if exists importacoes_mes_tipo_valido;
alter table public.importacoes_mes add constraint importacoes_mes_tipo_valido check (tipo in ('completo', 'volume'));

-- p = { mes, arquivo, resumo, vinculos: [...], pessoas: [{ chave, volume: [...] }] }
-- (o mesmo formato da importar_mes_anterior, sem resultado e sem avaliações).
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
  end loop;

  return jsonb_build_object('importacao', v_imp, 'volume', v_volume);
end;
$$;

revoke all on function public.importar_volume_mes(jsonb) from public, anon;
grant execute on function public.importar_volume_mes(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: a função, a coluna, e os meses fechados pelo sistema sem volume
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'importar_volume_mes') as funcao_criada,
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'importacoes_mes' and column_name = 'tipo') as coluna_tipo,
  (select string_agg(to_char(m, 'MM/YYYY'), ', ' order by m)
     from (select distinct mes_competencia as m from public.fechamentos_cota where importacao_id is null) f
    where not exists (select 1 from public.volume_semanal v where v.mes_competencia = f.m)) as meses_sem_volume;
