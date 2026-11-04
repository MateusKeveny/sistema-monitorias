-- ============================================================================
-- 96 · Conferência dos números: "ciente" (Performance 3.6.0)
--
-- A conferência (3.4.0/3.5.0) aponta o que foge do padrão, mas não guardava
-- a decisão do gestor: o que ele já conferiu e está certo seguia aparecendo
-- na tela inicial e no Fechamento. Agora cada aviso pode ser marcado como
-- ciente, com quem marcou e quando.
--
-- O aviso é reconhecido pela chave (tipo|fila|semana) E pelo texto: se o
-- número mudar (volume recolado, avaliação nova), o texto muda e o aviso
-- volta a aparecer — ciente vale para aquele número, não para sempre.
--
-- Só tabela nova: não muda dado existente nem cálculo.
-- ============================================================================

begin;

create table if not exists public.conferencia_cientes (
  id               bigint generated always as identity primary key,
  mes_competencia  date not null,
  pessoa_id        uuid not null references public.pessoas(id) on delete cascade,
  chave            text not null,
  texto            text not null,
  observacao       text,
  marcado_por      uuid default public.pessoa_atual() references public.pessoas(id) on delete set null,
  marcado_por_nome text,
  marcado_em       timestamptz not null default now(),
  unique (mes_competencia, pessoa_id, chave, texto)
);

create index if not exists conferencia_cientes_mes on public.conferencia_cientes (mes_competencia);

-- Quem marcou: o nome sai do cadastro, não do navegador.
create or replace function public.conferencia_ciente_autor()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.marcado_por := coalesce(new.marcado_por, public.pessoa_atual());
  new.marcado_por_nome := (select nome from public.pessoas where id = new.marcado_por);
  return new;
end $$;

drop trigger if exists conferencia_ciente_autor on public.conferencia_cientes;
create trigger conferencia_ciente_autor before insert on public.conferencia_cientes
  for each row execute function public.conferencia_ciente_autor();

alter table public.conferencia_cientes enable row level security;

-- Gestor (e administrador) das pessoas que vê, como no resto da 94/95.
drop policy if exists conferencia_cientes_ler on public.conferencia_cientes;
create policy conferencia_cientes_ler on public.conferencia_cientes for select
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
drop policy if exists conferencia_cientes_marcar on public.conferencia_cientes;
create policy conferencia_cientes_marcar on public.conferencia_cientes for insert
  with check ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));
drop policy if exists conferencia_cientes_desfazer on public.conferencia_cientes;
create policy conferencia_cientes_desfazer on public.conferencia_cientes for delete
  using ((select public.eh_gestor()) and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));

grant select, insert, delete on public.conferencia_cientes to authenticated;

commit;
