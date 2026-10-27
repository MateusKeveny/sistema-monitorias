-- ============================================================================
-- 83 · Setores e filas em árvore — etapa 3, parte 1 (a foto de antes)
--
-- A etapa 3 (docs/PLANO-SETORES.md) troca o cálculo da cota para ler a fila
-- pelo id e junta as regras de cada fila numa regra só, com peso por fila.
-- É a etapa que reescreve dados, então antes de qualquer troca guardamos uma
-- foto do que o cálculo dá hoje:
--
--   foto_da_cota         cada linha do extrato (pessoa, mês, semana, fila,
--                        regra, quantidade, peso, cota), de todos os meses
--   foto_da_cota_mensal  o resultado de cada pessoa em cada mês
--
-- e uma função que compara o cálculo de agora com uma foto, centavo por
-- centavo. Esta migração NÃO muda nada no cálculo: só cria as duas tabelas,
-- tira a foto 'antes-da-etapa-3' e confere a foto contra ela mesma (tem de
-- dar zero diferenças).
--
-- A comparação não depende do nome da regra (que muda na etapa 3): soma a
-- cota por pessoa, mês, semana e fila, e o resultado do mês por pessoa.
--
-- Rode no SQL Editor do projeto dos PAINÉIS, inteiro, de uma vez. Pode rodar
-- de novo: a foto com o mesmo nome é substituída.
-- ============================================================================

begin;

create table if not exists public.foto_da_cota (
  foto            text        not null,
  tirada_em       timestamptz not null default now(),
  pessoa_id       uuid        not null,
  mes_competencia date        not null,
  semana          smallint,
  origem          text,
  regra           text,
  rotulo          text,
  grupo           text,
  cargo_id        smallint,
  quantidade      numeric,
  peso            numeric,
  cota            numeric
);
create index if not exists foto_da_cota_idx on public.foto_da_cota (foto, mes_competencia, pessoa_id);

create table if not exists public.foto_da_cota_mensal (
  foto            text        not null,
  tirada_em       timestamptz not null default now(),
  pessoa_id       uuid        not null,
  mes_competencia date        not null,
  cargo           text,
  resultado       numeric,
  meta            numeric,
  atingimento     numeric,
  primary key (foto, pessoa_id, mes_competencia)
);

-- Só o SQL Editor e as funções abaixo mexem nelas: RLS ligado e sem política.
alter table public.foto_da_cota        enable row level security;
alter table public.foto_da_cota_mensal enable row level security;

-- Tira (ou retira) a foto com esse nome, de todos os meses.
create or replace function public.tirar_foto_da_cota(p_foto text)
returns table (linhas bigint, meses_pessoa bigint)
language plpgsql security definer set search_path = public as $$
begin
  delete from public.foto_da_cota        where foto = p_foto;
  delete from public.foto_da_cota_mensal where foto = p_foto;

  insert into public.foto_da_cota
    (foto, pessoa_id, mes_competencia, semana, origem, regra, rotulo, grupo, cargo_id, quantidade, peso, cota)
  select p_foto, e.pessoa_id, e.mes_competencia, e.semana, e.origem, e.regra, e.rotulo, e.grupo, e.cargo_id,
         e.quantidade, e.peso, e.cota
    from public.vw_extrato_cota e;

  insert into public.foto_da_cota_mensal
    (foto, pessoa_id, mes_competencia, cargo, resultado, meta, atingimento)
  select p_foto, m.pessoa_id, m.mes_competencia, m.cargo, m.resultado, m.meta, m.atingimento
    from public.vw_cota_mensal m;

  return query
    select (select count(*) from public.foto_da_cota        where foto = p_foto),
           (select count(*) from public.foto_da_cota_mensal where foto = p_foto);
end;
$$;

-- Compara o cálculo de agora com a foto. Devolve só o que difere (vazio =
-- tudo bate). `nivel`: 'semana' (cota somada por pessoa, mês, semana e fila)
-- ou 'mes' (resultado e atingimento da pessoa no mês).
create or replace function public.comparar_com_a_foto(p_foto text)
returns table (nivel text, pessoa_id uuid, mes_competencia date, semana smallint, origem text,
               antes numeric, depois numeric, diferenca numeric)
language sql security definer set search_path = public as $$
  with antes_semana as (
    select f.pessoa_id, f.mes_competencia, f.semana, f.origem, sum(f.cota) as cota
      from public.foto_da_cota f where f.foto = p_foto
     group by 1, 2, 3, 4
  ), depois_semana as (
    select e.pessoa_id, e.mes_competencia, e.semana, e.origem, sum(e.cota) as cota
      from public.vw_extrato_cota e
     group by 1, 2, 3, 4
  ), antes_mes as (
    select f.pessoa_id, f.mes_competencia, f.resultado, f.atingimento
      from public.foto_da_cota_mensal f where f.foto = p_foto
  ), depois_mes as (
    select m.pessoa_id, m.mes_competencia, m.resultado, m.atingimento
      from public.vw_cota_mensal m
  )
  select 'semana', coalesce(a.pessoa_id, d.pessoa_id), coalesce(a.mes_competencia, d.mes_competencia),
         coalesce(a.semana, d.semana), coalesce(a.origem, d.origem),
         a.cota, d.cota, coalesce(d.cota, 0) - coalesce(a.cota, 0)
    from antes_semana a
    full join depois_semana d
      on d.pessoa_id = a.pessoa_id and d.mes_competencia = a.mes_competencia
     and d.semana is not distinct from a.semana and d.origem is not distinct from a.origem
   where round(coalesce(a.cota, 0), 2) <> round(coalesce(d.cota, 0), 2)
  union all
  select 'mes', coalesce(a.pessoa_id, d.pessoa_id), coalesce(a.mes_competencia, d.mes_competencia),
         null, null, a.resultado, d.resultado, coalesce(d.resultado, 0) - coalesce(a.resultado, 0)
    from antes_mes a
    full join depois_mes d on d.pessoa_id = a.pessoa_id and d.mes_competencia = a.mes_competencia
   where round(coalesce(a.resultado, 0), 2) <> round(coalesce(d.resultado, 0), 2)
      or a.atingimento is distinct from d.atingimento
   order by 1, 3, 2, 4, 5;
$$;

revoke all on function public.tirar_foto_da_cota(text)  from public, anon, authenticated;
revoke all on function public.comparar_com_a_foto(text) from public, anon, authenticated;

select * from public.tirar_foto_da_cota('antes-da-etapa-3');

commit;

-- Conferência 1: a foto, mês a mês (o total tem de bater com o Comparativo).
select f.mes_competencia, count(distinct f.pessoa_id) as pessoas, count(*) as linhas,
       round(sum(f.cota), 2) as total_de_pontos
  from public.foto_da_cota f
 where f.foto = 'antes-da-etapa-3'
 group by 1 order by 1;

-- Conferência 2: comparar o cálculo com a foto recém-tirada — tem de voltar
-- VAZIO ("Success. No rows returned").
select * from public.comparar_com_a_foto('antes-da-etapa-3');
