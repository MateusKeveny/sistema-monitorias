-- ============================================================================
-- Painel de Cota — importação de avaliações do Hub
-- Rode DEPOIS de 18-media-por-cargos.sql. Pode ser executado mais de uma vez.
--
-- Em 03/09/2026 o atendimento saiu do Huggy e foi para o Hub. O relatório do
-- Hub traz os dois setores no mesmo arquivo:
--   Expansao           → avaliações de atendimento (origem 'huggy')
--   Diretores-Expansao → avaliações de diretores   (origem 'diretores')
-- A origem continua se chamando 'huggy' para não mexer nas views da cota: o
-- que ela significa é "canal de atendimento", seja qual for o sistema.
--
-- Só entram avaliações (nota 1 a 5). Volume de finalizados é digitado à mão.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Nome da pessoa no Hub
--
-- O Hub identifica pelo nome, e em quatro casos ele difere do cadastro. Nome
-- sem vínculo faz o importador RECUSAR o arquivo — a alternativa, descartar a
-- linha, faria a nota sumir sem ninguém perceber.
-- ---------------------------------------------------------------------------
alter table public.pessoas add column if not exists nome_hub text;

create unique index if not exists pessoas_nome_hub_unico
  on public.pessoas (lower(nome_hub)) where nome_hub is not null;

update public.pessoas p
   set nome_hub = v.hub
  from (values
    ('allana.silva@igreenenergy.com.br',       'Allana Silva'),
    ('denise.silva@igreenenergy.com.br',       'Denise Silva'),
    ('rafael.silva@igreenenergy.com.br',       'Rafael Silva'),
    ('joaovitor.honorato@igreenenergy.com.br', 'Joao Vitor Honorato'),
    ('ibson.santos@igreenenergy.com.br',       'Ibson Santos'),
    ('mateus.silva@igreenenergy.com.br',       'Mateus Keveny'),
    ('pedro.lima@igreenenergy.com.br',         'Pedro Lucas'),
    ('rayssa.gabrielle@igreenenergy.com.br',   'Rayssa Gabrielle'),
    ('bruno.aguiar@igreenenergy.com.br',       'Bruno Aguiar')
  ) as v (email, hub)
 where lower(p.email) = v.email
   and p.nome_hub is null;

-- ---------------------------------------------------------------------------
-- 2. A mesma avaliação não entra duas vezes
--
-- Os relatórios se sobrepõem (26/08 a 08/09, depois 03/09 a 15/09…). Linha
-- com a mesma data e o mesmo protocolo é ignorada. Conferido antes: nenhum
-- par repetido entre as 4.027 avaliações existentes.
-- ---------------------------------------------------------------------------
-- Sem bloco do $$: o SQL Editor do Supabase cortou o bloco ao colar.
alter table public.avaliacoes drop constraint if exists avaliacoes_data_protocolo_unica;
alter table public.avaliacoes
  add constraint avaliacoes_data_protocolo_unica unique (data, protocolo);
