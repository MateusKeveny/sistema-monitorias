-- ============================================================================
-- Painel de Cota — estrutura
-- Rode DEPOIS de 11-tabela-unica-de-pessoas.sql. Pode ser executado mais de
-- uma vez.
--
-- Substitui a estrutura herdada do projeto antigo do painel. O que ela tinha
-- de bom foi mantido — principalmente a tabela `regras`, que já é o cadastro
-- de pesos e motivos. O que muda:
--
--   * Tudo passa a apontar para `pessoas` por id. A junção por texto de nome
--     ou e-mail é a origem de todo erro silencioso deste projeto: monitoria
--     contando zero, atendente sumindo do relatório. Nome muda; id não.
--   * As avaliações ganham `origem`, para o mesmo cálculo servir a mais de um
--     canal sem duplicar regra.
--   * Competência vira `date`, como no resto do sistema.
--   * Toda tabela ganha política de acesso. Quatro delas estavam com RLS
--     ligada e nenhuma política, o que bloqueia todo mundo — é por isso que
--     `regras` tem 33 linhas dentro e o painel enxerga vazio, sem erro.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. `pessoas` como cadastro único
--
-- `nome_huggy` é indispensável e não dá para deduzir: o relatório de avaliações
-- identifica a pessoa por e-mail, mas o relatório de volume identifica por nome
-- por extenso. São duas chaves para a mesma pessoa, e é esse casamento por nome
-- que hoje falha calado — "Allana Castro" no Huggy contra "Allana Castro da
-- Silva" nas monitorias.
-- ---------------------------------------------------------------------------
update public.pessoas p
   set nome_huggy = a.nome_huggy
  from public.atendentes a
 where lower(trim(a.email)) = lower(trim(p.email))
   and a.nome_huggy is not null
   and p.nome_huggy is distinct from a.nome_huggy;

-- A meta NÃO fica aqui, de propósito.
--
-- Ela é uma regra única, no grupo `config` da tabela `regras`, e vale para
-- todos. Guardá-la por pessoa permitiria metas divergentes sem ninguém
-- perceber — e como a meta é o denominador do "quanto falta", duas pessoas com
-- o mesmo desempenho apareceriam com atingimentos diferentes. Alterar a meta é
-- um `update` numa linha, e todo mundo passa a ser medido pelo novo valor no
-- mesmo instante.
--
-- Os ciclos já fechados não são afetados: o fechamento guarda a meta que
-- valia no dia, junto do resultado.

-- ---------------------------------------------------------------------------
-- 2. Avaliações
--
-- Uma tabela para todos os canais, distinguidos por `origem`. O suporte a
-- diretores é um canal novo com a MESMA regra de C-SAT e as MESMAS notas do
-- Huggy — então precisa da mesma tabela, não de uma cópia. Duas tabelas
-- idênticas significariam a regra escrita duas vezes, que é exatamente o
-- defeito da planilha: as faixas aparecem em dois blocos e um deles saiu
-- desalinhado sem ninguém notar.
--
-- Notas `-1` e `0` são avaliações inválidas. Ficam gravadas — apagar dado
-- bruto não é opção — mas saem da contagem e do denominador do C-SAT.
-- ---------------------------------------------------------------------------
create table if not exists public.avaliacoes (
  id             uuid primary key default uuid_generate_v4(),
  pessoa_id      uuid not null references public.pessoas (id) on delete restrict,
  origem         text not null default 'huggy' check (origem in ('huggy', 'diretores')),
  data           date not null,
  protocolo      text,
  nota           smallint,
  tabulacao      text,
  -- De onde a linha veio. As avaliações herdadas entraram por macro do Excel,
  -- sem registro de arquivo nem de data, e ficam nulas — que é a resposta
  -- honesta. Num sistema que remunera, a diferença entre "o número está certo"
  -- e "o número está certo e eu provo de onde saiu" é o que sustenta uma
  -- conversa com o outro departamento meses depois.
  origem_arquivo text,
  importado_por  uuid references public.pessoas (id) on delete set null,
  importado_em   timestamptz,
  criado_em      timestamptz not null default now()
);

create index if not exists avaliacoes_pessoa_idx
  on public.avaliacoes (pessoa_id, data);
create index if not exists avaliacoes_origem_idx
  on public.avaliacoes (origem, data);

-- Traz o que já existe em `atendimentos`, casando por e-mail. Conferido antes
-- de escrever: os 11 e-mails distintos da tabela casam todos com `pessoas`.
insert into public.avaliacoes (pessoa_id, origem, data, protocolo, nota, tabulacao, criado_em)
select p.id, 'huggy', a.data, a.protocolo, a.avaliacao::smallint, a.tabulacao, a.criado_em
  from public.atendimentos a
  join public.pessoas p on lower(trim(p.email)) = lower(trim(a.atendente))
 where not exists (select 1 from public.avaliacoes);

-- `atendimentos` continua de pé de propósito, para conferir a migração. A
-- planilha conta 4.043 registros no ciclo de agosto e o banco tem 4.027 — a
-- diferença nunca foi explicada, e some junto se a tabela for apagada antes da
-- reimportação. Apague depois de conferir:
--
--   select origem, count(*) from public.avaliacoes group by origem;
--
-- drop table if exists public.atendimentos cascade;

-- ---------------------------------------------------------------------------
-- 3. Volume semanal
--
-- O relatório do Huggy, uma linha por pessoa e semana. É daqui que sai
-- `finalizados`, que multiplica quase toda a cota — e que NÃO é a contagem de
-- avaliações: a base só guarda atendimento que gerou avaliação. Na 1ª semana
-- de agosto a Allana tem 102 finalizados e 98 avaliações, e é 102 que conta.
--
-- Só entram as colunas usadas. Fila, transferidos e nota média do relatório
-- ficam de fora: não pontuam, e a nota média não serve porque o C-SAT é
-- calculado a partir das avaliações.
-- ---------------------------------------------------------------------------
drop table if exists public.volume_semanal cascade;

create table public.volume_semanal (
  id              bigint generated always as identity primary key,
  pessoa_id       uuid not null references public.pessoas (id) on delete restrict,
  mes_competencia date not null,
  semana          smallint not null check (semana between 1 and 4),
  finalizados     integer not null default 0,
  -- Unidade no nome. Os tempos do Huggy passam de 24h — o TMA do Pedro sai
  -- como "33:51:39" — então guardar como hora de relógio perderia o dia.
  tma_seg         integer,
  tme_seg         integer,
  origem_arquivo  text,
  importado_por   uuid references public.pessoas (id) on delete set null,
  atualizado_em   timestamptz not null default now(),
  unique (pessoa_id, mes_competencia, semana)
);

-- ---------------------------------------------------------------------------
-- 4. Lançamentos manuais
--
-- O que não existe em sistema nenhum e o gestor digita: diretores, tempo de
-- resposta, transferências, demandas extras. `semana` nula significa
-- lançamento do mês inteiro, que é como os diretores entram hoje.
-- ---------------------------------------------------------------------------
drop table if exists public.lancamentos cascade;

create table public.lancamentos (
  id               bigint generated always as identity primary key,
  pessoa_id        uuid not null references public.pessoas (id) on delete restrict,
  mes_competencia  date not null,
  semana           smallint check (semana between 1 and 4),
  regra            text not null references public.regras (chave) on delete restrict,
  quantidade       numeric(12,4) not null default 0,
  -- Para as regras em que o valor não sai de quantidade × peso e sim do
  -- julgamento do gestor: "Inconsistência de atendimentos" (o "zera o dia",
  -- que na planilha é texto sem fórmula) e "Atestado" (o desconto depende da
  -- quantidade de faltas).
  pontos_manuais   numeric(12,4),
  observacao       text,
  lancado_por      uuid references public.pessoas (id) on delete set null,
  lancado_por_nome text,
  criado_em        timestamptz not null default now()
);

create index if not exists lancamentos_pessoa_idx
  on public.lancamentos (pessoa_id, mes_competencia);

-- Quem lançou fica registrado, e o nome vai junto do id para o extrato
-- continuar legível se a pessoa sair do cadastro depois. Mesmo padrão das
-- monitorias.
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
-- 5. Ajustes na tabela de regras
-- ---------------------------------------------------------------------------

-- Marca as regras cujo valor o gestor digita direto, em vez de sair de
-- quantidade × peso. A tela usa isso para pedir o valor em vez de calculá-lo.
alter table public.regras
  add column if not exists valor_manual boolean not null default false;

update public.regras set valor_manual = true
 where chave in ('inconsistencia', 'atestado');

-- A medição de executivos deixou de existir. As regras saem de circulação pelo
-- `ativo`, não por delete: fechamentos antigos ainda referenciam essas chaves,
-- e apagá-las quebraria o histórico do que foi entregue.
update public.regras set ativo = false
 where chave in ('executivos_atendimento', 'executivos_ate_30',
                 'executivos_ate_1h', 'executivos_acima_1h');

-- ---------------------------------------------------------------------------
-- 6. Permissões
--
-- Reaproveita as guardas do monitorias: `pessoa_atual()`, `ve_o_time()`,
-- `eh_gestor()`. Nada de lista de e-mails no código — hoje o painel decide
-- quem é admin dentro do JavaScript do navegador, o que qualquer pessoa
-- logada contorna chamando a API direto.
--
-- As políticas antigas de `atendimentos` e `cotas` são removidas pelo nome. O
-- conteúdo delas nunca foi levantado, e sistema que remunera não convive com
-- regra de acesso desconhecida: em vez de auditar, substitui-se por regra
-- conhecida.
-- ---------------------------------------------------------------------------
alter table public.regras enable row level security;

drop policy if exists regras_leitura on public.regras;
create policy regras_leitura on public.regras
  for select using (public.papel_atual() is not null);

drop policy if exists regras_gestor on public.regras;
create policy regras_gestor on public.regras
  for all using (public.eh_gestor()) with check (public.eh_gestor());

alter table public.avaliacoes enable row level security;

drop policy if exists avaliacoes_leitura on public.avaliacoes;
create policy avaliacoes_leitura on public.avaliacoes
  for select using (public.ve_o_time() or pessoa_id = public.pessoa_atual());

-- Só o gestor grava. Sem isto, quem estivesse logado poderia editar a base que
-- gera a própria pontuação.
drop policy if exists avaliacoes_gestor on public.avaliacoes;
create policy avaliacoes_gestor on public.avaliacoes
  for all using (public.eh_gestor()) with check (public.eh_gestor());

alter table public.volume_semanal enable row level security;

drop policy if exists volume_leitura on public.volume_semanal;
create policy volume_leitura on public.volume_semanal
  for select using (public.ve_o_time() or pessoa_id = public.pessoa_atual());

drop policy if exists volume_gestor on public.volume_semanal;
create policy volume_gestor on public.volume_semanal
  for all using (public.eh_gestor()) with check (public.eh_gestor());

alter table public.lancamentos enable row level security;

drop policy if exists lancamentos_leitura on public.lancamentos;
create policy lancamentos_leitura on public.lancamentos
  for select using (public.ve_o_time() or pessoa_id = public.pessoa_atual());

drop policy if exists lancamentos_gestor on public.lancamentos;
create policy lancamentos_gestor on public.lancamentos
  for all using (public.eh_gestor()) with check (public.eh_gestor());

-- Tabelas herdadas: viram histórico, só leitura para quem enxerga o time.
alter table public.atendimentos enable row level security;
drop policy if exists "Leitura de Atendimentos" on public.atendimentos;
drop policy if exists "Edicao de Atendimentos" on public.atendimentos;
drop policy if exists atendimentos_historico on public.atendimentos;
create policy atendimentos_historico on public.atendimentos
  for select using (public.ve_o_time());

alter table public.cotas enable row level security;
drop policy if exists "Leitura de Cotas" on public.cotas;
drop policy if exists cotas_historico on public.cotas;
create policy cotas_historico on public.cotas
  for select using (public.ve_o_time());

-- ---------------------------------------------------------------------------
-- 7. `atendentes` ficou redundante
--
-- `pessoas` já tem e-mail, nome e agora `nome_huggy`. Confira antes de apagar:
--
--   select nome, email, nome_huggy from public.pessoas order by nome;
--
-- drop table if exists public.atendentes cascade;
-- ---------------------------------------------------------------------------
