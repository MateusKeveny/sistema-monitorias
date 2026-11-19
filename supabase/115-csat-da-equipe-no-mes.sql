-- 115 · C-SAT da equipe do mês numa chamada só (Performance 4.14.1)
--
-- O Início do atendente pedia csat_da_equipe uma vez por fila × semana: com
-- as 7 filas do Expansão eram 28 chamadas, e a página passou do limite de 50
-- chamadas por carregamento do Cloudflare ("Algo deu errado" para todo
-- operador, 19/11/2026). A 4.14.0 cortou para as filas e semanas com dados;
-- esta função devolve tudo de uma vez — 1 chamada, qualquer que seja o número
-- de filas.
--
-- Mesma conta da csat_da_equipe (positivas sobre avaliações de toda a
-- equipe), agrupada por fila e semana. Conferida no oficial em 19/11/2026:
-- 21 de 21 combinações de novembro iguais; o mês sai em ~20 ms.
-- Só agregados, como a csat_da_equipe: nenhum dado de colega.

create or replace function public.csat_da_equipe_no_mes(p_mes date)
returns table(origem text, semana smallint, positivas bigint, avaliacoes bigint, csat numeric)
language sql stable security definer
set search_path to 'public'
as $function$
  select v.origem, v.semana::smallint, sum(v.positivas)::bigint, sum(v.avaliacoes)::bigint,
         round(sum(v.positivas)::numeric / nullif(sum(v.avaliacoes), 0), 6)
    from public.vw_csat_semanal v
   where v.mes_competencia = p_mes
   group by v.origem, v.semana;
$function$;

-- As mesmas permissões da csat_da_equipe: só quem está logado.
revoke all on function public.csat_da_equipe_no_mes(date) from public, anon;
grant execute on function public.csat_da_equipe_no_mes(date) to authenticated, service_role;
