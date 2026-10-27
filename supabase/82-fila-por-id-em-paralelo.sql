-- ============================================================================
-- 82 · Setores e filas em árvore — etapa 2 (fila por id, em paralelo)
--
-- Segunda etapa do plano da 3.0 (docs/PLANO-SETORES.md). Cada registro que
-- hoje diz o canal por texto ('huggy' / 'diretores') ganha também `canal_id`,
-- a fila da árvore (migração 79). Nas telas, "canal" passa a se chamar
-- "fila", o nome que o Hub usa.
--
--   volume_semanal.canal          → canal_id
--   lancamentos.canal             → canal_id
--   avaliacoes.origem             → canal_id
--   avaliacoes_guardadas.origem   → canal_id
--   metricas_desligadas.canal     → canal_id
--   fechamento_linhas.origem      → canal_id  (meses fechados: só ganham o id)
--
-- O cálculo continua lendo o texto: NENHUM ponto muda. A etapa 3 é que passa
-- o cálculo para o `canal_id`.
--
-- Quem grava não precisa mudar nada: um gatilho preenche o `canal_id` a
-- partir do texto, em toda inserção e quando o texto muda (a realocação troca
-- o canal de um volume). O preenchimento dos registros antigos roda com os
-- gatilhos desligados, só nesta transação: não marca o resumo do mês como
-- desatualizado nem reescreve o autor dos lançamentos.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo.
-- ============================================================================

begin;

-- 1. As colunas, ligadas à árvore. `restrict`: fila com registro não some.
alter table public.volume_semanal       add column if not exists canal_id smallint references public.canais_do_setor (id) on delete restrict;
alter table public.lancamentos          add column if not exists canal_id smallint references public.canais_do_setor (id) on delete restrict;
alter table public.avaliacoes           add column if not exists canal_id smallint references public.canais_do_setor (id) on delete restrict;
alter table public.avaliacoes_guardadas add column if not exists canal_id smallint references public.canais_do_setor (id) on delete restrict;
alter table public.metricas_desligadas  add column if not exists canal_id smallint references public.canais_do_setor (id) on delete restrict;
alter table public.fechamento_linhas    add column if not exists canal_id smallint references public.canais_do_setor (id) on delete restrict;

create index if not exists volume_semanal_canal_id_idx on public.volume_semanal (canal_id);
create index if not exists lancamentos_canal_id_idx    on public.lancamentos (canal_id);
create index if not exists avaliacoes_canal_id_idx     on public.avaliacoes (canal_id);

-- 2. O gatilho: o argumento é a coluna de texto ('canal' ou 'origem').
-- `security definer` para achar a fila também quando quem grava é o cron ou
-- o sistema, sem login (a leitura da árvore pede login).
create or replace function public.preencher_canal_id()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_texto text := to_jsonb(new) ->> tg_argv[0];
begin
  -- O texto mudou e o id não veio junto: o id acompanha o texto.
  if tg_op = 'UPDATE'
     and v_texto is distinct from (to_jsonb(old) ->> tg_argv[0])
     and new.canal_id is not distinct from old.canal_id then
    new.canal_id := null;
  end if;
  if new.canal_id is null and v_texto is not null then
    select id into new.canal_id from public.canais_do_setor where apelido = v_texto;
  end if;
  return new;
end;
$$;

drop trigger if exists canal_id_em_paralelo on public.volume_semanal;
create trigger canal_id_em_paralelo before insert or update on public.volume_semanal
  for each row execute function public.preencher_canal_id('canal');
drop trigger if exists canal_id_em_paralelo on public.lancamentos;
create trigger canal_id_em_paralelo before insert or update on public.lancamentos
  for each row execute function public.preencher_canal_id('canal');
drop trigger if exists canal_id_em_paralelo on public.avaliacoes;
create trigger canal_id_em_paralelo before insert or update on public.avaliacoes
  for each row execute function public.preencher_canal_id('origem');
drop trigger if exists canal_id_em_paralelo on public.avaliacoes_guardadas;
create trigger canal_id_em_paralelo before insert or update on public.avaliacoes_guardadas
  for each row execute function public.preencher_canal_id('origem');
drop trigger if exists canal_id_em_paralelo on public.metricas_desligadas;
create trigger canal_id_em_paralelo before insert or update on public.metricas_desligadas
  for each row execute function public.preencher_canal_id('canal');
drop trigger if exists canal_id_em_paralelo on public.fechamento_linhas;
create trigger canal_id_em_paralelo before insert or update on public.fechamento_linhas
  for each row execute function public.preencher_canal_id('origem');

-- 3. Os registros que já existem. Gatilhos desligados só aqui dentro.
set local session_replication_role = replica;

update public.volume_semanal t set canal_id = c.id from public.canais_do_setor c
 where c.apelido = t.canal and t.canal_id is null;
update public.lancamentos t set canal_id = c.id from public.canais_do_setor c
 where c.apelido = t.canal and t.canal_id is null;
update public.avaliacoes t set canal_id = c.id from public.canais_do_setor c
 where c.apelido = t.origem and t.canal_id is null;
update public.avaliacoes_guardadas t set canal_id = c.id from public.canais_do_setor c
 where c.apelido = t.origem and t.canal_id is null;
update public.metricas_desligadas t set canal_id = c.id from public.canais_do_setor c
 where c.apelido = t.canal and t.canal_id is null;
update public.fechamento_linhas t set canal_id = c.id from public.canais_do_setor c
 where c.apelido = t.origem and t.canal_id is null;

set local session_replication_role = origin;

commit;

-- Conferência: "sem_fila" tem de dar 0 em todas as linhas.
select 'volume_semanal' as tabela, count(*) as total, count(*) filter (where canal_id is null) as sem_fila from public.volume_semanal
union all
select 'lancamentos', count(*), count(*) filter (where canal_id is null) from public.lancamentos
union all
select 'avaliacoes', count(*), count(*) filter (where canal_id is null) from public.avaliacoes
union all
select 'avaliacoes_guardadas', count(*), count(*) filter (where canal_id is null) from public.avaliacoes_guardadas
union all
select 'metricas_desligadas', count(*), count(*) filter (where canal_id is null) from public.metricas_desligadas
union all
-- Fechamento: só as linhas de canal (monitoria e as gerais não têm fila).
select 'fechamento_linhas', count(*) filter (where origem in ('huggy', 'diretores')),
       count(*) filter (where origem in ('huggy', 'diretores') and canal_id is null) from public.fechamento_linhas;
