-- ============================================================================
-- Painel de Cota — entrada, saída e registro de quem foi desligado
-- Rode DEPOIS de 21-media-mais-rapida.sql. Pode ser executado mais de uma vez.
--
-- Até aqui o cadastro tinha uma chave só, `ativo`, que misturava duas coisas
-- diferentes: estar na operação e ter login. E não tinha DATA — sem data o
-- painel não distingue um mês inteiro de um mês pela metade.
--
-- Em setembro/2026 isso custou dinheiro: o Bruno Aguiar saiu em 11/09, fechou
-- a competência com uma semana trabalhada (964,75) e esse mês parcial derrubou
-- a média dos Juniores de 3.351,36 para 3.053,03 — menos 358 na Suyara (Pleno)
-- e menos 447 no Gestor. Resolver isso com `ativo` estaria errado: tiraria o
-- Bruno também de agosto, mês que ele trabalhou inteiro e em que ficou ACIMA
-- da média (1.346,50 contra 1.139,74).
--
-- A regra passa a ser: **mês parcial não compõe a média do cargo**, e vale dos
-- dois lados — para quem sai e para quem é admitido no meio da competência.
-- O extrato de quem saiu continua existindo, com os pontos que fez.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Datas de entrada e de saída
--
-- `ativo` continua sendo o acesso ao sistema. Quem é desligado perde o acesso,
-- mas o contrário não vale: alguém pode estar sem login e continuar na
-- operação (quem só é avaliado nas monitorias, por exemplo). Por isso são
-- campos separados.
-- ---------------------------------------------------------------------------
alter table public.pessoas add column if not exists admitido_em  date;
alter table public.pessoas add column if not exists desligado_em date;

comment on column public.pessoas.admitido_em is
  'Entrada na operação. Nulo = já estava antes do painel existir.';
comment on column public.pessoas.desligado_em is
  'Saída da operação. Nulo = continua na equipe.';

-- ---------------------------------------------------------------------------
-- 2. O registro de quem saiu
--
-- O extrato é vivo: se as avaliações de quem saiu forem reatribuídas, o mês
-- dele esvazia e não sobra prova do que produziu. Foi o que aconteceu com
-- setembro do Bruno. Aqui fica a foto tirada no dia da saída — ficha
-- cadastral e o resumo da cota de cada competência — que nada depois altera.
-- ---------------------------------------------------------------------------
create table if not exists public.saidas (
  id                 uuid primary key default uuid_generate_v4(),
  pessoa_id          uuid not null references public.pessoas (id) on delete restrict,
  pessoa_nome        text not null,
  data               date not null,
  motivo             text,
  -- Nome, e-mail, papel, nomes nos relatórios e os cargos que teve.
  ficha              jsonb not null,
  -- Uma linha por competência: cargo, pontos, meta e atingimento.
  cota               jsonb not null,
  registrado_por     uuid references public.pessoas (id) on delete set null,
  registrado_por_nome text,
  registrado_em      timestamptz not null default now(),
  -- Saída desfeita (recontratação ou engano): o registro permanece.
  revertida_em       timestamptz,
  revertida_por_nome text
);

create index if not exists saidas_pessoa_idx on public.saidas (pessoa_id, data desc);

-- ---------------------------------------------------------------------------
-- 3. Registrar a saída
--
-- Num passo só: tira o acesso, grava a data e guarda a foto. Fazer isso em
-- três telas diferentes é como se perde registro.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_saida(
  p_pessoa uuid, p_data date, p_motivo text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid;
  v_nome   text;
  v_ficha  jsonb;
  v_cota   jsonb;
begin
  if not public.eh_gestor() then
    raise exception 'Apenas gestores registram saída.';
  end if;
  if p_data is null then
    raise exception 'Informe a data da saída.';
  end if;

  select nome into v_nome from public.pessoas where id = p_pessoa;
  if v_nome is null then
    raise exception 'Pessoa não encontrada.';
  end if;

  select jsonb_build_object(
           'nome', p.nome, 'email', p.email, 'papel', p.papel,
           'nome_huggy', p.nome_huggy, 'nome_hub', p.nome_hub,
           'admitido_em', p.admitido_em, 'avaliado', p.avaliado,
           'cargos', coalesce((
             select jsonb_agg(jsonb_build_object('desde', cp.desde, 'cargo', c.nome)
                              order by cp.desde)
               from public.cargos_da_pessoa cp
               join public.cargos c on c.id = cp.cargo_id
              where cp.pessoa_id = p.id), '[]'::jsonb))
    into v_ficha
    from public.pessoas p
   where p.id = p_pessoa;

  select coalesce(jsonb_agg(jsonb_build_object(
           'competencia', m.mes_competencia, 'cargo', m.cargo,
           'resultado', m.resultado, 'meta', m.meta, 'atingimento', m.atingimento)
         order by m.mes_competencia), '[]'::jsonb)
    into v_cota
    from public.vw_cota_mensal m
   where m.pessoa_id = p_pessoa;

  insert into public.saidas
    (pessoa_id, pessoa_nome, data, motivo, ficha, cota,
     registrado_por, registrado_por_nome)
  values
    (p_pessoa, v_nome, p_data, nullif(btrim(coalesce(p_motivo, '')), ''), v_ficha, v_cota,
     public.pessoa_atual(),
     (select nome from public.pessoas where id = public.pessoa_atual()))
  returning id into v_id;

  update public.pessoas
     set desligado_em = p_data,
         ativo = false
   where id = p_pessoa;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Desfazer a saída (engano ou recontratação)
--
-- Não apaga o registro: marca como revertido. Histórico que some não serve de
-- respaldo.
-- ---------------------------------------------------------------------------
create or replace function public.reverter_saida(p_pessoa uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.eh_gestor() then
    raise exception 'Apenas gestores revertem uma saída.';
  end if;

  update public.saidas
     set revertida_em = now(),
         revertida_por_nome = (select nome from public.pessoas where id = public.pessoa_atual())
   where pessoa_id = p_pessoa and revertida_em is null;

  update public.pessoas
     set desligado_em = null,
         ativo = true
   where id = p_pessoa;
end;
$$;

revoke all on function public.registrar_saida(uuid, date, text) from public, anon;
revoke all on function public.reverter_saida(uuid) from public, anon;
grant execute on function public.registrar_saida(uuid, date, text) to authenticated;
grant execute on function public.reverter_saida(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Quem compõe a média do cargo
--
-- Só quem trabalhou a competência inteira. O ciclo vai do dia 26 do mês
-- anterior ao dia 25 do mês da competência — o mesmo recorte das semanas.
-- ---------------------------------------------------------------------------
create or replace function public.mes_inteiro_na_operacao(p_pessoa uuid, p_mes date)
returns boolean language sql stable set search_path = public as $$
  select coalesce(
           (p.admitido_em  is null or p.admitido_em  <= (p_mes - interval '1 month')::date + 25)
       and (p.desligado_em is null or p.desligado_em >= p_mes + 24),
         false)
    from public.pessoas p
   where p.id = p_pessoa;
$$;

comment on function public.mes_inteiro_na_operacao(uuid, date) is
  'A pessoa esteve na operação do dia 26 do mês anterior ao dia 25 da competência.';

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

-- ---------------------------------------------------------------------------
-- 6. A tela "Como a média foi formada" precisa saber quem entrou na conta
--
-- Sem isso ela listaria alguém que o cálculo já não usa, e a conta não
-- fecharia na frente do operador. As colunas entram no fim para não quebrar
-- quem lê a view por posição.
-- ---------------------------------------------------------------------------
create or replace view public.vw_cota_mensal with (security_invoker = true) as
  select
    e.pessoa_id,
    p.nome                           as pessoa,
    e.mes_competencia,
    e.cargo,
    sum(e.cota)                      as resultado,
    pm.peso                          as meta,
    round(sum(e.cota) / nullif(pm.peso, 0), 6) as atingimento,
    p.ativo                          as pessoa_ativa,
    public.mes_inteiro_na_operacao(e.pessoa_id, e.mes_competencia) as compoe_media
  from public.vw_extrato_cota e
  join public.pessoas p on p.id = e.pessoa_id
  left join public.pesos_por_cargo pm
    on pm.cargo_id = e.cargo_id and pm.regra = 'meta' and pm.ativo
  group by e.pessoa_id, p.nome, p.ativo, e.mes_competencia, e.cargo, pm.peso;

-- ---------------------------------------------------------------------------
-- 7. Permissões do registro de saída
--
-- Quem vê o time lê; só o gestor escreve. E ninguém apaga: o registro existe
-- para respaldar, então não tem política de exclusão.
-- ---------------------------------------------------------------------------
alter table public.saidas enable row level security;

drop policy if exists saidas_leitura on public.saidas;
create policy saidas_leitura on public.saidas
  for select using (public.ve_o_time());

drop policy if exists saidas_gestor on public.saidas;
create policy saidas_gestor on public.saidas
  for insert with check (public.eh_gestor());
