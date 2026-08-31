-- ============================================================================
-- CORREÇÃO CRÍTICA — rode imediatamente, antes de qualquer outra coisa.
--
-- A função excluir_monitoria criada em 07 podia ser chamada por QUALQUER UM,
-- inclusive sem sessão, usando apenas a chave pública que vai no navegador.
--
-- Causa: eh_admin() devolve NULL para quem não tem perfil — papel_atual() não
-- encontra linha e o `=` com NULL dá NULL, não `false`. E em PL/pgSQL
-- `if not NULL then` NÃO entra no bloco: NULL não é verdadeiro, mas também não
-- é falso. A guarda simplesmente não disparava.
--
-- Nas políticas de RLS o mesmo NULL era inofensivo, porque ali NULL reprova por
-- definição. O perigo apareceu ao usar a função dentro de um `if`.
--
-- Duas correções, para não depender de lembrar disso de novo:
--   1. eh_admin() e eh_gestor_ou_admin() passam a devolver false, nunca NULL.
--   2. a guarda testa `is not true`, que trata NULL como reprovação.
-- ============================================================================

-- A coluna precisa existir antes da função que grava nela.
alter table public.monitorias_excluidas
  add column if not exists itens jsonb;

create or replace function public.eh_admin()
returns boolean language sql stable as $$
  select coalesce(public.papel_atual() = 'admin', false);
$$;

create or replace function public.eh_gestor_ou_admin()
returns boolean language sql stable as $$
  select coalesce(public.papel_atual() in ('admin', 'gestor'), false);
$$;

create or replace function public.excluir_monitoria(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m        public.monitorias%rowtype;
  v_operador text;
  v_autor    text;
begin
  -- `is not true` em vez de `not ...`: se a expressão vier NULL, reprova.
  if public.eh_admin() is not true then
    raise exception 'Apenas a Qualidade pode excluir monitorias.';
  end if;

  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da exclusão.';
  end if;

  select * into v_m from public.monitorias where id = p_id;
  if not found then
    raise exception 'Monitoria não encontrada.';
  end if;

  select nome into v_operador from public.operadores where id = v_m.operador_id;
  select nome into v_autor    from public.perfis     where id = auth.uid();

  insert into public.monitorias_excluidas (
    monitoria_id, protocolo, data_atendimento, mes_referencia, semana_mes,
    numero_monitoria, operador_id, operador_nome, nota_final, zerado, parecer,
    motivo, excluida_por, excluida_por_nome, itens)
  values (
    v_m.id, v_m.protocolo, v_m.data_atendimento, v_m.mes_referencia, v_m.semana_mes,
    v_m.numero_monitoria, v_m.operador_id, v_operador, v_m.nota_final, v_m.zerado,
    v_m.parecer, trim(p_motivo), auth.uid(), coalesce(v_autor, 'sistema'),
    -- As respostas dos critérios vão junto: sem elas não há como refazer a
    -- nota de uma monitoria apagada por engano, porque o cascade as leva.
    (select jsonb_agg(jsonb_build_object(
              'criterio', c.nome, 'conforme', i.conforme, 'observacao', i.observacao))
       from public.monitoria_itens i
       join public.criterios c on c.id = i.criterio_id
      where i.monitoria_id = p_id));

  delete from public.monitorias where id = p_id;
end;
$$;
