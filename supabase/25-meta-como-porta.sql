-- ============================================================================
-- Painel de Cota — a meta é a porta do pagamento
-- Rode DEPOIS de 24-valor-da-cota.sql. Pode ser executado mais de uma vez.
--
-- A meta não é só referência de desempenho: quem fecha a competência abaixo
-- dela não recebe. É para isso que ela existe. A visão da migração 24
-- multiplicava os pontos de todo mundo pelo valor, e mostraria valor a pagar
-- para quem não atingiu — em agosto/2026 seriam cinco pessoas.
--
-- Agora a visão traz `atingiu_meta`, e o valor só é calculado para quem
-- atingiu. Os pontos continuam aparecendo: o extrato de quem não bateu segue
-- inteiro, o que muda é só o pagamento.
-- ============================================================================

-- A coluna nova entra no FIM da lista: `create or replace view` recusa coluna
-- nova no meio, e derrubar a view a cada ajuste é convite a esquecer uma
-- permissão pelo caminho.
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
  base as (
    select mes_competencia, round(avg(resultado), 4) as media_base
      from com_cargo
     where base_do_bonus and mes_inteiro
     group by mes_competencia
  ),
  condicao as (
    select mes_competencia,
           bool_and(meta is not null and resultado >= meta) as todos_bateram,
           count(*) filter (where meta is null or resultado < meta) as quantos_faltaram
      from com_cargo
     where recebe_bonus and mes_inteiro
     group by mes_competencia
  ),
  conta as (
    select cc.*,
           b.media_base,
           coalesce(cd.todos_bateram, false) as bonus_liberado,
           coalesce(cd.quantos_faltaram, 0)  as quantos_faltaram,
           v.valor_por_ponto,
           coalesce(v.percentual_bonus, 0.10) as percentual_bonus,
           (cc.meta is not null and cc.resultado >= cc.meta) as atingiu_meta,
           case
             when cc.recebe_bonus and cc.mes_inteiro and coalesce(cd.todos_bateram, false)
             then round(coalesce(b.media_base, 0) * coalesce(v.percentual_bonus, 0.10), 4)
             else 0
           end as bonus
      from com_cargo cc
      left join base     b  on b.mes_competencia  = cc.mes_competencia
      left join condicao cd on cd.mes_competencia = cc.mes_competencia
      left join public.valores_da_cota v on v.mes_competencia = cc.mes_competencia
  )
  select
    pessoa_id, pessoa_nome, mes_competencia, cargo, resultado, meta,
    mes_inteiro, recebe_bonus, media_base, bonus_liberado, quantos_faltaram,
    valor_por_ponto, percentual_bonus, bonus,
    resultado + bonus as pontos_pagos,
    -- Abaixo da meta não se calcula valor: é para isso que a meta existe.
    case
      when not atingiu_meta          then 0
      when valor_por_ponto is null   then null
      else round((resultado + bonus) * valor_por_ponto, 2)
    end as valor,
    atingiu_meta
  from conta;
