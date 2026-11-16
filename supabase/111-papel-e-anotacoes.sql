-- 111 · Papel de diretoria e anotações do gestor (Performance 4.11.1)
--
-- Teste de acesso por dentro (13/11/2026), simulando cada papel logado:
--
-- 1. Um gestor conseguia mudar o PRÓPRIO papel para "diretoria" (o da CEO,
--    que vê e aprova a cota de todos os setores). Só o papel de
--    administrador era protegido. Agora:
--      · só o administrador dá ou tira o papel de diretoria;
--      · ninguém muda o próprio nível de acesso (o gestor pede a outro gestor
--        do setor ou ao administrador).
--
-- 2. As anotações do gestor (Diário de bordo › Anotações do gestor) eram lidas
--    por qualquer gestor de qualquer setor: o gestor do Telecom lia as do
--    Expansão. Agora cada gestor lê as próprias, as de quem é do setor dele e
--    as sobre alguém do setor dele (o administrador continua vendo todas).
--
-- 3. O papel "qualidade" via o mesmo que o gestor no setor. Decisão do gestor
--    (13/11/2026): qualidade deixa de ver, de outras pessoas,
--      · o valor em R$ do pagamento (vw_pagamento_mensal: só a própria linha);
--      · os desligamentos (saidas);
--      · os registros privados dos atendentes com a gestão (diario_privados);
--      · as férias (ve_ferias), mesmo tendo cargo de Pleno.
--    Continua vendo notas, C-SAT, volume, pontos e monitorias da equipe.
--    Junto: cada pessoa passa a ver as próprias férias (o quadro "Para bater a
--    meta" do atendente já as procurava, e a regra só deixava gestão, Pleno e
--    Analista).
--
-- Guarda: só troca o que for exatamente o conferido (md5).

do $guarda$
begin
  if md5(pg_get_functiondef('public.guarda_da_pessoa()'::regprocedure)) <> 'ed791b59972cfa6d9398b41e96374e04' then
    raise exception 'guarda_da_pessoa mudou desde a conferência: revisar a 111 antes de aplicar.';
  end if;
end $guarda$;

create or replace function public.guarda_da_pessoa()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if auth.uid() is null or public.eh_admin() then return coalesce(new, old); end if;
  if (tg_op <> 'DELETE' and new.papel = 'administrador') or (tg_op <> 'INSERT' and old.papel = 'administrador') then
    raise exception 'Só o administrador mexe na conta de administrador.' using errcode = '42501';
  end if;
  -- 111: o papel de diretoria (a CEO) só o administrador dá ou tira.
  if (tg_op = 'INSERT' and new.papel = 'diretoria')
     or (tg_op = 'UPDATE' and (new.papel = 'diretoria') is distinct from (old.papel = 'diretoria'))
     or (tg_op = 'DELETE' and old.papel = 'diretoria') then
    raise exception 'Só o administrador dá ou tira o papel de diretoria.' using errcode = '42501';
  end if;
  -- 111: ninguém muda o próprio nível de acesso.
  if tg_op = 'UPDATE' and old.id = public.pessoa_atual() and new.papel is distinct from old.papel then
    raise exception 'Ninguém muda o próprio nível de acesso: peça a outro gestor do setor ou ao administrador.' using errcode = '42501';
  end if;
  if tg_op <> 'INSERT' and coalesce(public.papel_atual(), 'operador') <> 'operador'
     and not public.cuida_da_pessoa(old.id)
     and exists (select 1 from public.setores_da_pessoa s where s.pessoa_id = old.id) then
    raise exception 'Fora do seu setor: só o administrador mexe em outro setor.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$function$;

drop policy if exists anotacoes_leitura on public.diario_anotacoes;
create policy anotacoes_leitura on public.diario_anotacoes for select
  using (
    (select public.eh_gestor())
    and (autor_id = (select public.pessoa_atual())
         or autor_id = any ((select public.pessoas_que_vejo())::uuid[])
         or sobre_pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
  );

-- ------------------------------------------------- 3. O que qualidade vê
do $guarda$
begin
  if md5(pg_get_viewdef('public.vw_pagamento_mensal'::regclass)) <> '3d7b24d2d62a106b3e06931ab13955fb' then
    raise exception 'vw_pagamento_mensal mudou desde a conferência: revisar a 111 antes de aplicar.';
  end if;
  if md5(pg_get_functiondef('public.ve_ferias()'::regprocedure)) <> 'dc44a02d104dde12b541f93cc54a0b4d' then
    raise exception 've_ferias mudou desde a conferência: revisar a 111 antes de aplicar.';
  end if;
end $guarda$;

-- Pagamento: qualidade vê só a própria linha.
do $$
declare
  t text := pg_get_viewdef('public.vw_pagamento_mensal'::regclass);
  n text;
begin
  n := regexp_replace(t, 'FROM conta;\s*$',
    'FROM conta' || chr(10) || '  WHERE ((conta.pessoa_id = pessoa_atual()) OR (COALESCE(papel_atual(), ''operador''::text) <> ''qualidade''::text));');
  if n = t then raise exception 'vw_pagamento_mensal: final da visão não encontrado'; end if;
  execute 'create or replace view public.vw_pagamento_mensal with (security_invoker = true) as ' || n;
end $$;

-- Férias: qualidade não vê as de outras pessoas; cada um vê as próprias.
create or replace function public.ve_ferias()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select public.eh_gestor() is true
      or (coalesce(public.papel_atual(), 'operador') <> 'qualidade'
          and coalesce(public.cargo_atual_nome() in ('Atendente Pleno', 'Analista'), false));
$function$;

drop policy if exists ferias_le on public.ferias;
create policy ferias_le on public.ferias for select to authenticated
  using ((public.ve_ferias() and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]))
         or pessoa_id = (select public.pessoa_atual()));

-- Desligamentos: só a gestão.
drop policy if exists saidas_leitura on public.saidas;
create policy saidas_leitura on public.saidas for select
  using ((select public.ve_o_time()) and coalesce((select public.papel_atual()), 'operador') <> 'qualidade'
         and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[]));

-- Registros privados: a própria pessoa e quem aprova o diário, menos qualidade.
drop policy if exists privados_leitura on public.diario_privados;
create policy privados_leitura on public.diario_privados for select
  using ((pessoa_id = (select public.pessoa_atual()))
         or (public.aprova_diario() and coalesce((select public.papel_atual()), 'operador') <> 'qualidade'
             and pessoa_id = any ((select public.pessoas_que_vejo())::uuid[])));