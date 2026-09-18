-- ============================================================================
-- Painel de Cota — ajustar ou reabrir um fechamento, com respaldo
-- Rode DEPOIS de 21-media-mais-rapida.sql. Pode ser executado mais de uma vez.
-- (Sem bloco `do $$`: o SQL Editor do Supabase corta o bloco ao colar.)
--
-- O fechamento continua sendo o valor entregue e não muda sozinho. Mas erro
-- acontece — um volume digitado errado, uma monitoria lançada depois — e sem
-- caminho de correção a saída seria mexer no banco por fora, sem rastro.
--
-- Então: só gestor, só com motivo escrito, e todo ajuste fica registrado com
-- valor anterior, valor novo, autor e data. O histórico não se apaga.
-- ============================================================================

create table if not exists public.fechamento_alteracoes (
  id             bigint generated always as identity primary key,
  fechamento_id  uuid not null,
  pessoa_id      uuid references public.pessoas (id) on delete set null,
  pessoa_nome    text,
  mes_competencia date not null,
  -- 'resultado', 'meta' ou 'reabertura'.
  campo          text not null,
  valor_anterior text,
  valor_novo     text,
  motivo         text not null,
  autor_id       uuid references public.pessoas (id) on delete set null,
  autor_nome     text,
  criado_em      timestamptz not null default now()
);

create index if not exists fechamento_alteracoes_mes_idx
  on public.fechamento_alteracoes (mes_competencia, criado_em desc);

-- ---------------------------------------------------------------------------
-- Ajustar um valor do fechamento
-- ---------------------------------------------------------------------------
create or replace function public.ajustar_fechamento(
  p_fechamento uuid, p_campo text, p_valor numeric, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_nome  text;
  v_f     record;
  v_antes numeric;
begin
  if public.eh_gestor() is not true then
    raise exception 'Apenas gestores ajustam um fechamento.';
  end if;
  if p_campo not in ('resultado', 'meta') then
    raise exception 'Só resultado e meta podem ser ajustados.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo do ajuste.';
  end if;

  select * into v_f from public.fechamentos_cota where id = p_fechamento;
  if not found then
    raise exception 'Fechamento não encontrado.';
  end if;

  v_antes := case p_campo when 'resultado' then v_f.resultado else v_f.meta end;

  if p_campo = 'resultado' then
    update public.fechamentos_cota set resultado = p_valor where id = p_fechamento;
  else
    update public.fechamentos_cota set meta = p_valor where id = p_fechamento;
  end if;

  select nome into v_nome from public.pessoas where id = public.pessoa_atual();

  insert into public.fechamento_alteracoes
    (fechamento_id, pessoa_id, pessoa_nome, mes_competencia, campo,
     valor_anterior, valor_novo, motivo, autor_id, autor_nome)
  values
    (p_fechamento, v_f.pessoa_id, v_f.pessoa_nome, v_f.mes_competencia, p_campo,
     v_antes::text, p_valor::text, btrim(p_motivo),
     public.pessoa_atual(), coalesce(v_nome, 'sistema'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Reabrir: apaga o congelamento da pessoa para poder fechar de novo
--
-- O registro do que havia antes fica no histórico — inclusive o resultado que
-- tinha sido entregue.
-- ---------------------------------------------------------------------------
create or replace function public.reabrir_fechamento(p_fechamento uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_nome text;
  v_f    record;
begin
  if public.eh_gestor() is not true then
    raise exception 'Apenas gestores reabrem um fechamento.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da reabertura.';
  end if;

  select * into v_f from public.fechamentos_cota where id = p_fechamento;
  if not found then
    raise exception 'Fechamento não encontrado.';
  end if;

  select nome into v_nome from public.pessoas where id = public.pessoa_atual();

  insert into public.fechamento_alteracoes
    (fechamento_id, pessoa_id, pessoa_nome, mes_competencia, campo,
     valor_anterior, valor_novo, motivo, autor_id, autor_nome)
  values
    (p_fechamento, v_f.pessoa_id, v_f.pessoa_nome, v_f.mes_competencia, 'reabertura',
     v_f.resultado::text, null, btrim(p_motivo),
     public.pessoa_atual(), coalesce(v_nome, 'sistema'));

  -- As linhas somem junto (cascade). Fechar de novo grava o extrato atual.
  delete from public.fechamentos_cota where id = p_fechamento;
end;
$$;

revoke all on function public.ajustar_fechamento(uuid, text, numeric, text) from public, anon;
grant execute on function public.ajustar_fechamento(uuid, text, numeric, text) to authenticated;
revoke all on function public.reabrir_fechamento(uuid, text) from public, anon;
grant execute on function public.reabrir_fechamento(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Quem lê o histórico
--
-- Gravação só pelas funções acima, que conferem o papel e exigem motivo. Não
-- existe política de escrita, nem de exclusão: respaldo que se apaga não é
-- respaldo.
-- ---------------------------------------------------------------------------
alter table public.fechamento_alteracoes enable row level security;

drop policy if exists fechamento_alteracoes_leitura on public.fechamento_alteracoes;
create policy fechamento_alteracoes_leitura on public.fechamento_alteracoes
  for select using (public.ve_o_time() or pessoa_id = public.pessoa_atual());
