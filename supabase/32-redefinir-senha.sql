-- ============================================================================
-- 32 · Redefinir senha pelo gestor
--
-- Não havia como recuperar uma senha esquecida: "exigir troca" pede a senha
-- atual para entrar, e o script de acesso não redefine conta que já existe.
-- Restava mexer na conta pelo painel do Supabase.
--
-- Agora o gestor redefine pela ficha da pessoa (Atendentes). O banco gera uma
-- senha temporária aleatória, devolve UMA vez para o gestor repassar, encerra
-- as sessões abertas da pessoa e obriga a troca no próximo acesso.
--
-- Por que temporária e não a senha padrão: a padrão todos conhecem — um
-- colega poderia entrar na conta redefinida antes do dono.
--
-- Por que no banco e não no site: redefinir senha pelo site exigiria a chave
-- mestra (service_role) no servidor, e o projeto a mantém só na máquina do
-- gestor. A função é security definer e confere que quem chama é gestor.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

-- Registro de quem redefiniu a senha de quem, e quando. Sem a senha, claro.
create table if not exists public.redefinicoes_de_senha (
  id           uuid primary key default uuid_generate_v4(),
  pessoa_id    uuid not null references public.pessoas (id) on delete cascade,
  feita_por    uuid references public.pessoas (id) on delete set null,
  feita_em     timestamptz not null default now()
);

alter table public.redefinicoes_de_senha enable row level security;
drop policy if exists redefinicoes_leitura on public.redefinicoes_de_senha;
create policy redefinicoes_leitura on public.redefinicoes_de_senha
  for select using (public.eh_gestor());

create or replace function public.redefinir_senha(p_pessoa uuid)
returns text
language plpgsql security definer
set search_path = public, extensions, auth
as $$
declare
  v_auth      uuid;
  -- Sem 0/O, 1/l/I: a senha é ditada ou copiada à mão.
  v_alfabeto  text := 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes     bytea := extensions.gen_random_bytes(10);
  v_senha     text := '';
  i           int;
begin
  if public.eh_gestor() is not true then
    raise exception 'Só o gestor redefine senha.';
  end if;

  select auth_id into v_auth from public.pessoas where id = p_pessoa and ativo;
  if v_auth is null then
    raise exception 'Esta pessoa não tem acesso ativo.';
  end if;
  if v_auth = auth.uid() then
    raise exception 'A sua própria senha se troca pela tela de troca de senha.';
  end if;

  for i in 0..9 loop
    v_senha := v_senha || substr(v_alfabeto, 1 + (get_byte(v_bytes, i) % length(v_alfabeto)), 1);
  end loop;

  update auth.users
     set encrypted_password = extensions.crypt(v_senha, extensions.gen_salt('bf')),
         updated_at = now()
   where id = v_auth;

  -- O gatilho da migração 15 acabou de marcar a senha como trocada; aqui ela
  -- volta a ser provisória, e a troca é obrigatória no próximo acesso.
  update public.pessoas set senha_definida = false where id = p_pessoa;

  -- Quem estava logado com a senha antiga sai.
  delete from auth.sessions where user_id = v_auth;

  insert into public.redefinicoes_de_senha (pessoa_id, feita_por) values (p_pessoa, public.pessoa_atual());

  return v_senha;
end;
$$;

revoke all on function public.redefinir_senha(uuid) from public, anon;
grant execute on function public.redefinir_senha(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: a função, a tabela de registro e as funções de senha do pgcrypto
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname = 'redefinir_senha') as funcao_criada,
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'redefinicoes_de_senha') as registro_criado,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'extensions' and p.proname in ('crypt', 'gen_salt', 'gen_random_bytes')) as pgcrypto_disponivel;
