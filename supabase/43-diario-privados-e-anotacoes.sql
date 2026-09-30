-- ============================================================================
-- 43 · Diário de bordo: registros com a gestão e anotações do gestor
--
-- Duas abas novas no diário, cada uma com a própria regra de quem vê:
--
--   diario_privados   o atendente registra algo só com a gestão (assunto e
--                     texto). Vê quem registrou, o gestor e o Pleno. A gestão
--                     aprova (fica privado) ou devolve com comentário; o autor
--                     corrige e reenvia.
--   diario_anotacoes  anotações do gestor, com pessoa opcional ("Sobre").
--                     Só quem tem papel gestor vê — nem o Pleno.
--
-- A regra está na RLS: nenhuma tela ou chamada direta mostra a outra pessoa.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Registros com a gestão
-- ---------------------------------------------------------------------------
create table if not exists public.diario_privados (
  id                  uuid primary key default uuid_generate_v4(),
  pessoa_id           uuid not null default public.pessoa_atual() references public.pessoas (id) on delete restrict,
  assunto             text not null check (length(trim(assunto)) > 0),
  texto               text not null check (length(trim(texto)) > 0),
  situacao            text not null default 'aguardando' check (situacao in ('aguardando', 'aprovado', 'devolvido')),
  decidido_por        uuid references public.pessoas (id) on delete set null,
  decidido_em         timestamptz,
  comentario_decisao  text,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

create index if not exists diario_privados_pessoa on public.diario_privados (pessoa_id, criado_em desc);

-- O autor é sempre quem está logado, e todo envio (ou reenvio) volta a
-- aguardar. Só a função de decisão muda a situação para aprovado/devolvido.
create or replace function public.diario_privado_situacao()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and current_setting('diario.decidindo', true) = 'sim' then
    new.atualizado_em := now();
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.pessoa_id := coalesce(public.pessoa_atual(), new.pessoa_id);
    new.criado_em := now();
  else
    new.pessoa_id := old.pessoa_id;
    new.criado_em := old.criado_em;
  end if;
  new.assunto := trim(new.assunto);
  new.situacao := 'aguardando';
  new.decidido_por := null; new.decidido_em := null; new.comentario_decisao := null;
  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists diario_privado_situacao on public.diario_privados;
create trigger diario_privado_situacao
  before insert or update on public.diario_privados
  for each row execute function public.diario_privado_situacao();

alter table public.diario_privados enable row level security;

drop policy if exists privados_leitura on public.diario_privados;
create policy privados_leitura on public.diario_privados
  for select using (pessoa_id = public.pessoa_atual() or public.aprova_diario());

drop policy if exists privados_registro on public.diario_privados;
create policy privados_registro on public.diario_privados
  for insert with check (public.pessoa_atual() is not null and pessoa_id = public.pessoa_atual());

-- O autor só mexe no devolvido, para corrigir e reenviar.
drop policy if exists privados_correcao on public.diario_privados;
create policy privados_correcao on public.diario_privados
  for update using (pessoa_id = public.pessoa_atual() and situacao = 'devolvido')
  with check (pessoa_id = public.pessoa_atual());

drop policy if exists privados_exclusao on public.diario_privados;
create policy privados_exclusao on public.diario_privados
  for delete using (public.eh_gestor());

create or replace function public.decidir_registro_privado(p_registro uuid, p_aprovar boolean, p_comentario text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_linhas int;
begin
  if public.aprova_diario() is not true then
    raise exception 'Só o gestor ou o Pleno aprova ou devolve registros.';
  end if;
  if not p_aprovar and length(trim(coalesce(p_comentario, ''))) = 0 then
    raise exception 'Diga o que precisa ser corrigido ao devolver.';
  end if;

  perform set_config('diario.decidindo', 'sim', true);
  update public.diario_privados
     set situacao = case when p_aprovar then 'aprovado' else 'devolvido' end,
         decidido_por = public.pessoa_atual(),
         decidido_em = now(),
         comentario_decisao = nullif(trim(coalesce(p_comentario, '')), '')
   where id = p_registro and situacao = 'aguardando'
     and (public.eh_gestor() or pessoa_id <> public.pessoa_atual());
  -- Contado antes do perform, que também mexe no FOUND.
  get diagnostics v_linhas = row_count;
  perform set_config('diario.decidindo', '', true);

  if v_linhas = 0 then
    raise exception 'Registro não encontrado, já decidido ou é seu.';
  end if;
end;
$$;

revoke all on function public.decidir_registro_privado(uuid, boolean, text) from public, anon;
grant execute on function public.decidir_registro_privado(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Anotações do gestor
-- ---------------------------------------------------------------------------
create table if not exists public.diario_anotacoes (
  id               uuid primary key default uuid_generate_v4(),
  autor_id         uuid not null default public.pessoa_atual() references public.pessoas (id) on delete restrict,
  data             date not null default (now() at time zone 'America/Sao_Paulo')::date,
  sobre_pessoa_id  uuid references public.pessoas (id) on delete set null,
  assunto          text not null check (length(trim(assunto)) > 0),
  texto            text not null check (length(trim(texto)) > 0),
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

create index if not exists diario_anotacoes_data on public.diario_anotacoes (data desc, criado_em desc);
create index if not exists diario_anotacoes_sobre on public.diario_anotacoes (sobre_pessoa_id);

alter table public.diario_anotacoes enable row level security;

-- Todos com papel gestor leem; cada um grava, edita e apaga as próprias.
drop policy if exists anotacoes_leitura on public.diario_anotacoes;
create policy anotacoes_leitura on public.diario_anotacoes
  for select using (public.eh_gestor());

drop policy if exists anotacoes_escrita on public.diario_anotacoes;
create policy anotacoes_escrita on public.diario_anotacoes
  for insert with check (public.eh_gestor() and autor_id = public.pessoa_atual());

drop policy if exists anotacoes_edicao on public.diario_anotacoes;
create policy anotacoes_edicao on public.diario_anotacoes
  for update using (public.eh_gestor() and autor_id = public.pessoa_atual())
  with check (public.eh_gestor() and autor_id = public.pessoa_atual());

drop policy if exists anotacoes_exclusao on public.diario_anotacoes;
create policy anotacoes_exclusao on public.diario_anotacoes
  for delete using (public.eh_gestor() and autor_id = public.pessoa_atual());

-- ---------------------------------------------------------------------------
-- Conferência: as duas tabelas, com RLS ligada, e a função de decisão
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_class where relname in ('diario_privados', 'diario_anotacoes') and relrowsecurity) as tabelas_com_rls,
  (select count(*) from pg_proc where proname = 'decidir_registro_privado') as funcao_de_decisao;
