# Histórico de versões

Numeração em três partes: **crítico . atualização . correção**

- **1º número** — mudança crítica: falha de segurança corrigida, ou alteração que
  reescreve dados já existentes e invalida o que foi reportado antes.
- **2º número** — funcionalidade nova ou melhoria relevante.
- **3º número** — correção pequena, sem mudança de comportamento.

---

## 4.10.0

A troca de senha passa a ser registrada pelo banco.

- Antes, quem marcava a senha como trocada era uma chamada feita pela tela
  logo depois do `updateUser`. Ela marcava **sem conferir nada**: qualquer
  pessoa logada podia chamar a função direto pela API e sair da troca
  obrigatória com a senha padrão intacta, com o sistema achando que já havia
  trocado.
- Agora a marca vem de um gatilho em `auth.users`, disparado só quando a senha
  muda de fato. A decisão sai da tela e vai para o banco.
- A função antiga fica sem permissão de execução. Conferido de fora: passou de
  `204` para `401 permission denied`.

Não é falha de invasão — quem chamava já estava dentro, e nenhum dado ficava
exposto. É a trava que existe para tirar de circulação a senha padrão, que é
conhecida e adivinhável, e que podia ser contornada justamente por quem tem
interesse em não trocá-la. Por isso a versão sobe no segundo número, e não no
primeiro.

## 4.9.1

A versão sobe para a barra de navegação, sob o nome do sistema.

- No rodapé ela era invisível na prática: 10px, cinza a 50%, num canto que
  ninguém olha — e no modo escuro sumia de vez.
- Deixa de aparecer nas telas de login e de definir senha, que não têm barra.
  Quem precisar do número antes de entrar tem o `/api/saude`.
- A versão chega à navegação por propriedade, e não por `import` do
  package.json: a navegação é componente de navegador, e importar ali levaria
  o arquivo inteiro para o pacote enviado ao usuário só para exibir cinco
  caracteres.
- De quebra, some o aviso de build sobre importação nomeada do package.json,
  que aparecia em toda compilação.

## 4.9.0

Aviso de data no futuro ao lançar ou editar monitoria.

- Data futura quase sempre é erro de digitação, e é um erro que **não
  aparece**: a monitoria cai numa competência que ainda não chegou, some dos
  relatórios do mês e reaparece meses depois. Aconteceu duas vezes, uma delas
  lançada em setembro com data de dezembro.
- O formulário avisa e diz em qual competência a monitoria vai contar.
  **Avisa, não bloqueia** — pode haver caso legítimo, e travar o lançamento
  atrapalharia mais do que ajudaria.
- Na lista, o protocolo perde o tratamento especial que o mantinha
  selecionável: a linha inteira passa a se comportar igual, e só o código é o
  link. Para copiar o protocolo, o detalhe da monitoria.

## 4.8.0

Cada monitoria ganha um código, e a lista ganha busca.

- O código aparece como **#0042** e é o link da linha. O `id` é um UUID, bom
  para o banco e impossível de ditar por telefone; o protocolo é do
  atendimento, não da monitoria, e se repete quando dois monitores avaliam o
  mesmo atendimento. O código identifica a monitoria e mais nada.
- **Campo de busca** na lista, por código ou por protocolo. O `#` e os zeros à
  esquerda são só apresentação: "#0042", "0042" e "42" chegam ao mesmo
  registro.
- O **protocolo volta a ser selecionável** — ele fica acima da camada de
  clique, porque é o número que se copia para procurar o atendimento no Huggy.
- A coluna de código é ordenável, e o código aparece também no detalhe e na
  lista de excluídas.

As 79 monitorias existentes foram numeradas pela ordem em que aconteceram, e o
código sobrevive à exclusão: perguntar "o que houve com a #0037" continua tendo
resposta depois de ela ser apagada.

## 4.7.0

A linha da lista de monitorias abre o registro.

- O **protocolo vira o link visível** — é por ele que se procura um
  atendimento — e a área de clique se estende por toda a linha.
- O clique é de um link de verdade, esticado sobre a linha por um `::after`, e
  não de um `onClick`. Com isso ctrl+clique, botão do meio e "abrir em nova
  aba" continuam funcionando, e o teclado alcança a linha pela tabulação
  normal. Um manipulador de clique perderia as quatro coisas.
- A coluna **"abrir →"** saiu: duas coisas clicáveis para o mesmo destino
  confundem mais do que ajudam.

A permissão de edição não mudou — gestor e qualidade seguem editando.

## 4.6.0

Ponto de verificação para monitoramento externo, em `/api/saude`.

A queda de 01/09 só foi percebida porque alguém estava usando o sistema na
hora. Fora do horário, ela poderia durar horas sem ninguém saber.

- A Cloudflare não oferece alerta de erro de Worker no plano gratuito, e os
  registros de execução só existem ao vivo, sem retenção. O aviso precisa vir
  de um monitor externo.
- Um monitor apontado para a página de login não serviria: durante toda a pane
  o login respondeu 200, e só as telas de dentro falhavam. Olhar a porta da
  frente não diz se a casa está de pé.
- Por isso `/api/saude` faz uma consulta real ao banco e verifica o caminho
  inteiro: o Worker executou, alcançou o Supabase e recebeu resposta. Responde
  `200` com estado, versão e tempo de resposta, ou `503` com o motivo.
- Não devolve nenhum dado do sistema — a RLS já entrega lista vazia para quem
  não está logado, e é esse o comportamento esperado.
- O endereço fica fora do `middleware`. Passando por ele seria redirecionado ao
  login e devolveria `200` mesmo com o sistema fora do ar, ou seja, o monitor
  diria que está tudo bem no meio da pane.

## 4.5.0

Corrige a queda do sistema com erro 1102 (*Worker exceeded resource limits*).

Em 01/09/2026, após uma exclusão de monitoria, o sistema inteiro passou a
responder erro para quem estava logado. A exclusão em si funcionou e nada foi
perdido — o problema era de capacidade, e a exclusão só disparou a rajada que
o revelou.

- **Causa.** O `next/link` pré-carrega todo link visível na tela. Como toda
  página aqui é dinâmica e atrás de login, cada pré-carregamento é uma
  renderização completa no servidor, com consulta ao banco junto. O menu tem 5
  links e a lista de monitorias tem 1 por linha: abrir a lista disparava dezenas
  de renderizações de páginas que ninguém pediu. Nos registros do Worker, **233
  das 239 chamadas (97%) eram pré-carregamento**, gastando 4,8 s de CPU. O
  Worker tem 10 ms de CPU por chamada; a rajada estourava o limite e derrubava
  junto a página que a pessoa realmente tinha aberto.
- **Correção.** Todo link do sistema passa por `componentes/Link.tsx`, que
  desliga o pré-carregamento por padrão. Não se perde velocidade: pré-carregar
  página dinâmica não guarda o conteúdo, só adianta um trabalho que seria
  refeito na navegação de qualquer jeito.
- **Alívio extra.** O gráfico do Painel (Recharts) era desenhado no servidor e
  descartado no navegador, porque a paleta depende do tema, que só existe lá.
  Agora ele carrega direto no navegador. O Painel caiu de 120 kB para 3,6 kB de
  código renderizado, e de 295 kB para 178 kB no primeiro carregamento.

Segue de pé a recomendação de migrar o Worker para o plano pago: 10 ms de CPU
por chamada é pouco para renderização no servidor, e esta correção dá folga,
não garantia.

## 4.4.1

Horários em GMT-3, o fuso da operação.

- As páginas são renderizadas no servidor, que roda em UTC, então todo horário
  de histórico aparecia três horas adiantado.
- Junto vinha um defeito maior: a data sugerida no formulário também vinha de
  UTC. Depois das 21h a data já era a do dia seguinte, e como semana e
  competência derivam dela, uma monitoria lançada às 22h de 25/08 caía na 1ª
  semana de setembro em vez da 4ª de agosto.
- O fuso passa a ser fixo em `America/Sao_Paulo`, e não o do servidor ou o do
  computador de quem acessa — assim a mesma tela mostra o mesmo horário para
  todos.

## 4.4.0

Histórico das decisões de exclusão, que ficavam gravadas sem nenhuma tela lendo.

- O detalhe da monitoria mostra os **pedidos de exclusão** feitos para ela, com
  motivo, quem pediu, quem decidiu, quando e a observação da recusa. Uma recusa
  saía da fila do gestor e não deixava nada visível.
- Tela **Monitorias excluídas**, acessível pela lista, com o que foi apagado, por
  quem e por quê. Sem ela a aprovação sumia da vista: aprovar apaga a monitoria e
  leva junto o pedido, porque a solicitação aponta para ela em cascata — o
  registro sobrevive em `monitorias_excluidas`, que nenhuma tela lia.

## 4.3.1

- A fila de exclusões aparecia vazia para o gestor mesmo com solicitação
  pendente: a consulta ainda pedia a tabela `operadores`, removida na
  unificação, e falhava por inteiro. O contador no menu seguia certo porque é
  uma contagem simples, sem junção — o que fez o defeito parecer coisa da tela.
- A consulta descartava o erro e lia só os dados, então uma falha virava
  "nenhuma pendência". Agora o erro é registrado e mostrado no lugar da fila.

## 4.3.0

- `npm run acesso` cria o acesso de uma pessoa com a senha padrão e obriga a
  troca no primeiro login — o equivalente à macro de Excel que fazia isso antes.
  Aceita `--todos` para cobrir de uma vez quem está cadastrado sem login.
- A senha padrão vem de `SENHA_PADRAO` no `.env.local`, fora do repositório.
- O comando é local, e não um botão no site, porque criar conta exige a chave
  `service_role`, que ignora toda a segurança do banco. Enquanto ela existir só
  na máquina de quem administra, um vazamento do site não expõe o banco.

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
