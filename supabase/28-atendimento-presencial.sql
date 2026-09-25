-- ============================================================================
-- Painel de Cota — atendimento presencial lançado pelo próprio operador
-- Rode DEPOIS de 27-exibicao-e-contagem.sql. Pode ser executado mais de uma vez.
--
-- Hoje o presencial chega como lançamento manual do gestor: uma linha com a
-- quantidade do mês e nada mais. Quem atendeu registra numa planilha à parte,
-- com data, identificação do cliente e a demanda tratada, e o gestor depois
-- transcreve o total. Cada transcrição é uma chance de erro, e o detalhe —
-- que é o que permite conferir — fica fora do sistema.
--
-- Agora o operador registra o próprio atendimento, com os mesmos campos da
-- planilha, e a contagem alimenta o extrato direto. O gestor vê a lista
-- inteira, com o nome de quem atendeu.
-- ============================================================================

create table if not exists public.atendimentos_presenciais (
  id              uuid primary key default uuid_generate_v4(),
  pessoa_id       uuid not null references public.pessoas (id) on delete restrict,
  data            date not null,
  -- Identificação do cliente, como na planilha: o número e o nome.
  cliente_id      text,
  cliente_nome    text not null,
  demanda         text not null,
  observacao      text,
  criado_em       timestamptz not null default now()
);

create index if not exists presenciais_pessoa_idx
  on public.atendimentos_presenciais (pessoa_id, data desc);

-- ---------------------------------------------------------------------------
-- A competência e a semana saem da data, pelas mesmas funções do resto do
-- sistema — o ciclo 26→25.
-- ---------------------------------------------------------------------------
create or replace view public.vw_presenciais with (security_invoker = true) as
  select a.*,
         p.nome as pessoa_nome,
         public.mes_de_competencia(a.data) as mes_competencia,
         public.semana_do_ciclo(a.data)    as semana
    from public.atendimentos_presenciais a
    join public.pessoas p on p.id = a.pessoa_id;

-- ---------------------------------------------------------------------------
-- Entra no extrato como quantidade da regra `presencial`.
--
-- Os lançamentos manuais continuam valendo: quem já lançou presencial à mão
-- não perde o que lançou. Para não contar em dobro, a tela de lançamentos
-- deixa de oferecer a regra `presencial` — quem registra agora é o operador.
-- ---------------------------------------------------------------------------
create or replace view public.vw_extrato_quantidades with (security_invoker = true) as

  -- Finalizados: a regra depende do canal.
  select v.pessoa_id, v.mes_competencia, v.semana, v.canal as origem,
         r.chave as regra, v.finalizados::numeric as quantidade,
         null::numeric as pontos_manuais
    from public.volume_semanal v
    join public.regras r
      on r.chave = case v.canal when 'huggy' then 'huggy_atendimento'
                                else 'diretores_atendimento' end
     and r.ativo

  union all

  -- Faixa pelo TME médio da equipe do canal, aplicada aos finalizados da
  -- pessoa. Cada canal tem o seu grupo de faixas.
  select v.pessoa_id, v.mes_competencia, v.semana, v.canal,
         r.chave, v.finalizados::numeric, null
    from public.volume_semanal v
    join public.vw_tme_equipe t
      on t.mes_competencia = v.mes_competencia and t.semana = v.semana
     and t.canal = v.canal
    join public.regras r
      on r.grupo = case v.canal when 'huggy' then 'tme' else 'tme_diretores' end
     and r.ativo
     and (r.faixa_min is null or t.tme_seg >= r.faixa_min)
     and (r.faixa_max is null or t.tme_seg <  r.faixa_max)

  union all

  select b.pessoa_id, b.mes_competencia, b.semana, b.origem,
         r.chave, b.quantidade, null
    from public.vw_base_do_csat b
    join public.vw_csat_semanal c
      on c.pessoa_id = b.pessoa_id and c.origem = b.origem
     and c.mes_competencia = b.mes_competencia and c.semana = b.semana
    join public.regras r
      on r.grupo = 'csat' and r.ativo
     and (r.faixa_min is null or c.csat >= r.faixa_min)
     and (r.faixa_max is null or c.csat <  r.faixa_max)

  union all

  select a.pessoa_id, a.mes_competencia, a.semana, a.origem,
         r.chave, count(*)::numeric, null
    from public.vw_avaliacoes_validas a
    join public.regras r
      on r.grupo = 'nota' and r.ativo and r.faixa_min = a.nota
   group by a.pessoa_id, a.mes_competencia, a.semana, a.origem, r.chave

  union all

  select m.operador_id, m.mes_referencia, m.semana_mes, null,
         r.chave, round(avg(m.nota_final), 4), null
    from public.monitorias m
    join public.regras r on r.chave = 'monitoria' and r.ativo
   group by m.operador_id, m.mes_referencia, m.semana_mes, r.chave

  union all

  -- Lançamentos manuais, com o canal em que foram lançados.
  select l.pessoa_id, l.mes_competencia, l.semana, l.canal,
         r.chave, l.quantidade, l.pontos_manuais
    from public.lancamentos l
    join public.regras r on r.chave = l.regra and r.ativo

  union all

  -- Presencial registrado pelo próprio operador: uma linha por atendimento,
  -- contadas por semana.
  --
  -- A partir de 26/09/2026, início do ciclo de outubro. Setembro já tem o
  -- presencial lançado à mão pelo gestor; contar as duas fontes no mesmo mês
  -- dobraria a pontuação de quem registrasse o mesmo atendimento aqui.
  select a.pessoa_id,
         public.mes_de_competencia(a.data),
         public.semana_do_ciclo(a.data),
         null,
         r.chave, count(*)::numeric, null
    from public.atendimentos_presenciais a
    join public.regras r on r.chave = 'presencial' and r.ativo
   where a.data >= date '2026-09-26'
   group by a.pessoa_id, public.mes_de_competencia(a.data), public.semana_do_ciclo(a.data), r.chave;

-- ---------------------------------------------------------------------------
-- Permissões
--
-- O operador registra e enxerga o próprio; quem vê o time vê todos. Apagar é
-- do gestor, ou do próprio autor enquanto a competência não estiver fechada:
-- depois do fechamento o número já foi entregue e não se mexe.
-- ---------------------------------------------------------------------------
alter table public.atendimentos_presenciais enable row level security;

drop policy if exists presenciais_leitura on public.atendimentos_presenciais;
create policy presenciais_leitura on public.atendimentos_presenciais
  for select using (public.ve_o_time() or pessoa_id = public.pessoa_atual());

drop policy if exists presenciais_registro on public.atendimentos_presenciais;
create policy presenciais_registro on public.atendimentos_presenciais
  for insert with check (
    pessoa_id = public.pessoa_atual() or public.eh_gestor()
  );

drop policy if exists presenciais_exclusao on public.atendimentos_presenciais;
create policy presenciais_exclusao on public.atendimentos_presenciais
  for delete using (
    public.eh_gestor()
    or (
      pessoa_id = public.pessoa_atual()
      and not exists (
        select 1 from public.fechamentos_cota f
         where f.pessoa_id = atendimentos_presenciais.pessoa_id
           and f.mes_competencia = public.mes_de_competencia(atendimentos_presenciais.data)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Prazo de registro: 2 dias úteis
--
-- O registro vale como comprovação, e comprovação que chega semanas depois
-- não comprova nada — na planilha antiga era comum aparecer atendimento do mês
-- passado na véspera do fechamento. O prazo é de dois dias úteis contados a
-- partir do dia seguinte ao atendimento: sexta-feira pode ser registrada até
-- terça, porque sábado e domingo não contam.
--
-- Feriado não é considerado: o sistema não tem calendário de feriados, e
-- inventar um daria uma regra que ninguém consegue conferir. Quando o prazo
-- cair em feriado, o gestor registra — ele não passa por esta trava.
-- ---------------------------------------------------------------------------
create or replace function public.dias_uteis(de date, ate date)
returns integer language sql immutable as $$
  select count(*)::integer
    from generate_series(de + 1, ate, interval '1 day') g
   where extract(isodow from g) < 6;
$$;

comment on function public.dias_uteis(date, date) is
  'Dias úteis no intervalo (de, ate]. Não considera feriados.';

create or replace function public.conferir_prazo_do_presencial()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if new.data > v_hoje then
    raise exception 'A data do atendimento não pode ser futura.';
  end if;

  if new.data < date '2026-09-26' then
    raise exception 'O registro pelo operador vale a partir de 26/09/2026.';
  end if;

  -- O gestor registra fora do prazo: é ele quem responde pelo acerto.
  if public.eh_gestor() then
    return new;
  end if;

  if public.dias_uteis(new.data, v_hoje) > 2 then
    raise exception 'Prazo encerrado: o atendimento deve ser registrado em até 2 dias úteis. Peça ao gestor.';
  end if;

  return new;
end;
$$;

drop trigger if exists presenciais_prazo on public.atendimentos_presenciais;
create trigger presenciais_prazo
  before insert on public.atendimentos_presenciais
  for each row execute function public.conferir_prazo_do_presencial();
