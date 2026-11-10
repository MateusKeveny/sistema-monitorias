-- 104: SLA dos chamados em faixas configuráveis (Performance 4.3.0).
--
-- Até aqui o prazo era fixo: "menos de 3,0 dias úteis" escrito no cálculo da
-- cota, na fila de atrasos, na justificativa e na conferência da importação.
-- Agora as faixas são as próprias regras "chamados_sla_*", com faixa_min e
-- faixa_max em HORAS (o tempo do Elo vem em dias úteis de 24 h: horas =
-- tempo_util × 24). A gestão escolhe quantas faixas e os limites em
-- Configuração › Faixas e nomes das métricas.
--
--   chamados_sla_ate_2d    a primeira faixa (começa no zero)
--   chamados_sla_f2..f5    as do meio, criadas pela tela quando precisar
--   chamados_sla_acima_2d  a última, sem teto: é o "fora do prazo", vai para a
--                          fila de atrasos e só conta com a decisão "manter"
--
-- As chaves antigas ficam (pesos, histórico e lançamentos manuais apontam para
-- elas). O prazo passa a ser o começo da última faixa: sla_prazo_dias().
--
-- Mudar as faixas vale já no mês em aberto (como os pesos); o mês fechado
-- continua com o fechamento (migração 102).
--
-- As visões e funções são trocadas por substituição do trecho exato, com
-- erro se o trecho não for encontrado: assim nada muda além do prazo.

begin;

-- 1. As duas faixas de hoje, em horas: até 72 h e 72 h ou mais.
update regras set faixa_min = 0,  faixa_max = 72   where chave = 'chamados_sla_ate_2d';
update regras set faixa_min = 72, faixa_max = null where chave = 'chamados_sla_acima_2d';

-- 2. O prazo em dias úteis do Elo: onde começa o "fora do prazo".
create or replace function public.sla_prazo_dias()
returns numeric language sql stable as $$
  select coalesce((select faixa_min from regras where chave = 'chamados_sla_acima_2d' and ativo), 72) / 24
$$;
grant execute on function public.sla_prazo_dias() to authenticated;

-- 3. O cálculo da cota: cada chamado cai na faixa em que o seu tempo está.
do $$
declare
  t text := pg_get_viewdef('public.vw_extrato_quantidades'::regclass);
  n text;
begin
  n := replace(t,
$a$CROSS JOIN LATERAL ( VALUES ('chamados_tratados'::text,true), ('chamados_sla_ate_2d'::text,(c.tempo_util < (3)::numeric)), ('chamados_sla_acima_2d'::text,((c.tempo_util >= (3)::numeric) AND (c.decisao = 'manter'::text)))) x(regra, conta))$a$,
$b$CROSS JOIN LATERAL ( SELECT 'chamados_tratados'::text AS regra, true AS conta
         UNION ALL
         SELECT s.chave, (((c.tempo_util * (24)::numeric) >= COALESCE(s.faixa_min, (0)::numeric))
                AND ((s.faixa_max IS NULL) OR ((c.tempo_util * (24)::numeric) < s.faixa_max))
                AND ((s.faixa_max IS NOT NULL) OR (c.decisao = 'manter'::text)))
           FROM regras s
          WHERE (s.ativo AND starts_with(s.chave, 'chamados_sla_'::text))) x(regra, conta))$b$);
  if n = t then raise exception 'vw_extrato_quantidades: trecho dos chamados não encontrado'; end if;
  execute 'create or replace view public.vw_extrato_quantidades with (security_invoker = true) as ' || n;
end $$;

-- 4. A conferência dos lançamentos manuais: todas as faixas do SLA somam.
do $$
declare
  t text := pg_get_viewdef('public.vw_lancamentos_a_conferir'::regclass);
  n text;
begin
  n := replace(t,
$a$(lancamentos.regra = ANY (ARRAY['chamados_sla_ate_2d'::text, 'chamados_sla_acima_2d'::text]))$a$,
$b$starts_with(lancamentos.regra, 'chamados_sla_'::text)$b$);
  if n = t then raise exception 'vw_lancamentos_a_conferir: trecho do SLA não encontrado'; end if;
  execute 'create or replace view public.vw_lancamentos_a_conferir with (security_invoker = true) as ' || n;
end $$;

-- 5. Fila de atrasos na Agenda, conferência da importação e justificativa:
--    o prazo fixo (3) vira sla_prazo_dias().
do $$
declare
  t text; n text;
begin
  t := pg_get_functiondef('public.agenda_pendencias_internas()'::regprocedure);
  n := replace(t, 'c.tempo_util >= 3 and', 'c.tempo_util >= sla_prazo_dias() and');
  if n = t then raise exception 'agenda_pendencias_internas: prazo não encontrado'; end if;
  execute n;

  t := pg_get_functiondef('public.conferir_chamados(jsonb)'::regprocedure);
  n := replace(t, $a$(v_linha->>'tempo_util')::numeric < 3 then$a$, $a$(v_linha->>'tempo_util')::numeric < sla_prazo_dias() then$a$);
  if n = t then raise exception 'conferir_chamados: prazo não encontrado'; end if;
  execute n;

  t := pg_get_functiondef('public.justificar_atraso_chamado(bigint,text)'::regprocedure);
  n := replace(t, 'v.tempo_util < 3 then', 'v.tempo_util < sla_prazo_dias() then');
  if n = t then raise exception 'justificar_atraso_chamado: prazo não encontrado'; end if;
  execute n;
end $$;

commit;
