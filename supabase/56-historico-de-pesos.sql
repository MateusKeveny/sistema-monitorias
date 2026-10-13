-- ============================================================================
-- 56 · Histórico de alteração de pesos
--
-- Mudar um peso em Configuração recalcula na hora o mês aberto, e não ficava
-- registro: em 09/10 o Analista foi de 4.630 para 4.170 pts com dois ajustes
-- pedidos pela diretoria, e nada na tela dizia por quê. Como a pontuação vira
-- remuneração, cada mudança em `pesos_por_cargo` (peso, meta, multiplicador
-- da média, ligar ou desligar uma métrica) passa a ficar registrada: quem,
-- quando, de quanto para quanto, para qual mês e o motivo.
--
-- Só o gestor lê o histórico (Configuração → Histórico de alterações). Nada
-- aparece no extrato: o gestor explica o ajuste no feedback de cada um.
--
-- O motivo vem da tela, na mesma gravação do peso (coluna
-- `motivo_alteracao`); o gatilho registra e limpa a coluna, para o motivo não
-- ficar grudado no peso para a próxima alteração.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

alter table public.pesos_por_cargo add column if not exists motivo_alteracao text;

create table if not exists public.pesos_historico (
  id                 bigint generated always as identity primary key,
  cargo_id           smallint not null,
  cargo_nome         text,
  regra              text not null,
  regra_rotulo       text,
  peso_antes         numeric(12,4),
  peso_depois        numeric(12,4),
  ativo_antes        boolean,
  ativo_depois       boolean,
  motivo             text,
  vale_para          date not null,
  alterado_por       uuid references public.pessoas (id) on delete set null,
  alterado_por_nome  text,
  alterado_em        timestamptz not null default now()
);

create index if not exists pesos_historico_quando_idx on public.pesos_historico (alterado_em desc);

alter table public.pesos_historico enable row level security;

drop policy if exists pesos_historico_leitura on public.pesos_historico;
create policy pesos_historico_leitura on public.pesos_historico
  for select using (public.eh_gestor());

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
  new.motivo_alteracao := null;
  return new;
end;
$$;

drop trigger if exists pesos_historico_registro on public.pesos_por_cargo;
create trigger pesos_historico_registro
  before insert or update on public.pesos_por_cargo
  for each row execute function public.registrar_alteracao_de_peso();

-- ---------------------------------------------------------------------------
-- Conferência: a tabela, o gatilho e nenhum registro ainda
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.pesos_historico) as alteracoes_registradas,
  (select count(*) from pg_trigger where tgname = 'pesos_historico_registro') as gatilho_criado,
  (select count(*) from information_schema.columns
    where table_name = 'pesos_por_cargo' and column_name = 'motivo_alteracao') as coluna_motivo;
