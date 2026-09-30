-- ============================================================================
-- 41 · Aviso de mês fechado
--
-- Quando o gestor fecha o mês, o canal da equipe — o mesmo endereço do aviso
-- "Semana encerrada" — recebe "Setembro fechado", com o link para o extrato.
--
-- O fechamento grava uma linha por pessoa em fechamentos_cota; o aviso sai na
-- primeira, e a referência por competência impede que as outras repitam.
-- Como pg_net só dispara depois do commit, um fechamento desfeito por erro
-- não chega a avisar.
--
-- Rode no SQL Editor inteiro, de uma vez. Pode rodar de novo.
-- ============================================================================

create or replace function public.aviso_mes_fechado()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_comp   date := new.mes_competencia;
  v_titulo text := format('%s fechado', initcap(public.nome_do_mes(new.mes_competencia)));
begin
  perform public.enviar_aviso_teams('semana_encerrada', 'fechamento/' || v_comp, v_titulo,
    public.cartao_teams('Mês fechado', 'Good', v_titulo,
      format('O gestor fechou o ciclo de %s (%s a %s). Os pontos do mês já estão definitivos no seu extrato.',
             public.nome_do_mes(v_comp), to_char((v_comp - interval '1 month')::date + 25, 'DD/MM'),
             to_char(v_comp + 24, 'DD/MM')),
      jsonb_build_array(jsonb_build_object('title', 'Fechado por', 'value',
        format('%s, %s', coalesce(new.fechado_por_nome, 'gestor'),
               to_char(new.fechado_em at time zone 'America/Sao_Paulo', 'DD/MM "às" HH24:MI')))),
      'Ver meu extrato',
      public.endereco_do_site('performance') || '/cota/extrato?mes=' || to_char(v_comp, 'YYYY-MM')));
  return null;
end;
$$;

drop trigger if exists aviso_mes_fechado on public.fechamentos_cota;
create trigger aviso_mes_fechado
  after insert on public.fechamentos_cota
  for each row execute function public.aviso_mes_fechado();

-- ---------------------------------------------------------------------------
-- Conferência: o gatilho está no fechamento
-- ---------------------------------------------------------------------------
select count(*) as gatilho_criado from pg_trigger where tgname = 'aviso_mes_fechado';
