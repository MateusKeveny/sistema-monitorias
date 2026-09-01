-- ============================================================================
-- Painel de Cota — estrutura e permissões
-- Rode DEPOIS de 11-tabela-unica-de-pessoas.sql. Pode ser executado mais de
-- uma vez.
--
-- As tabelas do painel já existiam (`atendimentos`, `cotas`, `regras`,
-- `volume_semanal`, `lancamentos`), e a forma delas está boa. O que falta é o
-- que este arquivo faz:
--
--   1. Ligar tudo a `pessoas` por id. Hoje a junção é por texto de e-mail, e
--      foi daí que nasceram os erros silenciosos do projeto — monitoria
--      contando zero, atendente sumindo do relatório. Nome e e-mail mudam;
--      id não.
--   2. Passar a competência para `date`, como no resto do sistema. Hoje é
--      texto "2026-08" aqui e `date` nas monitorias, e toda consulta que
--      cruzasse as duas precisava converter.
--   3. Dar políticas de acesso às cinco tabelas. Quatro estão com RLS ligada e
--      NENHUMA política, o que bloqueia todo mundo — inclusive o gestor. É por
--      isso que `atendentes` (12 linhas) e `regras` (33 linhas) têm dado
--      dentro e o painel enxerga vazio, sem erro nenhum.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. O de-para do Huggy vai para `pessoas`
--
-- `atendentes` foi criada pelo projeto do painel e é redundante com `pessoas`.
-- O que ela tem de único é `nome_huggy` — o nome como o Huggy escreve, que é o
-- que permite casar o relatório importado com a pessoa certa.
-- ---------------------------------------------------------------------------
update public.pessoas p
   set nome_huggy = a.nome_huggy
  from public.atendentes a
 where lower(trim(a.email)) = lower(trim(p.email))
   and a.nome_huggy is not null
   and p.nome_huggy is distinct from a.nome_huggy;

-- `nome_monitoria` não é copiado de propósito: as monitorias passaram a se
-- ligar por `pessoas.id`, então casar por nome deixou de existir.

-- ---------------------------------------------------------------------------
-- 2. Ponte por id nas tabelas que já têm dado
-- ---------------------------------------------------------------------------
alter table public.atendimentos
  add column if not exists pessoa_id uuid references public.pessoas (id) on delete restrict,
  -- De onde a linha veio. As avaliações que já estão aqui entraram por macro
  -- do Excel, e não há registro de qual arquivo nem de quando — ficam nulas, o
  -- que é a resposta honesta. Daqui em diante toda importação se identifica:
  -- num sistema que remunera, a diferença entre "o número está certo" e "o
  -- número está certo e eu provo de onde saiu" é o que sustenta uma conversa
  -- com o outro departamento seis meses depois.
  add column if not exists origem_arquivo text,
  add column if not exists importado_por uuid references public.pessoas (id) on delete set null,
  add column if not exists importado_em timestamptz;

update public.atendimentos a
   set pessoa_id = p.id
  from public.pessoas p
 where lower(trim(a.atendente)) = lower(trim(p.email))
   and a.pessoa_id is null;

create index if not exists atendimentos_pessoa_idx
  on public.atendimentos (pessoa_id, data);

alter table public.cotas
  add column if not exists pessoa_id uuid references public.pessoas (id) on delete restrict,
  add column if not exists mes_competencia date;

update public.cotas c
   set pessoa_id = p.id
  from public.pessoas p
 where lower(trim(c.atendente)) = lower(trim(p.email))
   and c.pessoa_id is null;

update public.cotas
   set mes_competencia = (mes_referencia || '-01')::date
 where mes_competencia is null
   and mes_referencia ~ '^\d{4}-\d{2}$';

-- ---------------------------------------------------------------------------
-- 3. As duas tabelas vazias são refeitas na forma certa
--
-- `volume_semanal` e `lancamentos` estão com zero linhas — conferido antes de
-- escrever isto. Por isso dá para trocar `atendente text` por `pessoa_id` e
-- `mes_referencia text` por `date` sem migrar nada.
-- ---------------------------------------------------------------------------
drop table if exists public.volume_semanal cascade;

-- O relatório semanal do Huggy. É daqui que sai `finalizados`, que multiplica
-- quase toda a cota — e que NÃO é a contagem de linhas de `atendimentos`: a
-- base só guarda atendimento que gerou avaliação. Na 1ª semana de agosto a
-- Allana tem 102 finalizados e 98 avaliações.
create table public.volume_semanal (
  id               bigint generated always as identity primary key,
  pessoa_id        uuid not null references public.pessoas (id) on delete restrict,
  mes_competencia  date not null,
  semana           smallint not null check (semana between 1 and 4),
  finalizados      integer not null default 0,
  fila             integer not null default 0,
  transferidos     integer not null default 0,
  avaliacao_media  numeric(6,4),
  -- Unidade no nome: `tma_seg` não deixa dúvida de que são segundos. Os tempos
  -- do Huggy passam de 24h (o TMA do Pedro sai como "33:51:39"), então guardar
  -- como intervalo de relógio perderia o dia.
  tma_seg          integer,
  tmpr_seg         integer,
  tme_seg          integer,
  origem_arquivo   text,
  importado_por    uuid references public.pessoas (id) on delete set null,
  atualizado_em    timestamptz not null default now(),
  unique (pessoa_id, mes_competencia, semana)
);

drop table if exists public.lancamentos cascade;

-- O que não existe em sistema nenhum e o gestor digita: diretores, executivos,
-- faixas de tempo de resposta, demandas extras e o "zera o dia".
--
-- `semana` nula significa lançamento do mês inteiro, que é como os diretores
-- entram hoje — consolidado, não por semana.
create table public.lancamentos (
  id               bigint generated always as identity primary key,
  pessoa_id        uuid not null references public.pessoas (id) on delete restrict,
  mes_competencia  date not null,
  semana           smallint check (semana between 1 and 4),
  regra            text not null references public.regras (chave) on delete restrict,
  quantidade       numeric(12,4) not null default 0,
  -- Escape para o caso em que o valor não sai de quantidade × peso. Hoje o
  -- único é "Inconsistência de atendimentos", que a planilha resolve com o
  -- texto "Zera o dia" e nenhuma fórmula: o gestor digita o valor.
  pontos_manuais   numeric(12,4),
  observacao       text,
  lancado_por      uuid references public.pessoas (id) on delete set null,
  lancado_por_nome text,
  criado_em        timestamptz not null default now()
);

create index if not exists lancamentos_pessoa_idx
  on public.lancamentos (pessoa_id, mes_competencia);

-- ---------------------------------------------------------------------------
-- 4. Quem lança fica registrado
--
-- Mesmo padrão das monitorias: o nome é gravado junto do id, para o extrato
-- continuar legível mesmo que a pessoa saia do cadastro depois.
-- ---------------------------------------------------------------------------
create or replace function public.marcar_autor_lancamento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lancado_por is null then
    new.lancado_por := public.pessoa_atual();
  end if;
  select nome into new.lancado_por_nome from public.pessoas where id = new.lancado_por;
  new.lancado_por_nome := coalesce(new.lancado_por_nome, 'sistema');
  return new;
end;
$$;

drop trigger if exists lancamentos_autor on public.lancamentos;
create trigger lancamentos_autor
  before insert or update on public.lancamentos
  for each row execute function public.marcar_autor_lancamento();

-- ---------------------------------------------------------------------------
-- 5. Permissões
--
-- Reaproveita as guardas que já existem: `pessoa_atual()`, `ve_o_time()` e
-- `eh_gestor()`. Nada de lista de e-mails no código — hoje o painel decide
-- quem é admin dentro do JavaScript do navegador, o que qualquer pessoa
-- logada contorna chamando a API direto.
--
-- As políticas antigas de `atendimentos` e `cotas` são removidas pelo nome. O
-- conteúdo delas nunca foi levantado, e sistema que remunera não convive com
-- regra de acesso desconhecida: em vez de auditar, substitui-se por regra
-- conhecida.
-- ---------------------------------------------------------------------------

-- Pesos e motivos: todo mundo lê (o operador precisa dos rótulos do próprio
-- extrato), só o gestor edita.
alter table public.regras enable row level security;

drop policy if exists regras_leitura on public.regras;
create policy regras_leitura on public.regras
  for select using (public.papel_atual() is not null);

drop policy if exists regras_gestor on public.regras;
create policy regras_gestor on public.regras
  for all using (public.eh_gestor()) with check (public.eh_gestor());

-- Avaliações
alter table public.atendimentos enable row level security;

drop policy if exists "Leitura de Atendimentos" on public.atendimentos;
drop policy if exists "Edicao de Atendimentos" on public.atendimentos;
drop policy if exists atendimentos_leitura on public.atendimentos;
drop policy if exists atendimentos_gestor on public.atendimentos;

create policy atendimentos_leitura on public.atendimentos
  for select using (public.ve_o_time() or pessoa_id = public.pessoa_atual());

-- Só o gestor grava. Sem isto, quem estivesse logado poderia editar a base que
-- gera a própria pontuação.
create policy atendimentos_gestor on public.atendimentos
  for all using (public.eh_gestor()) with check (public.eh_gestor());

-- Volume do Huggy
alter table public.volume_semanal enable row level security;

drop policy if exists volume_leitura on public.volume_semanal;
create policy volume_leitura on public.volume_semanal
  for select using (public.ve_o_time() or pessoa_id = public.pessoa_atual());

drop policy if exists volume_gestor on public.volume_semanal;
create policy volume_gestor on public.volume_semanal
  for all using (public.eh_gestor()) with check (public.eh_gestor());

-- Lançamentos manuais
alter table public.lancamentos enable row level security;

drop policy if exists lancamentos_leitura on public.lancamentos;
create policy lancamentos_leitura on public.lancamentos
  for select using (public.ve_o_time() or pessoa_id = public.pessoa_atual());

drop policy if exists lancamentos_gestor on public.lancamentos;
create policy lancamentos_gestor on public.lancamentos
  for all using (public.eh_gestor()) with check (public.eh_gestor());

-- Cotas antigas: viram histórico, só leitura.
alter table public.cotas enable row level security;

drop policy if exists "Leitura de Cotas" on public.cotas;
drop policy if exists cotas_leitura on public.cotas;
drop policy if exists cotas_gestor on public.cotas;

create policy cotas_leitura on public.cotas
  for select using (public.ve_o_time() or pessoa_id = public.pessoa_atual());

create policy cotas_gestor on public.cotas
  for all using (public.eh_gestor()) with check (public.eh_gestor());

-- ---------------------------------------------------------------------------
-- 6. `atendentes` ficou redundante
--
-- `pessoas` já tem e-mail, nome e agora `nome_huggy`. A linha abaixo está
-- comentada de propósito: confira antes que o `nome_huggy` chegou completo em
-- `pessoas`, e só então apague.
--
--   select nome, email, nome_huggy from public.pessoas order by nome;
--
-- drop table if exists public.atendentes cascade;
-- ---------------------------------------------------------------------------
