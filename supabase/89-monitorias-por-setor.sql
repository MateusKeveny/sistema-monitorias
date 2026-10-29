-- ============================================================================
-- 89 · Monitorias em árvore — parte A (Monitorias 6.0, junto com o Performance 3.0)
--
-- O sistema de Monitorias passa a ser por setor, como o Performance:
--
--   · setores.monitorias_por_semana — quantas monitorias cada pessoa recebe
--     por semana (a Conexão Expansão: 4). Antes estava fixo no código e no
--     aviso "semana monitorada".
--   · O piso da média que pontua já era do setor: o faixa_min da régua de
--     monitoria dele (setores.regra_monitoria; a Expansão: 85%).
--     piso_da_monitoria(setor) lê; definir_monitorias_do_setor grava os dois.
--   · criterios.setor_id — cada setor com o seu formulário (critérios e
--     pesos). Os de hoje ficam com a Expansão. O nome passa a ser único
--     dentro do setor, e a ordem também.
--   · monitorias.setor_id — o setor da pessoa avaliada no mês da monitoria,
--     preenchido sozinho (gatilho). As de hoje ficam com a Expansão.
--   · As visões dos relatórios ganham setor_id (no fim, sem mudar as colunas
--     que o oficial lê).
--   · Criar setor (clonar_setor) e ligar as monitorias depois
--     (ligar_monitorias) ganham versões com quantidade por semana, piso e a
--     cópia dos critérios do setor de origem.
--
-- ADITIVO: o site oficial (Performance 2.11 / Monitorias 5.7) continua
-- funcionando — critério novo sem setor cai na Expansão (padrão 1).
--
-- Prova: a cota de todas as pessoas e meses (foto) e as monitorias (nota de
-- cada uma, ranking e critérios reprovados) iguais antes e depois. Diferença
-- desfaz tudo.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez.
-- ============================================================================

begin;

-- 0. Fotos de antes.
select public.tirar_foto_da_cota('antes-da-89');

create temp table monitorias_antes on commit drop as
  select id, operador_id, mes_referencia, semana_mes, nota_final, zerado from public.monitorias;
create temp table ranking_antes on commit drop as
  select mes_referencia, operador_id, total_monitorias, nota_media, zeradas, impecaveis from public.vw_ranking_mensal;
create temp table reprovados_antes on commit drop as
  select mes_referencia, criterio_id, avaliacoes, reprovacoes, pontos_perdidos from public.vw_criterios_reprovados;

-- 1. Quantas monitorias por semana, por setor.
alter table public.setores add column if not exists monitorias_por_semana smallint not null default 4
  check (monitorias_por_semana between 1 and 10);

-- O piso da média que pontua: o faixa_min da régua de monitoria do setor.
create or replace function public.piso_da_monitoria(p_setor smallint)
returns numeric language sql stable security definer set search_path = public as $$
  select r.faixa_min from public.setores s join public.regras r on r.chave = s.regra_monitoria where s.id = p_setor;
$$;
grant execute on function public.piso_da_monitoria(smallint) to authenticated;

-- 2. Critérios por setor.
alter table public.criterios add column if not exists setor_id smallint not null default 1 references public.setores (id);
alter table public.criterios drop constraint if exists criterios_nome_key;
create unique index if not exists criterios_setor_nome_idx on public.criterios (setor_id, nome);
drop index if exists public.criterios_ordem_idx;
create unique index if not exists criterios_ordem_idx on public.criterios (setor_id, ordem) where ativo;

-- 3. O setor de cada monitoria: o da pessoa avaliada no mês.
alter table public.monitorias add column if not exists setor_id smallint references public.setores (id);
update public.monitorias set setor_id = public.setor_na_competencia(operador_id, mes_referencia) where setor_id is null;
alter table public.monitorias alter column setor_id set not null;
create index if not exists monitorias_setor_mes_idx on public.monitorias (setor_id, mes_referencia);

-- Roda depois de preencher_mes_referencia (ordem alfabética dos gatilhos).
create or replace function public.setor_da_monitoria()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.setor_id := public.setor_na_competencia(new.operador_id, new.mes_referencia);
  return new;
end;
$$;
drop trigger if exists setor_da_monitoria on public.monitorias;
create trigger setor_da_monitoria
  before insert or update of operador_id, data_atendimento, mes_referencia on public.monitorias
  for each row execute function public.setor_da_monitoria();

-- 4. O aviso "semana monitorada" usa a quantidade do setor.
create or replace function public.aviso_semana_monitorada()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_qtd smallint;
begin
  if new.mes_referencia is null or new.mes_referencia > public.mes_aberto_das_monitorias() then
    return null;
  end if;
  select monitorias_por_semana into v_qtd from public.setores where id = new.setor_id;
  v_qtd := coalesce(v_qtd, 4);
  if (select count(*) from public.monitorias
       where operador_id = new.operador_id and mes_referencia = new.mes_referencia
         and semana_mes = new.semana_mes) < v_qtd then
    return null;
  end if;
  insert into public.avisos_da_pessoa (pessoa_id, chave, titulo, texto, link)
  values (new.operador_id,
          format('monitorias/%s/%s/%s', to_char(new.mes_referencia, 'YYYY-MM'), new.semana_mes, new.operador_id),
          format('Monitorias da %sª semana de %s concluídas', new.semana_mes, public.nome_do_mes(new.mes_referencia)),
          case when v_qtd = 1 then 'A monitoria da semana já está no painel, com a nota e o que melhorar.'
               else format('As %s monitorias da semana já estão no painel, com a nota e o que melhorar.', v_qtd) end,
          '/cota/monitorias')
  on conflict (chave) do nothing;
  return null;
end;
$$;

-- 5. As visões dos relatórios com o setor (colunas novas no fim).
create or replace view public.vw_monitorias with (security_invoker = true) as
 SELECT m.id,
    m.protocolo,
    m.data_atendimento,
    m.mes_referencia,
    EXTRACT(year FROM m.data_atendimento)::integer AS ano,
    EXTRACT(month FROM m.data_atendimento)::integer AS mes,
    m.semana_mes,
    m.numero_monitoria,
    o.id AS operador_id,
    o.nome AS operador,
    c.nome AS canal,
    m.tempo_atendimento_seg,
    m.nota_final,
    m.zerado,
    m.motivo_zeramento,
    m.parecer,
    nome_de_pessoa(m.monitor_id) AS monitor,
    m.criado_em,
    m.codigo,
    m.setor_id
   FROM monitorias m
     JOIN pessoas o ON o.id = m.operador_id
     LEFT JOIN canais c ON c.id = m.canal_id;

create or replace view public.vw_ranking_mensal with (security_invoker = true) as
 SELECT mes_referencia,
    operador_id,
    operador,
    count(*)::integer AS total_monitorias,
    round(avg(nota_final), 4) AS nota_media,
    min(nota_final) AS nota_minima,
    max(nota_final) AS nota_maxima,
    count(*) FILTER (WHERE zerado)::integer AS zeradas,
    count(*) FILTER (WHERE nota_final = 1::numeric)::integer AS impecaveis,
    round(avg(nota_final) FILTER (WHERE NOT zerado), 4) AS nota_media_sem_zeradas,
    -- Uma pessoa está num setor por mês: o setor não divide a linha.
    min(setor_id) AS setor_id
   FROM vw_monitorias
  GROUP BY mes_referencia, operador_id, operador;

create or replace view public.vw_criterios_reprovados with (security_invoker = true) as
 SELECT m.mes_referencia,
    cr.id AS criterio_id,
    cr.nome AS criterio,
    cr.peso,
    count(*)::integer AS avaliacoes,
    count(*) FILTER (WHERE NOT i.conforme)::integer AS reprovacoes,
    round(count(*) FILTER (WHERE NOT i.conforme)::numeric / NULLIF(count(*), 0)::numeric, 4) AS taxa_reprovacao,
    round(count(*) FILTER (WHERE NOT i.conforme)::numeric * cr.peso, 4) AS pontos_perdidos,
    cr.setor_id
   FROM monitoria_itens i
     JOIN monitorias m ON m.id = i.monitoria_id
     JOIN criterios cr ON cr.id = i.criterio_id
  GROUP BY m.mes_referencia, cr.id, cr.nome, cr.peso, cr.setor_id;

create or replace view public.vw_feedback_individual with (security_invoker = true) as
 SELECT m.id AS monitoria_id,
    o.id AS operador_id,
    o.nome AS operador,
    m.protocolo,
    m.data_atendimento,
    m.mes_referencia,
    m.semana_mes,
    m.numero_monitoria,
    m.nota_final,
    m.zerado,
    m.parecer,
    cr.ordem AS criterio_ordem,
    cr.nome AS criterio,
    cr.peso,
    i.conforme,
    i.observacao,
    m.setor_id
   FROM monitorias m
     JOIN pessoas o ON o.id = m.operador_id
     JOIN monitoria_itens i ON i.monitoria_id = m.id
     JOIN criterios cr ON cr.id = i.criterio_id;

-- 6. Quantidade por semana e piso de um setor (Configuração).
create or replace function public.definir_monitorias_do_setor(p_setor smallint, p_por_semana smallint, p_piso numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_regra text;
begin
  if not public.eh_gestor() then raise exception 'Só o gestor muda as monitorias do setor.'; end if;
  if p_por_semana is null or p_por_semana not between 1 and 10 then
    raise exception 'Monitorias por semana: de 1 a 10.';
  end if;
  if p_piso is null or p_piso <= 0 or p_piso > 1 then
    raise exception 'O piso é um percentual entre 1%% e 100%%.';
  end if;
  select regra_monitoria into v_regra from public.setores where id = p_setor;
  if v_regra is null then raise exception 'Este setor não tem régua de monitoria.'; end if;
  update public.setores set monitorias_por_semana = p_por_semana where id = p_setor;
  update public.regras set faixa_min = p_piso where chave = v_regra;
end;
$$;
revoke all on function public.definir_monitorias_do_setor(smallint, smallint, numeric) from public, anon;
grant execute on function public.definir_monitorias_do_setor(smallint, smallint, numeric) to authenticated;

-- 7. Copiar o formulário (critérios e pesos) de um setor para outro que não tem.
create or replace function public.copiar_criterios(p_de smallint, p_para smallint)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not public.eh_gestor() then raise exception 'Só o gestor copia critérios.'; end if;
  if exists (select 1 from public.criterios where setor_id = p_para) then return 0; end if;
  insert into public.criterios (ordem, nome, peso, ativo, setor_id)
  select ordem, nome, peso, ativo, p_para from public.criterios where setor_id = p_de;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.copiar_criterios(smallint, smallint) from public, anon;
grant execute on function public.copiar_criterios(smallint, smallint) to authenticated;

-- 8. Criar setor com as monitorias já configuradas.
create or replace function public.clonar_setor(p_nome text, p_origem smallint, p_monitorias boolean,
                                               p_por_semana smallint, p_piso numeric)
returns smallint language plpgsql security definer set search_path = public as $$
declare
  v_novo smallint;
begin
  v_novo := public.clonar_setor(p_nome, p_origem, p_monitorias);
  if p_monitorias then
    perform public.definir_monitorias_do_setor(v_novo, p_por_semana, p_piso);
    perform public.copiar_criterios(p_origem, v_novo);
  end if;
  return v_novo;
end;
$$;
revoke all on function public.clonar_setor(text, smallint, boolean, smallint, numeric) from public, anon;
grant execute on function public.clonar_setor(text, smallint, boolean, smallint, numeric) to authenticated;

-- 9. Ligar as monitorias depois, com as mesmas perguntas da criação.
create or replace function public.ligar_monitorias(p_setor smallint, p_ligar boolean,
                                                   p_por_semana smallint, p_piso numeric, p_copiar_de smallint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.ligar_monitorias(p_setor, p_ligar);
  if p_ligar then
    perform public.definir_monitorias_do_setor(p_setor, p_por_semana, p_piso);
    perform public.copiar_criterios(coalesce(p_copiar_de, 1::smallint), p_setor);
  end if;
end;
$$;
revoke all on function public.ligar_monitorias(smallint, boolean, smallint, numeric, smallint) from public, anon;
grant execute on function public.ligar_monitorias(smallint, boolean, smallint, numeric, smallint) to authenticated;

-- 10. A prova: cota, monitorias, ranking e critérios iguais aos de antes.
do $$
declare
  v_cota integer;
  v_mon integer;
  v_rank integer;
  v_rep integer;
begin
  select count(*) into v_cota from public.comparar_com_a_foto('antes-da-89');
  select count(*) into v_mon from (
    (select * from monitorias_antes except all
     select id, operador_id, mes_referencia, semana_mes, nota_final, zerado from public.monitorias)
    union all
    (select id, operador_id, mes_referencia, semana_mes, nota_final, zerado from public.monitorias
     except all select * from monitorias_antes)) d;
  select count(*) into v_rank from (
    (select * from ranking_antes except all
     select mes_referencia, operador_id, total_monitorias, nota_media, zeradas, impecaveis from public.vw_ranking_mensal)
    union all
    (select mes_referencia, operador_id, total_monitorias, nota_media, zeradas, impecaveis from public.vw_ranking_mensal
     except all select * from ranking_antes)) d;
  select count(*) into v_rep from (
    (select * from reprovados_antes except all
     select mes_referencia, criterio_id, avaliacoes, reprovacoes, pontos_perdidos from public.vw_criterios_reprovados)
    union all
    (select mes_referencia, criterio_id, avaliacoes, reprovacoes, pontos_perdidos from public.vw_criterios_reprovados
     except all select * from reprovados_antes)) d;
  if v_cota + v_mon + v_rank + v_rep > 0 then
    raise exception 'A 89 mudou algo (cota %, monitorias %, ranking %, critérios %). Nada foi gravado.',
      v_cota, v_mon, v_rank, v_rep;
  end if;
end;
$$;

commit;

-- Conferência
select s.id, s.nome, s.monitorias, s.monitorias_por_semana, public.piso_da_monitoria(s.id) as piso,
       (select count(*) from public.criterios c where c.setor_id = s.id) as criterios,
       (select count(*) from public.monitorias m where m.setor_id = s.id) as monitorias
  from public.setores s order by s.id;
select count(*) as diferencas_da_cota from public.comparar_com_a_foto('antes-da-89');
