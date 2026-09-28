-- ============================================================================
-- Painel de Cota — presencial de setembro/2026 vindo da planilha de registro
-- Rode DEPOIS de 28-atendimento-presencial.sql. Pode ser executado mais de
-- uma vez.
--
-- Setembro foi lançado à mão pelo gestor: só a quantidade por operador.
-- A planilha de onde o total saía tem o detalhe — data, cliente e demanda —,
-- e é ela que passa a valer. Os lançamentos manuais de `presencial` da
-- competência saem, com cópia em `lancamentos_substituidos`, e cada linha da
-- planilha entra em `atendimentos_presenciais` como se tivesse sido
-- registrada na tela.
--
-- O fechamento não é tocado. Se setembro já estiver fechado, o que se paga
-- continua sendo o fechamento; a conferência no fim mostra quem tem.
--
-- Aplicada em 28/09/2026, com setembro ainda aberto: 16 lançamentos manuais
-- saíram, 31 linhas entraram.
--
-- Este arquivo tem a estrutura. A troca de dados (passo 3) tem nome e ID de
-- clientes e fica em `dados/29-presencial-de-setembro-linhas.sql`, fora do
-- git. Na ordem: passos 1 e 2 daqui, o arquivo de `dados/`, passos 4 e 5.
--
-- Sem tabela temporária e sem begin/commit: a primeira versão usava os dois e
-- o SQL Editor descartou a tabela temporária antes do comando seguinte. A
-- troca inteira é um comando só — ou acontece toda, ou nada.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Onde fica a cópia dos lançamentos manuais
-- ---------------------------------------------------------------------------
create table if not exists public.lancamentos_substituidos (
  like public.lancamentos,
  motivo          text not null,
  substituido_em  timestamptz not null default now()
);

alter table public.lancamentos_substituidos enable row level security;
drop policy if exists lancamentos_substituidos_leitura on public.lancamentos_substituidos;
create policy lancamentos_substituidos_leitura on public.lancamentos_substituidos
  for select using (public.eh_gestor());

-- ---------------------------------------------------------------------------
-- 2. A trava de prazo deixa passar quem acessa o banco direto
--
-- A trava da migração 28 existe para o registro do dia a dia, que chega pelo
-- site. Pelo site a conexão é sempre do usuário `authenticator`; pelo SQL
-- Editor é do administrador do banco, que é quem roda as migrações. Sem
-- isso, a importação seria recusada: as datas são anteriores a 26/09 e o
-- prazo de 2 dias úteis já passou.
--
-- Para o operador, nada muda.
-- ---------------------------------------------------------------------------
create or replace function public.conferir_prazo_do_presencial()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- Acesso direto ao banco (SQL Editor): importação feita pelo gestor.
  if session_user <> 'authenticator' then
    return new;
  end if;

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

-- ---------------------------------------------------------------------------
-- 3. A troca: sai o manual, entra a planilha
--
-- Em `dados/29-presencial-de-setembro-linhas.sql` (não versionado).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. O que veio da planilha só o gestor apaga
--
-- Pela regra da migração 28, o operador apagaria o próprio registro enquanto
-- a competência estivesse aberta — inclusive as linhas importadas, que ele
-- não registrou. Registro anterior a 26/09/2026 o operador nem consegue
-- criar; apagar passa a seguir o mesmo corte.
-- ---------------------------------------------------------------------------
drop policy if exists presenciais_exclusao on public.atendimentos_presenciais;
create policy presenciais_exclusao on public.atendimentos_presenciais
  for delete using (
    public.eh_gestor()
    or (
      pessoa_id = public.pessoa_atual()
      and data >= date '2026-09-26'
      and not exists (
        select 1 from public.fechamentos_cota f
         where f.pessoa_id = atendimentos_presenciais.pessoa_id
           and f.mes_competencia = public.mes_de_competencia(atendimentos_presenciais.data)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 5. O extrato passa a contar o registro desde setembro
--
-- Igual à migração 28, com uma diferença: o corte do presencial registrado
-- vai de 26/09/2026 para 26/08/2026, início da competência de setembro. O
-- motivo do corte — não somar registro e lançamento manual no mesmo mês —
-- deixou de existir para setembro, porque o manual saiu no passo 3.
--
-- Para o operador nada muda: a tela e a trava continuam aceitando registro
-- só a partir de 26/09/2026, com prazo de 2 dias úteis.
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

  -- Presencial registrado: uma linha por atendimento, contadas por semana.
  --
  -- A partir de 26/08/2026, início da competência de setembro — a primeira
  -- em que o registro substituiu o lançamento manual (migração 29).
  select a.pessoa_id,
         public.mes_de_competencia(a.data),
         public.semana_do_ciclo(a.data),
         null,
         r.chave, count(*)::numeric, null
    from public.atendimentos_presenciais a
    join public.regras r on r.chave = 'presencial' and r.ativo
   where a.data >= date '2026-08-26'
   group by a.pessoa_id, public.mes_de_competencia(a.data), public.semana_do_ciclo(a.data), r.chave;

-- ---------------------------------------------------------------------------
-- Conferência: por pessoa, o que havia no lançamento manual, o que entrou da
-- planilha, o que o extrato conta agora e se setembro já está fechado.
-- O esperado é "planilha" igual a "no_extrato" em todas as linhas, e 31 no
-- total da planilha.
-- ---------------------------------------------------------------------------
select p.nome,
       coalesce(ant.quantidade, 0)  as manual_anterior,
       coalesce(pla.linhas, 0)      as planilha,
       coalesce(ext.quantidade, 0)  as no_extrato,
       (f.id is not null)           as setembro_fechado
  from public.pessoas p
  left join (select pessoa_id, sum(quantidade) as quantidade
               from public.lancamentos_substituidos
              where regra = 'presencial' and mes_competencia = date '2026-09-01'
              group by pessoa_id) ant on ant.pessoa_id = p.id
  left join (select pessoa_id, count(*) as linhas
               from public.atendimentos_presenciais
              where public.mes_de_competencia(data) = date '2026-09-01'
              group by pessoa_id) pla on pla.pessoa_id = p.id
  left join (select pessoa_id, sum(quantidade) as quantidade
               from public.vw_extrato_quantidades
              where regra = 'presencial' and mes_competencia = date '2026-09-01'
              group by pessoa_id) ext on ext.pessoa_id = p.id
  left join public.fechamentos_cota f
    on f.pessoa_id = p.id and f.mes_competencia = date '2026-09-01'
 where ant.pessoa_id is not null or pla.pessoa_id is not null
 order by p.nome;
