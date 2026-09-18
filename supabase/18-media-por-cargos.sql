-- ============================================================================
-- Painel de Cota — "recebe por média" como configuração do cargo
-- Rode DEPOIS de 17-pleno-e-analista.sql. Pode ser executado mais de uma vez.
--
-- A 17 permitia UM cargo de referência. Agora cada cargo escolhe QUAIS cargos
-- compõem a sua média:
--   Atendente Pleno — média dos Atendentes Júnior
--   Gestor          — média de Júnior e Analista, × 1,5 (+50%). O Pleno não
--                     compõe a média do Gestor no cenário atual.
-- Cargo sem nenhuma referência não recebe por média.
-- ============================================================================

-- As views e a função antiga dependem da coluna que vai sair.
drop view if exists public.vw_cota_mensal;
drop view if exists public.vw_extrato_cota;
drop function if exists public.media_do_cargo(smallint, date);

-- ---------------------------------------------------------------------------
-- 1. Quais cargos compõem a média de cada cargo
-- ---------------------------------------------------------------------------
create table if not exists public.cargos_referencia (
  cargo_id      smallint not null references public.cargos (id) on delete cascade,
  referencia_id smallint not null references public.cargos (id) on delete restrict,
  primary key (cargo_id, referencia_id),
  check (cargo_id <> referencia_id)
);

-- Bloqueia configuração circular (A recebe a média de B, B recebe a de A):
-- o cálculo nunca terminaria.
create or replace function public.impedir_ciclo_de_media()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (
    with recursive cadeia (id) as (
      select new.referencia_id
      union
      select r.referencia_id
        from public.cargos_referencia r
        join cadeia c on r.cargo_id = c.id
    )
    select 1 from cadeia where id = new.cargo_id
  ) then
    raise exception 'Configuração circular: um cargo não pode compor a média de quem compõe a dele.';
  end if;
  return new;
end;
$$;

drop trigger if exists cargos_referencia_sem_ciclo on public.cargos_referencia;
create trigger cargos_referencia_sem_ciclo
  before insert or update on public.cargos_referencia
  for each row execute function public.impedir_ciclo_de_media();

-- Traz a configuração da 17 e remove a coluna antiga.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'cargos'
                and column_name = 'media_de_cargo_id') then
    insert into public.cargos_referencia (cargo_id, referencia_id)
    select id, media_de_cargo_id from public.cargos
     where media_de_cargo_id is not null
    on conflict do nothing;
    alter table public.cargos drop column media_de_cargo_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Cargo Gestor: média de Júnior e Analista, × 1,5
--
-- Na primeira execução o Gestor nasceu com o Pleno na média e multiplicador
-- 1,0; o `delete` e o `update` do fim desta seção corrigem quem já rodou.
-- ---------------------------------------------------------------------------
insert into public.cargos (nome, ordem)
values ('Gestor', 4)
on conflict (nome) do nothing;

insert into public.cargos_referencia (cargo_id, referencia_id)
select g.id, c.id
  from public.cargos g
  join public.cargos c on c.nome in ('Atendente Júnior', 'Analista')
 where g.nome = 'Gestor'
on conflict do nothing;

insert into public.pesos_por_cargo (cargo_id, regra, peso, ativo)
select c.id, v.regra, v.peso, true
  from public.cargos c
  join (values ('meta', 5000), ('media_da_equipe', 1.5)) as v (regra, peso) on true
 where c.nome = 'Gestor'
on conflict (cargo_id, regra) do nothing;

delete from public.cargos_referencia
 where cargo_id      = (select id from public.cargos where nome = 'Gestor')
   and referencia_id = (select id from public.cargos where nome = 'Atendente Pleno');

update public.pesos_por_cargo
   set peso = 1.5, atualizado_em = now()
 where cargo_id = (select id from public.cargos where nome = 'Gestor')
   and regra = 'media_da_equipe'
   and peso = 1.0;

update public.regras set rotulo = 'Média dos cargos de referência'
 where chave = 'media_da_equipe';

-- ---------------------------------------------------------------------------
-- 3. O cálculo encadeado
--
-- resultado_do_mes = pontos próprios + (média dos cargos de referência × peso)
-- media_do_cargo   = média do resultado_do_mes de quem está nos cargos de
--                    referência e pontuou no mês
--
-- Uma chama a outra: a média do Gestor usa o resultado COMPLETO do Pleno, que
-- já inclui a média dos Júniors. O `p_nivel` é uma trava extra além do
-- bloqueio de ciclo.
--
-- `security definer`: a média precisa enxergar a equipe inteira, mesmo quando
-- quem consulta só pode ver a própria linha. Devolve só o agregado.
-- ---------------------------------------------------------------------------
create or replace function public.resultado_do_mes(p_pessoa uuid, p_mes date, p_nivel integer default 0)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare
  v_cargo  smallint;
  v_direto numeric;
  v_peso   numeric;
  v_media  numeric;
begin
  if p_nivel > 5 then
    return null;
  end if;

  v_cargo := public.cargo_na_competencia(p_pessoa, p_mes);
  if v_cargo is null then
    return null;
  end if;

  select sum(cota) into v_direto
    from public.vw_extrato_direto
   where pessoa_id = p_pessoa and mes_competencia = p_mes;

  select pc.peso into v_peso
    from public.pesos_por_cargo pc
    join public.regras r on r.chave = pc.regra and r.ativo
   where pc.cargo_id = v_cargo and pc.regra = 'media_da_equipe' and pc.ativo;

  if v_peso is not null then
    v_media := public.media_do_cargo(v_cargo, p_mes, p_nivel + 1);
  end if;

  if v_direto is null and v_media is null then
    return null;
  end if;

  return coalesce(v_direto, 0) + coalesce(round(v_media * v_peso, 4), 0);
end;
$$;

create or replace function public.media_do_cargo(p_cargo smallint, p_mes date, p_nivel integer default 0)
returns numeric language sql stable security definer set search_path = public as $$
  select round(avg(res), 4)
    from (
      select public.resultado_do_mes(cp.pessoa_id, p_mes, p_nivel) as res
        from (select distinct pessoa_id from public.cargos_da_pessoa) cp
       where public.cargo_na_competencia(cp.pessoa_id, p_mes) in (
               select referencia_id from public.cargos_referencia where cargo_id = p_cargo)
    ) x
   where res is not null;
$$;

revoke all on function public.resultado_do_mes(uuid, date, integer) from public, anon;
grant execute on function public.resultado_do_mes(uuid, date, integer) to authenticated;
revoke all on function public.media_do_cargo(smallint, date, integer) from public, anon;
grant execute on function public.media_do_cargo(smallint, date, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Extrato e cota mensal, recriados sobre a nova configuração
-- ---------------------------------------------------------------------------
create view public.vw_extrato_cota with (security_invoker = true) as
  select pessoa_id, mes_competencia, semana, origem, regra, rotulo, grupo, ordem,
         cargo_id, cargo, quantidade, peso, cota
    from public.vw_extrato_direto

  union all

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
   where x.media is not null;

create view public.vw_cota_mensal with (security_invoker = true) as
  select
    e.pessoa_id,
    p.nome                           as pessoa,
    e.mes_competencia,
    e.cargo,
    sum(e.cota)                      as resultado,
    pm.peso                          as meta,
    round(sum(e.cota) / nullif(pm.peso, 0), 6) as atingimento
  from public.vw_extrato_cota e
  join public.pessoas p on p.id = e.pessoa_id
  left join public.pesos_por_cargo pm
    on pm.cargo_id = e.cargo_id and pm.regra = 'meta' and pm.ativo
  group by e.pessoa_id, p.nome, e.mes_competencia, e.cargo, pm.peso;

-- ---------------------------------------------------------------------------
-- 5. Permissões da nova tabela
-- ---------------------------------------------------------------------------
alter table public.cargos_referencia enable row level security;
drop policy if exists cargos_referencia_leitura on public.cargos_referencia;
create policy cargos_referencia_leitura on public.cargos_referencia
  for select using (public.papel_atual() is not null);
drop policy if exists cargos_referencia_gestor on public.cargos_referencia;
create policy cargos_referencia_gestor on public.cargos_referencia
  for all using (public.eh_gestor()) with check (public.eh_gestor());
