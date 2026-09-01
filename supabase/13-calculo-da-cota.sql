-- ============================================================================
-- Painel de Cota — o cálculo
-- Rode DEPOIS de 12-painel-de-cota.sql. Pode ser executado mais de uma vez.
--
-- A cota é a SOMA DE UM EXTRATO. Cada linha é (pessoa, competência, semana,
-- origem, regra, quantidade, peso), e a cota é `soma(quantidade × peso)` — o
-- mesmo formato da aba de cada atendente na planilha: categoria, pontuação,
-- feito, cota.
--
-- A diferença é que lá o extrato é desenhado à mão em 48 blocos de fórmula, e
-- aqui é derivado do dado bruto. Isso fecha defeitos conhecidos:
--
--   * O mensal é a soma das semanas por definição, não um segundo cálculo.
--   * Nenhuma categoria existe na semana e some no mês.
--   * A monitoria casa por id, não por nome — era assim que virava zero em
--     silêncio para quem tem nome divergente entre as fontes.
--   * As faixas de C-SAT existem UMA vez e servem aos dois canais. Na planilha
--     elas estão escritas duas vezes, e um dos blocos saiu desalinhado.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Avaliações válidas, já com competência e semana
--
-- `-1` e `0` são inválidas: fora da contagem de notas E do denominador do
-- C-SAT. As funções de ciclo são as mesmas das monitorias, para os dois
-- sistemas nunca discordarem sobre a que mês pertence um dia 26.
-- ---------------------------------------------------------------------------
create or replace view public.vw_avaliacoes_validas with (security_invoker = true) as
  select
    a.id,
    a.pessoa_id,
    a.origem,
    public.mes_de_competencia(a.data) as mes_competencia,
    public.semana_do_ciclo(a.data)    as semana,
    a.data,
    a.nota
  from public.avaliacoes a
  where a.nota between 1 and 5;

-- ---------------------------------------------------------------------------
-- C-SAT da semana, por canal = (notas 4 e 5) ÷ (notas válidas)
--
-- Semana sem nenhuma avaliação válida não aparece aqui — e por isso não gera
-- linha de C-SAT no extrato. Na planilha ela daria zero, cairia na faixa
-- "abaixo de 80%" e aplicaria −1 por atendimento: quem trabalhou e não foi
-- avaliado saía punido. Ausência de dado não é nota ruim.
-- ---------------------------------------------------------------------------
create or replace view public.vw_csat_semanal with (security_invoker = true) as
  select
    pessoa_id,
    origem,
    mes_competencia,
    semana,
    count(*)                                          as avaliacoes,
    count(*) filter (where nota >= 4)                 as positivas,
    round(count(*) filter (where nota >= 4)::numeric / count(*), 6) as csat
  from public.vw_avaliacoes_validas
  group by pessoa_id, origem, mes_competencia, semana;

-- ---------------------------------------------------------------------------
-- O que a faixa de C-SAT multiplica, por canal
--
-- Os dois canais respondem essa pergunta de forma DIFERENTE, e é de propósito:
--
--   huggy     — os finalizados do relatório de volume. A base de avaliações só
--               guarda atendimento que gerou avaliação, então contá-la
--               subestimaria o volume: na 1ª semana de agosto a Allana tem 102
--               finalizados e 98 avaliações, e é 102 que conta.
--   diretores — a contagem da própria base, porque não existe relatório de
--               volume separado para esse canal.
--
-- Está escrito aqui em vez de espalhado porque é o tipo de assimetria que, sem
-- explicação, alguém "corrige" daqui a seis meses para deixar os dois iguais —
-- e muda a cota sem perceber.
-- ---------------------------------------------------------------------------
create or replace view public.vw_base_do_csat with (security_invoker = true) as
  select pessoa_id, 'huggy'::text as origem, mes_competencia, semana,
         finalizados::numeric as quantidade
    from public.volume_semanal
  union all
  select pessoa_id, 'diretores', mes_competencia, semana, count(*)::numeric
    from public.vw_avaliacoes_validas
   where origem = 'diretores'
   group by pessoa_id, mes_competencia, semana;

-- ---------------------------------------------------------------------------
-- TME da equipe na semana
--
-- A faixa é avaliada sobre a EQUIPE, não sobre o indivíduo — o mesmo valor
-- para todos na semana — e aplicada aos finalizados de cada um.
--
-- Esta é a única view daqui sem `security_invoker`, e é deliberado: precisa
-- enxergar a equipe inteira para calcular a média. Com a RLS aplicada, o
-- operador veria só a própria linha e a "média da equipe" seria o TME dele —
-- justamente o tipo de número plausível e errado que este redesenho existe
-- para eliminar. Não expõe ninguém: devolve só o agregado.
-- ---------------------------------------------------------------------------
create or replace view public.vw_tme_equipe with (security_invoker = false) as
  select mes_competencia, semana,
         round(avg(tme_seg) filter (where tme_seg > 0))::integer as tme_seg
    from public.volume_semanal
   group by mes_competencia, semana;

-- ---------------------------------------------------------------------------
-- O extrato
--
-- As faixas são resolvidas pela própria tabela `regras`, em intervalos
-- semiabertos [mínimo, máximo). Mexer num peso ou acrescentar uma categoria é
-- `update`/`insert`, nunca alteração de código.
-- ---------------------------------------------------------------------------
create or replace view public.vw_extrato_cota with (security_invoker = true) as

  -- Atendimentos do Huggy: 4 pontos por finalizado.
  select v.pessoa_id, v.mes_competencia, v.semana, 'huggy'::text as origem,
         r.chave as regra, r.rotulo, r.grupo, r.ordem,
         v.finalizados::numeric as quantidade, r.peso,
         round(v.finalizados * r.peso, 4) as cota
    from public.volume_semanal v
    join public.regras r on r.chave = 'huggy_atendimento' and r.ativo

  union all

  -- TME: a faixa vem da equipe, a quantidade é a do indivíduo.
  select v.pessoa_id, v.mes_competencia, v.semana, 'huggy',
         r.chave, r.rotulo, r.grupo, r.ordem,
         v.finalizados::numeric, r.peso,
         round(v.finalizados * r.peso, 4)
    from public.volume_semanal v
    join public.vw_tme_equipe t
      on t.mes_competencia = v.mes_competencia and t.semana = v.semana
    join public.regras r
      on r.grupo = 'tme' and r.ativo
     and (r.faixa_min is null or t.tme_seg >= r.faixa_min)
     and (r.faixa_max is null or t.tme_seg <  r.faixa_max)

  union all

  -- C-SAT: uma regra, os dois canais. A faixa vem do C-SAT do canal e
  -- multiplica a base daquele canal.
  select b.pessoa_id, b.mes_competencia, b.semana, b.origem,
         r.chave, r.rotulo, r.grupo, r.ordem,
         b.quantidade, r.peso,
         round(b.quantidade * r.peso, 4)
    from public.vw_base_do_csat b
    join public.vw_csat_semanal c
      on c.pessoa_id = b.pessoa_id and c.origem = b.origem
     and c.mes_competencia = b.mes_competencia and c.semana = b.semana
    join public.regras r
      on r.grupo = 'csat' and r.ativo
     and (r.faixa_min is null or c.csat >= r.faixa_min)
     and (r.faixa_max is null or c.csat <  r.faixa_max)

  union all

  -- Notas 1 a 5, também para os dois canais.
  select a.pessoa_id, a.mes_competencia, a.semana, a.origem,
         r.chave, r.rotulo, r.grupo, r.ordem,
         count(*)::numeric, r.peso,
         round(count(*) * r.peso, 4)
    from public.vw_avaliacoes_validas a
    join public.regras r
      on r.grupo = 'nota' and r.ativo and r.faixa_min = a.nota
   group by a.pessoa_id, a.mes_competencia, a.semana, a.origem,
            r.chave, r.rotulo, r.grupo, r.ordem, r.peso

  union all

  -- Monitoria: a única regra que não é quantidade × peso.
  -- `75 × média` quando a média passa de 85%, zero quando não passa. O teste é
  -- estritamente maior: exatamente 0,85 não pontua. A média é sobre as
  -- monitorias que existirem na semana, não sobre quatro fixas.
  select m.operador_id, m.mes_referencia, m.semana_mes, null,
         r.chave, r.rotulo, r.grupo, r.ordem,
         round(avg(m.nota_final), 4), r.peso,
         case when avg(m.nota_final) > r.faixa_min
              then round(avg(m.nota_final) * r.peso, 4) else 0 end
    from public.monitorias m
    join public.regras r on r.chave = 'monitoria' and r.ativo
   group by m.operador_id, m.mes_referencia, m.semana_mes,
            r.chave, r.rotulo, r.grupo, r.ordem, r.peso, r.faixa_min

  union all

  -- Lançamentos manuais. Quando a regra é de valor manual — "Atestado", cujo
  -- desconto depende da quantidade de faltas, e "Inconsistência de
  -- atendimentos", o "zera o dia" que na planilha é texto sem fórmula — vale o
  -- valor digitado, não a multiplicação.
  select l.pessoa_id, l.mes_competencia, l.semana, null,
         r.chave, r.rotulo, r.grupo, r.ordem,
         l.quantidade, r.peso,
         coalesce(l.pontos_manuais, round(l.quantidade * r.peso, 4))
    from public.lancamentos l
    join public.regras r on r.chave = l.regra and r.ativo;

-- ---------------------------------------------------------------------------
-- A cota do mês é a soma do extrato. Não existe segundo cálculo.
--
-- A meta é única e global: alterar a linha `meta` em `regras` muda o
-- atingimento de todo mundo no mesmo instante.
-- ---------------------------------------------------------------------------
create or replace view public.vw_cota_mensal with (security_invoker = true) as
  select
    e.pessoa_id,
    p.nome                      as pessoa,
    e.mes_competencia,
    sum(e.cota)                 as resultado,
    (select peso from public.regras where chave = 'meta') as meta,
    round(sum(e.cota) / nullif((select peso from public.regras where chave = 'meta'), 0), 6)
                                as atingimento
  from public.vw_extrato_cota e
  join public.pessoas p on p.id = e.pessoa_id
  group by e.pessoa_id, p.nome, e.mes_competencia;

-- ---------------------------------------------------------------------------
-- Conferência dos lançamentos manuais
--
-- Todo atendimento a diretores levou algum tempo para ser respondido, então as
-- três faixas de tempo somadas têm que dar o total de atendimentos. Em julho
-- batem exatamente: 602 atendimentos, 602 na faixa de até 30 min.
--
-- Se alguém digitar 500 numa faixa e esquecer os outros 102, nada reclama — e
-- esses 102 valem 306 pontos que não são creditados, com a cota fechando menor
-- e com aparência normal. Esta view lista as divergências para a tela avisar.
--
-- Avisa, não bloqueia: pode existir caso legítimo de diferença.
-- ---------------------------------------------------------------------------
create or replace view public.vw_lancamentos_a_conferir with (security_invoker = true) as
  select
    pessoa_id,
    mes_competencia,
    'diretores'::text as bloco,
    sum(quantidade) filter (where regra = 'diretores_atendimento')     as atendimentos,
    sum(quantidade) filter (where regra like 'diretores_ate%'
                               or regra = 'diretores_acima_1h')        as soma_das_faixas,
    sum(quantidade) filter (where regra like 'diretores_ate%'
                               or regra = 'diretores_acima_1h')
      - sum(quantidade) filter (where regra = 'diretores_atendimento') as diferenca
  from public.lancamentos
  where regra like 'diretores%'
  group by pessoa_id, mes_competencia
  having coalesce(sum(quantidade) filter (where regra like 'diretores_ate%'
                                             or regra = 'diretores_acima_1h'), 0)
      <> coalesce(sum(quantidade) filter (where regra = 'diretores_atendimento'), 0);

-- ---------------------------------------------------------------------------
-- Média da equipe, legível por todos
--
-- O operador não pode ler as linhas dos colegas, e é por isso que o painel
-- antigo mostrava a constante 82,93 escrita no código como "média da equipe".
-- Esta função devolve só o agregado, sem expor ninguém.
-- ---------------------------------------------------------------------------
create or replace function public.csat_da_equipe(
  p_mes date, p_semana smallint default null, p_origem text default 'huggy')
returns numeric language sql stable security definer set search_path = public as $$
  select round(sum(positivas)::numeric / nullif(sum(avaliacoes), 0), 6)
    from public.vw_csat_semanal
   where mes_competencia = p_mes
     and origem = p_origem
     and (p_semana is null or semana = p_semana);
$$;

revoke all on function public.csat_da_equipe(date, smallint, text) from public, anon;
grant execute on function public.csat_da_equipe(date, smallint, text) to authenticated;

-- ============================================================================
-- Fechamento do ciclo
--
-- O extrato é vivo e reflete sempre a regra atual. O fechamento é o que foi
-- entregue ao outro departamento, e não muda nunca mais. Se um peso ou a meta
-- forem corrigidos em outubro, julho continua valendo o que valia quando foi
-- enviado — senão não há como responder de onde vieram os pontos.
-- ============================================================================
create table if not exists public.fechamentos_cota (
  id               uuid primary key default uuid_generate_v4(),
  pessoa_id        uuid not null references public.pessoas (id) on delete restrict,
  pessoa_nome      text,
  mes_competencia  date not null,
  resultado        numeric(14,4) not null,
  meta             numeric(14,4),
  fechado_por      uuid references public.pessoas (id) on delete set null,
  fechado_por_nome text,
  fechado_em       timestamptz not null default now(),
  unique (pessoa_id, mes_competencia)
);

create table if not exists public.fechamento_linhas (
  id            bigint generated always as identity primary key,
  fechamento_id uuid not null references public.fechamentos_cota (id) on delete cascade,
  semana        smallint,
  origem        text,
  regra         text,
  rotulo        text,
  grupo         text,
  ordem         integer,
  quantidade    numeric(12,4),
  peso          numeric(12,4),
  cota          numeric(14,4)
);

create index if not exists fechamento_linhas_idx
  on public.fechamento_linhas (fechamento_id, ordem);

-- Congela a competência inteira. Devolve quantas pessoas foram fechadas.
-- Não sobrescreve fechamento existente: número já enviado não se refaz por
-- acidente.
create or replace function public.fechar_ciclo(p_mes date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_nome  text;
  v_conta integer := 0;
  v_p     record;
  v_id    uuid;
begin
  if public.eh_gestor() is not true then
    raise exception 'Apenas gestores fecham o ciclo.';
  end if;

  select nome into v_nome from public.pessoas where id = public.pessoa_atual();

  for v_p in
    select * from public.vw_cota_mensal
     where mes_competencia = p_mes
       and pessoa_id not in (
         select pessoa_id from public.fechamentos_cota where mes_competencia = p_mes)
  loop
    insert into public.fechamentos_cota
      (pessoa_id, pessoa_nome, mes_competencia, resultado, meta,
       fechado_por, fechado_por_nome)
    values
      (v_p.pessoa_id, v_p.pessoa, p_mes, v_p.resultado, v_p.meta,
       public.pessoa_atual(), coalesce(v_nome, 'sistema'))
    returning id into v_id;

    insert into public.fechamento_linhas
      (fechamento_id, semana, origem, regra, rotulo, grupo, ordem,
       quantidade, peso, cota)
    select v_id, e.semana, e.origem, e.regra, e.rotulo, e.grupo, e.ordem,
           e.quantidade, e.peso, e.cota
      from public.vw_extrato_cota e
     where e.pessoa_id = v_p.pessoa_id
       and e.mes_competencia = p_mes;

    v_conta := v_conta + 1;
  end loop;

  return v_conta;
end;
$$;

revoke all on function public.fechar_ciclo(date) from public, anon;
grant execute on function public.fechar_ciclo(date) to authenticated;

-- Ninguém grava direto: só a função acima, que confere o papel. Não existe
-- caminho de exclusão, de propósito — registro de valor entregue não se apaga
-- por conveniência.
alter table public.fechamentos_cota  enable row level security;
alter table public.fechamento_linhas enable row level security;

drop policy if exists fechamentos_leitura on public.fechamentos_cota;
create policy fechamentos_leitura on public.fechamentos_cota
  for select using (public.ve_o_time() or pessoa_id = public.pessoa_atual());

drop policy if exists fechamento_linhas_leitura on public.fechamento_linhas;
create policy fechamento_linhas_leitura on public.fechamento_linhas
  for select using (
    exists (
      select 1 from public.fechamentos_cota f
       where f.id = fechamento_id
         and (public.ve_o_time() or f.pessoa_id = public.pessoa_atual())
    )
  );
