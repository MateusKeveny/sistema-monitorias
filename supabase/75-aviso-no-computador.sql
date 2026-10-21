-- ============================================================================
-- 75 · Aviso no computador (Web Push) para os avisos do sino
--
-- Quem ativar recebe os avisos do sino (migração 74) também no canto da tela,
-- mesmo com o painel fechado — o mesmo mecanismo da Agenda (Web Push, chave
-- VAPID). Sem Teams.
--
-- Quem envia é o próprio site: depois que o gestor salva o volume da semana ou
-- os valores do RH, a tela chama /api/avisos/enviar, que lê aqui os avisos
-- ainda não enviados e as inscrições de quem ativou, envia e marca. Só o
-- gestor chama (as funções conferem).
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo.
-- ============================================================================

create table if not exists public.inscricoes_push (
  id         bigint generated always as identity primary key,
  -- A tela não sabe o id da pessoa: vem de quem está logado.
  pessoa_id  uuid not null default public.pessoa_atual() references public.pessoas (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  criado_em  timestamptz not null default now()
);
create index if not exists inscricoes_push_pessoa on public.inscricoes_push (pessoa_id);
alter table public.inscricoes_push enable row level security;
drop policy if exists inscricoes_push_dono on public.inscricoes_push;
create policy inscricoes_push_dono on public.inscricoes_push
  for all using (pessoa_id = public.pessoa_atual()) with check (pessoa_id = public.pessoa_atual());

alter table public.avisos_da_pessoa add column if not exists push_em timestamptz;
-- Os avisos que já existem não vão para o computador (seriam todos de uma vez).
update public.avisos_da_pessoa set push_em = now() where push_em is null;

-- Avisos ainda não enviados, com as inscrições de cada pessoa (últimas 24 h).
create or replace function public.avisos_para_enviar()
returns table (aviso_id bigint, titulo text, texto text, link text,
               inscricao_id bigint, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public as $$
begin
  if public.eh_gestor() is not true then raise exception 'Só o gestor envia avisos.'; end if;
  return query
    select a.id, a.titulo, a.texto, a.link, i.id, i.endpoint, i.p256dh, i.auth
      from public.avisos_da_pessoa a
      join public.inscricoes_push i on i.pessoa_id = a.pessoa_id
     where a.push_em is null and a.criado_em > now() - interval '24 hours'
     order by a.id;
end;
$$;

-- Marca os avisos como enviados e apaga as inscrições que o navegador recusou.
create or replace function public.avisos_enviados(p_avisos bigint[], p_inscricoes_mortas bigint[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.eh_gestor() is not true then raise exception 'Só o gestor envia avisos.'; end if;
  update public.avisos_da_pessoa set push_em = now() where id = any (coalesce(p_avisos, '{}'));
  delete from public.inscricoes_push where id = any (coalesce(p_inscricoes_mortas, '{}'));
end;
$$;

revoke all on function public.avisos_para_enviar() from public, anon;
revoke all on function public.avisos_enviados(bigint[], bigint[]) from public, anon;
grant execute on function public.avisos_para_enviar() to authenticated;
grant execute on function public.avisos_enviados(bigint[], bigint[]) to authenticated;

-- Conferência
select (select count(*) from pg_proc where proname in ('avisos_para_enviar', 'avisos_enviados')) as funcoes,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'avisos_da_pessoa' and column_name = 'push_em') as coluna;
