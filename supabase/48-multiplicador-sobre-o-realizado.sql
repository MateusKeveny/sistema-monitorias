-- ============================================================================
-- 48 · Quem recebe pela média: o multiplicador vale também para o realizado
--
-- Até aqui: pontos diretos (demandas) + média do cargo de referência × peso.
-- Regra correta: (média + pontos diretos) × peso — ex.: Pleno,
-- (média dos Juniores + pontuação realizada) × 1,2.
--
-- No extrato isso vira uma linha a mais, "Multiplicador sobre a pontuação
-- realizada" = pontos diretos × (peso − 1), ao lado da linha da média. A
-- soma das linhas fica (média × peso) + diretos + diretos × (peso − 1) =
-- (média + diretos) × peso. Vale para todo cargo com a regra
-- media_da_equipe ativa (hoje Pleno, 1,2, e Gestor, 1,5 — este não recebe).
--
-- Meses fechados não mudam: o fechamento guarda as linhas da época. O mês
-- em aberto recalcula na hora.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

create or replace view public.vw_extrato_cota with (security_invoker = true) as
  select pessoa_id, mes_competencia, semana, origem, regra, rotulo, grupo, ordem,
         cargo_id, cargo, quantidade, peso, cota
    from public.vw_extrato_direto

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

  -- O mesmo multiplicador sobre a pontuação realizada (os pontos diretos).
  select d.pessoa_id, d.mes_competencia, null::smallint, null::text,
         -- Mesmos tipos da linha da média: a view é trocada no lugar, sem
         -- derrubar as que dependem dela.
         'media_sobre_realizado'::text, 'Multiplicador sobre a pontuação realizada'::text, r.grupo, r.ordem,
         d.cargo_id, d.cargo,
         d.realizado, (pc.peso - 1)::numeric(12,4),
         round(d.realizado * (pc.peso - 1), 4)
    from (
      select pessoa_id, mes_competencia, cargo_id, cargo, sum(cota) as realizado
        from public.vw_extrato_direto
       group by pessoa_id, mes_competencia, cargo_id, cargo
    ) d
    join public.pesos_por_cargo pc
      on pc.cargo_id = d.cargo_id and pc.regra = 'media_da_equipe' and pc.ativo
    join public.regras r on r.chave = 'media_da_equipe' and r.ativo
   where d.realizado <> 0 and pc.peso <> 1;

-- A média de um cargo que usa outro cargo que também recebe pela média
-- (ex.: Gestor sobre Pleno) usa a mesma regra: (média + diretos) × peso.
create or replace function public.media_do_cargo(p_cargo smallint, p_mes date, p_nivel integer default 0)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_media numeric;
begin
  -- Trava extra além do bloqueio de configuração circular.
  if p_nivel > 5 then
    return null;
  end if;

  with membros as (
    select distinct cp.pessoa_id,
           public.cargo_na_competencia(cp.pessoa_id, p_mes) as cargo_id
      from public.cargos_da_pessoa cp
  ),
  alvo as (
    select m.pessoa_id, m.cargo_id
      from membros m
     where m.cargo_id in (select referencia_id from public.cargos_referencia
                           where cargo_id = p_cargo)
       -- Mês parcial (entrou ou saiu no meio) não compõe a média.
       and public.mes_inteiro_na_operacao(m.pessoa_id, p_mes)
  ),
  diretos as (
    select e.pessoa_id, sum(e.cota) as pontos
      from public.vw_extrato_direto e
     where e.mes_competencia = p_mes
       and e.pessoa_id in (select pessoa_id from alvo)
     group by e.pessoa_id
  ),
  -- Quando o cargo de referência também recebe por média, ela é a mesma para
  -- todos daquele cargo: calcula uma vez.
  medias as (
    select c.cargo_id, pc.peso,
           round(public.media_do_cargo(c.cargo_id, p_mes, p_nivel + 1) * pc.peso, 4) as pontos
      from (select distinct cargo_id from alvo) c
      join public.pesos_por_cargo pc
        on pc.cargo_id = c.cargo_id and pc.regra = 'media_da_equipe' and pc.ativo
      join public.regras r on r.chave = 'media_da_equipe' and r.ativo
  )
  select round(avg(coalesce(d.pontos, 0) * coalesce(md.peso, 1) + coalesce(md.pontos, 0)), 4)
    into v_media
    from alvo a
    left join diretos d on d.pessoa_id = a.pessoa_id
    left join medias md on md.cargo_id = a.cargo_id
   where d.pontos is not null or md.pontos is not null;

  return v_media;
end;
$$;

revoke all on function public.media_do_cargo(smallint, date, integer) from public, anon;
grant execute on function public.media_do_cargo(smallint, date, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: setembro da Suyara (Pleno) — antes e agora
-- ---------------------------------------------------------------------------
select
  e.mes_competencia,
  sum(e.cota) filter (where e.regra = 'media_da_equipe')        as media_x_peso,
  sum(e.cota) filter (where e.grupo <> 'media')                 as realizado,
  sum(e.cota) filter (where e.regra = 'media_sobre_realizado')  as multiplicador_no_realizado,
  sum(e.cota)                                                    as total
  from public.vw_extrato_cota e
  join public.pessoas p on p.id = e.pessoa_id
 where p.nome = 'Suyara Martins' and e.mes_competencia = '2026-09-01'
 group by e.mes_competencia;
