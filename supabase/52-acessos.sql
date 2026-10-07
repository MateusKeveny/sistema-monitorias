-- ============================================================================
-- 52 · Acessos: quem abre os painéis e com que frequência
--
-- Pedido do gestor: saber quem acessa com frequência e a data do último
-- acesso. O último login (auth.users.last_sign_in_at) não basta — quem fica
-- com a sessão aberta entra todo dia sem fazer login.
--
-- Uma linha por pessoa, sistema e dia: primeiro e último horário e quantas
-- vezes o painel foi aberto. O navegador chama registrar_acesso uma vez por
-- abertura do painel, direto no banco — nada passa pelo Worker, que tem o
-- limite de CPU do plano gratuito (Error 1102, 05/10).
--
-- Só o gestor lê, na tela Acessos do Performance (1.37.0). Ninguém grava na
-- tabela direto: só pela função, e sempre em nome de quem está logado.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

create table if not exists public.acessos (
  pessoa_id uuid        not null references public.pessoas(id) on delete cascade,
  sistema   text        not null check (sistema in ('cota', 'monitorias')),
  dia       date        not null,
  primeiro  timestamptz not null default now(),
  ultimo    timestamptz not null default now(),
  aberturas integer     not null default 1,
  primary key (pessoa_id, sistema, dia)
);

alter table public.acessos enable row level security;

drop policy if exists acessos_leitura on public.acessos;
create policy acessos_leitura on public.acessos
  for select using (public.eh_gestor());

-- Grava o acesso de quem está logado. Sistema desconhecido ou pessoa inativa:
-- não faz nada, sem erro — o registro nunca pode atrapalhar a abertura do painel.
create or replace function public.registrar_acesso(p_sistema text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_pessoa uuid := public.pessoa_atual();
begin
  if v_pessoa is null or p_sistema not in ('cota', 'monitorias') then return; end if;
  insert into public.acessos (pessoa_id, sistema, dia)
  values (v_pessoa, p_sistema, (now() at time zone 'America/Sao_Paulo')::date)
  on conflict (pessoa_id, sistema, dia)
  do update set ultimo = now(), aberturas = public.acessos.aberturas + 1;
end;
$$;

revoke all on function public.registrar_acesso(text) from public, anon;
grant execute on function public.registrar_acesso(text) to authenticated;

-- Último acesso de cada pessoa em cada sistema, de todo o histórico. A tela
-- lê os últimos 30 dias linha a linha; quem está parado há mais tempo vem
-- daqui. security_invoker: a view respeita a regra de leitura da tabela.
create or replace view public.vw_ultimo_acesso with (security_invoker = true) as
  select pessoa_id, sistema, max(ultimo) as ultimo
    from public.acessos
   group by pessoa_id, sistema;

-- Último login de cada pessoa, para quem ainda não tem acesso registrado
-- (o histórico começa na publicação). auth.users não é legível pelo painel;
-- a função devolve só a data, e só para o gestor.
create or replace function public.ultimo_login_das_pessoas()
returns table (pessoa_id uuid, ultimo_login timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, u.last_sign_in_at
    from public.pessoas p
    join auth.users u on u.id = p.auth_id
   where public.eh_gestor();
$$;

revoke all on function public.ultimo_login_das_pessoas() from public, anon;
grant execute on function public.ultimo_login_das_pessoas() to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: a tabela, a regra de leitura, as duas funções e a view
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.acessos) as acessos_registrados,
  (select qual from pg_policies where tablename = 'acessos' and policyname = 'acessos_leitura') as regra_de_leitura,
  (select count(*) from pg_proc where proname in ('registrar_acesso', 'ultimo_login_das_pessoas')) as funcoes_criadas,
  (select count(*) from pg_views where viewname = 'vw_ultimo_acesso') as view_criada;
