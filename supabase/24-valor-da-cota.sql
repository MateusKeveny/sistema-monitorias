-- ============================================================================
-- Painel de Cota — valor por ponto e bônus de equipe
-- Rode DEPOIS de 23-entrada-e-saida.sql. Pode ser executado mais de uma vez.
--
-- O painel para hoje na pontuação. O que a equipe recebe depende de um valor
-- por ponto definido por outra área, que chega até o dia 10 do mês seguinte, e
-- de um bônus coletivo. Nada disso é calculado pelo painel hoje — sai na mão,
-- fora do sistema.
--
-- A regra, como o gestor definiu:
--
--   * o bônus de equipe é 10% da média dos Juniores;
--   * só sai se TODOS os que têm direito baterem a meta — Juniores e Analista.
--     Um que não bate, ninguém recebe;
--   * quem recebe são Júnior e Analista. Pleno e Gestor ficam de fora: eles já
--     recebem a média multiplicada;
--   * só entra na conta quem trabalhou a competência inteira, pela mesma regra
--     de mês parcial da migração 23 — quem entrou ou saiu no meio não soma nem
--     atrapalha;
--   * o valor de cada um é (pontuação + bônus) × valor por ponto.
--
-- Tudo sai do FECHAMENTO, não do extrato ao vivo: o que se paga é o que foi
-- enviado. Mês não fechado não tem valor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Quais cargos entram no bônus
--
-- Em colunas do cargo, e não no nome escrito no código: o nome é editável na
-- tela, e regra de pagamento presa a texto quebra no dia em que alguém
-- renomear um cargo.
-- ---------------------------------------------------------------------------
alter table public.cargos add column if not exists recebe_bonus   boolean not null default false;
alter table public.cargos add column if not exists base_do_bonus  boolean not null default false;

comment on column public.cargos.recebe_bonus is
  'Recebe o bônus de equipe — e precisa bater a meta para que ele saia para todos.';
comment on column public.cargos.base_do_bonus is
  'A média deste cargo é a base do bônus.';

update public.cargos set recebe_bonus = true,  base_do_bonus = true  where nome = 'Atendente Júnior';
update public.cargos set recebe_bonus = true,  base_do_bonus = false where nome = 'Analista';
update public.cargos set recebe_bonus = false, base_do_bonus = false where nome in ('Atendente Pleno', 'Gestor');

-- ---------------------------------------------------------------------------
-- 2. O valor por ponto de cada competência
--
-- Uma linha por mês. O percentual do bônus fica junto porque é da mesma
-- natureza: número de fora, que pode mudar sem ser um recurso novo do sistema.
-- ---------------------------------------------------------------------------
create table if not exists public.valores_da_cota (
  mes_competencia   date primary key,
  valor_por_ponto   numeric(12,6) not null check (valor_por_ponto >= 0),
  percentual_bonus  numeric(6,4)  not null default 0.10 check (percentual_bonus >= 0),
  observacao        text,
  definido_por      uuid references public.pessoas (id) on delete set null,
  definido_por_nome text,
  definido_em       timestamptz not null default now(),
  atualizado_em     timestamptz
);

-- ---------------------------------------------------------------------------
-- 3. Histórico de alteração do valor
--
-- Mesmo princípio do ajuste de fechamento (migração 22): valor que remunera
-- não muda sem deixar rastro de quem mudou, quando e por quê.
-- ---------------------------------------------------------------------------
create table if not exists public.valores_alteracoes (
  id               bigint generated always as identity primary key,
  mes_competencia  date not null,
  valor_antes      numeric(12,6),
  valor_depois     numeric(12,6),
  percentual_antes numeric(6,4),
  percentual_depois numeric(6,4),
  motivo           text not null,
  alterado_por     uuid references public.pessoas (id) on delete set null,
  alterado_por_nome text,
  alterado_em      timestamptz not null default now()
);

create index if not exists valores_alteracoes_idx
  on public.valores_alteracoes (mes_competencia, alterado_em desc);

-- ---------------------------------------------------------------------------
-- 4. Definir o valor
--
-- O primeiro registro do mês é livre. Alterar exige motivo, e a alteração vai
-- para o histórico.
-- ---------------------------------------------------------------------------
create or replace function public.definir_valor_da_cota(
  p_mes date, p_valor numeric, p_percentual numeric default 0.10,
  p_motivo text default null, p_observacao text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_atual public.valores_da_cota;
  v_nome  text;
begin
  if not public.eh_gestor() then
    raise exception 'Apenas gestores definem o valor da cota.';
  end if;
  if p_valor is null or p_valor < 0 then
    raise exception 'Informe um valor por ponto maior ou igual a zero.';
  end if;

  select nome into v_nome from public.pessoas where id = public.pessoa_atual();
  select * into v_atual from public.valores_da_cota where mes_competencia = p_mes;

  if v_atual.mes_competencia is null then
    insert into public.valores_da_cota
      (mes_competencia, valor_por_ponto, percentual_bonus, observacao,
       definido_por, definido_por_nome)
    values
      (p_mes, p_valor, coalesce(p_percentual, 0.10), nullif(btrim(coalesce(p_observacao, '')), ''),
       public.pessoa_atual(), coalesce(v_nome, 'sistema'));
    return;
  end if;

  if v_atual.valor_por_ponto = p_valor
     and v_atual.percentual_bonus = coalesce(p_percentual, v_atual.percentual_bonus) then
    return;
  end if;

  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Alterar um valor já definido exige motivo.';
  end if;

  insert into public.valores_alteracoes
    (mes_competencia, valor_antes, valor_depois, percentual_antes, percentual_depois,
     motivo, alterado_por, alterado_por_nome)
  values
    (p_mes, v_atual.valor_por_ponto, p_valor,
     v_atual.percentual_bonus, coalesce(p_percentual, v_atual.percentual_bonus),
     btrim(p_motivo), public.pessoa_atual(), coalesce(v_nome, 'sistema'));

  update public.valores_da_cota
     set valor_por_ponto  = p_valor,
         percentual_bonus = coalesce(p_percentual, percentual_bonus),
         observacao       = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao),
         atualizado_em    = now()
   where mes_competencia = p_mes;
end;
$$;

revoke all on function public.definir_valor_da_cota(date, numeric, numeric, text, text) from public, anon;
grant execute on function public.definir_valor_da_cota(date, numeric, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. O que cada pessoa recebe na competência fechada
--
-- O cargo NÃO vem do texto guardado no fechamento: vem de
-- `cargo_na_competencia`, para a regra sobreviver a um cargo renomeado.
-- ---------------------------------------------------------------------------
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
  -- A base do bônus: média de quem forma a referência e trabalhou o mês todo.
  base as (
    select mes_competencia, round(avg(resultado), 4) as media_base
      from com_cargo
     where base_do_bonus and mes_inteiro
     group by mes_competencia
  ),
  -- A condição: todos os que têm direito bateram a meta. Um que não bate,
  -- ninguém recebe.
  condicao as (
    select mes_competencia,
           bool_and(meta is not null and resultado >= meta) as todos_bateram,
           count(*) filter (where meta is null or resultado < meta) as quantos_faltaram
      from com_cargo
     where recebe_bonus and mes_inteiro
     group by mes_competencia
  )
  select
    cc.pessoa_id,
    cc.pessoa_nome,
    cc.mes_competencia,
    cc.cargo,
    cc.resultado,
    cc.meta,
    cc.mes_inteiro,
    cc.recebe_bonus,
    b.media_base,
    coalesce(cd.todos_bateram, false)                        as bonus_liberado,
    coalesce(cd.quantos_faltaram, 0)                         as quantos_faltaram,
    v.valor_por_ponto,
    coalesce(v.percentual_bonus, 0.10)                       as percentual_bonus,
    case
      when cc.recebe_bonus and cc.mes_inteiro and coalesce(cd.todos_bateram, false)
      then round(coalesce(b.media_base, 0) * coalesce(v.percentual_bonus, 0.10), 4)
      else 0
    end                                                      as bonus,
    cc.resultado + case
      when cc.recebe_bonus and cc.mes_inteiro and coalesce(cd.todos_bateram, false)
      then round(coalesce(b.media_base, 0) * coalesce(v.percentual_bonus, 0.10), 4)
      else 0
    end                                                      as pontos_pagos,
    case when v.valor_por_ponto is null then null else
      round((cc.resultado + case
        when cc.recebe_bonus and cc.mes_inteiro and coalesce(cd.todos_bateram, false)
        then round(coalesce(b.media_base, 0) * coalesce(v.percentual_bonus, 0.10), 4)
        else 0
      end) * v.valor_por_ponto, 2)
    end                                                      as valor
  from com_cargo cc
  left join base     b  on b.mes_competencia  = cc.mes_competencia
  left join condicao cd on cd.mes_competencia = cc.mes_competencia
  left join public.valores_da_cota v on v.mes_competencia = cc.mes_competencia;

-- ---------------------------------------------------------------------------
-- 6. Permissões
--
-- O valor por ponto é o mesmo para todos e o operador precisa dele para
-- conferir o próprio cálculo: leitura liberada a quem está logado. O
-- pagamento de cada um segue a regra das demais telas — o operador vê o seu,
-- quem enxerga o time vê todos —, e isso vem da RLS de `fechamentos_cota`,
-- porque a view roda com a permissão de quem consulta.
-- ---------------------------------------------------------------------------
alter table public.valores_da_cota enable row level security;
drop policy if exists valores_leitura on public.valores_da_cota;
create policy valores_leitura on public.valores_da_cota
  for select using (public.papel_atual() is not null);
drop policy if exists valores_gestor on public.valores_da_cota;
create policy valores_gestor on public.valores_da_cota
  for all using (public.eh_gestor()) with check (public.eh_gestor());

alter table public.valores_alteracoes enable row level security;
drop policy if exists valores_alteracoes_leitura on public.valores_alteracoes;
create policy valores_alteracoes_leitura on public.valores_alteracoes
  for select using (public.ve_o_time());
