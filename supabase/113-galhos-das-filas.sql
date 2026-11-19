-- 113 · Galhos das filas (Performance 4.14.0)
--
-- As filas de um setor passam a se agrupar em "galhos", só para a leitura das
-- telas (Início do atendente e Extrato): o galho Expansão junta Expansão,
-- Diretores-Expansão e iGreen Mob; o Marketing junta Cruzeiro, Experience,
-- Marketing e Store. Não muda nenhum cálculo nem ponto.
--
-- Fila sem galho aparece sozinha, com o próprio nome (é o caso do Telecom).

alter table public.canais_do_setor add column if not exists galho text;

comment on column public.canais_do_setor.galho is
  'Agrupamento das filas nas telas (4.14.0). Nulo: a fila fica sozinha, com o próprio nome.';

update public.canais_do_setor set galho = 'Expansão'
 where setor_id = 1 and apelido in ('huggy', 'diretores', 'fila_19');

update public.canais_do_setor set galho = 'Marketing'
 where setor_id = 1 and apelido in ('fila_20', 'fila_21', 'fila_22', 'fila_23');
