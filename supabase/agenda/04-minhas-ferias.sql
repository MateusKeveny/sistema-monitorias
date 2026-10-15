-- ===========================================================================
-- Agenda · 04 · Minhas férias (projeto da AGENDA)
--
-- As férias do próprio usuário ficam aqui, no banco da agenda; as da equipe
-- ficam no banco dos painéis (61-ferias.sql) e chegam pela ponte. A tela
-- Férias da agenda mostra as duas no mesmo calendário e avisa quando alguém
-- da equipe sai no mesmo período.
-- ===========================================================================

create table if not exists public.minhas_ferias (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null default auth.uid() references public.usuarios (id) on delete cascade,
  inicio      date not null,
  fim         date not null,
  observacao  text check (observacao is null or length(observacao) <= 500),
  criado_em   timestamptz not null default now(),
  check (fim >= inicio),
  check (fim - inicio < 60)
);
create index if not exists minhas_ferias_usuario on public.minhas_ferias (usuario_id, inicio);

alter table public.minhas_ferias enable row level security;
drop policy if exists minhas_ferias_dono on public.minhas_ferias;
create policy minhas_ferias_dono on public.minhas_ferias for all to authenticated
  using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());
revoke all on public.minhas_ferias from anon;

-- Para o resumo do dia: o site pede, com o segredo, as férias de quem vai
-- receber o resumo (de 7 dias atrás até 60 à frente).
create or replace function public.agenda_minhas_ferias_resumo(p_segredo text, p_usuarios uuid[])
returns table (usuario_id uuid, inicio date, fim date)
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if not public.agenda_segredo_confere(p_segredo) then raise exception 'Não autorizado'; end if;
  return query
    select m.usuario_id, m.inicio, m.fim from public.minhas_ferias m
     where m.usuario_id = any (p_usuarios) and m.fim >= v_hoje - 7 and m.inicio <= v_hoje + 60
     order by m.inicio;
end;
$$;
revoke all on function public.agenda_minhas_ferias_resumo(text, uuid[]) from public, authenticated;
grant execute on function public.agenda_minhas_ferias_resumo(text, uuid[]) to anon;

select (select count(*) from information_schema.tables
         where table_schema = 'public' and table_name = 'minhas_ferias') as tabela_criada;   -- 1
