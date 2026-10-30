-- ============================================================================
-- 93 · Escala da pessoa e aviso de ritmo (quadro "Para bater a meta", 3.0)
--
--   · pessoas.dias_de_trabalho — os dias da semana em que a pessoa atende
--     (1 = segunda … 7 = domingo). Sem preencher: segunda a sexta. Serve ao
--     "atendimentos a mais por dia" do quadro, que conta só os dias de escala
--     (e desconta as férias).
--   · avisar_ritmo() — quando o mês tem semana nova lançada e a projeção da
--     pessoa (a média das semanas lançadas valendo para as que faltam, a mesma
--     conta do "Seu ritmo") fica abaixo da meta, avisa no sino: "Seu ritmo está
--     abaixo da meta". Um aviso por semana lançada, sem repetir. Roda todo dia
--     às 9h (agendamento "aviso-de-ritmo"), sobre o resumo pronto.
--
-- ADITIVO: não muda cálculo, cota, fechamento nem o que cada um vê.
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez.
-- ============================================================================

begin;

-- 1. A escala.
alter table public.pessoas add column if not exists dias_de_trabalho smallint[] not null default '{1,2,3,4,5}';
alter table public.pessoas drop constraint if exists pessoas_dias_de_trabalho_validos;
alter table public.pessoas add constraint pessoas_dias_de_trabalho_validos
  check (cardinality(dias_de_trabalho) between 1 and 7 and dias_de_trabalho <@ '{1,2,3,4,5,6,7}'::smallint[]);

-- 2. O aviso de ritmo.
drop function if exists public.avisar_ritmo();
-- p_mes: só para conferir um mês passado; o agendamento usa o mês corrente.
create or replace function public.avisar_ritmo(p_mes date default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_mes     date := coalesce(p_mes, public.mes_de_competencia((now() at time zone 'America/Sao_Paulo')::date));
  v_semanas smallint[];
  v_n       integer := 0;
  v_proj    numeric;
  r         record;
begin
  -- As semanas já lançadas no mês (o volume é digitado quando a semana fecha).
  select array_agg(distinct semana order by semana) into v_semanas
    from public.volume_semanal where mes_competencia = v_mes;
  -- Sem semana lançada, ou com o mês todo lançado, não há ritmo a projetar.
  if v_semanas is null or cardinality(v_semanas) >= 4 then return 0; end if;

  for r in
    select m.pessoa_id, m.meta,
           coalesce(sum(e.cota) filter (where e.semana is null), 0) as do_mes,
           coalesce(sum(e.cota) filter (where e.semana = any (v_semanas)), 0) as das_semanas
      from public.resumo_cota_mensal m
      join public.pessoas p on p.id = m.pessoa_id and p.papel = 'operador' and p.ativo and p.desligado_em is null
      left join public.resumo_extrato e on e.pessoa_id = m.pessoa_id and e.mes_competencia = m.mes_competencia
     where m.mes_competencia = v_mes and m.meta > 0
     group by m.pessoa_id, m.meta
  loop
    v_proj := r.do_mes + r.das_semanas / cardinality(v_semanas) * 4;
    continue when v_proj >= r.meta;
    insert into public.avisos_da_pessoa (pessoa_id, chave, titulo, texto, link)
    values (r.pessoa_id,
            format('ritmo/%s/%s/%s', to_char(v_mes, 'YYYY-MM'), cardinality(v_semanas), r.pessoa_id),
            'Seu ritmo está abaixo da meta',
            format('No ritmo das %s semana%s lançada%s, você fecha %s com cerca de %s pts (meta: %s). Veja no Início o que fazer para chegar lá.',
                   cardinality(v_semanas), case when cardinality(v_semanas) = 1 then '' else 's' end,
                   case when cardinality(v_semanas) = 1 then '' else 's' end,
                   public.nome_do_mes(v_mes),
                   replace(to_char(round(v_proj), 'FM999,999'), ',', '.'), replace(to_char(round(r.meta), 'FM999,999'), ',', '.')),
            '/cota')
    on conflict (chave) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.avisar_ritmo(date) from public, anon, authenticated;

-- 3. Todo dia às 9h (12h UTC).
do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'aviso-de-ritmo' limit 1;
  if v_job is null then
    perform cron.schedule('aviso-de-ritmo', '0 12 * * *', 'select public.avisar_ritmo()');
  end if;
end $$;

commit;

-- Conferência
select count(*) filter (where dias_de_trabalho = '{1,2,3,4,5}') as com_escala_padrao, count(*) as pessoas from public.pessoas;
select jobname, schedule from cron.job where jobname = 'aviso-de-ritmo';
