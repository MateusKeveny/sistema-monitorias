-- ============================================================================
-- Ciclo de metrificação da IGreen: o mês vai do dia 26 ao dia 25.
-- Rode DEPOIS de 04-senha-primeiro-acesso.sql. Pode ser executado mais de uma vez.
--
-- Até aqui o sistema usava o mês do calendário, o que jogava 31 das 52
-- monitorias na competência errada — uma monitoria de 27/07, por exemplo,
-- pertence a agosto. As semanas informadas na planilha já seguiam este ciclo
-- (conferiram em 52 de 52), então só a derivação do mês estava fora.
-- ============================================================================

-- Mês de competência: dia >= 26 já pertence ao mês seguinte.
create or replace function public.mes_de_competencia(p_data date)
returns date
language sql
immutable
as $$
  select case
    when extract(day from p_data) >= 26
      then (date_trunc('month', p_data) + interval '1 month')::date
    else date_trunc('month', p_data)::date
  end;
$$;

-- Semana do ciclo:  1ª 26–02 | 2ª 03–10 | 3ª 11–18 | 4ª 19–25
create or replace function public.semana_do_ciclo(p_data date)
returns smallint
language sql
immutable
as $$
  select (case
    when extract(day from p_data) >= 26 or extract(day from p_data) <= 2 then 1
    when extract(day from p_data) <= 10 then 2
    when extract(day from p_data) <= 18 then 3
    else 4
  end)::smallint;
$$;

-- O trigger passa a derivar mês e semana da data do atendimento. Ambos são
-- função determinística da data, então deixam de ser digitados: elimina a
-- chance de a semana ser marcada errada no formulário.
create or replace function public.definir_mes_referencia()
returns trigger language plpgsql as $$
begin
  new.mes_referencia := public.mes_de_competencia(new.data_atendimento);
  new.semana_mes     := public.semana_do_ciclo(new.data_atendimento);
  return new;
end;
$$;

drop trigger if exists preencher_mes_referencia on public.monitorias;
create trigger preencher_mes_referencia
  before insert or update of data_atendimento on public.monitorias
  for each row execute function public.definir_mes_referencia();

-- Recalcula o histórico. Conferido antes de rodar: nenhuma linha colide com o
-- índice único (operador, mês, semana, nº) depois da mudança.
update public.monitorias
   set mes_referencia = public.mes_de_competencia(data_atendimento),
       semana_mes     = public.semana_do_ciclo(data_atendimento)
 where mes_referencia is distinct from public.mes_de_competencia(data_atendimento)
    or semana_mes     is distinct from public.semana_do_ciclo(data_atendimento);
