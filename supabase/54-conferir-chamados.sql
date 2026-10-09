-- ============================================================================
-- 54 · Conferir a importação de chamados antes de gravar
--
-- Na 53, escolher o arquivo do ELO já gravava. Pedido do gestor: igual ao
-- Hub, em três passos — escolher, conferir, importar. Esta função faz a mesma
-- leitura de `importar_chamados` e devolve o resumo, sem gravar nada.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

create or replace function public.conferir_chamados(p_linhas jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_linha   jsonb;
  v_antes   public.chamados_elo;
  v_aberto  timestamptz;
  v_mes     date;
  v_pessoa  uuid;
  v_novos   int := 0;
  v_atual   int := 0;
  v_iguais  int := 0;
  v_sem_pessoa int := 0;
  v_resolvidos int := 0;
  v_no_prazo   int := 0;
  v_atrasados  int := 0;
  v_abertos    int := 0;
  v_cancelados int := 0;
  v_fechados   int := 0;
  v_meses   date[] := '{}';
begin
  if not public.eh_gestor() then
    raise exception 'Só o gestor importa chamados.';
  end if;

  for v_linha in select * from jsonb_array_elements(p_linhas) loop
    v_aberto := (v_linha->>'aberto_em')::timestamptz;
    v_mes := public.mes_de_competencia((v_aberto at time zone 'America/Sao_Paulo')::date);
    select id into v_pessoa from public.pessoas
     where lower(trim(coalesce(nome_elo, nome))) = lower(trim(v_linha->>'responsavel'))
     order by nome_elo is null limit 1;

    select * into v_antes from public.chamados_elo where protocolo = (v_linha->>'protocolo')::bigint;
    if not found then
      v_novos := v_novos + 1;
    elsif (v_antes.status, v_antes.concluido_em, v_antes.aberto_clickup_em, v_antes.tempo_util,
           v_antes.tempo_interno, v_antes.tempo_ti, v_antes.motivo_atraso, v_antes.observacao,
           v_antes.responsavel, v_antes.pessoa_id)
          is distinct from
          (v_linha->>'status', (v_linha->>'concluido_em')::timestamptz, (v_linha->>'aberto_clickup_em')::timestamptz,
           (v_linha->>'tempo_util')::numeric(10,2), (v_linha->>'tempo_interno')::numeric(10,2),
           (v_linha->>'tempo_ti')::numeric(10,2), nullif(trim(v_linha->>'motivo_atraso'), ''),
           nullif(trim(v_linha->>'observacao'), ''), v_linha->>'responsavel', v_pessoa) then
      v_atual := v_atual + 1;
    else
      v_iguais := v_iguais + 1;
    end if;

    if v_pessoa is null then
      v_sem_pessoa := v_sem_pessoa + 1;
    elsif exists (select 1 from public.fechamentos_cota f
                   where f.pessoa_id = v_pessoa and f.mes_competencia = v_mes) then
      v_fechados := v_fechados + 1;
    elsif v_linha->>'status' = 'Cancelado' then
      v_cancelados := v_cancelados + 1;
    elsif v_linha->>'concluido_em' is null then
      v_abertos := v_abertos + 1;
    else
      v_resolvidos := v_resolvidos + 1;
      v_meses := array_append(v_meses, v_mes);
      if (v_linha->>'tempo_util')::numeric < 3 then v_no_prazo := v_no_prazo + 1;
      else v_atrasados := v_atrasados + 1; end if;
    end if;
  end loop;

  return jsonb_build_object('novos', v_novos, 'atualizados', v_atual, 'sem_mudanca', v_iguais,
    'sem_pessoa', v_sem_pessoa, 'de_mes_fechado', v_fechados, 'cancelados', v_cancelados,
    'em_aberto', v_abertos, 'resolvidos', v_resolvidos, 'no_prazo', v_no_prazo, 'atrasados', v_atrasados,
    'meses', (select jsonb_agg(distinct m) from unnest(v_meses) m));
end;
$$;

revoke all on function public.conferir_chamados(jsonb) from public, anon;
grant execute on function public.conferir_chamados(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: a função existe
-- ---------------------------------------------------------------------------
select (select count(*) from pg_proc where proname = 'conferir_chamados') as funcao_criada;
