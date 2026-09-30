-- ============================================================================
-- 37 · Diário de bordo: renovar a validade
--
-- Nos 7 dias antes de vencer, gestor e Pleno podem renovar o registro: a
-- validade passa para uma data nova, sem criar outro registro. Registro já
-- vencido não se renova — para voltar a valer, cria-se um registro novo.
--
-- Cada renovação fica em `diario_renovacoes` (de quando, para quando, quem,
-- quando): a validade antiga não se perde.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

create table if not exists public.diario_renovacoes (
  id            uuid primary key default uuid_generate_v4(),
  registro_id   uuid not null references public.diario_registros (id) on delete cascade,
  valia_ate     date not null,
  passa_a_valer date not null,
  renovado_por  uuid references public.pessoas (id) on delete set null,
  renovado_em   timestamptz not null default now()
);

create index if not exists diario_renovacoes_registro on public.diario_renovacoes (registro_id);

alter table public.diario_renovacoes enable row level security;

-- Todos leem, como o diário. Gravar, só pela função abaixo.
drop policy if exists renovacoes_leitura on public.diario_renovacoes;
create policy renovacoes_leitura on public.diario_renovacoes
  for select using (public.papel_atual() is not null);

-- ---------------------------------------------------------------------------
-- Renovar: gestor ou Pleno, só nos 7 dias antes de vencer
-- ---------------------------------------------------------------------------
create or replace function public.renovar_registro_diario(p_registro uuid, p_ate date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_hoje  date := (now() at time zone 'America/Sao_Paulo')::date;
  v_atual date;
begin
  if public.aprova_diario() is not true then
    raise exception 'Só o gestor ou o Pleno renova registros do diário.';
  end if;

  select valido_ate into v_atual from public.diario_registros where id = p_registro;
  if v_atual is null then
    raise exception 'Este registro não tem validade.';
  end if;
  if v_atual < v_hoje then
    raise exception 'Registro vencido não se renova: crie um registro novo.';
  end if;
  if v_atual > v_hoje + 7 then
    raise exception 'A renovação abre nos 7 dias antes de vencer.';
  end if;
  if p_ate is null or p_ate <= v_atual then
    raise exception 'A nova validade precisa ser depois de %.', to_char(v_atual, 'DD/MM/YYYY');
  end if;

  -- Renovação marcada para o gatilho diario_situacao deixar passar sem
  -- recalcular a situação (e sem trocar quem aprovou).
  perform set_config('diario.renovando', 'sim', true);
  update public.diario_registros set valido_ate = p_ate where id = p_registro;
  perform set_config('diario.renovando', '', true);

  insert into public.diario_renovacoes (registro_id, valia_ate, passa_a_valer, renovado_por)
  values (p_registro, v_atual, p_ate, public.pessoa_atual());
end;
$$;

revoke all on function public.renovar_registro_diario(uuid, date) from public, anon;
grant execute on function public.renovar_registro_diario(uuid, date) to authenticated;

-- Situação decidida pelo banco (a da 36, deixando passar a renovação).
create or replace function public.diario_situacao()
returns trigger language plpgsql as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- Renovação (função renovar_registro_diario): só a validade muda.
  if tg_op = 'UPDATE' and current_setting('diario.renovando', true) = 'sim' then
    new.atualizado_em := now();
    return new;
  end if;

  -- A decisão de quem aprova (aprovar/devolver) passa direto.
  if tg_op = 'UPDATE' and public.aprova_diario() and new.situacao is distinct from old.situacao then
    new.atualizado_em := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.pessoa_id := coalesce(public.pessoa_atual(), new.pessoa_id);
    new.criado_em := now();
  end if;

  -- Dia do ocorrido e validade: só gestor e Pleno escolhem.
  if public.aprova_diario() then
    new.data := coalesce(new.data, v_hoje);
    if new.data > v_hoje then
      raise exception 'O dia do ocorrido não pode ser depois de hoje.';
    end if;
  elsif tg_op = 'INSERT' then
    new.data := v_hoje;
    new.valido_ate := null;
  else
    -- Correção de um devolvido pelo autor: dia e validade ficam como estavam.
    new.data := old.data;
    new.valido_ate := old.valido_ate;
  end if;

  -- O protocolo é gravado sem espaços nas pontas: é por ele que a monitoria
  -- encontra o registro. Em branco vira nulo.
  new.protocolo := nullif(trim(coalesce(new.protocolo, '')), '');

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
-- Conferência: a tabela de renovações e a função
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.tables
    where table_schema = 'public' and table_name = 'diario_renovacoes') as tabela_de_renovacoes,
  (select count(*) from pg_proc where proname = 'renovar_registro_diario') as funcao_de_renovar;
