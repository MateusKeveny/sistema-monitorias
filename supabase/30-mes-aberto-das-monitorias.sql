-- ============================================================================
-- Monitorias — o mês seguinte só abre depois do fechamento da cota
-- Rode DEPOIS de 29-presencial-de-setembro.sql. Pode ser executado mais de
-- uma vez.
--
-- Política definida pelo gestor em 28/09/2026: enquanto setembro não for
-- fechado, o painel de Monitorias continua em setembro e outubro não aparece
-- nem aceita monitoria. "Fechado" é o fechamento da cota no Performance
-- (fechamentos_cota): a nota de monitoria entra na cota, então setembro só
-- termina quando a cota dele foi entregue.
--
-- O mês aberto é o seguinte ao último fechamento. Sem fechamento nenhum, vale
-- o mês do calendário.
--
-- A trava fica no banco, e não só na tela: senão bastaria mudar a data no
-- formulário para passar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Qual é o mês aberto
--
-- `security definer` pelo mesmo motivo de `bonus_da_competencia`: com a RLS,
-- o operador só enxerga o próprio fechamento, e o mês aberto dependeria de
-- quem pergunta. Devolve só a data.
-- ---------------------------------------------------------------------------
create or replace function public.mes_aberto_das_monitorias()
returns date language sql stable security definer set search_path = public as $$
  select coalesce(
    (select (max(mes_competencia) + interval '1 month')::date from public.fechamentos_cota),
    public.mes_de_competencia((now() at time zone 'America/Sao_Paulo')::date)
  );
$$;

revoke all on function public.mes_aberto_das_monitorias() from public, anon;
grant execute on function public.mes_aberto_das_monitorias() to authenticated;

comment on function public.mes_aberto_das_monitorias() is
  'Mês de competência aberto para monitorias: o seguinte ao último fechamento da cota.';

-- ---------------------------------------------------------------------------
-- 2. A trava: monitoria de mês depois do aberto é recusada
--
-- O mês sai da data do atendimento pela mesma regra do resto do sistema
-- (ciclo 26 → 25), calculado aqui mesmo para não depender da ordem em que os
-- gatilhos rodam. Vale para lançar e para mudar a data de uma monitoria.
-- ---------------------------------------------------------------------------
create or replace function public.conferir_mes_aberto_da_monitoria()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_mes    date := public.mes_de_competencia(new.data_atendimento);
  v_aberto date := public.mes_aberto_das_monitorias();
begin
  if v_mes > v_aberto then
    raise exception 'A competência % só abre para monitorias depois do fechamento da cota de %.',
      to_char(v_mes, 'MM/YYYY'), to_char(v_aberto, 'MM/YYYY');
  end if;
  return new;
end;
$$;

drop trigger if exists monitorias_mes_aberto on public.monitorias;
create trigger monitorias_mes_aberto
  before insert or update of data_atendimento on public.monitorias
  for each row execute function public.conferir_mes_aberto_da_monitoria();

-- ---------------------------------------------------------------------------
-- Conferência: o mês aberto e quantas monitorias já existem depois dele
-- (lançadas antes desta trava). Elas não são apagadas, mas somem da seleção de
-- mês e ficam sem edição até o mês aberto ser fechado — o formulário manda a
-- data do atendimento junto, e a trava confere.
-- ---------------------------------------------------------------------------
select public.mes_aberto_das_monitorias() as mes_aberto,
       (select count(*) from public.monitorias
         where mes_referencia > public.mes_aberto_das_monitorias()) as monitorias_depois_do_aberto;
