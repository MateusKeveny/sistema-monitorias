-- ============================================================================
-- 44 · Reportar problema
--
-- Qualquer pessoa, nos dois sites, reporta um problema pelo botão do menu. O
-- relato leva sozinho a tela, a versão e o navegador; o print é opcional e
-- fica no Storage (bucket privado "reportes"). Quem reportou acompanha os
-- próprios; o gestor vê todos, responde e marca em análise ou resolvido.
--
-- Cada report novo vira cartão no Teams, no destino "reporte_novo"
-- (Configuração › Avisos no Teams).
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

create table if not exists public.reportes (
  id               bigint generated always as identity primary key,
  pessoa_id        uuid not null default public.pessoa_atual() references public.pessoas (id) on delete restrict,
  sistema          text not null check (sistema in ('performance', 'monitorias')),
  tela             text,
  versao           text,
  navegador        text,
  descricao        text not null check (length(trim(descricao)) > 0),
  esperado         text,
  print_path       text,
  situacao         text not null default 'novo' check (situacao in ('novo', 'analise', 'resolvido')),
  resposta         text,
  respondido_por   uuid references public.pessoas (id) on delete set null,
  respondido_em    timestamptz,
  -- Falso quando o gestor responde e o autor ainda não viu: é o aviso no botão.
  lido_pelo_autor  boolean not null default true,
  criado_em        timestamptz not null default now()
);

create index if not exists reportes_pessoa on public.reportes (pessoa_id, criado_em desc);

-- Autor é quem está logado e todo report nasce novo. Quando o gestor muda a
-- resposta, grava quem respondeu e acende o aviso para o autor.
create or replace function public.reporte_regras()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.pessoa_id := coalesce(public.pessoa_atual(), new.pessoa_id);
    new.situacao := 'novo';
    new.resposta := null; new.respondido_por := null; new.respondido_em := null;
    new.lido_pelo_autor := true;
    new.criado_em := now();
  elsif new.resposta is distinct from old.resposta then
    new.respondido_por := public.pessoa_atual();
    new.respondido_em := now();
    new.lido_pelo_autor := false;
  end if;
  return new;
end;
$$;

drop trigger if exists reporte_regras on public.reportes;
create trigger reporte_regras before insert or update on public.reportes
  for each row execute function public.reporte_regras();

alter table public.reportes enable row level security;

drop policy if exists reportes_leitura on public.reportes;
create policy reportes_leitura on public.reportes
  for select using (pessoa_id = public.pessoa_atual() or public.eh_gestor());

drop policy if exists reportes_envio on public.reportes;
create policy reportes_envio on public.reportes
  for insert with check (public.pessoa_atual() is not null and pessoa_id = public.pessoa_atual());

-- Responder, mudar situação e excluir: só o gestor.
drop policy if exists reportes_gestor on public.reportes;
create policy reportes_gestor on public.reportes
  for update using (public.eh_gestor()) with check (public.eh_gestor());

drop policy if exists reportes_exclusao on public.reportes;
create policy reportes_exclusao on public.reportes
  for delete using (public.eh_gestor());

-- O autor apaga o aviso de resposta nova ao abrir "Meus reports".
create or replace function public.marcar_reportes_lidos()
returns void language sql security definer set search_path = public as $$
  update public.reportes set lido_pelo_autor = true
   where pessoa_id = public.pessoa_atual() and not lido_pelo_autor;
$$;

revoke all on function public.marcar_reportes_lidos() from public, anon;
grant execute on function public.marcar_reportes_lidos() to authenticated;

-- ---------------------------------------------------------------------------
-- Print: bucket privado. Cada um grava na própria pasta (id da pessoa);
-- lê a própria pasta, e o gestor lê todas.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reportes', 'reportes', false, 5242880, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists reportes_print_envio on storage.objects;
create policy reportes_print_envio on storage.objects
  for insert to authenticated
  with check (bucket_id = 'reportes' and (storage.foldername(name))[1] = public.pessoa_atual()::text);

drop policy if exists reportes_print_leitura on storage.objects;
create policy reportes_print_leitura on storage.objects
  for select to authenticated
  using (bucket_id = 'reportes' and ((storage.foldername(name))[1] = public.pessoa_atual()::text or public.eh_gestor()));

drop policy if exists reportes_print_exclusao on storage.objects;
create policy reportes_print_exclusao on storage.objects
  for delete to authenticated
  using (bucket_id = 'reportes' and public.eh_gestor());

-- ---------------------------------------------------------------------------
-- Aviso no Teams a cada report novo
-- ---------------------------------------------------------------------------
alter table public.avisos_teams drop constraint if exists avisos_teams_chave_check;
alter table public.avisos_teams add constraint avisos_teams_chave_check check (chave in (
  'semana_encerrada', 'monitorias_liberadas', 'lembrete_fechamento', 'diario_novidades', 'reporte_novo'));

insert into public.avisos_teams (chave) values ('reporte_novo') on conflict (chave) do nothing;

create or replace function public.aviso_reporte_novo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_titulo text := format('#%s · %s', new.id, left(regexp_replace(new.descricao, '\s+', ' ', 'g'), 80));
  v_texto  text := regexp_replace(new.descricao, '\s+', ' ', 'g');
begin
  if length(v_texto) > 280 then v_texto := rtrim(left(v_texto, 280)) || '…'; end if;
  perform public.enviar_aviso_teams('reporte_novo', 'reporte/' || new.id, v_titulo,
    public.cartao_teams('Problema reportado', 'Attention', v_titulo, v_texto,
      jsonb_build_array(
        jsonb_build_object('title', 'Quem', 'value', coalesce((select nome from public.pessoas where id = new.pessoa_id), '—')),
        jsonb_build_object('title', 'Tela', 'value', coalesce(new.tela, '—')),
        jsonb_build_object('title', 'Versão', 'value', coalesce(new.versao, '—')),
        jsonb_build_object('title', 'Print', 'value', case when new.print_path is null then 'não' else 'sim' end)),
      'Abrir o report', public.endereco_do_site('performance') || '/reportes?id=' || new.id));
  return null;
end;
$$;

drop trigger if exists aviso_reporte_novo on public.reportes;
create trigger aviso_reporte_novo after insert on public.reportes
  for each row execute function public.aviso_reporte_novo();

create or replace function public.testar_aviso_teams(p_chave text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_titulo text := 'Teste do Painel de Performance';
begin
  if public.eh_gestor() is not true then
    raise exception 'Só o gestor testa os avisos.';
  end if;
  return public.enviar_aviso_teams(p_chave, 'teste ' || clock_timestamp()::text, v_titulo,
    public.cartao_teams('Teste', 'Accent', v_titulo,
      format('Se este cartão chegou, o aviso "%s" está configurado neste destino.',
             case p_chave when 'semana_encerrada' then 'Semana encerrada e mês fechado'
                          when 'monitorias_liberadas' then 'Monitorias liberadas'
                          when 'diario_novidades' then 'Novidades do diário'
                          when 'reporte_novo' then 'Problema reportado'
                          else 'Lembrete de fechamento' end),
      '[]'::jsonb, 'Abrir o painel', public.endereco_do_site('performance') || '/cota'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Conferência: tabela com RLS, bucket privado e cinco avisos
-- ---------------------------------------------------------------------------
select
  (select relrowsecurity from pg_class where relname = 'reportes') as reportes_com_rls,
  (select public from storage.buckets where id = 'reportes') as bucket_publico,
  (select count(*) from public.avisos_teams) as avisos;
