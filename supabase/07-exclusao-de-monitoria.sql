-- ============================================================================
-- Exclusão de monitoria, restrita à Qualidade.
-- Rode DEPOIS de 06-edicao-e-historico.sql. Pode ser executado mais de uma vez.
--
-- Apagar a linha levaria junto os itens e o histórico de alterações, por causa
-- do cascade. Some a avaliação e some também a prova de que ela existiu — o
-- oposto do que o histórico foi criado para garantir. Por isso a exclusão
-- guarda antes um registro do que foi apagado, com quem apagou e por quê.
-- ============================================================================

create table if not exists public.monitorias_excluidas (
  id                uuid primary key default uuid_generate_v4(),
  monitoria_id      uuid not null,
  protocolo         text,
  data_atendimento  date,
  mes_referencia    date,
  semana_mes        smallint,
  numero_monitoria  smallint,
  operador_id       uuid,
  operador_nome     text,
  nota_final        numeric(6,4),
  zerado            boolean,
  parecer           text,
  motivo            text not null,
  excluida_por      uuid references public.perfis (id) on delete set null,
  excluida_por_nome text,
  excluida_em       timestamptz not null default now()
);

create index if not exists excluidas_operador_idx
  on public.monitorias_excluidas (operador_id, excluida_em desc);

-- ---------------------------------------------------------------------------
-- A exclusão passa por esta função, e não por um delete direto: assim o
-- registro do que foi apagado e o apagar em si acontecem na mesma transação —
-- não há como perder um e executar o outro.
-- ---------------------------------------------------------------------------
create or replace function public.excluir_monitoria(p_id uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m       public.monitorias%rowtype;
  v_operador text;
  v_autor    text;
begin
  if not public.eh_admin() then
    raise exception 'Apenas a Qualidade pode excluir monitorias.';
  end if;

  if coalesce(trim(p_motivo), '') = '' then
    raise exception 'Informe o motivo da exclusão.';
  end if;

  select * into v_m from public.monitorias where id = p_id;
  if not found then
    raise exception 'Monitoria não encontrada.';
  end if;

  select nome into v_operador from public.operadores where id = v_m.operador_id;
  select nome into v_autor    from public.perfis     where id = auth.uid();

  insert into public.monitorias_excluidas (
    monitoria_id, protocolo, data_atendimento, mes_referencia, semana_mes,
    numero_monitoria, operador_id, operador_nome, nota_final, zerado, parecer,
    motivo, excluida_por, excluida_por_nome)
  values (
    v_m.id, v_m.protocolo, v_m.data_atendimento, v_m.mes_referencia, v_m.semana_mes,
    v_m.numero_monitoria, v_m.operador_id, v_operador, v_m.nota_final, v_m.zerado,
    v_m.parecer, trim(p_motivo), auth.uid(), coalesce(v_autor, 'sistema'));

  delete from public.monitorias where id = p_id;
end;
$$;

revoke all on function public.excluir_monitoria(uuid, text) from public;
grant execute on function public.excluir_monitoria(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- O registro de exclusões é leitura para quem enxerga o time. Ninguém escreve
-- nem apaga por aqui: só a função acima, que é security definer.
-- ---------------------------------------------------------------------------
alter table public.monitorias_excluidas enable row level security;

drop policy if exists excluidas_leitura on public.monitorias_excluidas;
create policy excluidas_leitura on public.monitorias_excluidas
  for select using (public.eh_gestor_ou_admin());
