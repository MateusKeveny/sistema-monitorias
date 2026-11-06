-- ============================================================================
-- 101 · Corrige a exclusão de setor (Performance 4.1.0, sobre a migração 100)
--
--   · excluir_setor() parava em "setores_regra_monitoria_fkey": o setor aponta
--     para a régua de monitoria dele (uma das regras que são apagadas). Agora
--     solta essa ligação antes de apagar as regras.
--   · historico_do_setor() passa a contar também o que liga OUTRO setor às
--     regras deste (fila com regra de finalizado, peso de cargo) e os
--     lançamentos ligados às regras do setor — nesses casos não exclui.
--
-- Só troca as duas funções (create or replace). Pode rodar de novo.
-- ============================================================================

create or replace function public.historico_do_setor(p_setor smallint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_filas smallint[] := array(select id from canais_do_setor where setor_id = p_setor);
  v_apelidos text[] := array(select apelido from canais_do_setor where setor_id = p_setor and apelido is not null);
  v_cargos smallint[] := array(select id from cargos where setor_id = p_setor);
  v_regras text[] := array(select chave from regras where setor_id = p_setor);
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
    'lancamentos', (select count(*) from lancamentos where canal_id = any (v_filas) or regra = any (v_regras))
                 + (select count(*) from fechamento_linhas where canal_id = any (v_filas)),
    'metricas_desligadas', (select count(*) from metricas_desligadas where canal_id = any (v_filas) or canal = any (v_apelidos)),
    'cargos_em_uso', (select count(*) from cargos_da_pessoa where cargo_id = any (v_cargos)),
    -- Outro setor usando algo deste: filas copiadas, regras copiadas ou usadas,
    -- cargo de referência, peso de cargo, régua de monitoria.
    'usado_por_outro', (select count(*) from canais_do_setor where setor_id <> p_setor
                          and (copia_de = any (v_filas) or regra_finalizado = any (v_regras)))
                     + (select count(*) from cargos_referencia cr join cargos c on c.id = cr.cargo_id
                         where c.setor_id <> p_setor and cr.referencia_id = any (v_cargos))
                     + (select count(*) from regras r where r.setor_id is distinct from p_setor
                         and r.copia_de = any (v_regras))
                     + (select count(*) from pesos_por_cargo where regra = any (v_regras)
                         and not (cargo_id = any (v_cargos)))
                     + (select count(*) from setores where id <> p_setor and regra_monitoria = any (v_regras)),
    'ativos_outros', (select count(*) from setores where ativo and id <> p_setor)
  );
end;
$$;

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
  -- O setor aponta para a régua de monitoria dele, que é uma das regras abaixo.
  update setores set regra_monitoria = null where id = p_setor;
  update regras set copia_de = null where setor_id = p_setor;
  delete from regras where setor_id = p_setor;
  delete from cargos where id = any (v_cargos);
  -- Por último: apagar filas e cargos pede recálculo (gatilho), que cria de novo
  -- um pedido na fila de cálculo do setor.
  delete from fila_de_calculo where setor_id = p_setor;
  delete from resumo_por_setor where setor_id = p_setor;
  delete from setores where id = p_setor;
end;
$$;

notify pgrst, 'reload schema';
