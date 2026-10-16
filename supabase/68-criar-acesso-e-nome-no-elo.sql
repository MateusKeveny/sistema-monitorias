-- ============================================================================
-- 68 · Criar acesso e Nome no ELO pela tela (sem terminal)
--
-- Duas coisas que até aqui pediam comando ou SQL passam para a ficha do
-- atendente (Performance › Atendentes):
--
-- 1. Criar acesso. Antes: `npm run acesso` / `npm run vincular`, na máquina do
--    gestor, com a chave mestra. Agora: o botão "Criar acesso". Como o
--    "Redefinir senha" (migração 32), a função roda no banco, é security
--    definer e confere que quem chama é gestor — a chave mestra continua fora
--    do site. Cria o login com uma senha temporária (mostrada uma vez, a
--    pessoa troca no primeiro acesso); se já existir conta com o e-mail, só
--    vincula e gera a senha temporária.
--
-- 2. Nome no ELO (antes só por SQL, migração 53). Salvar o nome também passa
--    para a pessoa os chamados dos meses abertos que tinham ficado sem dono
--    com esse nome — como o "Nome no Hub" faz com as notas guardadas.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo. No fim ele confere que as funções existem e quem está sem acesso.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Criar acesso
-- ---------------------------------------------------------------------------
-- Registro de quem criou o acesso de quem, e quando (sem a senha).
create table if not exists public.acessos_criados (
  id          uuid primary key default uuid_generate_v4(),
  pessoa_id   uuid not null references public.pessoas (id) on delete cascade,
  email       text not null,
  papel       text not null,
  vinculou    boolean not null,   -- a conta já existia e foi só vinculada
  feito_por   uuid references public.pessoas (id) on delete set null,
  feito_em    timestamptz not null default now()
);
alter table public.acessos_criados enable row level security;
drop policy if exists acessos_criados_leitura on public.acessos_criados;
create policy acessos_criados_leitura on public.acessos_criados for select using (public.eh_gestor());

create or replace function public.criar_acesso(p_pessoa uuid, p_email text, p_papel text)
returns text
language plpgsql security definer
set search_path = public, extensions, auth
as $$
declare
  v_pessoa    public.pessoas%rowtype;
  v_email     text := lower(trim(coalesce(p_email, '')));
  v_conta     uuid;
  v_vinculou  boolean := false;
  -- O mesmo alfabeto da migração 32: sem 0/O, 1/l/I, para ditar ou copiar à mão.
  v_alfabeto  text := 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes     bytea := extensions.gen_random_bytes(10);
  v_senha     text := '';
  i           int;
begin
  if public.eh_gestor() is not true then
    raise exception 'Só o gestor cria acesso.';
  end if;
  if p_papel not in ('gestor', 'qualidade', 'operador') then
    raise exception 'Papel inválido.';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail inválido.';
  end if;

  select * into v_pessoa from public.pessoas where id = p_pessoa;
  if not found then
    raise exception 'Pessoa não encontrada.';
  end if;
  if v_pessoa.auth_id is not null then
    raise exception 'Esta pessoa já tem acesso. Para senha esquecida, use Redefinir senha.';
  end if;
  if not v_pessoa.ativo or v_pessoa.desligado_em is not null then
    raise exception 'Esta pessoa não está ativa na operação.';
  end if;
  if exists (select 1 from public.pessoas where lower(email) = v_email and id <> p_pessoa) then
    raise exception 'Este e-mail já é de outra pessoa do cadastro.';
  end if;

  for i in 0..9 loop
    v_senha := v_senha || substr(v_alfabeto, 1 + (get_byte(v_bytes, i) % length(v_alfabeto)), 1);
  end loop;

  -- O e-mail fica na pessoa antes da conta: o gatilho de conta nova (migração
  -- 11) liga a conta à pessoa pelo e-mail.
  update public.pessoas set email = v_email, papel = p_papel where id = p_pessoa;

  select id into v_conta from auth.users where lower(email) = v_email;
  if v_conta is not null then
    -- Já existe login com esse e-mail: vincula, se não for de outra pessoa.
    if exists (select 1 from public.pessoas where auth_id = v_conta and id <> p_pessoa) then
      raise exception 'Já existe um login com este e-mail, ligado a outra pessoa.';
    end if;
    v_vinculou := true;
    update auth.users
       set encrypted_password = extensions.crypt(v_senha, extensions.gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = v_conta;
    delete from auth.sessions where user_id = v_conta;
  else
    v_conta := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, email_change, email_change_token_new, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', v_conta, 'authenticated', 'authenticated', v_email,
            extensions.crypt(v_senha, extensions.gen_salt('bf')), now(),
            jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
            jsonb_build_object('nome', v_pessoa.nome), now(), now(), '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_conta, v_conta::text,
            jsonb_build_object('sub', v_conta::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());
  end if;

  -- Ligada à pessoa, com a senha provisória: a troca é obrigatória no
  -- primeiro acesso (o gatilho da migração 15 marcaria a senha como trocada).
  update public.pessoas set auth_id = v_conta, senha_definida = false where id = p_pessoa;

  insert into public.acessos_criados (pessoa_id, email, papel, vinculou, feito_por)
  values (p_pessoa, v_email, p_papel, v_vinculou, public.pessoa_atual());

  return v_senha;
end;
$$;
revoke all on function public.criar_acesso(uuid, text, text) from public, anon;
grant execute on function public.criar_acesso(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Nome no ELO
-- ---------------------------------------------------------------------------
-- Um nome do ELO é de uma pessoa só: a importação acha a pessoa por ele.
create unique index if not exists pessoas_nome_elo_unico
  on public.pessoas (lower(trim(nome_elo))) where nome_elo is not null;

create or replace function public.salvar_nome_elo(p_pessoa uuid, p_nome text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_nome text := nullif(trim(coalesce(p_nome, '')), '');
  v_n    integer := 0;
begin
  if public.eh_gestor() is not true then
    raise exception 'Só o gestor muda o nome no ELO.';
  end if;
  update public.pessoas set nome_elo = v_nome where id = p_pessoa;

  -- Os chamados dos meses abertos que ficaram sem dono com esse nome passam
  -- para a pessoa (mês fechado não muda: o fechamento está congelado).
  if v_nome is not null then
    update public.chamados_elo c
       set pessoa_id = p_pessoa
     where c.pessoa_id is null
       and lower(trim(c.responsavel)) = lower(v_nome)
       and not exists (select 1 from public.fechamentos_cota f where f.mes_competencia = c.mes_competencia);
    get diagnostics v_n = row_count;
  end if;
  return v_n;
end;
$$;
revoke all on function public.salvar_nome_elo(uuid, text) from public, anon;
grant execute on function public.salvar_nome_elo(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência
-- ---------------------------------------------------------------------------
select
  (select count(*) from pg_proc where proname in ('criar_acesso', 'salvar_nome_elo')) as funcoes_criadas,
  (select count(*) from public.pessoas where auth_id is null and ativo and desligado_em is null) as pessoas_sem_acesso,
  (select string_agg(nome || ' = ' || nome_elo, ', ') from public.pessoas where nome_elo is not null) as nomes_no_elo;
