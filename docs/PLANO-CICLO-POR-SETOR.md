# Ciclo e semanas por setor (plano adormecido)

> Decidido com o gestor em 11/11/2026: **não implementar agora.** Primeiro
> alinhar o que já está no sistema; aplicar quando entrar um setor que feche
> diferente da Expansão. Até lá, todo setor usa o ciclo e as semanas de hoje.

## Como é hoje (vale para todos os setores)

- Ciclo do dia **26 ao dia 25**; a competência é o mês em que o ciclo termina.
- **4 semanas** em faixas fixas de dias: **26–02, 03–10, 11–18, 19–25**.
- Escrito em: `semana_do_ciclo(date)` e `mes_de_competencia(date)` no banco,
  7 travas `semana <= 4` (check constraints), 16 funções e 4 visões que usam as
  duas funções; no código, `semanaDoCiclo`, `periodoDaSemana` e
  `mesDeCompetencia` (`lib/formatar.ts`, ~31 arquivos) e ~21 arquivos com as
  semanas fixas `[1, 2, 3, 4]` (Lançamentos, gráficos do Início, Extrato,
  Fechamento, Importar, Ajustes da semana, exportação).

## O que o gestor decidiu (11/11/2026)

- **Cada setor escolhe o dia de início do ciclo** (26, 1, 21…; até 28, por
  causa de fevereiro). Início no dia 1 = mês do calendário.
- **Semanas em faixas de dias que cobrem o ciclo inteiro**, sem sobrar dia,
  como a Expansão hoje — 4 ou 5 semanas. O sistema sugere os cortes; o admin
  ajusta.
- **Definido na criação do setor**, com aviso ao admin: o tamanho real de cada
  semana conforme o mês (30 ou 31 dias; fevereiro à parte), semana curta ou
  longa demais (proposta: menos de 5 ou mais de 9 dias), e corte em dia que
  fevereiro não tem.
- **Só para setores novos.** Expansão e Telecom ficam no ciclo 26 → 25 com 4
  semanas.

## Como fazer, quando for a hora (proposta de 4.x)

1. **Banco:** tabela `ciclos_do_setor (setor_id, desde, dia_inicio, cortes smallint[])`,
   com vigência (`desde`) para poder mudar no futuro; as funções de semana e de
   competência passam a receber o setor (o da pessoa no dia); travas para
   `semana <= 6`. Conferir que Expansão e Telecom ficam idênticos (md5 das
   visões e da cota mensal antes e depois, como na migração 104).
2. **Cálculo:** as 4 visões e as 16 funções com semana e competência.
3. **Telas:** as semanas do setor no lugar de `[1, 2, 3, 4]`.
4. **Criação de setor:** passo "Ciclo e semanas" no assistente, com a sugestão
   dos cortes e os avisos.
5. **Exportação:** as colunas "1ª a 4ª semana" de monitoria ficam; setor com 5
   semanas ganha a 5ª no fim.

Cada migração com ensaio no banco local e "Sim" do gestor, como sempre.
