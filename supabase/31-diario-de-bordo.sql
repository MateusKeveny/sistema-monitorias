-- ============================================================================
-- 31 · Diário de bordo
--
-- Todos registram o que aconteceu no dia e vale para a equipe: processo novo,
-- treinamento, autorização e exceção. O protocolo é obrigatório. Todos leem
-- todos os registros — é uma consulta para todos os casos.
--
-- Autorização e exceção dizem QUEM autorizou. Quando foi a gestão ou a
-- diretoria, o registro nasce "aguardando" e só conclui com a aprovação do
-- gestor (função `decidir_registro_diario`). Devolvido, o autor corrige e o
-- registro volta a aguardar.
--
-- Na monitoria, se o protocolo tem autorização ou exceção no diário, o monitor
-- responde se o registro impacta a avaliação (`diario_citacoes`).
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo sem duplicar.
-- ============================================================================

create table if not exists public.diario_registros (
  id                   uuid primary key default uuid_generate_v4(),
  pessoa_id            uuid not null default public.pessoa_atual()
                         references public.pessoas (id) on delete restrict,
  data                 date not null default (now() at time zone 'America/Sao_Paulo')::date,
  tipo                 text not null check (tipo in ('processo', 'treinamento', 'autorizacao', 'excecao')),
  protocolo            text not null check (length(trim(protocolo)) > 0),
  assunto              text not null check (length(trim(assunto)) > 0),
  descricao            text not null check (length(trim(descricao)) > 0),
  autorizado_por       text check (autorizado_por in ('gestao', 'diretoria', 'outro')),
  autorizado_por_nome  text,
  situacao             text not null default 'concluido'
                         check (situacao in ('concluido', 'aguardando', 'devolvido')),
  decidido_por         uuid references public.pessoas (id) on delete set null,
  decidido_em          timestamptz,
  comentario_decisao   text,
  criado_em            timestamptz not null default now(),
  atualizado_em        timestamptz not null default now(),
  -- Autorização e exceção sempre dizem quem autorizou, com nome.
  constraint diario_autorizacao_diz_quem check (
    tipo not in ('autorizacao', 'excecao')
    or (autorizado_por is not null and length(trim(coalesce(autorizado_por_nome, ''))) > 0)
  )
);

create index if not exists diario_registros_protocolo on public.diario_registros (protocolo);
create index if not exists diario_registros_data on public.diario_registros (data desc, criado_em desc);

-- ---------------------------------------------------------------------------
-- Situação decidida pelo banco, não pela tela
--
-- Quem registra é sempre a pessoa logada. Autorização da gestão ou diretoria
-- nasce aguardando; o resto nasce concluído. O gestor que registra a própria
-- autorização já aprova no ato. Na correção de um devolvido, volta a aguardar.
-- ---------------------------------------------------------------------------
create or replace function public.diario_situacao()
returns trigger language plpgsql as $$
begin
  -- A decisão do gestor (aprovar/devolver) passa direto.
  if tg_op = 'UPDATE' and public.eh_gestor() and new.situacao is distinct from old.situacao then
    new.atualizado_em := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.pessoa_id := coalesce(public.pessoa_atual(), new.pessoa_id);
    new.criado_em := now();
  end if;

  -- O protocolo é gravado sem espaços nas pontas: é por ele que a monitoria
  -- encontra o registro.
  new.protocolo := trim(new.protocolo);

  if new.autorizado_por in ('gestao', 'diretoria') and not public.eh_gestor() then
    new.situacao := 'aguardando';
    new.decidido_por := null; new.decidido_em := null;
  elsif new.autorizado_por in ('gestao', 'diretoria') then
    new.situacao := 'concluido';
    new.decidido_por := public.pessoa_atual(); new.decidido_em := now();
  else
    new.situacao := 'concluido';
  end if;

  new.atualizado_em := now();
  return new;
end;
$$;

drop trigger if exists diario_situacao on public.diario_registros;
create trigger diario_situacao
  before insert or update on public.diario_registros
  for each row execute function public.diario_situacao();

-- ---------------------------------------------------------------------------
-- Acesso
-- ---------------------------------------------------------------------------
alter table public.diario_registros enable row level security;

-- Todos leem tudo: o diário é a consulta de todos os casos.
drop policy if exists diario_leitura on public.diario_registros;
create policy diario_leitura on public.diario_registros
  for select using (public.papel_atual() is not null);

-- Qualquer pessoa ativa registra, sempre em nome próprio.
drop policy if exists diario_registro on public.diario_registros;
create policy diario_registro on public.diario_registros
  for insert with check (public.pessoa_atual() is not null and pessoa_id = public.pessoa_atual());

-- O autor só mexe no registro devolvido (para corrigir e reenviar).
drop policy if exists diario_correcao on public.diario_registros;
create policy diario_correcao on public.diario_registros
  for update using (pessoa_id = public.pessoa_atual() and situacao = 'devolvido')
  with check (pessoa_id = public.pessoa_atual());

-- Excluir é só do gestor.
drop policy if exists diario_exclusao on public.diario_registros;
create policy diario_exclusao on public.diario_registros
  for delete using (public.eh_gestor());

-- ---------------------------------------------------------------------------
-- Aprovar ou devolver: só o gestor, e só o que está aguardando
-- ---------------------------------------------------------------------------
create or replace function public.decidir_registro_diario(p_registro uuid, p_aprovar boolean, p_comentario text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.eh_gestor() is not true then
    raise exception 'Só o gestor aprova ou devolve registros do diário.';
  end if;
  if not p_aprovar and length(trim(coalesce(p_comentario, ''))) = 0 then
    raise exception 'Diga o que precisa ser corrigido ao devolver.';
  end if;

  update public.diario_registros
     set situacao = case when p_aprovar then 'concluido' else 'devolvido' end,
         decidido_por = public.pessoa_atual(),
         decidido_em = now(),
         comentario_decisao = nullif(trim(coalesce(p_comentario, '')), '')
   where id = p_registro and situacao = 'aguardando';

  if not found then
    raise exception 'Registro não encontrado ou já decidido.';
  end if;
end;
$$;

revoke all on function public.decidir_registro_diario(uuid, boolean, text) from public, anon;
grant execute on function public.decidir_registro_diario(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Citação na monitoria: o monitor diz se o registro impacta a avaliação
-- ---------------------------------------------------------------------------
create table if not exists public.diario_citacoes (
  monitoria_id    uuid not null references public.monitorias (id) on delete cascade,
  registro_id     uuid not null references public.diario_registros (id) on delete cascade,
  impacta         boolean not null,
  justificativa   text,
  respondido_por  uuid default public.pessoa_atual() references public.pessoas (id) on delete set null,
  respondido_em   timestamptz not null default now(),
  primary key (monitoria_id, registro_id),
  -- Quem diz que impacta explica por quê.
  constraint citacao_impacto_justificado check (
    not impacta or length(trim(coalesce(justificativa, ''))) > 0
  )
);

alter table public.diario_citacoes enable row level security;

drop policy if exists citacoes_leitura on public.diario_citacoes;
create policy citacoes_leitura on public.diario_citacoes
  for select using (public.ve_o_time());

drop policy if exists citacoes_monitor on public.diario_citacoes;
create policy citacoes_monitor on public.diario_citacoes
  for all using (public.pode_monitorar()) with check (public.pode_monitorar());

-- ---------------------------------------------------------------------------
-- Conferência: as duas tabelas, a função e a trava de autorização
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name in ('diario_registros', 'diario_citacoes')) as tabelas_criadas,
  (select count(*) from pg_proc where proname = 'decidir_registro_diario') as funcao_de_aprovacao,
  (select count(*) from pg_constraint where conname = 'diario_autorizacao_diz_quem') as trava_de_autorizacao;
