-- ============================================================================
-- Troca de senha obrigatória no primeiro acesso.
-- Rode DEPOIS de 00-instalar-tudo.sql. Pode ser executado mais de uma vez.
-- ============================================================================

-- Marca quem já definiu a própria senha dentro do sistema.
alter table public.perfis
  add column if not exists senha_definida boolean not null default false;

-- ---------------------------------------------------------------------------
-- CORREÇÃO DE SEGURANÇA
--
-- A política perfis_editar_proprio deixava o usuário alterar a própria linha,
-- travando apenas o campo `papel`. Só que a RLS do Postgres age por linha, não
-- por coluna: com ela valendo, um operador podia trocar o próprio operador_id
-- e passar a enxergar as monitorias de outra pessoa — ou reativar o próprio
-- acesso depois de ser desativado.
--
-- A política sai. A única alteração que o usuário precisa fazer em si mesmo é
-- registrar que definiu a senha, e isso passa a acontecer por uma função
-- controlada, que só mexe nessa coluna e só na linha de quem chamou.
-- ---------------------------------------------------------------------------
drop policy if exists perfis_editar_proprio on public.perfis;

create or replace function public.marcar_senha_definida()
returns void
language sql
security definer
set search_path = public
as $$
  update public.perfis set senha_definida = true where id = auth.uid();
$$;

revoke all on function public.marcar_senha_definida() from public;
grant execute on function public.marcar_senha_definida() to authenticated;

-- ---------------------------------------------------------------------------
-- Quem já vinha usando o sistema não é interrompido: só quem nunca entrou
-- passa pela tela de definir senha. A consulta abaixo lê last_sign_in_at de
-- auth.users, que é o registro real de primeiro acesso.
-- ---------------------------------------------------------------------------
update public.perfis p
   set senha_definida = true
  from auth.users u
 where u.id = p.id
   and u.last_sign_in_at is not null
   and p.senha_definida = false;
