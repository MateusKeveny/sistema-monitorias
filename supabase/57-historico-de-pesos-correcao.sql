-- ============================================================================
-- 57 · Histórico de pesos: uma linha por alteração, com o motivo
--
-- Na 56 o gatilho era BEFORE INSERT OR UPDATE. A tela grava os pesos com
-- upsert (insert ... on conflict do update): o BEFORE INSERT dispara mesmo
-- quando o insert vira update, registrava uma "criação" que não aconteceu e
-- limpava o motivo; o update que vinha depois era registrado sem motivo. O
-- teste de 09/10 (Analista, "Resolvidos fora do prazo" −5 → −6 → −5) deixou
-- duas linhas por salvamento.
--
-- Agora:
--   - alteração (UPDATE): registrada antes de gravar, com o motivo, e o
--     motivo é limpo da linha do peso;
--   - criação (INSERT): registrada depois de gravar — só quando o insert de
--     fato aconteceu.
-- E as linhas do teste saem.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

create or replace function public.registrar_alteracao_de_peso()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT'
     or new.peso is distinct from old.peso
     or new.ativo is distinct from old.ativo then
    insert into public.pesos_historico (cargo_id, cargo_nome, regra, regra_rotulo, peso_antes, peso_depois,
      ativo_antes, ativo_depois, motivo, vale_para, alterado_por, alterado_por_nome)
    values (new.cargo_id,
      (select nome from public.cargos where id = new.cargo_id),
      new.regra,
      (select rotulo from public.regras where chave = new.regra),
      case when tg_op = 'UPDATE' then old.peso end, new.peso,
      case when tg_op = 'UPDATE' then old.ativo end, new.ativo,
      nullif(trim(new.motivo_alteracao), ''),
      public.mes_de_competencia((now() at time zone 'America/Sao_Paulo')::date),
      public.pessoa_atual(),
      (select nome from public.pessoas where id = public.pessoa_atual()));
  end if;
  if tg_op = 'UPDATE' then
    new.motivo_alteracao := null;
    return new;
  end if;
  return null;
end;
$$;

drop trigger if exists pesos_historico_registro on public.pesos_por_cargo;
drop trigger if exists pesos_historico_alteracao on public.pesos_por_cargo;
drop trigger if exists pesos_historico_criacao on public.pesos_por_cargo;

create trigger pesos_historico_alteracao
  before update on public.pesos_por_cargo
  for each row execute function public.registrar_alteracao_de_peso();

create trigger pesos_historico_criacao
  after insert on public.pesos_por_cargo
  for each row execute function public.registrar_alteracao_de_peso();

-- As quatro linhas do teste de 09/10.
delete from public.pesos_historico
 where regra = 'chamados_sla_acima_2d'
   and (motivo like 'Teste do histórico%' or motivo is null)
   and alterado_em::date = date '2026-10-09';

-- ---------------------------------------------------------------------------
-- Conferência: os dois gatilhos novos, o antigo removido e o histórico limpo
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_trigger where tgname in ('pesos_historico_alteracao', 'pesos_historico_criacao')) as gatilhos_novos,
  (select count(*) from pg_trigger where tgname = 'pesos_historico_registro') as gatilho_antigo,
  (select count(*) from public.pesos_historico) as alteracoes_registradas;
