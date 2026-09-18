-- ============================================================================
-- Painel de Cota — média do cargo numa consulta só
-- Rode DEPOIS de 20-volume-por-canal.sql. Pode ser executado mais de uma vez.
-- (Sem bloco `do $$`: o SQL Editor do Supabase corta o bloco ao colar.)
--
-- A versão da migração 18 calculava o resultado de cada pessoa do cargo de
-- referência com uma consulta própria ao extrato (~70 ms cada). Com 8 Júniors,
-- a média do Pleno levava ~0,7 s, e a tela inicial ~1,8 s.
--
-- Agora os pontos próprios de todos saem de uma consulta agrupada, e a média
-- que um cargo de referência recebe (quando recebe) é calculada uma vez por
-- cargo, não uma vez por pessoa. O resultado é o mesmo:
--   resultado = pontos próprios + média dos cargos de referência × peso
--   entra na média só quem tem algum ponto no mês.
-- ============================================================================

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
    select c.cargo_id,
           round(public.media_do_cargo(c.cargo_id, p_mes, p_nivel + 1) * pc.peso, 4) as pontos
      from (select distinct cargo_id from alvo) c
      join public.pesos_por_cargo pc
        on pc.cargo_id = c.cargo_id and pc.regra = 'media_da_equipe' and pc.ativo
      join public.regras r on r.chave = 'media_da_equipe' and r.ativo
  )
  select round(avg(coalesce(d.pontos, 0) + coalesce(md.pontos, 0)), 4)
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
