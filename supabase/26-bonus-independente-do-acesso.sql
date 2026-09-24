-- ============================================================================
-- Painel de Cota — o bônus não pode depender de quem está olhando
-- Rode DEPOIS de 25-meta-como-porta.sql. Pode ser executado mais de uma vez.
--
-- `vw_pagamento_mensal` roda com a permissão de quem consulta (security
-- invoker), e é assim que cada pessoa vê só a própria linha. Só que a média do
-- bônus e a condição "todos bateram a meta" eram calculadas DENTRO da view,
-- sobre as linhas visíveis:
--
--   * o gestor enxerga a equipe inteira e via a conta certa;
--   * o operador enxerga só a si mesmo — e a condição olhava uma pessoa só.
--     Quem tivesse batido a meta veria o bônus liberado e um valor maior do
--     que o real. Rafael, em agosto/2026: R$ 196,06 na tela dele contra os
--     R$ 178,23 que o gestor vê.
--
-- A conta coletiva passa para uma função `security definer`: ela enxerga a
-- competência inteira e devolve só três números agregados — média, se o bônus
-- saiu e quantos faltaram. Nenhum resultado individual de colega vaza por ela.
-- ============================================================================

create or replace function public.bonus_da_competencia(p_mes date)
returns table (media_base numeric, todos_bateram boolean, quantos_faltaram integer)
language sql stable security definer set search_path = public as $$
  with com_cargo as (
    select f.resultado, f.meta, c.recebe_bonus, c.base_do_bonus,
           public.mes_inteiro_na_operacao(f.pessoa_id, f.mes_competencia) as mes_inteiro
      from public.fechamentos_cota f
      join public.cargos c
        on c.id = public.cargo_na_competencia(f.pessoa_id, f.mes_competencia)
     where f.mes_competencia = p_mes
  )
  select
    (select round(avg(resultado), 4) from com_cargo where base_do_bonus and mes_inteiro),
    coalesce((select bool_and(meta is not null and resultado >= meta)
                from com_cargo where recebe_bonus and mes_inteiro), false),
    coalesce((select count(*) filter (where meta is null or resultado < meta)
                from com_cargo where recebe_bonus and mes_inteiro), 0)::integer;
$$;

revoke all on function public.bonus_da_competencia(date) from public, anon;
grant execute on function public.bonus_da_competencia(date) to authenticated;

-- A view continua security invoker: quem vê quais linhas não muda. O que muda
-- é de onde vêm os três números coletivos.
create or replace view public.vw_pagamento_mensal with (security_invoker = true) as
  with fechado as (
    select f.pessoa_id, f.pessoa_nome, f.mes_competencia, f.resultado, f.meta,
           public.cargo_na_competencia(f.pessoa_id, f.mes_competencia) as cargo_id,
           public.mes_inteiro_na_operacao(f.pessoa_id, f.mes_competencia) as mes_inteiro
      from public.fechamentos_cota f
  ),
  com_cargo as (
    select fc.*, c.nome as cargo, c.recebe_bonus, c.base_do_bonus
      from fechado fc
      join public.cargos c on c.id = fc.cargo_id
  ),
  conta as (
    select cc.*,
           col.media_base,
           col.todos_bateram   as bonus_liberado,
           col.quantos_faltaram,
           v.valor_por_ponto,
           coalesce(v.percentual_bonus, 0.10) as percentual_bonus,
           (cc.meta is not null and cc.resultado >= cc.meta) as atingiu_meta,
           case
             when cc.recebe_bonus and cc.mes_inteiro and col.todos_bateram
             then round(coalesce(col.media_base, 0) * coalesce(v.percentual_bonus, 0.10), 4)
             else 0
           end as bonus
      from com_cargo cc
      cross join lateral public.bonus_da_competencia(cc.mes_competencia) col
      left join public.valores_da_cota v on v.mes_competencia = cc.mes_competencia
  )
  select
    pessoa_id, pessoa_nome, mes_competencia, cargo, resultado, meta,
    mes_inteiro, recebe_bonus, media_base, bonus_liberado, quantos_faltaram,
    valor_por_ponto, percentual_bonus, bonus,
    resultado + bonus as pontos_pagos,
    -- Abaixo da meta não se calcula valor: é para isso que a meta existe.
    case
      when not atingiu_meta        then 0
      when valor_por_ponto is null then null
      else round((resultado + bonus) * valor_por_ponto, 2)
    end as valor,
    atingiu_meta
  from conta;
