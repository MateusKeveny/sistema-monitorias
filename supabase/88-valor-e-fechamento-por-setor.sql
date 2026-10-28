-- ============================================================================
-- 88 · Setores e filas em árvore — etapa 4, parte 2 (valor por ponto e
-- fechamento por setor; ligar as monitorias de um setor)
--
--   valores_da_cota       um valor por ponto por MÊS E SETOR
--   fechar_ciclo          fecha o mês de um setor (ou de todos, como antes)
--   bônus e pagamento     "todos bateram a meta" e a média base contam
--                         dentro do setor; o valor por ponto é o do setor
--   ligar_monitorias      liga/desliga as monitorias de um setor; ao ligar,
--                         os cargos que pontuam finalizado ganham o peso da
--                         régua de monitoria do setor
--
-- O site oficial (2.11.2) chama as funções sem setor: as versões antigas
-- continuam existindo e passam a valer para a Conexão Expansão (setor 1) —
-- e fechar_ciclo(mês) continua fechando todo mundo, como hoje.
--
-- O pagamento não está na foto da cota (83): esta migração guarda o pagamento
-- de todos os meses fechados ANTES da troca e compara DEPOIS, centavo por
-- centavo. Qualquer diferença desfaz tudo.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo.
-- ============================================================================

begin;

-- 0. O pagamento de hoje, para comparar no fim.
create temporary table pagamento_antes on commit drop as
  select * from public.vw_pagamento_mensal;

-- 1. Valor por ponto por mês e setor.
alter table public.valores_da_cota drop constraint if exists valores_da_cota_pkey;
alter table public.valores_da_cota add constraint valores_da_cota_pkey primary key (setor_id, mes_competencia);
alter table public.valores_alteracoes add column if not exists setor_id smallint not null default 1
  references public.setores (id) on delete restrict;

create or replace function public.definir_valor_da_cota(p_mes date, p_valor numeric, p_percentual numeric,
                                                        p_motivo text, p_observacao text, p_setor smallint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_atual public.valores_da_cota;
  v_nome  text;
begin
  if not public.eh_gestor() then
    raise exception 'Apenas gestores definem o valor da cota.';
  end if;
  if p_valor is null or p_valor < 0 then
    raise exception 'Informe um valor por ponto maior ou igual a zero.';
  end if;

  select nome into v_nome from public.pessoas where id = public.pessoa_atual();
  select * into v_atual from public.valores_da_cota where mes_competencia = p_mes and setor_id = p_setor;

  if v_atual.mes_competencia is null then
    insert into public.valores_da_cota
      (setor_id, mes_competencia, valor_por_ponto, percentual_bonus, observacao,
       definido_por, definido_por_nome)
    values
      (p_setor, p_mes, p_valor, coalesce(p_percentual, 0.10), nullif(btrim(coalesce(p_observacao, '')), ''),
       public.pessoa_atual(), coalesce(v_nome, 'sistema'));
    return;
  end if;

  if v_atual.valor_por_ponto = p_valor
     and v_atual.percentual_bonus = coalesce(p_percentual, v_atual.percentual_bonus) then
    return;
  end if;

  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Alterar um valor já definido exige motivo.';
  end if;

  insert into public.valores_alteracoes
    (setor_id, mes_competencia, valor_antes, valor_depois, percentual_antes, percentual_depois,
     motivo, alterado_por, alterado_por_nome)
  values
    (p_setor, p_mes, v_atual.valor_por_ponto, p_valor,
     v_atual.percentual_bonus, coalesce(p_percentual, v_atual.percentual_bonus),
     btrim(p_motivo), public.pessoa_atual(), coalesce(v_nome, 'sistema'));

  update public.valores_da_cota
     set valor_por_ponto  = p_valor,
         percentual_bonus = coalesce(p_percentual, percentual_bonus),
         observacao       = coalesce(nullif(btrim(coalesce(p_observacao, '')), ''), observacao),
         atualizado_em    = now()
   where mes_competencia = p_mes and setor_id = p_setor;
end;
$$;

-- A de antes (sem setor): a Conexão Expansão.
create or replace function public.definir_valor_da_cota(p_mes date, p_valor numeric, p_percentual numeric default 0.10,
                                                        p_motivo text default null, p_observacao text default null)
returns void language sql security definer set search_path = public as $$
  select public.definir_valor_da_cota(p_mes, p_valor, p_percentual, p_motivo, p_observacao, 1::smallint);
$$;

create or replace function public.remover_valor_da_cota(p_mes date, p_motivo text, p_setor smallint)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_atual public.valores_da_cota;
begin
  if public.eh_gestor() is not true then raise exception 'Apenas gestores removem o valor da cota.'; end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'Remover o valor por ponto exige motivo.';
  end if;
  select * into v_atual from public.valores_da_cota where mes_competencia = p_mes and setor_id = p_setor;
  if v_atual.mes_competencia is null then return; end if;

  insert into public.valores_alteracoes
    (setor_id, mes_competencia, valor_antes, valor_depois, percentual_antes, percentual_depois,
     motivo, alterado_por, alterado_por_nome)
  values
    (p_setor, p_mes, v_atual.valor_por_ponto, null, v_atual.percentual_bonus, null, btrim(p_motivo),
     public.pessoa_atual(), coalesce((select nome from public.pessoas where id = public.pessoa_atual()), 'sistema'));
  delete from public.valores_da_cota where mes_competencia = p_mes and setor_id = p_setor;
end;
$$;

create or replace function public.remover_valor_da_cota(p_mes date, p_motivo text)
returns void language sql security definer set search_path = public as $$
  select public.remover_valor_da_cota(p_mes, p_motivo, 1::smallint);
$$;

-- 2. Fechar o mês de um setor (nulo = todos, como antes).
create or replace function public.fechar_ciclo(p_mes date, p_setor smallint)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_nome  text;
  v_conta integer := 0;
  v_p     record;
  v_id    uuid;
begin
  if public.eh_gestor() is not true then
    raise exception 'Apenas gestores fecham o ciclo.';
  end if;

  select nome into v_nome from public.pessoas where id = public.pessoa_atual();

  for v_p in
    select m.*, public.setor_na_competencia(m.pessoa_id, p_mes) as setor_id
      from public.vw_cota_mensal m
     where m.mes_competencia = p_mes
       and (p_setor is null or public.setor_na_competencia(m.pessoa_id, p_mes) = p_setor)
       and m.pessoa_id not in (
         select pessoa_id from public.fechamentos_cota where mes_competencia = p_mes)
  loop
    insert into public.fechamentos_cota
      (pessoa_id, pessoa_nome, mes_competencia, cargo, resultado, meta,
       fechado_por, fechado_por_nome, setor_id)
    values
      (v_p.pessoa_id, v_p.pessoa, p_mes, v_p.cargo, v_p.resultado, v_p.meta,
       public.pessoa_atual(), coalesce(v_nome, 'sistema'), coalesce(v_p.setor_id, 1))
    returning id into v_id;

    insert into public.fechamento_linhas
      (fechamento_id, semana, origem, regra, rotulo, grupo, ordem,
       quantidade, peso, cota)
    select v_id, e.semana, e.origem, e.regra, e.rotulo, e.grupo, e.ordem,
           e.quantidade, e.peso, e.cota
      from public.vw_extrato_cota e
     where e.pessoa_id = v_p.pessoa_id
       and e.mes_competencia = p_mes;

    v_conta := v_conta + 1;
  end loop;

  return v_conta;
end;
$$;

create or replace function public.fechar_ciclo(p_mes date)
returns integer language sql security definer set search_path = public as $$
  select public.fechar_ciclo(p_mes, null::smallint);
$$;

-- Um setor está fechado no mês quando alguém dele foi fechado.
create or replace function public.mes_fechado_no_setor(p_mes date, p_setor smallint)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.fechamentos_cota where mes_competencia = p_mes and setor_id = p_setor);
$$;

-- 3. Bônus e pagamento, dentro do setor.
create or replace function public.bonus_da_competencia(p_mes date, p_setor smallint)
returns table (media_base numeric, todos_bateram boolean, quantos_faltaram integer)
language sql stable security definer set search_path = public as $$
  with com_cargo as (
    select f.resultado, f.meta, c.recebe_bonus, c.base_do_bonus,
           public.mes_inteiro_na_operacao(f.pessoa_id, f.mes_competencia) as mes_inteiro
      from public.fechamentos_cota f
      join public.cargos c
        on c.id = public.cargo_na_competencia(f.pessoa_id, f.mes_competencia)
     where f.mes_competencia = p_mes
       and f.setor_id = p_setor
  )
  select
    (select round(avg(resultado), 4) from com_cargo where base_do_bonus and mes_inteiro),
    coalesce((select bool_and(meta is not null and resultado >= meta)
                from com_cargo where recebe_bonus and mes_inteiro), false),
    coalesce((select count(*) filter (where meta is null or resultado < meta)
                from com_cargo where recebe_bonus and mes_inteiro), 0)::integer;
$$;

create or replace view public.vw_pagamento_mensal with (security_invoker = true) as
 WITH fechado AS (
         SELECT f.pessoa_id,
            f.pessoa_nome,
            f.mes_competencia,
            f.resultado,
            f.meta,
            cargo_na_competencia(f.pessoa_id, f.mes_competencia) AS cargo_id,
            mes_inteiro_na_operacao(f.pessoa_id, f.mes_competencia) AS mes_inteiro,
            f.setor_id
           FROM fechamentos_cota f
        ), com_cargo AS (
         SELECT fc.pessoa_id,
            fc.pessoa_nome,
            fc.mes_competencia,
            fc.resultado,
            fc.meta,
            fc.cargo_id,
            fc.mes_inteiro,
            c.nome AS cargo,
            c.recebe_bonus,
            c.base_do_bonus,
            fc.setor_id
           FROM fechado fc
             JOIN cargos c ON c.id = fc.cargo_id
        ), conta AS (
         SELECT cc.pessoa_id,
            cc.pessoa_nome,
            cc.mes_competencia,
            cc.resultado,
            cc.meta,
            cc.cargo_id,
            cc.mes_inteiro,
            cc.cargo,
            cc.recebe_bonus,
            cc.base_do_bonus,
            cc.setor_id,
            col.media_base,
            col.todos_bateram AS bonus_liberado,
            col.quantos_faltaram,
            v.valor_por_ponto,
            COALESCE(v.percentual_bonus, 0.10) AS percentual_bonus,
            cc.meta IS NOT NULL AND cc.resultado >= cc.meta AS atingiu_meta,
                CASE
                    WHEN cc.recebe_bonus AND cc.mes_inteiro AND col.todos_bateram THEN round(COALESCE(col.media_base, 0::numeric) * COALESCE(v.percentual_bonus, 0.10), 4)
                    ELSE 0::numeric
                END AS bonus
           FROM com_cargo cc
             CROSS JOIN LATERAL bonus_da_competencia(cc.mes_competencia, cc.setor_id) col(media_base, todos_bateram, quantos_faltaram)
             LEFT JOIN valores_da_cota v ON v.mes_competencia = cc.mes_competencia AND v.setor_id = cc.setor_id
        )
 SELECT pessoa_id,
    pessoa_nome,
    mes_competencia,
    cargo,
    resultado,
    meta,
    mes_inteiro,
    recebe_bonus,
    media_base,
    bonus_liberado,
    quantos_faltaram::bigint AS quantos_faltaram,
    valor_por_ponto,
    percentual_bonus,
    bonus,
    resultado + bonus AS pontos_pagos,
        CASE
            WHEN NOT atingiu_meta THEN 0::numeric
            WHEN valor_por_ponto IS NULL THEN NULL::numeric
            ELSE round((resultado + bonus) * valor_por_ponto, 2)
        END AS valor,
    atingiu_meta,
    setor_id
   FROM conta;

-- 4. Ligar/desligar as monitorias de um setor.
create or replace function public.ligar_monitorias(p_setor smallint, p_ligar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_regra text;
begin
  if not public.eh_gestor() then raise exception 'Só o gestor liga as monitorias do setor.'; end if;
  select regra_monitoria into v_regra from public.setores where id = p_setor;
  if p_ligar and v_regra is null then
    raise exception 'Este setor não tem régua de monitoria (foi criado do zero).';
  end if;
  update public.setores set monitorias = p_ligar where id = p_setor;
  if p_ligar then
    -- Quem pontua finalizado no setor ganha o peso padrão da régua (se ainda não tiver).
    insert into public.pesos_por_cargo (cargo_id, regra, peso, ativo, motivo_alteracao)
    select distinct p.cargo_id, v_regra, r.peso, true, 'Monitorias ligadas no setor'
      from public.pesos_por_cargo p
      join public.regras x on x.chave = p.regra and x.grupo = 'atendimento'
      join public.cargos c on c.id = p.cargo_id and c.setor_id = p_setor
      join public.regras r on r.chave = v_regra
     where p.ativo
    on conflict (cargo_id, regra) do nothing;
  end if;
end;
$$;

revoke all on function public.definir_valor_da_cota(date, numeric, numeric, text, text, smallint) from public, anon;
revoke all on function public.remover_valor_da_cota(date, text, smallint) from public, anon;
revoke all on function public.fechar_ciclo(date, smallint) from public, anon;
revoke all on function public.ligar_monitorias(smallint, boolean) from public, anon;
grant execute on function public.definir_valor_da_cota(date, numeric, numeric, text, text, smallint) to authenticated;
grant execute on function public.remover_valor_da_cota(date, text, smallint) to authenticated;
grant execute on function public.fechar_ciclo(date, smallint) to authenticated;
grant execute on function public.ligar_monitorias(smallint, boolean) to authenticated;

-- 5. A conferência: o pagamento de todos os meses fechados, igual ao de antes.
do $$
declare
  v_qtd integer;
begin
  select count(*) into v_qtd from (
    (select pessoa_id, mes_competencia, resultado, meta, bonus, pontos_pagos, valor, valor_por_ponto, percentual_bonus, bonus_liberado
       from pagamento_antes
     except all
     select pessoa_id, mes_competencia, resultado, meta, bonus, pontos_pagos, valor, valor_por_ponto, percentual_bonus, bonus_liberado
       from public.vw_pagamento_mensal)
    union all
    (select pessoa_id, mes_competencia, resultado, meta, bonus, pontos_pagos, valor, valor_por_ponto, percentual_bonus, bonus_liberado
       from public.vw_pagamento_mensal
     except all
     select pessoa_id, mes_competencia, resultado, meta, bonus, pontos_pagos, valor, valor_por_ponto, percentual_bonus, bonus_liberado
       from pagamento_antes)
  ) d;
  if v_qtd > 0 then
    raise exception 'A troca mudou o pagamento (% linha(s) diferentes). Nada foi gravado.', v_qtd;
  end if;
end;
$$;

commit;

-- Conferência: o pagamento por mês (igual ao de antes) e as funções.
select mes_competencia, count(*) as pessoas, sum(valor) as total_pago
  from public.vw_pagamento_mensal group by 1 order by 1;
select proname, pg_get_function_identity_arguments(oid) as argumentos
  from pg_proc
 where pronamespace = 'public'::regnamespace
   and proname in ('definir_valor_da_cota', 'remover_valor_da_cota', 'fechar_ciclo', 'bonus_da_competencia',
                   'ligar_monitorias', 'mes_fechado_no_setor')
 order by 1, 2;
