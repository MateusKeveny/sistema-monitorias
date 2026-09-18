-- ============================================================================
-- Painel de Cota — regras do Atendente Pleno e do Analista
-- Rode DEPOIS de 13-calculo-da-cota.sql. Pode ser executado mais de uma vez.
--
--   Atendente Júnior — pontuado em todas as regras do Huggy, C-SAT, notas,
--                      monitoria e lançamentos.
--   Atendente Pleno  — recebe a MÉDIA dos resultados dos Júniors no mês × um
--                      multiplicador (hoje 1,2, os "20%"). Exemplo do gestor:
--                      Allana 4.500, Bruno 4.000, Rafael 5.000 → média 4.500
--                      → 4.500 × 1,2 = 5.400. As demandas extras que forem
--                      cadastradas para o cargo somam por cima.
--   Analista         — soma de lançamentos manuais de chamados. Meta 5.000.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Qual cargo serve de referência para a média
--
-- Fica no cargo, não escrito no cálculo: se amanhã existir um "Pleno II" que
-- recebe a média dos Plenos, é uma configuração, não código novo.
-- ---------------------------------------------------------------------------
alter table public.cargos
  add column if not exists media_de_cargo_id smallint references public.cargos (id);

update public.cargos p
   set media_de_cargo_id = j.id
  from public.cargos j
 where p.nome = 'Atendente Pleno' and j.nome = 'Atendente Júnior';

-- ---------------------------------------------------------------------------
-- 2. Regras novas no catálogo
--
-- `media_da_equipe` guarda o MULTIPLICADOR (1,2), não o percentual (20%). Assim
-- a linha do extrato continua sendo quantidade × peso como todas as outras —
-- quantidade = média dos Júniors, peso = 1,2 — e a tela exibe como +20%.
-- ---------------------------------------------------------------------------
insert into public.regras (chave, grupo, rotulo, peso, faixa_min, faixa_max, ordem, manual, ativo)
values
  ('media_da_equipe',       'media',   'Média do cargo de referência', 1.2, null, null,  5, false, true),
  ('chamados_tratados',     'manual',  'Tratativas de chamados',        20, null, null, 90, true,  true),
  ('chamados_sla_ate_2d',   'manual',  'SLA menor ou igual a 2 dias',    5, null, null, 91, true,  true),
  ('chamados_sla_acima_2d', 'manual',  'SLA maior que 2 dias',          -5, null, null, 92, true,  true)
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Pesos por cargo
--
-- O Júnior recebe as regras novas DESLIGADAS, de propósito: a migração 12
-- semeia o Júnior cruzando com todas as regras, e rodá-la de novo daria a ele
-- pontos por chamado. Com a linha já existente e inativa, o `on conflict do
-- nothing` de lá não a liga.
-- ---------------------------------------------------------------------------
insert into public.pesos_por_cargo (cargo_id, regra, peso, ativo)
select c.id, r.chave, r.peso, false
  from public.cargos c
  join public.regras r on r.chave in ('media_da_equipe', 'chamados_tratados',
                                      'chamados_sla_ate_2d', 'chamados_sla_acima_2d')
 where c.nome = 'Atendente Júnior'
on conflict (cargo_id, regra) do nothing;

insert into public.pesos_por_cargo (cargo_id, regra, peso, ativo)
select c.id, v.regra, v.peso, true
  from public.cargos c
  join (values
    ('Atendente Pleno', 'meta',                  5000),
    ('Atendente Pleno', 'media_da_equipe',        1.2),
    ('Analista',        'meta',                  5000),
    ('Analista',        'chamados_tratados',       20),
    ('Analista',        'chamados_sla_ate_2d',      5),
    ('Analista',        'chamados_sla_acima_2d',   -5)
  ) as v (cargo, regra, peso) on v.cargo = c.nome
on conflict (cargo_id, regra) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Quem está em cada cargo
-- ---------------------------------------------------------------------------
insert into public.cargos_da_pessoa (pessoa_id, desde, cargo_id)
select p.id, date '2026-01-01', c.id
  from (values ('Suyara Martins', 'Atendente Pleno'),
               ('Matheus Camargo', 'Analista')) as v (pessoa, cargo)
  join public.pessoas p on p.nome = v.pessoa
  join public.cargos  c on c.nome = v.cargo
on conflict (pessoa_id, desde) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Média do cargo, calculada sobre a equipe inteira
--
-- `security definer` pelo mesmo motivo de `vw_tme_equipe`: com a RLS, a
-- Suyara enxergaria só a própria linha, e a "média dos Júniors" seria calculada
-- sobre ninguém. Devolve só o agregado.
--
-- Lê `vw_extrato_direto` — os pontos próprios, SEM a linha de média. Se lesse
-- o extrato completo, a média chamaria a si mesma.
-- ---------------------------------------------------------------------------
drop view if exists public.vw_cota_mensal;
drop view if exists public.vw_extrato_cota;

create or replace view public.vw_extrato_direto with (security_invoker = true) as
  select q.pessoa_id, q.mes_competencia, q.semana, q.origem,
         q.regra, r.rotulo, r.grupo, r.ordem,
         c.id   as cargo_id,
         c.nome as cargo,
         q.quantidade,
         pc.peso,
         case
           -- Valor digitado pelo gestor vence a multiplicação.
           when q.pontos_manuais is not null then q.pontos_manuais
           -- Monitoria: pontua só com média acima do mínimo (85%).
           when r.grupo = 'monitoria' then
             case when q.quantidade > r.faixa_min
                  then round(q.quantidade * pc.peso, 4) else 0 end
           else round(q.quantidade * pc.peso, 4)
         end as cota
    from public.vw_extrato_quantidades q
    join public.regras r on r.chave = q.regra
    join public.cargos c
      on c.id = public.cargo_na_competencia(q.pessoa_id, q.mes_competencia)
    join public.pesos_por_cargo pc
      on pc.cargo_id = c.id and pc.regra = q.regra and pc.ativo;

-- Média dos resultados mensais de quem estava no cargo naquela competência.
-- Só entra quem pontuou no mês: Júnior sem nenhum dado não puxa a média a zero.
create or replace function public.media_do_cargo(p_cargo smallint, p_mes date)
returns numeric language sql stable security definer set search_path = public as $$
  select round(avg(pontos), 4)
    from (select pessoa_id, sum(cota) as pontos
            from public.vw_extrato_direto
           where cargo_id = p_cargo and mes_competencia = p_mes
           group by pessoa_id) x;
$$;

revoke all on function public.media_do_cargo(smallint, date) from public, anon;
grant execute on function public.media_do_cargo(smallint, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. O extrato completo = pontos próprios + linha de média
--
-- A média entra como UMA LINHA do extrato (semana vazia = do mês), e não como
-- conta separada no resultado. Isso mantém a regra da migração 13: a cota é a
-- soma do extrato, e o fechamento congela a linha junto — daqui a seis meses
-- dá para ver que a Suyara recebeu 4.500 × 1,2, não só "5.400".
--
-- Os meses vêm da vigência do cargo, não dos dados da própria pessoa: o Pleno
-- pode não ter nenhum lançamento no mês e ainda assim receber a média.
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
    join public.cargos c on c.id = m.cargo_id and c.media_de_cargo_id is not null
    join public.pesos_por_cargo pc
      on pc.cargo_id = c.id and pc.regra = 'media_da_equipe' and pc.ativo
    join public.regras r on r.chave = 'media_da_equipe' and r.ativo
    cross join lateral (select public.media_do_cargo(c.media_de_cargo_id, m.mes) as media) x
   where x.media is not null;

-- Idêntica à da migração 13; recriada porque dependia do extrato.
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
-- 7. Alerta de "sem cargo" ignora gestores
--
-- A Luciana e o Mateus têm avaliações do Huggy em agosto, mas não recebem
-- cota. Alerta que dispara sempre é alerta que ninguém lê.
-- ---------------------------------------------------------------------------
create or replace view public.vw_sem_cargo with (security_invoker = true) as
  select distinct d.pessoa_id, p.nome, d.mes_competencia
    from (
      select pessoa_id, mes_competencia from public.volume_semanal
      union select pessoa_id, mes_competencia from public.vw_avaliacoes_validas
      union select pessoa_id, mes_competencia from public.lancamentos
      union select operador_id, mes_referencia from public.monitorias
    ) d
    join public.pessoas p on p.id = d.pessoa_id
   where p.papel <> 'gestor'
     and public.cargo_na_competencia(d.pessoa_id, d.mes_competencia) is null;

-- ---------------------------------------------------------------------------
-- 8. Conferência dos chamados
--
-- Mesma lógica dos diretores: todo chamado tratado cai em uma das duas faixas
-- de SLA, então as faixas somadas têm que dar o total. Avisa, não bloqueia.
-- ---------------------------------------------------------------------------
create or replace view public.vw_lancamentos_a_conferir with (security_invoker = true) as
  select pessoa_id, mes_competencia, bloco, atendimentos, soma_das_faixas,
         soma_das_faixas - atendimentos as diferenca
    from (
      select pessoa_id, mes_competencia, 'diretores'::text as bloco,
             coalesce(sum(quantidade) filter (where regra = 'diretores_atendimento'), 0) as atendimentos,
             coalesce(sum(quantidade) filter (where regra in ('diretores_ate_30', 'diretores_ate_1h',
                                                              'diretores_acima_1h')), 0) as soma_das_faixas
        from public.lancamentos
       where regra like 'diretores%'
       group by pessoa_id, mes_competencia

      union all

      select pessoa_id, mes_competencia, 'chamados',
             coalesce(sum(quantidade) filter (where regra = 'chamados_tratados'), 0),
             coalesce(sum(quantidade) filter (where regra in ('chamados_sla_ate_2d',
                                                              'chamados_sla_acima_2d')), 0)
        from public.lancamentos
       where regra like 'chamados%'
       group by pessoa_id, mes_competencia
    ) t
   where soma_das_faixas <> atendimentos;
