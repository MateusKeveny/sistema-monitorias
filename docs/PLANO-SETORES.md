# Plano · Setores e canais em árvore (Performance 3.0)

Plano aprovado em desenho pelo gestor em 26/10/2026, com a prévia das telas
(Configuração › Setores e canais, ficha da pessoa, cargos e pesos, extrato,
lançamentos e importação).

**Situação (27/10/2026):** a 3.0 é feita em paralelo, na branch `versao-3`,
publicada só na cópia de teste (`painel-performance-teste`). Etapas 1 e 2
prontas (migrações 79 e 82); etapa 3 com o cálculo já lendo a fila (83 e 84,
zero diferença) e a fila nova recebendo dados (85). Nas telas, "canal" passou a se chamar **fila**,
o nome que o Hub usa; no banco a tabela continua `canais_do_setor` e a coluna
`canal_id`.

## Objetivo

Hoje o Performance conhece um setor só, com dois canais fixos no código e no
banco (`huggy` = Expansão, `diretores` = Diretores-Expansão). O objetivo é o
setor virar cadastro, em árvore, e tudo — leitura do Hub, importação,
lançamentos, regras, pesos e fechamento — passar a seguir o cadastro:

```
Conexão Expansão              ← setor: pessoas, cargos, meta, valor por ponto, fechamento
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

1. **Cadastro e leitura do Hub** (2.12.0) — tabelas `setores` e `canais`, tela
   em Configuração, e a importação do Hub e o Colar do Hub lendo os nomes do
   cadastro em vez do código. Cálculo intocado.
2. **Canal por id, em paralelo** (2.13.0) — `canal_id` preenchido ao lado do
   texto antigo; as abas de Lançamentos e da importação vêm do cadastro.
   Cálculo ainda lê o texto. *Feito (migração 82):* um gatilho preenche o
   `canal_id` a partir do texto em toda gravação, então as telas não mudaram
   o que gravam; os registros antigos (inclusive `fechamento_linhas`) foram
   preenchidos sem disparar o resumo. Fila nova (sem apelido) ganha aba em
   Lançamentos e linha na Importar com o aviso de que só recebe dados na
   etapa 3 — até lá, os atendimentos dela viram demanda extra pendente.
3. **Cálculo pelo cadastro** (3.0.0) — a cadeia da cota, o resumo e a
   conferência passam a ler `canal_id`; regras e pesos de canal viram uma
   regra com peso por canal. É a etapa que reescreve dados: **antes e depois,
   a cota de cada pessoa em cada mês tem de bater centavo por centavo**
   (a conferência diária e uma comparação mês a mês, guardada antes de rodar).
   *Feito:* a 83 guardou a foto de todos os meses (`foto_da_cota`) e a função
   `comparar_com_a_foto`; a 84 deu à fila as colunas `regra_finalizado`,
   `grupo_tme`, `grupo_csat` e `grupo_nota` e trocou o cálculo numa transação
   só — foto, troca e comparação; qualquer centavo de diferença desfaria tudo.
   Deu zero. Em vez de renomear as regras, a fila aponta para elas: fila que
   copia outra aponta para as mesmas e acompanha a original; fila com regras
   próprias ganha regras com peso zero (`definir_regras_da_fila`, 85). A 85
   também troca as travas "huggy ou diretores" por chave estrangeira para o
   apelido (fila nova ganha `fila_<id>`). Telas: Configuração › Regras por
   fila (uma coluna por fila; C-SAT e notas da equipe) e a escolha de regras ao
   criar a fila. Os painéis (Início, Comparativo) ainda mostram só as duas
   filas de sempre — entram com o visual novo de cada tela.
4. **Setor na pessoa, no fechamento e no acesso** (3.1.0) — pessoas, cargos,
   meta, valor por ponto, fechamento e exportação por setor; seletor de setor
   nas telas; gestor restrito ao seu setor e o papel administrador (ver
   "Acesso por setor").
   *Parte 1 feita (86 e 87):* setor na pessoa com histórico (`setores_da_pessoa`),
   cargos e métricas por setor, valor por ponto e fechamento marcados com o
   setor, monitorias liga/desliga por setor com régua própria
   (`setores.regra_monitoria`) e `clonar_setor` (cópias independentes das
   definições + cargos com pesos e meta). Setor 1 é o padrão, para o site
   oficial seguir gravando sem saber de setor. *Parte 2 (88 e telas):* valor
   por ponto, bônus e pagamento por setor (as funções antigas valem para o
   setor 1), fechar o mês de um setor, ligar monitorias; telas: setor em
   Atendentes, Configuração por setor, criar setor copiando outro, Fechamento
   por setor, Monitorias sem quem é de setor com monitorias desligadas e
   cadastro de pessoas em lote. *Parte 3 (acesso) adiada* até existir um
   segundo gestor — e ensaiada antes num banco local.
   *Pendente antes de um 2º setor fechar mês:* as travas de "mês fechado"
   (mover volume/lançamento, realocação) ainda olham o mês, não o setor; a
   exportação e os relatórios do Monitorias ainda não filtram por setor.
   *Planejado (quando o próximo setor definir):* ciclo de medição por setor
   (hoje 26 a 25, semanas fixas).
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
   TME opcional), acompanhando as mudanças do original — para um canal novo
   que funcione como a Expansão. O iGreen Mob **não** vira canal por
   enquanto: os atendimentos de outubro ficam como demanda extra (2.9.0),
   porque foi de fato extra.

5. **Vale a partir de novembro/2026.** Outubro está em fechamento e fica no
   formato atual. Nenhuma etapa que mexa em tela de lançamento, importação ou
   cálculo é publicada antes de outubro fechado.
6. **O setor de hoje se chama "Conexão Expansão"**, com os canais Expansão
   e Diretores-Expansão. Tudo o que já está gravado (até outubro) entra nele,
   sem mudar valor, para consulta de histórico.

## Acesso por setor (entra na etapa 4)

- `pessoas.papel` ganha `administrador`. O gestor ganha o setor dele; as
  funções de acesso (`eh_gestor`, `ve_o_time` e as políticas das tabelas)
  passam a perguntar "gestor **deste** setor", e o administrador passa em
  todas.
- É a parte mais sensível: cada tabela e view com RLS é revista, e o teste
  inclui um gestor de setor tentando ler e gravar dados do outro setor — tem
  de dar zero linhas e erro.
- Quem hoje é gestor vira administrador **e** gestor da Conexão Expansão, para nada
  mudar no dia da troca.
