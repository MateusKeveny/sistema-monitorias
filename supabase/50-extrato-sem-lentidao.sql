-- ============================================================================
-- 50 · Correção: extrato lento depois da migração 49
--
-- A 49 montou a vw_extrato_cota com CTEs usadas duas vezes ("direto" e
-- "base"). O Postgres materializa CTE usada mais de uma vez: cada consulta,
-- mesmo de uma pessoa e um mês, calculava o extrato de todos em todos os
-- meses — e o "Fechar setembro" estourou o tempo do banco (statement timeout).
--
-- Volta a estrutura da 48 (partes unidas, com o filtro chegando a cada uma) e
-- o atestado sai de uma função chamada só nas linhas de atestado, que soma a
-- pontuação do mês daquela pessoa direto das fontes. A regra é a mesma da 49:
-- desconto = (pontuação do mês, antes do atestado ÷ dias do ciclo) × dias.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

-- Pontuação do mês de uma pessoa antes do atestado: diretos + média × peso +
-- multiplicador sobre o realizado — as mesmas linhas da view, com o mesmo
-- arredondamento.
create or replace function public.pontuacao_antes_do_atestado(p_pessoa uuid, p_mes date)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_cargo   smallint := public.cargo_na_competencia(p_pessoa, p_mes);
  v_direto  numeric;
  v_peso    numeric;
  v_media   numeric;
begin
  select coalesce(sum(cota), 0) into v_direto
    from public.vw_extrato_direto
   where pessoa_id = p_pessoa and mes_competencia = p_mes and regra <> 'atestado';

  select pc.peso into v_peso
    from public.pesos_por_cargo pc
    join public.regras r on r.chave = 'media_da_equipe' and r.ativo
   where pc.cargo_id = v_cargo and pc.regra = 'media_da_equipe' and pc.ativo;

  if v_peso is null then
    return v_direto;
  end if;

  v_media := public.media_do_cargo(v_cargo, p_mes);
  return v_direto
       + coalesce(round(v_media * v_peso, 4), 0)
       + case when v_direto <> 0 and v_peso <> 1 then round(v_direto * (v_peso - 1), 4) else 0 end;
end;
$$;

revoke all on function public.pontuacao_antes_do_atestado(uuid, date) from public, anon;
grant execute on function public.pontuacao_antes_do_atestado(uuid, date) to authenticated;

create or replace view public.vw_extrato_cota with (security_invoker = true) as
  -- Linhas diretas, menos o atestado, que volta calculado no fim.
  select pessoa_id, mes_competencia, semana, origem, regra, rotulo, grupo, ordem,
         cargo_id, cargo, quantidade, peso, cota
    from public.vw_extrato_direto
   where regra <> 'atestado'

  union all

  -- A média do cargo de referência × o peso do cargo.
  select m.pessoa_id, m.mes, null::smallint, null::text,
         r.chave, r.rotulo, r.grupo, r.ordem,
         c.id, c.nome,
         x.media, pc.peso,
         round(x.media * pc.peso, 4)
    from (
      select distinct cp.pessoa_id, cp.cargo_id, g.mes::date as mes
        from public.cargos_da_pessoa cp
       cross join lateral generate_series(
               cp.desde, public.mes_de_competencia(current_date), interval '1 month') g (mes)
       where public.cargo_na_competencia(cp.pessoa_id, g.mes::date) = cp.cargo_id
    ) m
    join public.cargos c on c.id = m.cargo_id
    join public.pesos_por_cargo pc
      on pc.cargo_id = c.id and pc.regra = 'media_da_equipe' and pc.ativo
    join public.regras r on r.chave = 'media_da_equipe' and r.ativo
    cross join lateral (select public.media_do_cargo(c.id, m.mes) as media) x
   where x.media is not null

  union all

  -- O mesmo multiplicador sobre a pontuação realizada (migração 48).
  select d.pessoa_id, d.mes_competencia, null::smallint, null::text,
         'media_sobre_realizado'::text, 'Multiplicador sobre a pontuação realizada'::text, r.grupo, r.ordem,
         d.cargo_id, d.cargo,
         d.realizado, (pc.peso - 1)::numeric(12,4),
         round(d.realizado * (pc.peso - 1), 4)
    from (
      select pessoa_id, mes_competencia, cargo_id, cargo, sum(cota) as realizado
        from public.vw_extrato_direto
       where regra <> 'atestado'
       group by pessoa_id, mes_competencia, cargo_id, cargo
    ) d
    join public.pesos_por_cargo pc
      on pc.cargo_id = d.cargo_id and pc.regra = 'media_da_equipe' and pc.ativo
    join public.regras r on r.chave = 'media_da_equipe' and r.ativo
   where d.realizado <> 0 and pc.peso <> 1

  union all

  -- Atestado (migração 49): dias × (− pontos por dia); a pontuação do mês só
  -- é calculada para quem tem atestado lançado.
  select a.pessoa_id, a.mes_competencia, null::smallint, null::text,
         'atestado'::text, a.rotulo, a.grupo, a.ordem, a.cargo_id, a.cargo,
         a.dias,
         (- round(t.total / a.dias_do_ciclo, 4))::numeric(12,4),
         - round(a.dias * t.total / a.dias_do_ciclo, 4)
    from (
      select e.pessoa_id, e.mes_competencia, e.cargo_id, e.cargo, e.rotulo, e.grupo, e.ordem,
             sum(e.quantidade) as dias,
             ((e.mes_competencia + 24) - ((e.mes_competencia - interval '1 month')::date + 25) + 1) as dias_do_ciclo
        from public.vw_extrato_direto e
       where e.regra = 'atestado'
       group by e.pessoa_id, e.mes_competencia, e.cargo_id, e.cargo, e.rotulo, e.grupo, e.ordem
    ) a
    cross join lateral (select public.pontuacao_antes_do_atestado(a.pessoa_id, a.mes_competencia) as total) t
   where a.dias <> 0;

-- ---------------------------------------------------------------------------
-- Conferência: o extrato de setembro inteiro volta a responder rápido, e o
-- total da Suyara segue o da migração 48 (8.223,63).
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.vw_extrato_cota where mes_competencia = '2026-09-01') as linhas_de_setembro,
  (select round(sum(e.cota), 2) from public.vw_extrato_cota e join public.pessoas p on p.id = e.pessoa_id
    where p.nome = 'Suyara Martins' and e.mes_competencia = '2026-09-01') as total_suyara;
