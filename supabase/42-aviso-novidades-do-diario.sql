-- ============================================================================
-- 42 · Aviso de novidades do diário
--
-- Processo novo ou treinamento concluído no diário vira um cartão no Teams,
-- no destino "Novidades do diário" (Configuração › Avisos no Teams). O cartão
-- traz só um resumo e leva ao painel: a leitura e a confirmação continuam lá
-- (migração 38), senão a pessoa leria no Teams e não confirmaria.
--
-- Avisa uma vez por registro — ao nascer concluído ou ao ser aprovado — e só
-- se ele ainda exige leitura (validade em dia, ou sem validade e até 30 dias).
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

alter table public.avisos_teams drop constraint if exists avisos_teams_chave_check;
alter table public.avisos_teams add constraint avisos_teams_chave_check check (chave in (
  'semana_encerrada', 'monitorias_liberadas', 'lembrete_fechamento', 'diario_novidades'));

insert into public.avisos_teams (chave) values ('diario_novidades') on conflict (chave) do nothing;

create or replace function public.aviso_diario_novo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_rotulo text := case new.tipo when 'treinamento' then 'Novo treinamento' else 'Novo processo' end;
  v_texto  text := regexp_replace(new.descricao, '\s+', ' ', 'g');
  v_fatos  jsonb;
begin
  if new.tipo not in ('processo', 'treinamento') or new.situacao <> 'concluido' then return null; end if;
  if tg_op = 'UPDATE' and old.situacao = 'concluido' then return null; end if;
  if not (new.valido_ate >= v_hoje or (new.valido_ate is null and new.data >= v_hoje - 30)) then return null; end if;

  -- Só um resumo: o texto inteiro fica no painel, onde a leitura é confirmada.
  if length(v_texto) > 280 then
    v_texto := rtrim(left(v_texto, 280)) || '…';
  end if;

  v_fatos := jsonb_build_array(jsonb_build_object('title', 'Registrado por', 'value',
    coalesce((select nome from public.pessoas where id = new.pessoa_id), '—')));
  if new.valido_ate is not null then
    v_fatos := v_fatos || jsonb_build_object('title', 'Vale até', 'value', to_char(new.valido_ate, 'DD/MM/YYYY'));
  end if;

  perform public.enviar_aviso_teams('diario_novidades', 'diario/' || new.id, new.assunto,
    public.cartao_teams(v_rotulo, 'Accent', new.assunto,
      v_texto || E'\n\nA leitura é obrigatória: confirme no painel.',
      v_fatos, 'Ler e confirmar no painel', public.endereco_do_site('performance') || '/cota'));
  return null;
end;
$$;

drop trigger if exists aviso_diario_novo on public.diario_registros;
create trigger aviso_diario_novo
  after insert or update of situacao on public.diario_registros
  for each row execute function public.aviso_diario_novo();

-- O teste da tela de Configuração conhece o aviso novo.
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
                          else 'Lembrete de fechamento' end),
      '[]'::jsonb, 'Abrir o painel', public.endereco_do_site('performance') || '/cota'));
end;
$$;

-- ---------------------------------------------------------------------------
-- Conferência: quatro avisos e o gatilho no diário
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.avisos_teams) as avisos,
  (select count(*) from pg_trigger where tgname = 'aviso_diario_novo') as gatilho_criado;
