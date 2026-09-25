-- ============================================================================
-- Painel de Cota — quem aparece e quem conta na tela inicial
-- Rode DEPOIS de 26-bonus-independente-do-acesso.sql. Pode rodar mais de uma vez.
--
-- A tela do gestor mostra e soma todo mundo que tem dado no mês. Nem sempre é
-- o que se quer: o gestor e a qualidade atendem pouco e aparecem no fim de
-- todas as listas; um teste de acesso polui o quadro; alguém emprestado de
-- outra operação distorce a média da equipe sem fazer parte dela.
--
-- São duas decisões diferentes, por isso duas colunas:
--
--   exibir_no_painel — aparece nas listas da tela inicial;
--   conta_nas_medias — entra nas médias de C-SAT, TME e volume.
--
-- Nenhuma das duas toca em pontuação, média do cargo ou pagamento. O extrato
-- de quem sair das listas continua igual, e a cota dele também: isto é
-- apresentação, não cálculo. Por decisão do gestor em 25/09/2026.
-- ============================================================================

alter table public.pessoas
  add column if not exists exibir_no_painel boolean not null default true;
alter table public.pessoas
  add column if not exists conta_nas_medias boolean not null default true;

comment on column public.pessoas.exibir_no_painel is
  'Aparece nas listas da tela inicial do gestor. Não afeta cálculo.';
comment on column public.pessoas.conta_nas_medias is
  'Entra nas médias de C-SAT, TME e volume da tela inicial. Não afeta a cota.';
