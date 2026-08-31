# Histórico de versões

Numeração em três partes: **crítico . atualização . correção**

- **1º número** — mudança crítica: falha de segurança corrigida, ou alteração que
  reescreve dados já existentes e invalida o que foi reportado antes.
- **2º número** — funcionalidade nova ou melhoria relevante.
- **3º número** — correção pequena, sem mudança de comportamento.

---

## 3.4.0

Fundos da marca nos dois temas.

- Cada tema ganha sua arte, vinda do material de apresentação da IGreen. No tema
  claro, o verde original com véu de contraste a 28%; no escuro, a arte preta.
- Títulos e legendas que ficam fora dos cartões passam a usar tokens próprios,
  claros nos dois temas — sem isso sumiriam sobre o fundo verde.
- Login, definir senha, erro e 404 deixam de ser formulário solto sobre o fundo
  e ganham cartão.
- Tema escuro neutralizado: as superfícies usavam a escala slate, que tem azul,
  e destoavam da arte preta.
- Correção: campos de formulário não tinham cor de fundo própria e eram
  transparentes. Só apareceu quando o fundo deixou de ser cor lisa.
- Artes de 1 MB reduzidas para ~10 KB cada em WebP.

## 3.3.0

- Rótulo de mês padronizado como `Agosto/2026` em todo o sistema.
- Seleção de mês no painel, que antes mostrava sempre o mais recente.
- Some uma consulta: a lista de meses e os números saem do mesmo ranking.

## 3.2.1

- Menu suspenso ilegível no tema escuro. A lista de um `<select>` é desenhada
  pelo navegador e mantinha fundo branco com texto claro.
- Gráfico com cores do tema claro sobre fundo escuro: o Recharts recebe cor como
  valor em JavaScript e não alcança a paleta CSS.

## 3.2.0

- Modo claro/escuro, com botão na barra e escolha lembrada no navegador.
- Visão do operador enxuta: sai o menu "Relatórios", que só traz recortes do
  time; o ranking dá lugar a "Minhas últimas monitorias"; "Onde o time mais
  perde nota" vira "Critérios de maior impacto na nota" e, para o operador,
  "Meus pontos de atenção".
- Correções: operador sem monitorias via instrução de instalação; não havia tela
  de erro nem 404; a lista cortava em 500 registros sem avisar.

## 3.1.0

- Edição de monitoria já lançada, com histórico de alterações — campo, valor
  anterior, valor novo, autor e data. Antes, corrigir um erro exigia mexer no
  painel do Supabase.
- Configurações passa a permitir criar critérios e tirá-los do formulário.
- Migração `06-edicao-e-historico.sql`.

## 3.0.0 — crítica

**Ciclo de metrificação de 26 a 25.**

O sistema derivava o mês pelo calendário, o que colocava **31 das 52 monitorias
na competência errada** — uma monitoria de 27/07 pertence a agosto. Relatórios
emitidos antes desta versão não batem com o sistema.

Mês e semana passam a ser derivados da data por função no banco, e deixam de ser
digitados. Migração `05-ciclo-26-a-25.sql`.

## 2.0.0 — crítica

**Correção de brecha na segurança de acesso.**

A política `perfis_editar_proprio` deixava o usuário alterar a própria linha,
travando apenas o campo `papel`. Como a RLS do Postgres age por linha e não por
coluna, **um operador podia trocar o próprio `operador_id` e passar a ver as
monitorias de outra pessoa**, ou reativar o acesso depois de ser desativado. Não
havia como explorar pela interface, mas sim chamando a API.

A política foi removida. A única alteração que o usuário faz em si mesmo passou a
ser uma função controlada, que só toca numa coluna e só na própria linha.

Junto veio a exigência de definir senha no primeiro acesso. Migração
`04-senha-primeiro-acesso.sql`.

## 1.1.0

- Navegação mais fluida: eram 5 idas à rede por clique só para autenticar,
  agora 2; esqueletos de carregamento nas 9 rotas; uma consulta desperdiçada no
  painel removida.

## 1.0.0

Primeira versão em produção.

- Migração da planilha `Dashboard Monitorias.xlsm`: 52 monitorias e 988 itens de
  critério, com a nota recalculada pelo banco conferindo com o Excel em 52 de 52.
- Cálculo do C-SAT por trigger no Postgres, fiel à fórmula da planilha.
- Três perfis de acesso isolados por Row Level Security.
- Relatórios: ranking mensal, critérios reprovados, folha de feedback individual
  e exportação em Excel e CSV.
- Leitor e escritor de `.xlsx` escritos sem dependências, para rodar tanto no
  Node quanto no runtime do Cloudflare Workers.
- Migrações `01` a `03`.
