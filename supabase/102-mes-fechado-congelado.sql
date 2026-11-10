-- 102 (Performance 4.1.0): mês fechado mostra o que foi fechado.
--
-- O problema: vw_cota_mensal e vw_extrato_cota (e o resumo, que as copia a
-- cada 30 min) calculam qualquer mês com os pesos de HOJE. Os pesos do
-- Atendente Júnior mudaram em 06/11 valendo para novembro (Finalizado de 4
-- para 2, C-SAT em dobro), e o Início passou a mostrar outubro — já fechado em
-- 03/11 — com os pesos novos (Denise: 5.394 no fechamento, 4.202 na tela).
--
-- A correção: duas views só de leitura, com as MESMAS colunas das ao vivo.
-- Quem tem fechamento no mês vem do fechamento (fechamentos_cota e
-- fechamento_linhas, como ficou gravado); quem ainda não fechou (outro setor,
-- mês aberto) vem do cálculo ao vivo, como antes. As telas passam a ler destas
-- views sempre que o mês tem fechamento (lib/resumo.ts).
--
-- Não muda nenhum dado, nenhuma tabela e nenhuma view existente. A leitura
-- segue a regra de acesso de cada um (security_invoker: as políticas de
-- fechamentos_cota, fechamento_linhas e das views ao vivo).

create or replace view public.vw_cota_mensal_vigente with (security_invoker = true) as
  select f.pessoa_id,
         coalesce(p.nome, f.pessoa_nome) as pessoa,
         f.mes_competencia,
         f.cargo,
         f.resultado,
         f.meta,
         round(f.resultado / nullif(f.meta, 0), 6) as atingimento,
         p.ativo as pessoa_ativa,
         public.mes_inteiro_na_operacao(f.pessoa_id, f.mes_competencia) as compoe_media
    from public.fechamentos_cota f
    left join public.pessoas p on p.id = f.pessoa_id
  union all
  select v.pessoa_id, v.pessoa, v.mes_competencia, v.cargo, v.resultado, v.meta,
         v.atingimento, v.pessoa_ativa, v.compoe_media
    from public.vw_cota_mensal v
   where not exists (select 1 from public.fechamentos_cota f
                      where f.pessoa_id = v.pessoa_id and f.mes_competencia = v.mes_competencia);

comment on view public.vw_cota_mensal_vigente is
  '102: vw_cota_mensal, mas quem tem fechamento no mês vem do fechamento (pesos da época).';

create or replace view public.vw_extrato_vigente with (security_invoker = true) as
  select f.pessoa_id,
         f.mes_competencia,
         l.semana,
         l.origem,
         l.regra,
         l.rotulo,
         l.grupo,
         l.ordem,
         c.id as cargo_id,
         f.cargo,
         l.quantidade,
         l.peso,
         l.cota
    from public.fechamento_linhas l
    join public.fechamentos_cota f on f.id = l.fechamento_id
    left join lateral (select c.id from public.cargos c
                        where c.nome = f.cargo and c.setor_id = f.setor_id
                        order by c.ativo desc, c.id limit 1) c on true
  union all
  select e.pessoa_id, e.mes_competencia, e.semana, e.origem, e.regra, e.rotulo, e.grupo, e.ordem,
         e.cargo_id, e.cargo, e.quantidade, e.peso, e.cota
    from public.vw_extrato_cota e
   where not exists (select 1 from public.fechamentos_cota f
                      where f.pessoa_id = e.pessoa_id and f.mes_competencia = e.mes_competencia);

comment on view public.vw_extrato_vigente is
  '102: vw_extrato_cota, mas quem tem fechamento no mês vem das linhas do fechamento (pesos da época).';

grant select on public.vw_cota_mensal_vigente, public.vw_extrato_vigente to authenticated;
