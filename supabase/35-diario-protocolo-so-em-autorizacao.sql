-- ============================================================================
-- 35 · Diário de bordo: protocolo só em autorização e exceção
--
-- Processo novo e treinamento nem sempre nascem de um atendimento: o
-- protocolo passa a ser opcional neles. Autorização e exceção continuam
-- exigindo — é por ele que a monitoria encontra o registro.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

alter table public.diario_registros alter column protocolo drop not null;
alter table public.diario_registros drop constraint if exists diario_registros_protocolo_check;
alter table public.diario_registros drop constraint if exists diario_protocolo_quando_exige;
alter table public.diario_registros add constraint diario_protocolo_quando_exige check (
  tipo not in ('autorizacao', 'excecao') or length(trim(coalesce(protocolo, ''))) > 0
);

-- Situação decidida pelo banco (a da 33, com o protocolo vazio gravado como
-- nulo em vez de texto em branco).
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
-- Conferência: protocolo aceita nulo e a nova trava existe (a antiga, não)
-- ---------------------------------------------------------------------------
select
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'diario_registros' and column_name = 'protocolo') as protocolo_opcional,
  (select count(*) from pg_constraint where conname = 'diario_protocolo_quando_exige') as trava_nova,
  (select count(*) from pg_constraint where conname = 'diario_registros_protocolo_check') as trava_antiga;
