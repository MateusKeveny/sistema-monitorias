-- ============================================================================
-- 80 · Demanda extra de outro setor com as regras de um canal
--
-- Os atendimentos de outro setor (migração 78) podiam ser lançados só numa
-- regra de demanda extra já existente. Agora há "usar as regras de": o
-- sistema cria a métrica "Atendimento <setor>" (grupo de demanda extra) com os
-- MESMOS pesos por cargo do finalizado do canal escolhido — copiados no
-- momento, não acompanham mudanças depois — e lança nela. No extrato é uma
-- linha à parte; não entra nos finalizados do canal, no C-SAT nem no TME.
-- Pedido do gestor para outubro/2026 (iGreen Mob).
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo.
-- ============================================================================

create or replace function public.decidir_outro_setor_copiando(p_ids bigint[], p_copiar_de text)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_setor text;
  v_chave text;
  v_rotulo text;
  v_origem public.regras;
  v_n integer := 0;
begin
  if public.eh_gestor() is not true then raise exception 'Só o gestor decide as demandas extras.'; end if;
  if p_copiar_de not in ('huggy_atendimento', 'diretores_atendimento') then
    raise exception 'Só dá para copiar as regras de um finalizado de canal.';
  end if;
  select * into v_origem from public.regras where chave = p_copiar_de;

  -- Uma métrica por setor do Hub.
  for v_setor in
    select distinct setor from public.atendimentos_outro_setor
     where id = any (p_ids) and situacao = 'pendente'
  loop
    v_rotulo := 'Atendimento ' || v_setor;
    v_chave := 'outro_setor_' || trim(both '_' from regexp_replace(lower(
                 translate(v_setor, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                    'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]+', '_', 'g'));

    insert into public.regras (chave, grupo, rotulo, peso, faixa_min, faixa_max, ordem, manual, valor_manual, ativo)
    values (v_chave, 'manual', v_rotulo, v_origem.peso, null, null,
            (select coalesce(max(ordem), 0) + 1 from public.regras), true, false, true)
    on conflict (chave) do update set ativo = true;

    -- Os pesos do finalizado copiados, cargo a cargo (só os que ainda não têm).
    insert into public.pesos_por_cargo (cargo_id, regra, peso, ativo, motivo_alteracao)
    select p.cargo_id, v_chave, p.peso, p.ativo, format('Copiado de "%s" para os atendimentos de %s', v_origem.rotulo, v_setor)
      from public.pesos_por_cargo p
     where p.regra = p_copiar_de
    on conflict (cargo_id, regra) do nothing;

    v_n := v_n + public.decidir_outro_setor(
      array(select id from public.atendimentos_outro_setor
             where id = any (p_ids) and setor = v_setor and situacao = 'pendente'),
      v_chave);
  end loop;
  return v_n;
end;
$$;
revoke all on function public.decidir_outro_setor_copiando(bigint[], text) from public, anon;
grant execute on function public.decidir_outro_setor_copiando(bigint[], text) to authenticated;

-- Conferência
select (select count(*) from pg_proc where proname = 'decidir_outro_setor_copiando') as funcao;
