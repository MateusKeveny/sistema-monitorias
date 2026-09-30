-- ============================================================================
-- 36 · Diário de bordo: dia do ocorrido e validade
--
-- Gestor e Pleno (quem aprova, migração 33) podem, ao registrar:
--   - escolher o dia do ocorrido — hoje ou antes, nunca depois;
--   - marcar que o registro tem validade e dizer até quando vale.
--
-- Vencido, o registro NÃO sai do diário: continua na consulta de todos e na
-- monitoria, só marcado como vencido. Para os demais, o dia é sempre o do
-- registro e não há validade — o banco garante, não só a tela.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

alter table public.diario_registros add column if not exists valido_ate date;

alter table public.diario_registros drop constraint if exists diario_validade_depois_do_dia;
alter table public.diario_registros add constraint diario_validade_depois_do_dia check (
  valido_ate is null or valido_ate >= data
);

-- Situação decidida pelo banco (a da 35, com o dia e a validade).
create or replace function public.diario_situacao()
returns trigger language plpgsql as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
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
-- Conferência: a coluna de validade e a trava de datas
-- ---------------------------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'diario_registros' and column_name = 'valido_ate') as coluna_validade,
  (select count(*) from pg_constraint where conname = 'diario_validade_depois_do_dia') as trava_de_datas;
