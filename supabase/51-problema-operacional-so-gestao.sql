-- ============================================================================
-- 51 · Problema operacional: só gestor e Pleno, sem aviso no Teams
--
-- Na 46 o problema operacional era registrado só pela gestão, mas toda a
-- equipe via e ele avisava em "Novidades do diário". Correção pedida pelo
-- gestor: é assunto só da gestão — gestor e Pleno (quem aprova, migração 33)
-- registram e veem; os demais não veem, nem pela consulta do Monitorias, e
-- nada vai para o Teams.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

-- Leitura: todos leem o diário, menos o problema operacional, que é da gestão.
drop policy if exists diario_leitura on public.diario_registros;
create policy diario_leitura on public.diario_registros
  for select using (public.papel_atual() is not null and (tipo <> 'problema' or public.aprova_diario()));

-- Aviso no Teams (o da 47, sem o problema operacional).
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
  if not (coalesce(new.valido_ate >= v_hoje, false)
          or (new.valido_ate is null and new.data >= v_hoje - 30)) then
    return null;
  end if;

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

-- ---------------------------------------------------------------------------
-- Conferência: a regra de leitura nova e quantos problemas existem hoje
-- ---------------------------------------------------------------------------
select
  (select qual from pg_policies where tablename = 'diario_registros' and policyname = 'diario_leitura') as regra_de_leitura,
  (select count(*) from public.diario_registros where tipo = 'problema') as problemas_registrados;
