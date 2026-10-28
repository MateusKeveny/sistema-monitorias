-- ============================================================================
-- 87 · Setores e filas em árvore — etapa 4, parte 1 (a régua da monitoria
-- por setor)
--
-- Até aqui a monitoria tinha uma régua só, fixa no cálculo: a regra
-- 'monitoria' (pontua acima de 85%, peso por cargo). Agora cada setor diz a
-- sua régua (setores.regra_monitoria), e o cálculo usa a do setor da pessoa
-- no mês. A Conexão Expansão continua com 'monitoria' — nada muda de valor.
--
-- Setor com monitorias desligadas (setores.monitorias = false) não pontua
-- monitoria: a linha nem aparece no extrato. Criar setor copiando outro
-- (clonar_setor) passa a copiar também a régua da monitoria, para o setor
-- poder ligá-la depois com a régua dele.
--
-- Como a 84, roda numa transação só: foto, troca e comparação. QUALQUER
-- diferença (1 centavo que seja) aborta e desfaz tudo.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo.
-- ============================================================================

begin;

-- 1. A foto de agora, antes de qualquer troca.
select * from public.tirar_foto_da_cota('na-troca-da-87');

-- 2. A régua de cada setor.
alter table public.setores add column if not exists regra_monitoria text references public.regras (chave);
update public.setores set regra_monitoria = 'monitoria' where id = 1 and regra_monitoria is null;

-- A monitoria deixa de ser estrutural: é copiada com o setor.
create or replace function public.regra_estrutural(p_chave text)
returns boolean language sql immutable as $$
  select p_chave in ('meta', 'media_da_equipe', 'atestado', 'presencial',
                     'chamados_tratados', 'chamados_sla_ate_2d', 'chamados_sla_acima_2d')
      or p_chave like 'outro_setor_%';
$$;

-- 3. O cálculo: só o bloco da monitoria muda; os outros são os da 84.
create or replace view public.vw_extrato_quantidades with (security_invoker = true) as
 select v.pessoa_id, v.mes_competencia, v.semana, v.canal as origem, r.chave as regra,
        v.finalizados::numeric as quantidade, null::numeric as pontos_manuais
   from public.volume_semanal v
   join public.canais_do_setor f on f.id = v.canal_id
   join public.regras r on r.chave = f.regra_finalizado and r.ativo
union all
 select v.pessoa_id, v.mes_competencia, v.semana, v.canal as origem, r.chave as regra,
        v.finalizados::numeric as quantidade, null::numeric as pontos_manuais
   from public.volume_semanal v
   join public.canais_do_setor f on f.id = v.canal_id
   join public.vw_tme_equipe t on t.mes_competencia = v.mes_competencia and t.semana = v.semana and t.canal_id = v.canal_id
   join public.regras r on r.grupo = f.grupo_tme and r.ativo
    and (r.faixa_min is null or t.tme_seg::numeric >= r.faixa_min)
    and (r.faixa_max is null or t.tme_seg::numeric <  r.faixa_max)
    and not public.metrica_desligada_na_fila(v.mes_competencia, v.semana::integer, v.canal_id)
union all
 select b.pessoa_id, b.mes_competencia, b.semana, b.origem, r.chave as regra,
        b.quantidade, null::numeric as pontos_manuais
   from public.vw_base_do_csat b
   join public.canais_do_setor f on f.id = b.canal_id
   join public.vw_csat_semanal c on c.pessoa_id = b.pessoa_id and c.canal_id = b.canal_id
    and c.mes_competencia = b.mes_competencia and c.semana = b.semana
   join public.regras r on r.grupo = f.grupo_csat and r.ativo
    and (r.faixa_min is null or c.csat >= r.faixa_min)
    and (r.faixa_max is null or c.csat <  r.faixa_max)
union all
 select a.pessoa_id, a.mes_competencia, a.semana, a.origem, r.chave as regra,
        count(*)::numeric as quantidade, null::numeric as pontos_manuais
   from public.vw_avaliacoes_validas a
   join public.canais_do_setor f on f.id = a.canal_id
   join public.regras r on r.grupo = f.grupo_nota and r.ativo and r.faixa_min = a.nota::numeric
  group by a.pessoa_id, a.mes_competencia, a.semana, a.origem, r.chave
union all
 select m.operador_id as pessoa_id, m.mes_referencia as mes_competencia, m.semana_mes as semana,
        null::text as origem, r.chave as regra,
        round(avg(m.nota_final), 4) as quantidade, null::numeric as pontos_manuais
   from public.monitorias m
   -- A régua de monitoria do setor da pessoa no mês (87); setor com
   -- monitorias desligadas não pontua monitoria.
   join public.setores s on s.id = public.setor_na_competencia(m.operador_id, m.mes_referencia) and s.monitorias
   join public.regras r on r.chave = s.regra_monitoria and r.ativo
  group by m.operador_id, m.mes_referencia, m.semana_mes, r.chave
union all
 select l.pessoa_id, l.mes_competencia, l.semana, l.canal as origem, r.chave as regra,
        l.quantidade, l.pontos_manuais
   from public.lancamentos l
   join public.regras r on r.chave = l.regra and r.ativo
union all
 select a.pessoa_id, mes_de_competencia(a.data) as mes_competencia, semana_do_ciclo(a.data) as semana,
        null::text as origem, r.chave as regra,
        count(*)::numeric as quantidade, null::numeric as pontos_manuais
   from public.atendimentos_presenciais a
   join public.regras r on r.chave = 'presencial'::text and r.ativo
  where a.data >= '2026-08-26'::date
  group by a.pessoa_id, (mes_de_competencia(a.data)), (semana_do_ciclo(a.data)), r.chave
union all
 select c.pessoa_id, c.mes_competencia, c.semana, 'huggy'::text as origem, r.chave as regra,
        count(*)::numeric as quantidade, null::numeric as pontos_manuais
   from public.chamados_elo c
   cross join lateral (values
     ('chamados_tratados'::text, true),
     ('chamados_sla_ate_2d'::text, c.tempo_util < 3::numeric),
     ('chamados_sla_acima_2d'::text, c.tempo_util >= 3::numeric and c.decisao = 'manter'::text)
   ) x(regra, conta)
   join public.regras r on r.chave = x.regra and r.ativo
  where c.pessoa_id is not null and c.concluido_em is not null and c.status <> 'Cancelado'::text
    and x.conta and c.mes_competencia >= '2026-10-01'::date
  group by c.pessoa_id, c.mes_competencia, c.semana, r.chave;

-- 4. Criar setor copiando outro: também a régua da monitoria.
create or replace function public.clonar_setor(p_nome text, p_origem smallint, p_monitorias boolean)
returns smallint language plpgsql security definer set search_path = public as $$
declare
  v_novo  smallint;
  v_sufixo text;
  r public.regras;
  c public.cargos;
  v_cargo smallint;
  v_mapa jsonb := '{}';
begin
  if not public.eh_gestor() then raise exception 'Só o administrador cria setor.'; end if;
  if coalesce(trim(p_nome), '') = '' then raise exception 'O setor precisa de nome.'; end if;

  insert into public.setores (nome, ordem, monitorias)
  values (trim(p_nome), (select coalesce(max(ordem), 0) + 1 from public.setores), p_monitorias)
  returning id into v_novo;
  if p_origem is null then return v_novo; end if;   -- do zero: só o setor
  v_sufixo := '_s' || v_novo;

  -- As definições: cópias independentes, com grupo próprio.
  for r in select * from public.regras where setor_id = p_origem and ativo and not public.regra_estrutural(chave) loop
    insert into public.regras (chave, grupo, rotulo, peso, faixa_min, faixa_max, ordem, manual, valor_manual, ativo, setor_id, copia_de)
    values (r.chave || v_sufixo,
            -- Grupo próprio só nas réguas de faixa (C-SAT, notas, TME), que o
            -- cálculo escolhe pelo grupo da fila; os outros grupos são categorias.
            case when r.grupo in ('csat', 'nota') or r.grupo like 'tme%' then r.grupo || v_sufixo else r.grupo end,
            r.rotulo, r.peso, r.faixa_min, r.faixa_max, r.ordem, r.manual, r.valor_manual, true, v_novo, r.chave);
  end loop;

  -- A régua da monitoria do setor novo: a cópia da régua do setor de origem.
  update public.setores
     set regra_monitoria = public.chave_no_setor((select regra_monitoria from public.setores where id = p_origem), v_novo)
   where id = v_novo;

  -- Os cargos, com os pesos (apontando para as cópias) e a meta. Monitorias
  -- desligadas: sem peso de monitoria.
  for c in select * from public.cargos where setor_id = p_origem and ativo order by ordem loop
    insert into public.cargos (nome, ordem, ativo, recebe_bonus, base_do_bonus, recebe_cota, setor_id)
    values (c.nome, c.ordem, true, c.recebe_bonus, c.base_do_bonus, c.recebe_cota, v_novo)
    returning id into v_cargo;
    v_mapa := v_mapa || jsonb_build_object(c.id::text, v_cargo);
    insert into public.pesos_por_cargo (cargo_id, regra, peso, ativo, motivo_alteracao)
    select v_cargo, public.chave_no_setor(p.regra, v_novo), p.peso, p.ativo,
           format('Setor "%s" criado copiando o cargo %s', trim(p_nome), c.nome)
      from public.pesos_por_cargo p
     where p.cargo_id = c.id
       and (p_monitorias or p.regra is distinct from (select regra_monitoria from public.setores where id = p_origem))
       and p.regra not like 'outro_setor_%'
    on conflict (cargo_id, regra) do nothing;
  end loop;

  -- Média da equipe: as referências entre os cargos copiados.
  insert into public.cargos_referencia (cargo_id, referencia_id)
  select (v_mapa ->> cr.cargo_id::text)::smallint, (v_mapa ->> cr.referencia_id::text)::smallint
    from public.cargos_referencia cr
   where v_mapa ? cr.cargo_id::text and v_mapa ? cr.referencia_id::text
  on conflict do nothing;

  return v_novo;
end;
$$;
revoke all on function public.clonar_setor(text, smallint, boolean) from public, anon;
grant execute on function public.clonar_setor(text, smallint, boolean) to authenticated;

-- 5. A conferência: o cálculo novo contra a foto de agora há pouco.
do $$
declare
  v_qtd     integer;
  v_amostra text;
begin
  select count(*), string_agg(format('%s %s sem %s %s: %s → %s', x.nivel, x.mes_competencia, x.semana,
                                     coalesce(x.origem, '-'), x.antes, x.depois), '; ')
    into v_qtd, v_amostra
    from (select * from public.comparar_com_a_foto('na-troca-da-87') limit 5) x;
  if v_qtd > 0 then
    raise exception 'A troca mudou a cota (% diferença(s), até 5 mostradas): %. Nada foi gravado.', v_qtd, v_amostra;
  end if;
end;
$$;

commit;

-- Conferência: a régua de cada setor e a comparação com a foto (tem de dar 0).
select id, nome, monitorias, regra_monitoria from public.setores order by id;
select 'na-troca-da-87' as foto, count(*) as diferencas from public.comparar_com_a_foto('na-troca-da-87');
