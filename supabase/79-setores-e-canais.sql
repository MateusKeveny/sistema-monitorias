-- ============================================================================
-- 79 · Setores e canais em árvore — etapa 1 (cadastro)
--
-- Primeira etapa do plano da 3.0 (docs/PLANO-SETORES.md): o setor e os
-- canais passam a existir como cadastro. O setor é a equipe; os canais são
-- como o relatório do Hub separa os atendimentos.
--
--   Conexão Expansão                ← setor
--   ├── Expansão                    ← canal (hoje 'huggy')
--   └── Diretores-Expansão          ← canal (hoje 'diretores')
--
-- Nesta etapa NADA do cálculo muda: o canal continua sendo o texto 'huggy' /
-- 'diretores' em volume, lançamentos e avaliações. O cadastro só diz à
-- importação do Hub quais nomes de setor vão para cada canal ("nomes no Hub")
-- — o que estava fixo no código. Setor do Hub fora da árvore continua virando
-- demanda extra pendente (migração 78).
--
-- A tabela é `canais_do_setor`, e não `canais`: `public.canais` já existe e é
-- das Monitorias (o canal da monitoria, migração 01).
--
-- `apelido` liga o canal ao texto que o cálculo usa hoje; canal sem apelido
-- só passa a contar quando o cálculo ler o cadastro (etapa 3).
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo.
-- ============================================================================

create table if not exists public.setores (
  id        smallint generated always as identity primary key,
  nome      text not null unique,
  ativo     boolean not null default true,
  ordem     integer not null default 0,
  criado_em timestamptz not null default now()
);

create table if not exists public.canais_do_setor (
  id           smallint generated always as identity primary key,
  setor_id     smallint not null references public.setores (id) on delete restrict,
  nome         text not null,
  apelido      text unique check (apelido in ('huggy', 'diretores')),
  nomes_no_hub text[] not null default '{}',
  ativo        boolean not null default true,
  ordem        integer not null default 0,
  criado_em    timestamptz not null default now(),
  unique (setor_id, nome)
);

alter table public.setores enable row level security;
alter table public.canais_do_setor enable row level security;
-- Leitura para quem está logado (a importação e as telas leem a árvore);
-- só o gestor muda.
drop policy if exists setores_leitura on public.setores;
create policy setores_leitura on public.setores for select using (auth.uid() is not null);
drop policy if exists setores_gestor on public.setores;
create policy setores_gestor on public.setores for all using (public.eh_gestor()) with check (public.eh_gestor());
drop policy if exists canais_do_setor_leitura on public.canais_do_setor;
create policy canais_do_setor_leitura on public.canais_do_setor for select using (auth.uid() is not null);
drop policy if exists canais_do_setor_gestor on public.canais_do_setor;
create policy canais_do_setor_gestor on public.canais_do_setor for all using (public.eh_gestor()) with check (public.eh_gestor());

-- A árvore de hoje. Pode rodar de novo: não duplica nem sobrescreve o que o
-- gestor já mudou na tela.
insert into public.setores (nome, ordem) values ('Conexão Expansão', 1)
on conflict (nome) do nothing;

insert into public.canais_do_setor (setor_id, nome, apelido, nomes_no_hub, ordem)
select s.id, c.nome, c.apelido, c.nomes, c.ordem
  from public.setores s,
       (values ('Expansão', 'huggy', array['Expansão'], 1),
               ('Diretores-Expansão', 'diretores', array['Diretores-Expansão'], 2)) as c(nome, apelido, nomes, ordem)
 where s.nome = 'Conexão Expansão'
on conflict (apelido) do nothing;

-- Setores do Hub que já apareceram fora da árvore (os da demanda extra
-- pendente, migração 78), com quantos atendimentos e quando por último.
create or replace view public.vw_setores_do_hub_vistos with (security_invoker = true) as
  select setor, count(*)::int as atendimentos, max(data) as ultima_vez
    from public.atendimentos_outro_setor
   group by setor;

-- Conferência
select (select count(*) from public.setores) as setores,
       (select count(*) from public.canais_do_setor) as canais;
