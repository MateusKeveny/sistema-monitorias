-- ============================================================================
-- 100 · Excluir ou desativar um setor (Performance 4.1.0) — só o administrador
--
--   · Setor SEM histórico (criado por engano ou de teste: nenhuma pessoa,
--     fechamento, monitoria, valor, volume, avaliação, lançamento ou métrica
--     desligada) e que nenhum outro setor usa: excluir_setor() apaga de vez,
--     com as filas, os cargos, os pesos, as regras e as configurações dele.
--   · Setor COM histórico: não exclui (apagaria fechamentos e números já
--     entregues). desativar_setor() tira do menu, do seletor e das listas, e
--     guarda tudo; dá para reativar. Para desativar, ninguém ativo no setor
--     (mova as pessoas pela Árvore antes).
--   · O último setor ativo não pode ser desativado nem excluído.
--
-- Aditiva: só funções novas. Rode no SQL Editor do projeto dos PAINÉIS. Pode
-- rodar de novo.
-- ============================================================================

-- O que o setor tem de histórico e quem depende dele.
create or replace function public.historico_do_setor(p_setor smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_filas smallint[] := array(select id from canais_do_setor where setor_id = p_setor);
  v_apelidos text[] := array(select apelido from canais_do_setor where setor_id = p_setor and apelido is not null);
  v_cargos smallint[] := array(select id from cargos where setor_id = p_setor);
begin
  if public.eh_admin() is not true then
    raise exception 'Só o administrador vê isto.';
  end if;
  return jsonb_build_object(
    'pessoas', (select count(distinct pessoa_id) from setores_da_pessoa where setor_id = p_setor),
    'pessoas_ativas', (select count(*) from pessoas p
                        where p.ativo and p.desligado_em is null and not coalesce(p.perfil_de_teste, false)
                          and (select sp.setor_id from setores_da_pessoa sp where sp.pessoa_id = p.id
                                order by sp.desde desc limit 1) = p_setor),
    'fechamentos', (select count(*) from fechamentos_cota where setor_id = p_setor),
    'monitorias', (select count(*) from monitorias where setor_id = p_setor),
    'valores', (select count(*) from valores_da_cota where setor_id = p_setor)
             + (select count(*) from valores_alteracoes where setor_id = p_setor),
    'volumes', (select count(*) from volume_semanal where canal_id = any (v_filas)),
    'avaliacoes', (select count(*) from avaliacoes where canal_id = any (v_filas))
                + (select count(*) from avaliacoes_guardadas where canal_id = any (v_filas)),
    'lancamentos', (select count(*) from lancamentos where canal_id = any (v_filas))
                 + (select count(*) from fechamento_linhas where canal_id = any (v_filas)),
    'metricas_desligadas', (select count(*) from metricas_desligadas where canal_id = any (v_filas) or canal = any (v_apelidos)),
    'cargos_em_uso', (select count(*) from cargos_da_pessoa where cargo_id = any (v_cargos)),
    -- Outro setor usando algo deste: filas copiadas, regras copiadas, cargo de referência.
    'usado_por_outro', (select count(*) from canais_do_setor where setor_id <> p_setor and copia_de = any (v_filas))
                     + (select count(*) from cargos_referencia cr join cargos c on c.id = cr.cargo_id
                         where c.setor_id <> p_setor and cr.referencia_id = any (v_cargos))
                     + (select count(*) from regras r where r.setor_id is distinct from p_setor
                         and r.copia_de in (select chave from regras where setor_id = p_setor)),
    'ativos_outros', (select count(*) from setores where ativo and id <> p_setor)
  );
end;
$$;

-- Exclui de vez um setor sem histórico.
create or replace function public.excluir_setor(p_setor smallint)
returns void language plpgsql security definer set search_path = public as $$
declare
  h jsonb;
  v_filas smallint[] := array(select id from canais_do_setor where setor_id = p_setor);
  v_cargos smallint[] := array(select id from cargos where setor_id = p_setor);
begin
  if public.eh_admin() is not true then
    raise exception 'Só o administrador exclui um setor.';
  end if;
  if not exists (select 1 from setores where id = p_setor) then
    raise exception 'Setor não encontrado.';
  end if;
  h := public.historico_do_setor(p_setor);
  if (h->>'ativos_outros')::int = 0 then
    raise exception 'É o único setor ativo: não dá para excluir.';
  end if;
  if (h->>'usado_por_outro')::int > 0 then
    raise exception 'Outro setor usa filas, regras ou cargos deste: ajuste o outro setor antes de excluir.';
  end if;
  if (h->>'pessoas')::int + (h->>'fechamentos')::int + (h->>'monitorias')::int + (h->>'valores')::int
     + (h->>'volumes')::int + (h->>'avaliacoes')::int + (h->>'lancamentos')::int
     + (h->>'metricas_desligadas')::int + (h->>'cargos_em_uso')::int > 0 then
    raise exception 'Este setor tem histórico (pessoas, fechamentos ou números lançados): desative em vez de excluir, para não perder o que já foi entregue.';
  end if;

  -- As configurações do setor, das dependentes para as principais.
  delete from volume_ia where setor_id = p_setor;
  delete from criterios where setor_id = p_setor;
  delete from cargos_referencia where cargo_id = any (v_cargos) or referencia_id = any (v_cargos);
  delete from pesos_por_cargo where cargo_id = any (v_cargos);
  update canais_do_setor set copia_de = null where setor_id = p_setor;
  delete from canais_do_setor where id = any (v_filas);
  delete from regras where setor_id = p_setor;
  delete from cargos where id = any (v_cargos);
  -- Por último: apagar filas e cargos pede recálculo (gatilho), que cria de novo
  -- um pedido na fila de cálculo do setor.
  delete from fila_de_calculo where setor_id = p_setor;
  delete from resumo_por_setor where setor_id = p_setor;
  delete from setores where id = p_setor;
end;
$$;

-- Desativa (some do menu, do seletor e das listas; o histórico fica) ou reativa.
create or replace function public.desativar_setor(p_setor smallint, p_ativo boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  h jsonb;
begin
  if public.eh_admin() is not true then
    raise exception 'Só o administrador desativa ou reativa um setor.';
  end if;
  if not exists (select 1 from setores where id = p_setor) then
    raise exception 'Setor não encontrado.';
  end if;
  if not p_ativo then
    h := public.historico_do_setor(p_setor);
    if (h->>'ativos_outros')::int = 0 then
      raise exception 'É o único setor ativo: não dá para desativar.';
    end if;
    if (h->>'pessoas_ativas')::int > 0 then
      raise exception 'Ainda há % pessoa(s) ativa(s) neste setor: mova-as pela Árvore antes de desativar.', h->>'pessoas_ativas';
    end if;
  end if;
  update setores set ativo = p_ativo where id = p_setor;
end;
$$;

revoke all on function public.historico_do_setor(smallint) from public, anon;
revoke all on function public.excluir_setor(smallint) from public, anon;
revoke all on function public.desativar_setor(smallint, boolean) from public, anon;
grant execute on function public.historico_do_setor(smallint) to authenticated;
grant execute on function public.excluir_setor(smallint) to authenticated;
grant execute on function public.desativar_setor(smallint, boolean) to authenticated;

notify pgrst, 'reload schema';
