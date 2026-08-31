# Histórico de versões

Numeração em três partes: **crítico . atualização . correção**

- **1º número** — mudança crítica: falha de segurança corrigida, ou alteração que
  reescreve dados já existentes e invalida o que foi reportado antes.
- **2º número** — funcionalidade nova ou melhoria relevante.
- **3º número** — correção pequena, sem mudança de comportamento.

---

## 4.2.0

**Uma tabela de pessoas no lugar de duas.**

Havia `operadores`, de quem é avaliado, e `perfis`, de quem entra no sistema, com
nome e e-mail repetidos e uma coluna ligando as duas. Quem cadastrava um operador
esperava que ele virasse um acesso, e não virava.

Agora é uma linha por pessoa, com dois campos independentes: `avaliado` diz se ela
entra nas monitorias e `auth_id` diz se ela tem login. Desativar encerra o acesso
de uma vez, sem procurar em dois lugares — que era o pedido.

- Configurações passa a ter um painel **Pessoas** no lugar de Operadores e Acessos.
- Criar a conta no Supabase com um e-mail já cadastrado **liga sozinho** à pessoa;
  antes virava registro separado, que era como a duplicação começava.
- A tabela ganha `nome_huggy`, hoje só existente em `atendentes`, para o painel de
  performance ler a mesma pessoa em vez de manter uma terceira cópia.
- Os ids de `operadores` foram reaproveitados, então as 52 monitorias seguiram
  apontando para o mesmo lugar. Conferido: 52 monitorias, 988 itens, nenhuma órfã.
- `npm run perfis` vira `npm run vincular`.

Migração `11`.

## 4.1.1

- Registro recém-cadastrado em Configurações aparecia como linha em branco até
  a página ser recarregada à força. O rascunho dos campos era montado só na
  primeira montagem do componente, então o id novo chegava sem entrada. Valia
  para operadores, canais e critérios.
- Operadores e Acessos são cadastros diferentes — há operador sem login e login
  que não é operador — mas a tela não dizia isso. Cada painel ganha uma linha
  explicando o que é, e Operadores passa a mostrar quem tem login.

## 4.1.0

- Contador no menu quando há exclusões aguardando decisão do gestor. O quadro
  da fila só existe quando há pendência, o que o tornava indescobrível: o
  gestor só o veria se abrisse o Painel justamente no dia certo. O contador
  aparece em qualquer tela e some sozinho quando a fila zera.

## 4.0.0 — crítica

**Cargos reestruturados e duas falhas de permissão corrigidas.**

### Cargos

`admin` sai e vira `gestor`. O papel deixou de ser enum e virou texto com
restrição — enum não aceita remover valor, e mudar a lista de cargos passa a ser
uma linha.

| Cargo | Vê | Monitora | Pesos e cadastros | Acessos | Exclui |
|---|---|---|---|---|---|
| Gestor | tudo | sim | sim | sim | direto |
| Qualidade | tudo | lança e edita | não | não | solicita |
| Operador | só as próprias | não | não | não | não |

A exclusão pedida pela Qualidade fica pendente até um gestor aprovar ou recusar,
e a monitoria continua valendo nos relatórios enquanto isso. Migração `09`.

### Falhas corrigidas

**Guarda de exclusão contornável** — migração `08`.

`eh_admin()` devolvia `NULL` para quem não tem perfil, e em PL/pgSQL
`if not NULL then` não entra no bloco. A guarda não disparava: qualquer pessoa,
sem sessão, apagava qualquer monitoria usando a chave pública que vai no
navegador. Encontrada em teste; apagou um registro, restaurado a partir do
registro de exclusão e da extração original da planilha. Todas as funções de
papel passam a usar `coalesce` e nunca devolvem `NULL`.

**Funções internas expostas** — migração `10`.

`apagar_monitoria`, que apaga sem verificar permissão porque a verificação vive
em quem a chama, e `registrar_alteracao`, que grava no histórico, estavam
chamáveis por qualquer um. `revoke ... from public` não basta no Supabase: ele
concede execução aos papéis `anon` e `authenticated` de forma explícita, e é
preciso nomeá-los para revogar.

### Também nesta versão

- O nº da monitoria deixa de ser escolhido: ao selecionar operador e data, o
  formulário consulta a semana e informa qual será a próxima. Semana com as 4
  já lançadas avisa e bloqueia o salvamento.
- Quadro "Cobertura do ciclo" no painel, para gestor e qualidade: grade de
  operador por semana, partindo da lista de operadores ativos — quem não foi
  monitorado nenhuma vez aparece com zero. Só cobra semanas já encerradas.
- Exclusão de monitoria com registro do que foi apagado, por quem e por quê,
  incluindo as respostas dos critérios. Migrações `07` e `08`.
- Lista de monitorias ordenável por qualquer coluna, preservando o filtro.
- Versão do sistema no rodapé.

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
