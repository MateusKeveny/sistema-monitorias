-- ============================================================================
-- A troca de senha passa a ser registrada pelo próprio banco
-- Rode DEPOIS de 11-tabela-unica-de-pessoas.sql. Pode ser executado mais de
-- uma vez.
--
-- Até agora quem marcava `senha_definida` era a função `marcar_senha_definida`,
-- chamada pela tela depois de trocar a senha. O problema é que ela marcava sem
-- conferir nada: qualquer pessoa logada podia chamá-la direto pela API e sair
-- da troca obrigatória com a senha padrão intacta, e o sistema passaria a
-- achar que ela já havia trocado.
--
-- Não é um buraco de invasão — quem chama já está dentro. É o contrário: é a
-- trava que existe para tirar de circulação a senha padrão, que é conhecida e
-- adivinhável, e que hoje pode ser contornada por quem tem exatamente o
-- interesse de não trocá-la.
--
-- A correção tira a decisão da tela e entrega ao banco: a marca passa a vir da
-- troca real da senha, e não de alguém dizendo que trocou.
-- ============================================================================

create or replace function public.registrar_troca_de_senha()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.pessoas
     set senha_definida = true
   where auth_id = new.id
     and senha_definida is distinct from true;
  return new;
end;
$$;

revoke all on function public.registrar_troca_de_senha()
  from public, anon, authenticated;

-- `of encrypted_password` faz o gatilho disparar só quando a senha muda de
-- fato. Sem isso ele rodaria em toda atualização do usuário — troca de e-mail,
-- confirmação, renovação de sessão — e voltaria a marcar sem a senha ter sido
-- trocada, que é justamente o defeito sendo corrigido.
drop trigger if exists ao_trocar_senha on auth.users;
create trigger ao_trocar_senha
  after update of encrypted_password on auth.users
  for each row
  when (old.encrypted_password is distinct from new.encrypted_password)
  execute function public.registrar_troca_de_senha();

-- ---------------------------------------------------------------------------
-- A função antiga sai de circulação
--
-- Não é apagada: a tela ainda a chama até o próximo deploy, e apagar agora
-- deixaria a troca de senha com erro nesse intervalo. Fica sem permissão de
-- execução, que já basta para fechar o desvio — e o `drop` fica para depois,
-- comentado abaixo.
-- ---------------------------------------------------------------------------
revoke all on function public.marcar_senha_definida()
  from public, anon, authenticated;

-- Depois de a aplicação parar de chamá-la:
-- drop function if exists public.marcar_senha_definida();
