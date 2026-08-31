-- ============================================================================
-- Edição de monitoria com histórico de alterações.
-- Rode DEPOIS de 05-ciclo-26-a-25.sql. Pode ser executado mais de uma vez.
--
-- Monitoria é avaliação de pessoa: uma nota corrigida depois precisa poder ser
-- reconstruída — quem mudou, quando, de quê para quê. Sem isso, liberar edição
-- seria trocar um problema (não poder corrigir) por outro (não poder auditar).
-- ============================================================================

create table if not exists public.monitoria_alteracoes (
  id              uuid primary key default uuid_generate_v4(),
  monitoria_id    uuid not null references public.monitorias (id) on delete cascade,
  autor_id        uuid references public.perfis (id) on delete set null,
  -- Nome copiado no momento da alteração: o histórico continua legível mesmo
  -- que o perfil do autor seja removido depois.
  autor_nome      text,
  alterado_em     timestamptz not null default now(),
  campo           text not null,
  valor_anterior  text,
  valor_novo      text
);

create index if not exists alteracoes_monitoria_idx
  on public.monitoria_alteracoes (monitoria_id, alterado_em desc);

-- ---------------------------------------------------------------------------
-- Registro das alterações
-- ---------------------------------------------------------------------------

create or replace function public.registrar_alteracao(
  p_monitoria uuid, p_campo text, p_anterior text, p_novo text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_nome text;
begin
  select nome into v_nome from public.perfis where id = auth.uid();

  insert into public.monitoria_alteracoes
    (monitoria_id, autor_id, autor_nome, campo, valor_anterior, valor_novo)
  values
    (p_monitoria, auth.uid(), coalesce(v_nome, 'sistema'), p_campo, p_anterior, p_novo);
end;
$$;

-- Campos da própria monitoria. O texto guardado é o valor legível, não o id:
-- o histórico precisa fazer sentido para quem lê, não só para o banco.
create or replace function public.auditar_monitoria()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_antes text;
  v_depois text;
begin
  if new.protocolo is distinct from old.protocolo then
    perform public.registrar_alteracao(new.id, 'Protocolo', old.protocolo, new.protocolo);
  end if;

  if new.data_atendimento is distinct from old.data_atendimento then
    perform public.registrar_alteracao(new.id, 'Data do atendimento',
      to_char(old.data_atendimento, 'DD/MM/YYYY'), to_char(new.data_atendimento, 'DD/MM/YYYY'));
  end if;

  if new.operador_id is distinct from old.operador_id then
    select nome into v_antes  from public.operadores where id = old.operador_id;
    select nome into v_depois from public.operadores where id = new.operador_id;
    perform public.registrar_alteracao(new.id, 'Operador', v_antes, v_depois);
  end if;

  if new.canal_id is distinct from old.canal_id then
    select nome into v_antes  from public.canais where id = old.canal_id;
    select nome into v_depois from public.canais where id = new.canal_id;
    perform public.registrar_alteracao(new.id, 'Canal', v_antes, v_depois);
  end if;

  if new.numero_monitoria is distinct from old.numero_monitoria then
    perform public.registrar_alteracao(new.id, 'Nº da monitoria',
      old.numero_monitoria || 'ª', new.numero_monitoria || 'ª');
  end if;

  if new.zerado is distinct from old.zerado then
    perform public.registrar_alteracao(new.id, 'Zeramento por falha crítica',
      case when old.zerado then 'Sim' else 'Não' end,
      case when new.zerado then 'Sim' else 'Não' end);
  end if;

  if new.motivo_zeramento is distinct from old.motivo_zeramento then
    perform public.registrar_alteracao(new.id, 'Motivo do zeramento',
      old.motivo_zeramento, new.motivo_zeramento);
  end if;

  if new.parecer is distinct from old.parecer then
    perform public.registrar_alteracao(new.id, 'Parecer geral', old.parecer, new.parecer);
  end if;

  -- A nota é derivada, mas é o número que a pessoa recebe: entra no histórico.
  if new.nota_final is distinct from old.nota_final then
    perform public.registrar_alteracao(new.id, 'Nota final',
      round(old.nota_final * 100, 1) || '%', round(new.nota_final * 100, 1) || '%');
  end if;

  return new;
end;
$$;

drop trigger if exists auditar_monitoria on public.monitorias;
create trigger auditar_monitoria
  after update on public.monitorias
  for each row execute function public.auditar_monitoria();

-- Respostas dos critérios.
create or replace function public.auditar_item()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_criterio text;
begin
  select nome into v_criterio from public.criterios where id = new.criterio_id;

  if new.conforme is distinct from old.conforme then
    perform public.registrar_alteracao(new.monitoria_id, 'Critério: ' || v_criterio,
      case when old.conforme then 'Sim' else 'Não' end,
      case when new.conforme then 'Sim' else 'Não' end);
  end if;

  if new.observacao is distinct from old.observacao then
    perform public.registrar_alteracao(new.monitoria_id,
      'Observação de "' || v_criterio || '"', old.observacao, new.observacao);
  end if;

  return new;
end;
$$;

drop trigger if exists auditar_item on public.monitoria_itens;
create trigger auditar_item
  after update on public.monitoria_itens
  for each row execute function public.auditar_item();

-- ---------------------------------------------------------------------------
-- Acesso ao histórico: mesma regra das monitorias — o operador vê o próprio.
-- Ninguém escreve pela API; só os gatilhos acima, que são security definer.
-- ---------------------------------------------------------------------------
alter table public.monitoria_alteracoes enable row level security;

drop policy if exists alteracoes_leitura on public.monitoria_alteracoes;
create policy alteracoes_leitura on public.monitoria_alteracoes
  for select using (
    exists (
      select 1 from public.monitorias m
      where m.id = monitoria_id
        and (public.eh_gestor_ou_admin() or m.operador_id = public.operador_atual())
    )
  );
