-- ============================================================================
-- Sistema de Monitorias de Qualidade (C-SAT) - IGreen Energia
-- Instalacao completa do banco. Cole TUDO no SQL Editor do Supabase e rode.
-- Pode ser executado mais de uma vez sem problema.
-- ============================================================================

-- ============================================================================
-- Sistema de Monitorias de Qualidade (C-SAT) — IGreen Energia
-- Schema base. Rode este arquivo no SQL Editor do Supabase.
-- ============================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------- cadastros
create table if not exists public.operadores (
  id          uuid primary key default uuid_generate_v4(),
  nome        text not null unique,
  email       text unique,
  ativo       boolean not null default true,
  criado_em   timestamptz not null default now()
);

create table if not exists public.canais (
  id     uuid primary key default uuid_generate_v4(),
  nome   text not null unique,
  ativo  boolean not null default true
);

-- Os 19 critérios do formulário, com o "peso oculto" que a planilha usava.
-- A soma dos pesos ativos deve ser 1,0000.
create table if not exists public.criterios (
  id     uuid primary key default uuid_generate_v4(),
  ordem  integer not null,
  nome   text not null unique,
  peso   numeric(6,4) not null check (peso >= 0 and peso <= 1),
  ativo  boolean not null default true
);
create unique index if not exists criterios_ordem_idx on public.criterios (ordem) where ativo;

-- ------------------------------------------------------------------ perfis
-- Espelha auth.users e define o papel de acesso.
--   admin    -> qualidade: lança monitorias e administra cadastros
--   gestor   -> enxerga o time inteiro e os relatórios, não edita cadastros
--   operador -> enxerga apenas as próprias monitorias
do $$ begin
  create type public.papel_usuario as enum ('admin', 'gestor', 'operador');
exception when duplicate_object then null;
end $$;

create table if not exists public.perfis (
  id           uuid primary key references auth.users (id) on delete cascade,
  nome         text not null,
  email        text not null,
  papel        public.papel_usuario not null default 'operador',
  operador_id  uuid references public.operadores (id) on delete set null,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now()
);

-- Cria o perfil automaticamente quando um usuário se cadastra.
create or replace function public.tratar_novo_usuario()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome, email, papel)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
    new.email,
    'operador'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.tratar_novo_usuario();

-- --------------------------------------------------------------- monitorias
create table if not exists public.monitorias (
  id                    uuid primary key default uuid_generate_v4(),
  protocolo             text not null,
  data_atendimento      date not null,
  semana_mes            smallint not null check (semana_mes between 1 and 5),
  numero_monitoria      smallint not null check (numero_monitoria between 1 and 10),
  operador_id           uuid not null references public.operadores (id) on delete restrict,
  canal_id              uuid references public.canais (id) on delete set null,
  tempo_atendimento_seg integer,
  -- nota_final é calculada por trigger a partir dos itens; nunca digitada à mão.
  nota_final            numeric(6,4) not null default 1 check (nota_final between 0 and 1),
  zerado                boolean not null default false,
  motivo_zeramento      text,
  parecer               text,
  monitor_id            uuid references public.perfis (id) on delete set null,
  -- Primeiro dia do mês do atendimento. É coluna de verdade, preenchida pelo
  -- trigger abaixo, e não uma expressão: assim serve de chave de unicidade e de
  -- agrupamento dos relatórios sem custo de cálculo a cada consulta.
  mes_referencia        date,
  criado_em             timestamptz not null default now(),
  atualizado_em         timestamptz not null default now()
);

-- Em bancos criados por versões anteriores deste script, garante a coluna nova.
alter table public.monitorias add column if not exists mes_referencia date;

create or replace function public.definir_mes_referencia()
returns trigger language plpgsql as $$
begin
  new.mes_referencia := make_date(
    extract(year  from new.data_atendimento)::int,
    extract(month from new.data_atendimento)::int,
    1);
  return new;
end;
$$;

drop trigger if exists preencher_mes_referencia on public.monitorias;
create trigger preencher_mes_referencia
  before insert or update of data_atendimento on public.monitorias
  for each row execute function public.definir_mes_referencia();

-- Preenche o que já existir na tabela antes de exigir a coluna.
update public.monitorias
   set mes_referencia = make_date(
         extract(year  from data_atendimento)::int,
         extract(month from data_atendimento)::int, 1)
 where mes_referencia is null;

alter table public.monitorias alter column mes_referencia set not null;

-- Evita lançar duas vezes a mesma monitoria para o mesmo operador no mesmo mês.
create unique index if not exists monitorias_slot_idx
  on public.monitorias (operador_id, mes_referencia, semana_mes, numero_monitoria);
create index if not exists monitorias_mes_idx      on public.monitorias (mes_referencia);
create index if not exists monitorias_operador_idx on public.monitorias (operador_id);
create index if not exists monitorias_data_idx     on public.monitorias (data_atendimento);
create index if not exists monitorias_protocolo_idx on public.monitorias (protocolo);

create table if not exists public.monitoria_itens (
  id           uuid primary key default uuid_generate_v4(),
  monitoria_id uuid not null references public.monitorias (id) on delete cascade,
  criterio_id  uuid not null references public.criterios (id) on delete restrict,
  conforme     boolean not null,
  observacao   text,
  unique (monitoria_id, criterio_id)
);
create index if not exists itens_monitoria_idx on public.monitoria_itens (monitoria_id);

-- ------------------------------------------------------- cálculo automático
-- Reproduz exatamente a fórmula da planilha:
--   zerado = Sim  ->  0
--   caso contrário ->  1 - (soma dos pesos dos critérios marcados "Não")
create or replace function public.recalcular_nota(p_monitoria uuid)
returns void language plpgsql as $$
declare
  v_perdido numeric(8,4);
  v_zerado  boolean;
begin
  select zerado into v_zerado from public.monitorias where id = p_monitoria;
  if v_zerado is null then return; end if;

  select coalesce(sum(c.peso), 0) into v_perdido
  from public.monitoria_itens i
  join public.criterios c on c.id = i.criterio_id
  where i.monitoria_id = p_monitoria and i.conforme = false;

  update public.monitorias
     set nota_final    = case when v_zerado then 0
                              else greatest(0, round(1 - v_perdido, 4)) end,
         atualizado_em = now()
   where id = p_monitoria;
end;
$$;

create or replace function public.ao_mudar_item()
returns trigger language plpgsql as $$
begin
  perform public.recalcular_nota(coalesce(new.monitoria_id, old.monitoria_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists itens_recalculam_nota on public.monitoria_itens;
create trigger itens_recalculam_nota
  after insert or update or delete on public.monitoria_itens
  for each row execute function public.ao_mudar_item();

create or replace function public.ao_mudar_zeramento()
returns trigger language plpgsql as $$
begin
  if new.zerado is distinct from old.zerado then
    perform public.recalcular_nota(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists zeramento_recalcula_nota on public.monitorias;
create trigger zeramento_recalcula_nota
  after update of zerado on public.monitorias
  for each row execute function public.ao_mudar_zeramento();

-- ============================================================================
-- Row Level Security: quem enxerga e edita o quê.
-- Rode DEPOIS de 01-schema.sql.
-- ============================================================================

-- Funções auxiliares. SECURITY DEFINER para poderem ler public.perfis
-- sem cair na própria RLS (evita recursão infinita nas políticas).
create or replace function public.papel_atual()
returns public.papel_usuario language sql stable security definer set search_path = public as $$
  select papel from public.perfis where id = auth.uid() and ativo;
$$;

create or replace function public.operador_atual()
returns uuid language sql stable security definer set search_path = public as $$
  select operador_id from public.perfis where id = auth.uid() and ativo;
$$;

create or replace function public.eh_admin()
returns boolean language sql stable as $$ select public.papel_atual() = 'admin'; $$;

create or replace function public.eh_gestor_ou_admin()
returns boolean language sql stable as $$
  select public.papel_atual() in ('admin', 'gestor');
$$;

alter table public.perfis           enable row level security;
alter table public.operadores       enable row level security;
alter table public.canais           enable row level security;
alter table public.criterios        enable row level security;
alter table public.monitorias       enable row level security;
alter table public.monitoria_itens  enable row level security;

-- ------------------------------------------------------------------ perfis
drop policy if exists perfis_ler_proprio on public.perfis;
create policy perfis_ler_proprio on public.perfis
  for select using (id = auth.uid() or public.eh_gestor_ou_admin());

drop policy if exists perfis_editar_proprio on public.perfis;
create policy perfis_editar_proprio on public.perfis
  for update using (id = auth.uid())
  with check (id = auth.uid() and papel = public.papel_atual());

drop policy if exists perfis_admin_total on public.perfis;
create policy perfis_admin_total on public.perfis
  for all using (public.eh_admin()) with check (public.eh_admin());

-- ------------------------------------------------- cadastros (leitura geral)
drop policy if exists operadores_leitura on public.operadores;
create policy operadores_leitura on public.operadores
  for select using (auth.uid() is not null);

drop policy if exists operadores_admin on public.operadores;
create policy operadores_admin on public.operadores
  for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists canais_leitura on public.canais;
create policy canais_leitura on public.canais
  for select using (auth.uid() is not null);

drop policy if exists canais_admin on public.canais;
create policy canais_admin on public.canais
  for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists criterios_leitura on public.criterios;
create policy criterios_leitura on public.criterios
  for select using (auth.uid() is not null);

drop policy if exists criterios_admin on public.criterios;
create policy criterios_admin on public.criterios
  for all using (public.eh_admin()) with check (public.eh_admin());

-- -------------------------------------------------------------- monitorias
-- Operador vê apenas as próprias; gestor e admin veem todas.
drop policy if exists monitorias_leitura on public.monitorias;
create policy monitorias_leitura on public.monitorias
  for select using (
    public.eh_gestor_ou_admin()
    or operador_id = public.operador_atual()
  );

-- Somente a qualidade (admin) lança e edita monitorias.
drop policy if exists monitorias_escrita on public.monitorias;
create policy monitorias_escrita on public.monitorias
  for all using (public.eh_admin()) with check (public.eh_admin());

drop policy if exists itens_leitura on public.monitoria_itens;
create policy itens_leitura on public.monitoria_itens
  for select using (
    exists (
      select 1 from public.monitorias m
      where m.id = monitoria_id
        and (public.eh_gestor_ou_admin() or m.operador_id = public.operador_atual())
    )
  );

drop policy if exists itens_escrita on public.monitoria_itens;
create policy itens_escrita on public.monitoria_itens
  for all using (public.eh_admin()) with check (public.eh_admin());

-- ============================================================================
-- Views de relatório. Rode DEPOIS de 02-seguranca.sql.
-- As views usam security_invoker, então herdam a RLS das tabelas base: um
-- operador que consultar qualquer uma delas enxerga apenas os próprios números.
-- ============================================================================

-- Monitoria "achatada" — base de todos os relatórios e da exportação bruta.
create or replace view public.vw_monitorias with (security_invoker = true) as
select
  m.id,
  m.protocolo,
  m.data_atendimento,
  m.mes_referencia,
  extract(year  from m.data_atendimento)::int   as ano,
  extract(month from m.data_atendimento)::int   as mes,
  m.semana_mes,
  m.numero_monitoria,
  o.id   as operador_id,
  o.nome as operador,
  c.nome as canal,
  m.tempo_atendimento_seg,
  m.nota_final,
  m.zerado,
  m.motivo_zeramento,
  m.parecer,
  p.nome as monitor,
  m.criado_em
from public.monitorias m
join public.operadores o on o.id = m.operador_id
left join public.canais c on c.id = m.canal_id
left join public.perfis p on p.id = m.monitor_id;

-- Relatório 1: ranking mensal por operador.
create or replace view public.vw_ranking_mensal with (security_invoker = true) as
select
  mes_referencia,
  operador_id,
  operador,
  count(*)::int                               as total_monitorias,
  round(avg(nota_final), 4)                   as nota_media,
  min(nota_final)                             as nota_minima,
  max(nota_final)                             as nota_maxima,
  count(*) filter (where zerado)::int         as zeradas,
  count(*) filter (where nota_final = 1)::int as impecaveis,
  round(avg(nota_final) filter (where not zerado), 4) as nota_media_sem_zeradas
from public.vw_monitorias
group by mes_referencia, operador_id, operador;

-- Relatório 3: critérios mais reprovados, com o impacto real na nota do time.
create or replace view public.vw_criterios_reprovados with (security_invoker = true) as
select
  m.mes_referencia,
  cr.id   as criterio_id,
  cr.nome as criterio,
  cr.peso,
  count(*)::int                              as avaliacoes,
  count(*) filter (where not i.conforme)::int as reprovacoes,
  round(
    count(*) filter (where not i.conforme)::numeric / nullif(count(*), 0),
    4)                                       as taxa_reprovacao,
  round(count(*) filter (where not i.conforme) * cr.peso, 4) as pontos_perdidos
from public.monitoria_itens i
join public.monitorias m  on m.id  = i.monitoria_id
join public.criterios  cr on cr.id = i.criterio_id
group by 1, cr.id, cr.nome, cr.peso;

-- Relatório 2: base do feedback individual — cada critério avaliado da pessoa.
create or replace view public.vw_feedback_individual with (security_invoker = true) as
select
  m.id   as monitoria_id,
  o.id   as operador_id,
  o.nome as operador,
  m.protocolo,
  m.data_atendimento,
  m.mes_referencia,
  m.semana_mes,
  m.numero_monitoria,
  m.nota_final,
  m.zerado,
  m.parecer,
  cr.ordem as criterio_ordem,
  cr.nome  as criterio,
  cr.peso,
  i.conforme,
  i.observacao
from public.monitorias m
join public.operadores o      on o.id = m.operador_id
join public.monitoria_itens i on i.monitoria_id = m.id
join public.criterios cr      on cr.id = i.criterio_id;
