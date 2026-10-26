# Plano · Setores e canais em árvore (Performance 3.0)

Plano aprovado em desenho pelo gestor em 26/10/2026, com a prévia das telas
(Configuração › Setores e canais, ficha da pessoa, cargos e pesos, extrato,
lançamentos e importação). Nada aqui foi feito ainda.

## Objetivo

Hoje o Performance conhece um setor só, com dois canais fixos no código e no
banco (`huggy` = Expansão, `diretores` = Diretores-Expansão). O objetivo é o
setor virar cadastro, em árvore, e tudo — leitura do Hub, importação,
lançamentos, regras, pesos e fechamento — passar a seguir o cadastro:

```
Expansão                      ← setor: pessoas, cargos, meta, valor por ponto, fechamento
├── Expansão                  ← canal: nomes no Hub, volume, C-SAT, TME, pesos de finalizado
└── Diretores-Expansão        ← canal
```

Setor do Hub que não está na árvore vira demanda extra pendente (2.9.0).

## Onde o canal está fixo hoje

- **Banco** (35 migrações citam canal/origem): `volume_semanal.canal`,
  `lancamentos.canal` (com trava `huggy`/`diretores`), `avaliacoes.origem`,
  regras com o canal no nome (`huggy_atendimento`, `diretores_atendimento`,
  grupos `tme` e `tme_diretores`), faixas de C-SAT e TME, a cadeia
  `vw_extrato_quantidades → vw_extrato_direto → vw_extrato_cota →
  vw_cota_mensal`, o resumo (migração 58), a conferência (72) e o fechamento.
- **Código** (20 arquivos): importação do Hub, Colar do Hub, Lançamentos (abas
  por canal), Extrato, Comparativo, Métricas, Início do gestor e do atendente,
  Simulação, Matriz de pesos, Importar mês anterior, Realocação, exportação para
  o portal, `componentes/Canal.tsx` e `lib/tipos.ts`.

## Modelo novo

- `setores` (id, nome, ativo, ordem).
- `canais` (id, setor_id, nome, nomes_no_hub text[], ativo, ordem). Os dois de
  hoje ganham ids fixos e o apelido antigo (`huggy`, `diretores`), para a
  migração ser só troca de rótulo.
- `pessoas.setor_id` e `cargos.setor_id`; `volume_semanal`, `lancamentos` e
  `avaliacoes` ganham `canal_id`.
- Regras de canal deixam de ter o canal no nome: uma regra "Finalizado" com o
  peso por cargo **e por canal**; o mesmo para faixas de TME e C-SAT.
- Fechamento, valor por ponto, meta e exportação passam a ser por setor.

## Etapas (cada uma com prévia, teste e publicação)

1. **Cadastro e leitura do Hub** (2.10.0) — tabelas `setores` e `canais`, tela
   em Configuração, e a importação do Hub e o Colar do Hub lendo os nomes do
   cadastro em vez do código. Cálculo intocado.
2. **Canal por id, em paralelo** (2.11.0) — `canal_id` preenchido ao lado do
   texto antigo, gravado pelas telas; as abas de Lançamentos e da importação
   vêm do cadastro. Cálculo ainda lê o texto.
3. **Cálculo pelo cadastro** (3.0.0) — a cadeia da cota, o resumo e a
   conferência passam a ler `canal_id`; regras e pesos de canal viram uma
   regra com peso por canal. É a etapa que reescreve dados: **antes e depois,
   a cota de cada pessoa em cada mês tem de bater centavo por centavo**
   (a conferência diária e uma comparação mês a mês, guardada antes de rodar).
4. **Setor na pessoa, no fechamento e no acesso** (3.1.0) — pessoas, cargos,
   meta, valor por ponto, fechamento e exportação por setor; seletor de setor
   nas telas; gestor restrito ao seu setor e o papel administrador (ver
   "Acesso por setor").
5. **Limpeza** (3.1.x) — sai o texto `huggy`/`diretores` e as travas antigas.

Meses fechados não mudam em nenhuma etapa: o fechamento guarda as linhas
congeladas (`fechamento_linhas`), e elas só ganham o `canal_id`.

## Decisões do gestor (26/10/2026)

1. **Sem segundo setor por enquanto, mas tudo pronto para ele**: as cinco
   etapas são feitas, e criar um setor novo vira cadastro, sem código.
2. **Uma pessoa, um setor por mês** — como o cargo, com histórico. Sem
   empréstimo entre setores no mesmo mês.
3. **Cada gestor vê e mexe só no seu setor**, e nasce um papel novo,
   **administrador do sistema**, que vê todos os setores para manutenção e
   ajustes (cadastro da árvore, cargos, correções).
4. Canal pode **copiar as métricas** de outro (finalizados, C-SAT e notas,
   TME opcional), acompanhando as mudanças do original — é o caso do iGreen
   Mob, que copia a Expansão. Outubro/2026 fica como demanda extra (2.9.0),
   porque foi de fato extra.

## Acesso por setor (entra na etapa 4)

- `pessoas.papel` ganha `administrador`. O gestor ganha o setor dele; as
  funções de acesso (`eh_gestor`, `ve_o_time` e as políticas das tabelas)
  passam a perguntar "gestor **deste** setor", e o administrador passa em
  todas.
- É a parte mais sensível: cada tabela e view com RLS é revista, e o teste
  inclui um gestor de setor tentando ler e gravar dados do outro setor — tem
  de dar zero linhas e erro.
- Quem hoje é gestor vira administrador **e** gestor da Expansão, para nada
  mudar no dia da troca.
