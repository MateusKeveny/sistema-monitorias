-- 106: o iGreen Mob deixa de ser paliativo e vira fila do Expansão (11/11/2026).
--
-- Decisão do gestor: o Mob é fila oficial do setor Conexão Expansão desde
-- novembro, com as mesmas regras da fila Expansão (ele criou a fila id 19,
-- apelido fila_19, copia_de = 1). O paliativo (atendimentos de "outro setor"
-- como demanda extra, lançados com as regras outro_setor_igreen_mob*) sai.
--
-- Só dados, só a competência de novembro (aberta). Outubro e antes ficam como
-- estão (fechados, com o paliativo da época).
--   1. o volume colado no paliativo vira volume da fila (finalizados = resolvidos);
--   2. as avaliações com nota viram avaliações da fila;
--   3. os atendimentos, lançamentos e volume do paliativo de novembro saem.
-- Ensaiado no oficial com desfazer no fim: 11 linhas de volume (337), 98
-- avaliações, 326 atendimentos, 37 lançamentos e 11 linhas de volume colado;
-- os pontos de novembro das 10 pessoas ficaram idênticos (mesmas regras).

begin;

insert into volume_semanal (pessoa_id, mes_competencia, semana, finalizados, canal, canal_id, origem_arquivo)
  select pessoa_id, mes_competencia, semana, resolvidos, 'fila_19', 19, 'paliativo iGreen Mob -> fila (11/11/2026)'
  from volume_outro_setor where mes_competencia = '2026-11-01' and setor = 'iGreen Mob';

insert into avaliacoes (pessoa_id, origem, canal_id, data, protocolo, nota, origem_arquivo, importado_em)
  select pessoa_id, 'fila_19', 19, data, protocolo, nota, origem_arquivo, now()
  from atendimentos_outro_setor where mes_competencia = '2026-11-01' and setor = 'iGreen Mob' and nota is not null
  on conflict (data, protocolo) do nothing;

delete from atendimentos_outro_setor where mes_competencia = '2026-11-01' and setor = 'iGreen Mob';
delete from lancamentos where mes_competencia = '2026-11-01' and regra like 'outro_setor_igreen_mob%';
delete from volume_outro_setor where mes_competencia = '2026-11-01' and setor = 'iGreen Mob';

commit;
