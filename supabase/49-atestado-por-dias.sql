-- ============================================================================
-- 49 · Atestado calculado pelos dias de afastamento
--
-- Até aqui o atestado era um valor digitado. Agora o gestor lança só os dias
-- (a quantidade do lançamento) e o desconto sai da conta:
--
--   desconto = (pontuação do mês ÷ dias do ciclo) × dias de afastamento
--
-- "Pontuação do mês" é tudo o que a pessoa fez no mês, antes do desconto —
-- para quem recebe pela média, inclui a média e o multiplicador (migração
-- 48). Os dias do ciclo vão do dia 26 do mês anterior ao dia 25 (28 a 31).
-- O desconto acompanha o mês até o fechamento, como as outras linhas.
--
-- A média dos cargos de referência (o que o Pleno recebe) usa a pontuação
-- sem o atestado: o afastamento de um Júnior não reduz o Pleno.
--
-- No extrato a linha mostra: dias × (− pontos por dia) = desconto.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

-- O lançamento de atestado passa a ser em dias, não em pontos digitados.
update public.regras set valor_manual = false, rotulo = 'Atestado (dias de afastamento)'
 where chave = 'atestado';

create or replace view public.vw_extrato_cota with (security_invoker = true) as
  with direto as (
    -- O atestado sai daqui e volta calculado no fim.
    select pessoa_id, mes_competencia, semana, origem, regra, rotulo, grupo, ordem,
           cargo_id, cargo, quantidade, peso, cota
      from public.vw_extrato_direto
     where regra <> 'atestado'
  ),
  media as (
    -- A média do cargo de referência × o peso do cargo.
    select m.pessoa_id, m.mes as mes_competencia, null::smallint as semana, null::text as origem,
           r.chave as regra, r.rotulo, r.grupo, r.ordem,
           c.id as cargo_id, c.nome as cargo,
           x.media as quantidade, pc.peso,
           round(x.media * pc.peso, 4) as cota
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
  ),
  realizado as (
    -- O mesmo multiplicador sobre a pontuação realizada (migração 48).
    select d.pessoa_id, d.mes_competencia, null::smallint as semana, null::text as origem,
           'media_sobre_realizado'::text as regra, 'Multiplicador sobre a pontuação realizada'::text as rotulo,
           r.grupo, r.ordem, d.cargo_id, d.cargo,
           d.realizado as quantidade, (pc.peso - 1)::numeric(12,4) as peso,
           round(d.realizado * (pc.peso - 1), 4) as cota
      from (
        select pessoa_id, mes_competencia, cargo_id, cargo, sum(cota) as realizado
          from direto
         group by pessoa_id, mes_competencia, cargo_id, cargo
      ) d
      join public.pesos_por_cargo pc
        on pc.cargo_id = d.cargo_id and pc.regra = 'media_da_equipe' and pc.ativo
      join public.regras r on r.chave = 'media_da_equipe' and r.ativo
     where d.realizado <> 0 and pc.peso <> 1
  ),
  base as (
    select * from direto
    union all select * from media
    union all select * from realizado
  ),
  atestado as (
    -- Dias lançados no mês (as semanas somadas) e a pontuação do mês sem eles.
    select a.pessoa_id, a.mes_competencia, a.cargo_id, a.cargo, r.rotulo, r.grupo, r.ordem,
           sum(a.quantidade) as dias,
           ((a.mes_competencia + 24) - ((a.mes_competencia - interval '1 month')::date + 25) + 1) as dias_do_ciclo,
           coalesce((select sum(b.cota) from base b
                      where b.pessoa_id = a.pessoa_id and b.mes_competencia = a.mes_competencia), 0) as total
      from public.vw_extrato_direto a
      join public.regras r on r.chave = 'atestado'
     where a.regra = 'atestado'
     group by a.pessoa_id, a.mes_competencia, a.cargo_id, a.cargo, r.rotulo, r.grupo, r.ordem
  )
  select pessoa_id, mes_competencia, semana, origem, regra, rotulo, grupo, ordem,
         cargo_id, cargo, quantidade, peso, cota
    from base

  union all

  select t.pessoa_id, t.mes_competencia, null::smallint, null::text,
         'atestado'::text, t.rotulo, t.grupo, t.ordem, t.cargo_id, t.cargo,
         t.dias,
         -- Pontos por dia arredondados só para exibir; o desconto multiplica antes
         -- de arredondar, para (6.500 ÷ 30) × 3 dar 650 e não 650,0001.
         (- round(t.total / t.dias_do_ciclo, 4))::numeric(12,4),
         - round(t.dias * t.total / t.dias_do_ciclo, 4)
    from atestado t
   where t.dias <> 0;

-- ---------------------------------------------------------------------------
-- Conferência: a conta com o exemplo (6.500 pts, ciclo de 30 dias, 3 dias)
-- e os dias de cada ciclo deste ano
-- ---------------------------------------------------------------------------
select
  - round(3 * 6500.0 / 30, 4) as exemplo_desconto,
  (select valor_manual from public.regras where chave = 'atestado') as atestado_digitado,
  (date '2026-10-01' + 24) - ((date '2026-10-01' - interval '1 month')::date + 25) + 1 as dias_ciclo_outubro;
