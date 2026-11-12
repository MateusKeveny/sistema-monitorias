-- 110 · Proteção do login e brechas sem login (Performance 4.11.0 / Monitorias 6.5.0)
--
-- 1. Tentativas de login (pedido do gestor em 12/11/2026): o login passa pelo
--    servidor do site (/auth/entrar), que conta as tentativas erradas por
--    usuário + endereço de rede (IP):
--      · a partir da 2ª tentativa (depois de 1 erro), pede uma verificação;
--      · na 5ª tentativa errada, bloqueia 15 minutos — e cada erro depois disso
--        bloqueia de novo, até acertar a senha;
--      · acertar a senha zera a contagem.
--    Limite conhecido: quem chamar o login do Supabase direto, por fora do
--    site, não passa por aqui (o Supabase já limita por IP).
--
-- 2. Brechas sem login (diagnóstico de 12/11/2026): quem não está logado
--    conseguia, com a chave pública do navegador,
--      · chamar recalcular_sla (regrava a faixa de SLA de todos os chamados);
--      · ler bonus_da_competencia (média de pontos e quantos não bateram);
--      · ler vw_tme_equipe (TME da equipe por semana e fila);
--      · chamar sla_pela_escala (horas de expediente de uma pessoa).
--    recalcular_sla e sla_pela_escala só são chamadas por dentro do banco
--    (por funções SECURITY DEFINER): ficam sem permissão para anon e logados.
--    bonus_da_competencia e vw_tme_equipe continuam para quem está logado.

-- ------------------------------------------------------------ 1. Tentativas
create table if not exists public.tentativas_login (
  id         bigint generated always as identity primary key,
  chave      text not null,                 -- o e-mail do login, em minúsculas
  ip         text not null,
  sucesso    boolean not null default false,
  criado_em  timestamptz not null default now()
);
create index if not exists tentativas_login_chave_ip on public.tentativas_login (chave, ip, criado_em desc);
alter table public.tentativas_login enable row level security;
-- O gestor vê (lista de bloqueios no Performance); ninguém grava pela API.
drop policy if exists tentativas_login_gestor on public.tentativas_login;
create policy tentativas_login_gestor on public.tentativas_login for select to authenticated
  using ((select public.eh_gestor()));

create table if not exists public.desafios_login (
  id         uuid primary key default gen_random_uuid(),
  resposta   integer not null,
  usado      boolean not null default false,
  criado_em  timestamptz not null default now()
);
alter table public.desafios_login enable row level security;   -- sem regra: só as funções

/** Erros desde o último acerto (nas últimas 24 h) e até quando está bloqueado. */
create or replace function public.login_situacao(p_chave text, p_ip text)
returns table (falhas integer, bloqueado_ate timestamptz)
language sql stable security definer set search_path = public as $$
  with alvo as (select lower(trim(coalesce(p_chave, ''))) as chave, coalesce(p_ip, '') as ip),
  ultimo_ok as (
    select max(t.criado_em) as em from public.tentativas_login t, alvo
     where t.chave = alvo.chave and t.ip = alvo.ip and t.sucesso),
  erros as (
    select t.criado_em from public.tentativas_login t, alvo, ultimo_ok
     where t.chave = alvo.chave and t.ip = alvo.ip and not t.sucesso
       and t.criado_em > coalesce(ultimo_ok.em, '-infinity'::timestamptz)
       and t.criado_em > now() - interval '24 hours')
  select count(*)::integer,
         case when count(*) >= 5 and max(criado_em) + interval '15 minutes' > now()
              then max(criado_em) + interval '15 minutes' end
    from erros;
$$;

/** Registra um erro de senha e devolve a situação depois dele. */
create or replace function public.login_falhou(p_chave text, p_ip text)
returns table (falhas integer, bloqueado_ate timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_chave), '') = '' then raise exception 'Informe o usuário.'; end if;
  insert into public.tentativas_login (chave, ip, sucesso)
  values (lower(trim(p_chave)), coalesce(p_ip, ''), false);
  -- A tabela não cresce sem fim: guarda 30 dias.
  delete from public.tentativas_login where criado_em < now() - interval '30 days';
  return query select * from public.login_situacao(p_chave, p_ip);
end;
$$;

/** Acerto: só quem acabou de entrar (sessão válida) zera a própria contagem. */
create or replace function public.login_ok(p_ip text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();
  if v_email is null then raise exception 'Sem sessão.'; end if;
  insert into public.tentativas_login (chave, ip, sucesso) values (v_email, coalesce(p_ip, ''), true);
end;
$$;

/** Uma verificação nova: "Quanto é 4 + 7?". A resposta fica só no banco. */
create or replace function public.login_novo_desafio()
returns table (id uuid, pergunta text)
language plpgsql volatile security definer set search_path = public as $$
declare
  a integer := 2 + floor(random() * 8)::integer;
  b integer := 2 + floor(random() * 8)::integer;
begin
  delete from public.desafios_login where criado_em < now() - interval '1 hour';
  return query
    insert into public.desafios_login (resposta) values (a + b)
    returning desafios_login.id, format('Quanto é %s + %s?', a, b);
end;
$$;

/** Confere a resposta (uma vez só, em até 10 minutos). */
create or replace function public.login_confere_desafio(p_id uuid, p_resposta integer)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare
  v_ok boolean;
begin
  update public.desafios_login set usado = true
   where id = p_id and not usado and criado_em > now() - interval '10 minutes'
  returning resposta = p_resposta into v_ok;
  return coalesce(v_ok, false);
end;
$$;

revoke all on function public.login_situacao(text, text) from public;
revoke all on function public.login_falhou(text, text) from public;
revoke all on function public.login_ok(text) from public;
revoke all on function public.login_novo_desafio() from public;
revoke all on function public.login_confere_desafio(uuid, integer) from public;
grant execute on function public.login_situacao(text, text) to anon, authenticated;
grant execute on function public.login_falhou(text, text) to anon, authenticated;
grant execute on function public.login_novo_desafio() to anon, authenticated;
grant execute on function public.login_confere_desafio(uuid, integer) to anon, authenticated;
grant execute on function public.login_ok(text) to authenticated;

-- ------------------------------------------------------- 2. Brechas sem login
revoke execute on function public.recalcular_sla(boolean) from public, anon, authenticated;
revoke execute on function public.sla_pela_escala(uuid, timestamptz, timestamptz) from public, anon, authenticated;

revoke execute on function public.bonus_da_competencia(date, smallint) from public, anon;
revoke execute on function public.bonus_da_competencia(date) from public, anon;
grant execute on function public.bonus_da_competencia(date, smallint) to authenticated;
grant execute on function public.bonus_da_competencia(date) to authenticated;

revoke select on public.vw_tme_equipe from anon;
