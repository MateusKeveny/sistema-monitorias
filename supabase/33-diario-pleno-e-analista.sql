-- ============================================================================
-- 33 · Diário de bordo: Pleno e Analista
--
-- Na 31, só o gestor concluía a própria autorização da gestão ou diretoria e
-- só ele aprovava as dos outros. Agora, pelo CARGO da pessoa no mês:
--
--   - Pleno e Analista: registram autorização da gestão ou diretoria e o
--     registro já nasce concluído, como o do gestor.
--   - Pleno: aprova ou devolve os registros que aguardam (dos júniores; os do
--     Analista já concluem direto), como o gestor.
--   - Excluir continua só do gestor.
--
-- Os cargos são lidos pelo nome ("Atendente Pleno", "Analista"), não pelo
-- número, para a regra não depender da ordem em que foram criados.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

-- O nome do cargo que vale hoje para quem está logado.
create or replace function public.cargo_atual_nome()
returns text language sql stable security definer set search_path = public as $$
  select c.nome
    from public.cargos c
   where c.id = public.cargo_na_competencia(
           public.pessoa_atual(), (now() at time zone 'America/Sao_Paulo')::date);
$$;

-- Registra autorização da gestão ou diretoria sem precisar de aprovação.
create or replace function public.conclui_diario_direto()
returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_gestor() is true
      or coalesce(public.cargo_atual_nome() in ('Atendente Pleno', 'Analista'), false);
$$;

-- Aprova ou devolve registros do diário que aguardam.
create or replace function public.aprova_diario()
returns boolean language sql stable security definer set search_path = public as $$
  select public.eh_gestor() is true
      or coalesce(public.cargo_atual_nome() = 'Atendente Pleno', false);
$$;

revoke all on function public.cargo_atual_nome() from public, anon;
revoke all on function public.conclui_diario_direto() from public, anon;
revoke all on function public.aprova_diario() from public, anon;
grant execute on function public.cargo_atual_nome() to authenticated;
grant execute on function public.conclui_diario_direto() to authenticated;
grant execute on function public.aprova_diario() to authenticated;

-- ---------------------------------------------------------------------------
-- Situação decidida pelo banco (substitui a da 31)
-- ---------------------------------------------------------------------------
create or replace function public.diario_situacao()
returns trigger language plpgsql as $$
begin
  -- A decisão de quem aprova (aprovar/devolver) passa direto.
  if tg_op = 'UPDATE' and public.aprova_diario() and new.situacao is distinct from old.situacao then
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

  if new.autorizado_por in ('gestao', 'diretoria') and not public.conclui_diario_direto() then
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

-- ---------------------------------------------------------------------------
-- Aprovar ou devolver: gestor ou Pleno, nunca o próprio registro
-- ---------------------------------------------------------------------------
create or replace function public.decidir_registro_diario(p_registro uuid, p_aprovar boolean, p_comentario text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.aprova_diario() is not true then
    raise exception 'Só o gestor ou o Pleno aprova ou devolve registros do diário.';
  end if;
  if not p_aprovar and length(trim(coalesce(p_comentario, ''))) = 0 then
    raise exception 'Diga o que precisa ser corrigido ao devolver.';
  end if;

  update public.diario_registros
     set situacao = case when p_aprovar then 'concluido' else 'devolvido' end,
         decidido_por = public.pessoa_atual(),
         decidido_em = now(),
         comentario_decisao = nullif(trim(coalesce(p_comentario, '')), '')
   where id = p_registro and situacao = 'aguardando'
     and (public.eh_gestor() or pessoa_id <> public.pessoa_atual());

  if not found then
    raise exception 'Registro não encontrado, já decidido ou é seu.';
  end if;
end;
$$;

revoke all on function public.decidir_registro_diario(uuid, boolean, text) from public, anon;
grant execute on function public.decidir_registro_diario(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Conferência: quem aprova e quem conclui direto, pelo cargo de hoje
-- ---------------------------------------------------------------------------
select p.nome, c.nome as cargo,
       c.nome in ('Atendente Pleno', 'Analista') or p.papel = 'gestor' as conclui_direto,
       c.nome = 'Atendente Pleno' or p.papel = 'gestor' as aprova
  from public.pessoas p
  left join public.cargos c
    on c.id = public.cargo_na_competencia(p.id, (now() at time zone 'America/Sao_Paulo')::date)
 where p.ativo
 order by aprova desc, conclui_direto desc, p.nome;
