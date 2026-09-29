-- ============================================================================
-- 34 · Diário de bordo: liberação por pessoa
--
-- Além do cargo (migração 33), o gestor pode liberar uma pessoa específica —
-- um júnior de confiança — para registrar autorização da gestão ou diretoria
-- sem passar por aprovação. Liga e desliga na ficha da pessoa (Atendentes →
-- Diário de bordo). Só o gestor altera: a tabela pessoas já é gravada só por
-- ele (política pessoas_gestor).
--
-- Também corrige a lista do diário para o operador, que via os registros dos
-- colegas sem o nome de quem registrou (função nomes_das_pessoas).
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

alter table public.pessoas
  add column if not exists diario_conclui_direto boolean not null default false;

create or replace function public.conclui_diario_direto()
returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_gestor() is true
      or coalesce(public.cargo_atual_nome() in ('Atendente Pleno', 'Analista'), false)
      or coalesce((select diario_conclui_direto from public.pessoas where id = public.pessoa_atual()), false);
$$;

-- ---------------------------------------------------------------------------
-- Nomes dos autores para todos
--
-- O operador só lê a própria linha de pessoas (migração 16). No diário, que
-- todos consultam, os registros dos colegas apareciam sem autor. Esta função
-- entrega só id e nome — nada do cadastro — para quem está logado.
-- ---------------------------------------------------------------------------
create or replace function public.nomes_das_pessoas()
returns table (id uuid, nome text) language sql stable security definer set search_path = public as $$
  select p.id, p.nome from public.pessoas p where public.pessoa_atual() is not null;
$$;

revoke all on function public.nomes_das_pessoas() from public, anon;
grant execute on function public.nomes_das_pessoas() to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: a coluna existe e ninguém começa liberado
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'pessoas' and column_name = 'diario_conclui_direto') as coluna_criada,
  (select count(*) from public.pessoas where diario_conclui_direto) as pessoas_liberadas,
  (select count(*) from pg_proc where proname = 'nomes_das_pessoas') as funcao_de_nomes;
