-- ============================================================================
-- 77 · Valor do RH para qualquer pessoa fechada, e remover o valor por ponto
--
-- Corrigindo agosto (22/10/2026), o gestor não conseguia:
--   · informar o valor do RH de quem fechou abaixo da meta — a migração 73 só
--     aceitava quem bateu. Mas o valor do RH é o que o RH mandou pagar: se ele
--     pagou, é isso que vale, e a tela continua mostrando "abaixo da meta" ao
--     lado. Continua exigindo que a pessoa esteja fechada no mês;
--   · apagar o valor por ponto — só dava para corrigir. Agora dá para remover,
--     com motivo, e a remoção vai para o histórico de correções (valor depois
--     vazio). Sem valor por ponto, o pagamento usa só o valor do RH.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo.
-- ============================================================================

create or replace function public.salvar_valores_rh(p_mes date, p_valores jsonb, p_motivo text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_eu    text;
  v_x     jsonb;
  v_p     uuid;
  v_novo  numeric(12,2);
  v_antes numeric(12,2);
  v_n     integer := 0;
begin
  if public.eh_gestor() is not true then raise exception 'Só o gestor informa o valor do RH.'; end if;
  select nome into v_eu from public.pessoas where id = public.pessoa_atual();

  for v_x in select * from jsonb_array_elements(coalesce(p_valores, '[]'::jsonb)) loop
    v_p := (v_x->>'pessoa_id')::uuid;
    v_novo := nullif(v_x->>'valor', '')::numeric;
    if v_novo is not null and v_novo < 0 then raise exception 'Valor negativo não vale.'; end if;
    if v_novo is not null and not exists (
         select 1 from public.fechamentos_cota f where f.pessoa_id = v_p and f.mes_competencia = p_mes) then
      raise exception 'Só quem está fechado no mês recebe valor (%).',
        (select nome from public.pessoas where id = v_p);
    end if;
    select valor into v_antes from public.valores_rh where pessoa_id = v_p and mes_competencia = p_mes;
    if v_antes is not distinct from v_novo then continue; end if;
    if v_antes is not null and nullif(trim(coalesce(p_motivo, '')), '') is null then
      raise exception 'Escreva o motivo: um valor já informado está mudando.';
    end if;

    if v_novo is null then
      delete from public.valores_rh where pessoa_id = v_p and mes_competencia = p_mes;
    else
      insert into public.valores_rh (pessoa_id, mes_competencia, valor, informado_por, informado_por_nome, informado_em)
      values (v_p, p_mes, v_novo, public.pessoa_atual(), v_eu, now())
      on conflict (pessoa_id, mes_competencia) do update
        set valor = excluded.valor, informado_por = excluded.informado_por,
            informado_por_nome = excluded.informado_por_nome, informado_em = now();
    end if;
    insert into public.valores_rh_alteracoes (pessoa_id, pessoa_nome, mes_competencia, valor_anterior, valor_novo, motivo, autor_nome)
    values (v_p, (select nome from public.pessoas where id = v_p), p_mes, v_antes, v_novo, nullif(trim(coalesce(p_motivo, '')), ''), v_eu);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.salvar_valores_rh(date, jsonb, text) from public, anon;
grant execute on function public.salvar_valores_rh(date, jsonb, text) to authenticated;

-- Remove o valor por ponto do mês, com motivo e registro.
create or replace function public.remover_valor_da_cota(p_mes date, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_atual public.valores_da_cota;
begin
  if public.eh_gestor() is not true then raise exception 'Apenas gestores removem o valor da cota.'; end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Remover o valor por ponto exige motivo.';
  end if;
  select * into v_atual from public.valores_da_cota where mes_competencia = p_mes;
  if v_atual.mes_competencia is null then return; end if;

  insert into public.valores_alteracoes
    (mes_competencia, valor_antes, valor_depois, percentual_antes, percentual_depois,
     motivo, alterado_por, alterado_por_nome)
  values
    (p_mes, v_atual.valor_por_ponto, null, v_atual.percentual_bonus, null, btrim(p_motivo),
     public.pessoa_atual(), coalesce((select nome from public.pessoas where id = public.pessoa_atual()), 'sistema'));
  delete from public.valores_da_cota where mes_competencia = p_mes;
end;
$$;
revoke all on function public.remover_valor_da_cota(date, text) from public, anon;
grant execute on function public.remover_valor_da_cota(date, text) to authenticated;

-- Conferência
select (select count(*) from pg_proc where proname in ('salvar_valores_rh', 'remover_valor_da_cota')) as funcoes;
