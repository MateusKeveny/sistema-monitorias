-- ============================================================================
-- 47 · Correção: aviso de novidades do diário em registro antigo sem validade
--
-- O aviso (migrações 42 e 46) devia sair só para registro que ainda vale:
-- com validade em dia, ou sem validade e do dia do ocorrido para cá há até
-- 30 dias. Sem validade, "valido_ate >= hoje" dá nulo em SQL, e "not (nulo
-- ou falso)" também é nulo — o IF não barrava, e registro antigo sem validade
-- avisava no Teams. Agora a comparação nula conta como falsa.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

create or replace function public.aviso_diario_novo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_rotulo text := case new.tipo when 'treinamento' then 'Novo treinamento'
                                 when 'problema' then 'Problema operacional · '
                                   || coalesce((select nome from public.diario_subcategorias where id = new.subcategoria_id), '—')
                                 else 'Novo processo' end;
  v_texto  text := regexp_replace(new.descricao, '\s+', ' ', 'g');
  v_fatos  jsonb;
begin
  if new.tipo not in ('processo', 'treinamento', 'problema') or new.situacao <> 'concluido' then return null; end if;
  if tg_op = 'UPDATE' and old.situacao = 'concluido' then return null; end if;
  if not (coalesce(new.valido_ate >= v_hoje, false)
          or (new.valido_ate is null and new.data >= v_hoje - 30)) then
    return null;
  end if;

  -- Só um resumo: o texto inteiro fica no painel.
  if length(v_texto) > 280 then
    v_texto := rtrim(left(v_texto, 280)) || '…';
  end if;

  v_fatos := jsonb_build_array(jsonb_build_object('title', 'Registrado por', 'value',
    coalesce((select nome from public.pessoas where id = new.pessoa_id), '—')));
  if new.valido_ate is not null then
    v_fatos := v_fatos || jsonb_build_object('title', 'Vale até', 'value', to_char(new.valido_ate, 'DD/MM/YYYY'));
  end if;

  perform public.enviar_aviso_teams('diario_novidades', 'diario/' || new.id, new.assunto,
    public.cartao_teams(v_rotulo, case when new.tipo = 'problema' then 'Attention' else 'Accent' end, new.assunto,
      v_texto || case when new.tipo = 'problema' then '' else E'\n\nA leitura é obrigatória: confirme no painel.' end,
      v_fatos, case when new.tipo = 'problema' then 'Ver no diário' else 'Ler e confirmar no painel' end,
      public.endereco_do_site('performance') || '/cota' || case when new.tipo = 'problema' then '/diario' else '' end));
  return null;
end;
$$;

-- Conferência: um registro de 60 dias atrás, sem validade, não deve avisar.
select not (coalesce(null::date >= current_date, false)
            or (true and (current_date - 60) >= current_date - 30)) as antigo_sem_validade_nao_avisa;
