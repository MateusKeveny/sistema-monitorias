  -- ============================================================================
  -- 76 · Aviso de semana de monitorias concluída
  --
  -- O atendente recebe, no sino do Performance (migração 74), um aviso quando a
  -- semana dele é concluída: a 4ª monitoria da pessoa naquela semana do ciclo
  -- (a meta é 4 por semana, ver CoberturaDoCiclo). Decisão do gestor,
  -- 21/10/2026: um aviso por semana, não um por monitoria.
  --
  -- Cada semana avisa uma vez (chave única): excluir e relançar uma monitoria
  -- não repete. Monitoria de mês ainda não liberado (migração 30) não avisa —
  -- o atendente ainda não a enxerga.
  --
  -- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
  -- de novo.
  -- ============================================================================
  
  create or replace function public.aviso_semana_monitorada()
  returns trigger language plpgsql security definer set search_path = public as $$
  begin
    if new.mes_referencia is null or new.mes_referencia > public.mes_aberto_das_monitorias() then
      return null;
    end if;
    if (select count(*) from public.monitorias
         where operador_id = new.operador_id and mes_referencia = new.mes_referencia
           and semana_mes = new.semana_mes) < 4 then
      return null;
    end if;
    insert into public.avisos_da_pessoa (pessoa_id, chave, titulo, texto, link)
    values (new.operador_id,
            format('monitorias/%s/%s/%s', to_char(new.mes_referencia, 'YYYY-MM'), new.semana_mes, new.operador_id),
            format('Monitorias da %sª semana de %s concluídas', new.semana_mes, public.nome_do_mes(new.mes_referencia)),
            'As 4 monitorias da semana já estão no painel, com a nota e o que melhorar.',
            '/cota/monitorias')
    on conflict (chave) do nothing;
    return null;
  end;
  $$;
  
  drop trigger if exists aviso_semana_monitorada on public.monitorias;
  create trigger aviso_semana_monitorada after insert on public.monitorias
    for each row execute function public.aviso_semana_monitorada();
  
  -- Conferência
  select (select count(*) from pg_trigger where tgname = 'aviso_semana_monitorada') as gatilho;
