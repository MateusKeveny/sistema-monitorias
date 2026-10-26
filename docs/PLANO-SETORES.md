# Plano · Setores e canais em árvore (Performance 3.0)

Rascunho para aprovação do gestor, 26/10/2026. Nada aqui foi feito ainda.

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
4. **Setor na pessoa e no fechamento** (3.1.0) — pessoas, cargos, meta, valor
   por ponto, fechamento e exportação por setor; seletor de setor nas telas.
5. **Limpeza** (3.1.x) — sai o texto `huggy`/`diretores` e as travas antigas.

Meses fechados não mudam em nenhuma etapa: o fechamento guarda as linhas
congeladas (`fechamento_linhas`), e elas só ganham o `canal_id`.

## Decisões pendentes

1. Existe um segundo setor previsto? Define se as etapas 4 e 5 vêm logo ou
   ficam para quando ele chegar.
2. Pessoa em mais de um setor no mesmo mês (empréstimo): fica de fora (cada
   pessoa num setor por mês, como o cargo) ou precisa existir?
3. Gestor por setor (cada gestor vê só o seu) ou um gestor para todos?
