-- ============================================================================
-- Painel de Cota — o cálculo
-- Rode DEPOIS de 12-painel-de-cota.sql. Pode ser executado mais de uma vez.
--
-- A cota deixa de ser um número guardado e passa a ser a SOMA DE UM EXTRATO.
-- Cada linha é (pessoa, competência, semana, regra, quantidade, peso), e a
-- cota é `soma(quantidade × peso)` — o mesmo formato da aba de cada atendente
-- na planilha: categoria, pontuação, feito, cota.
--
-- A diferença é que na planilha o extrato é desenhado à mão em 48 blocos de
-- fórmula, um por semana e por pessoa, e aqui ele é derivado do dado bruto.
-- Isso fecha três defeitos conhecidos de uma vez:
--
--   * O mensal é a soma das semanas por definição, e não um segundo cálculo
--     que pode divergir do primeiro.
--   * Nenhuma categoria pode existir na semana e sumir no mês.
--   * A monitoria casa por id, não por nome — era assim que ela virava zero
--     silenciosamente para quem tinha nome divergente entre as fontes.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Avaliações válidas, já com competência e semana
--
-- `-1` e `0` são avaliações inválidas: ficam de fora da contagem de notas E do
-- denominador do C-SAT. As funções de ciclo são as mesmas das monitorias, para
-- os dois sistemas nunca discordarem sobre a que mês pertence um dia 26.
-- ---------------------------------------------------------------------------
create or replace view public.vw_avaliacoes with (security_invoker = true) as
  select
    a.id,
    a.pessoa_id,
    public.mes_de_competencia(a.data) as mes_competencia,
    public.semana_do_ciclo(a.data)    as semana,
    a.data,
    a.avaliacao::smallint             as nota
  from public.atendimentos a
  where a.pessoa_id is not null
    and a.avaliacao between 1 and 5;

-- ---------------------------------------------------------------------------
-- C-SAT da semana = (notas 4 e 5) ÷ (notas válidas)
--
-- Semana sem nenhuma avaliação válida simplesmente não aparece aqui — e por
-- isso não gera linha de C-SAT no extrato. Na planilha ela daria zero, cairia
-- na faixa "abaixo de 80%" e aplicaria −1 por finalizado: quem trabalhou e não
-- foi avaliado saía punido.
-- ---------------------------------------------------------------------------
create or replace view public.vw_csat_semanal with (security_invoker = true) as
  select
    pessoa_id,
    mes_competencia,
    semana,
    count(*)                                              as avaliacoes,
    count(*) filter (where nota >= 4)                     as positivas,
    round(count(*) filter (where nota >= 4)::numeric
          / count(*), 6)                                  as csat
  from public.vw_avaliacoes
  group by pessoa_id, mes_competencia, semana;

-- ---------------------------------------------------------------------------
-- TME da equipe na semana
--
-- A faixa de TME é avaliada sobre a EQUIPE, não sobre o indivíduo — o mesmo
-- valor para todos na semana — e aplicada aos finalizados de cada um. Confere
-- com a planilha: na 1ª semana de agosto o TME da equipe é 00:21:00, que cai
-- na faixa de até 30 min, e é essa a faixa marcada na aba da Allana.
--
-- Aqui é a média simples da equipe. A planilha usa "TME Válido", que calcula
-- sobre um intervalo deslocado em uma linha e acaba excluindo quem estiver em
-- primeiro na ordem alfabética — o que parece defeito, não regra. Como os três
-- pesos são zero, a escolha não muda pontuação nenhuma hoje.
--
-- Esta é a ÚNICA view daqui que não usa `security_invoker`, e é de propósito:
-- ela precisa enxergar a equipe inteira para calcular a média. Com a RLS
-- aplicada, o operador veria só a própria linha e a "média da equipe" seria o
-- TME dele — que é justamente o tipo de número plausível e errado que este
-- redesenho existe para eliminar. Não expõe ninguém: só devolve o agregado.
-- ---------------------------------------------------------------------------
create or replace view public.vw_tme_equipe with (security_invoker = false) as
  select
    mes_competencia,
    semana,
    round(avg(tme_seg) filter (where tme_seg > 0))::integer as tme_seg
  from public.volume_semanal
  group by mes_competencia, semana;

-- ---------------------------------------------------------------------------
-- O extrato
--
-- Uma linha por (pessoa, competência, semana, regra). As faixas são resolvidas
-- pela própria tabela `regras`, em intervalos semiabertos [mínimo, máximo) —
-- assim mexer num peso ou acrescentar uma linha é `update`/`insert`, nunca
-- alteração de código.
-- ---------------------------------------------------------------------------
create or replace view public.vw_extrato_cota with (security_invoker = true) as

  -- Atendimentos do Huggy: 4 pontos por finalizado.
  -- `finalizados` vem do relatório de volume, não da contagem de avaliações:
  -- a base só guarda atendimento que gerou avaliação, e a diferença é real.
  select v.pessoa_id, v.mes_competencia, v.semana,
         r.chave as regra, r.rotulo, r.grupo, r.ordem,
         v.finalizados::numeric as quantidade, r.peso,
         round(v.finalizados * r.peso, 4) as cota
    from public.volume_semanal v
    join public.regras r on r.chave = 'huggy_atendimento' and r.ativo

  union all

  -- TME: a faixa vem da equipe, a quantidade é a do indivíduo.
  select v.pessoa_id, v.mes_competencia, v.semana,
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

  -- C-SAT: a faixa vem do indivíduo, e o peso multiplica os FINALIZADOS da
  -- semana, não as avaliações.
  select v.pessoa_id, v.mes_competencia, v.semana,
         r.chave, r.rotulo, r.grupo, r.ordem,
         v.finalizados::numeric, r.peso,
         round(v.finalizados * r.peso, 4)
    from public.volume_semanal v
    join public.vw_csat_semanal c
      on c.pessoa_id = v.pessoa_id
     and c.mes_competencia = v.mes_competencia
     and c.semana = v.semana
    join public.regras r
      on r.grupo = 'csat' and r.ativo
     and (r.faixa_min is null or c.csat >= r.faixa_min)
     and (r.faixa_max is null or c.csat <  r.faixa_max)

  union all

  -- Notas 1 a 5, cada uma com seu peso.
  select a.pessoa_id, a.mes_competencia, a.semana,
         r.chave, r.rotulo, r.grupo, r.ordem,
         count(*)::numeric, r.peso,
         round(count(*) * r.peso, 4)
    from public.vw_avaliacoes a
    join public.regras r
      on r.grupo = 'nota' and r.ativo and r.faixa_min = a.nota
   group by a.pessoa_id, a.mes_competencia, a.semana,
            r.chave, r.rotulo, r.grupo, r.ordem, r.peso

  union all

  -- Monitoria: a única regra que não é quantidade × peso.
  -- É `75 × média` quando a média passa de 85%, e zero quando não passa. O
  -- teste é estritamente maior: exatamente 0,85 não pontua. A média é sobre as
  -- monitorias que existirem na semana, não sobre quatro fixas.
  select m.operador_id, m.mes_referencia, m.semana_mes,
         r.chave, r.rotulo, r.grupo, r.ordem,
         round(avg(m.nota_final), 4), r.peso,
         case when avg(m.nota_final) > r.faixa_min
              then round(avg(m.nota_final) * r.peso, 4)
              else 0 end
    from public.monitorias m
    join public.regras r on r.chave = 'monitoria' and r.ativo
   group by m.operador_id, m.mes_referencia, m.semana_mes,
            r.chave, r.rotulo, r.grupo, r.ordem, r.peso, r.faixa_min

  union all

  -- Lançamentos manuais. `pontos_manuais` é o escape para o caso em que o
  -- valor não sai de quantidade × peso — hoje só a "Inconsistência de
  -- atendimentos", que a planilha resolve com o texto "Zera o dia" e nenhuma
  -- fórmula.
  select l.pessoa_id, l.mes_competencia, l.semana,
         r.chave, r.rotulo, r.grupo, r.ordem,
         l.quantidade, r.peso,
         coalesce(l.pontos_manuais, round(l.quantidade * r.peso, 4))
    from public.lancamentos l
    join public.regras r on r.chave = l.regra and r.ativo;

-- ---------------------------------------------------------------------------
-- A cota do mês é a soma do extrato. Não existe segundo cálculo.
-- ---------------------------------------------------------------------------
create or replace view public.vw_cota_mensal with (security_invoker = true) as
  select
    e.pessoa_id,
    p.nome                       as pessoa,
    e.mes_competencia,
    sum(e.cota)                  as resultado,
    (select peso from public.regras where chave = 'meta') as meta,
    round(
      sum(e.cota)
      / nullif((select peso from public.regras where chave = 'meta'), 0), 6
    )                            as atingimento
  from public.vw_extrato_cota e
  join public.pessoas p on p.id = e.pessoa_id
  group by e.pessoa_id, p.nome, e.mes_competencia;

-- ---------------------------------------------------------------------------
-- Média da equipe, legível por todos
--
-- O operador não pode ler as linhas dos colegas, e é por isso que o painel
-- antigo mostrava a constante 82,93 escrita no código como "média da equipe".
-- Esta view devolve só o número agregado, sem expor ninguém — e por ser
-- `security definer` ela atravessa a RLS de propósito, entregando apenas o que
-- já é público para o time.
-- ---------------------------------------------------------------------------
create or replace function public.csat_da_equipe(p_mes date, p_semana smallint default null)
returns numeric language sql stable security definer set search_path = public as $$
  select round(sum(positivas)::numeric / nullif(sum(avaliacoes), 0), 6)
    from public.vw_csat_semanal
   where mes_competencia = p_mes
     and (p_semana is null or semana = p_semana);
$$;

revoke all on function public.csat_da_equipe(date, smallint) from public, anon;
grant execute on function public.csat_da_equipe(date, smallint) to authenticated;

-- ============================================================================
-- Fechamento do ciclo
--
-- O extrato é vivo: reflete sempre a regra atual. Mas o que foi entregue ao
-- outro departamento não pode mudar depois. Se um peso for corrigido em
-- outubro, julho tem que continuar valendo o que valia quando foi enviado —
-- senão não há como responder "de onde vieram esses pontos".
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
      (fechamento_id, semana, regra, rotulo, grupo, ordem, quantidade, peso, cota)
    select v_id, e.semana, e.regra, e.rotulo, e.grupo, e.ordem,
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

-- ---------------------------------------------------------------------------
-- Permissões do fechamento
--
-- Ninguém grava direto: só a função acima, que é `security definer` e confere
-- o papel. Não existe caminho de exclusão de propósito — registro de valor
-- entregue não se apaga por conveniência.
-- ---------------------------------------------------------------------------
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
