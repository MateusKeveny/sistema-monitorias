# Continuidade — Painel de Performance

Onde o trabalho parou, o que já vale como regra e o que ficou pendente.
Escrito em 28/09/2026, atualizado em 29/09/2026. Para o modelo de dados completo, ver
[MODELO-PAINEL.md](MODELO-PAINEL.md); para infraestrutura,
[HOSPEDAGEM.md](HOSPEDAGEM.md).

---

## Estado em 29/09/2026

| | |
|---|---|
| Publicado | Performance **1.24.0** · Monitorias **4.14.1** (deploy de 29/09/2026) |
| Branch | `painel-performance` (a `main` segue intocada) |
| Migrações no banco | 01 a 33, todas aplicadas |
| Endereços | `painel-performance.expansao.workers.dev` · `painel-monitorias.expansao.workers.dev` |

### Revisão de design (28/09/2026)

Três versões, cada uma publicada e conferida antes da próxima:

- **1.13.0** (publicada): meta visível na barra de atingimento, com frase do
  bônus de equipe; cota no topo da tela inicial; cabeçalho agrupado
  (Registrar, Administrar) e fixo só em tela larga; competência em aberto
  como padrão.
- **1.14.0** (publicada): resumo do mês no topo do extrato (total, barra de
  meta, quanto falta, valor).
- **1.15.0** (publicada): a tela inicial do gestor vira um painel de
  **acompanhamento**, escolhido entre várias prévias (a "régua da meta" e o
  detalhe no fim da página foram recusados). Menu lateral no Performance em
  tela larga (`MenuLateral`), conteúdo na largura toda. Topo: saudação, mês
  com setas, selo da situação do mês (só gestor) e nota discreta do mês
  seguinte. "Precisa de você": pendências calculadas do banco, cada uma
  levando à tela onde se resolve. Cinco destaques que são as abas da tela
  (`SeletorDeDetalhe`) — Na meta, C-SAT, Volume, TME, Monitoria —, cada um com
  comparação contra o mês anterior e o detalhe logo abaixo, com gráfico de
  linha nas semanas (`GraficoDeLinha`). Projeção só no mês corrente, pelo
  ritmo das semanas com volume lançado. Escala única de cor: verde da marca =
  bom/na meta, âmbar = atenção, rosa = ruim, cinza = sem julgamento.
- **1.16.0** (publicada, em teste com os operadores): a tela inicial do
  operador no mesmo formato de acompanhamento (`PainelAtendente`). "Como
  chegar à meta" no topo (quanto falta, quantos atendimentos, ganho do
  próximo degrau de C-SAT, critérios da última monitoria); cinco destaques —
  Minha meta, Meu C-SAT, Meus atendimentos, Meu TME, Minha monitoria —
  comparados com a própria pessoa no mês anterior; projeção pessoal no mês
  corrente. Nada de colega nem de fechamento; da equipe, só as médias de
  C-SAT e TME que o banco já entrega ao operador (por isso a referência do
  volume é a média da própria pessoa). Removidos AlternadorCanal,
  AlternadorDeVisao, GraficoCsat e GraficoSemanal, sem uso.
- **1.17.0** (publicada): **Comparativo entre meses** (`/cota/comparativo`),
  no menu logo abaixo de Início. Abas por categoria — Pontuação, C-SAT,
  Volume, TME, Monitoria —, período de 3, 6 ou 12 meses; em cada uma, resumo
  (último mês, contra o anterior, média, melhor mês), linha dos meses e
  tabela por atendente com os meses nas colunas. Pontuação de mês fechado sai
  do fechamento; de mês aberto, do cálculo ao vivo. O link de cada linha leva
  ao detalhe da categoria: histórico da cota, extrato ou as monitorias. Nova
  tela **Monitorias do atendente** (`/cota/monitorias`) dentro do Performance,
  no lugar do link para o site de Monitorias. Atalhos "comparar meses ›" nos
  detalhes da tela inicial. O operador vê só a própria evolução.
- **1.18.0** (publicada): o estilo novo nas telas de consulta. **Extrato**:
  resumo do mês no topo, "De onde vieram os pontos" (o que somou e o que
  tirou, por categoria), as semanas lado a lado como cartões que abrem o
  detalhe e o resumo geral do mês por canal, sempre visível. Todo quadro
  segue a **ordem da planilha** — atendimento e transferências, TME, faixas
  de C-SAT, notas, monitoria, demanda extra —, e não o `ordem` do catálogo,
  que punha o TME de Diretores depois das notas. A monitoria do mês é a
  **média das semanas**, não a soma. **Histórico**: resumo, linha dos pontos
  por mês e meses recolhíveis. **Fechamento**: setas, situação e o quadro
  "Antes de fechar" (sem cargo, lançamentos a conferir, semanas sem volume,
  monitorias incompletas, ciclo correndo).
- **1.19.0** (publicada): o estilo novo nas telas de registro.
  **Lançamentos**: mês nas setas; um cartão por semana com o volume lançado
  e as avaliações importadas (a semana que termina depois da última
  importação aparece como parcial) e um cartão "A conferir"; o clique abre o
  volume da semana, com o valor da semana anterior como referência. Cada
  semana espera quem teve volume na **última semana lançada** (na 1ª, a
  última do mês anterior) — no Diretores-Expansão nem todos atendem; quem
  não atendeu fica na lista sem a marca de "falta". Lançamento manual mostra
  o efeito antes de lançar e a lista filtra por pessoa. Saiu a digitação de
  **avaliações de diretores**: todas vêm da importação (as 547 do banco
  vieram de lá). **Presencial**: data, ID do cliente, nome e demanda
  **obrigatórios** (na tela; registros antigos sem ID ficam como estão),
  observação opcional, cartões do mês e das semanas, total por pessoa e
  lista por dia com busca. **Importar**: grade "O que já está no sistema"
  por semana e canal, com a última importação, e o importador em três
  passos.
- **1.20.0** (publicada): administração. **Atendentes**: tudo de uma
  pessoa num lugar só — cartões que filtram (na operação, precisa de atenção,
  entradas e saídas recentes, desligados), lista e a **ficha** ao lado com
  entrada, cargo com histórico, Nome no Hub, o que aparece na tela inicial e
  a saída (agora com confirmação). **Configuração**: "Pesos por cargo" é a
  tabela da planilha (métrica na linha, cargo na coluna; cartão do cargo
  abre nome, meta e média; barra diz quantas pessoas a mudança afeta);
  "Faixas e nomes" tem réguas com os cortes editáveis — cada corte grava o
  fim de uma faixa e o começo da próxima — e os nomes das métricas (a faixa
  saiu dessa lista para não haver dois lugares gravando o mesmo campo).
  Saíram PainelCargos, PainelCargosDaPessoa, PainelExibicao e AbasLaterais.
- **1.20.1** (publicada): gráfico de linha nas telas de largura cheia
  (Comparativo, Histórico, Monitorias do atendente) desenhado com base de
  1.400 em vez de 640 — antes saía com mais que o dobro do tamanho.
- **1.21.0** (publicada e aprovada pela Suyara em 29/09/2026): tela inicial de quem
  recebe pela média (`PainelPleno`) — a cota com a conta aberta (média dos
  Juniores × 1,2 + demandas), as demandas do mês, os Juniores que formam a
  média e, para quem enxerga o time, a equipe com o painel do gestor sem
  "Precisa de você". **A migração 31 não foi feita**: a Suyara, única Pleno,
  tem papel Qualidade, que já vê a equipe (`ve_o_time`); ela só seria
  necessária para um Pleno com papel Operador. A gestão continua só do
  gestor na RLS (pesos, métricas, cargos, lançamentos, volume, avaliações,
  valor, fechamento, saída).
- **Revisão concluída**: todas as telas do Performance estão no estilo
  novo. Pleno com papel Operador vendo a equipe no Comparativo fica como
  nota para o futuro: pediria uma migração própria, com consulta liberada só
  para o cargo (hoje a única Pleno é Qualidade, que já vê a equipe).
- **1.22.0 / Monitorias 4.13.0** (publicada): **redefinir senha pelo
  gestor** (migração 32). Não havia como recuperar senha esquecida. Na ficha
  da pessoa (Atendentes → Acesso), "Redefinir senha" gera uma senha
  temporária aleatória (10 caracteres, sem 0/O, 1/l/I), mostrada uma vez ao
  gestor, encerra as sessões abertas e obriga a troca no próximo acesso;
  cada redefinição fica em `redefinicoes_de_senha`. Só o gestor redefine, e
  não a própria senha. O login dos dois sites ganhou "Esqueci minha senha",
  que orienta a procurar o gestor. O "Copiar" não chegou à área de
  transferência no navegador embutido do app: conferir no Chrome, no site
  publicado. Ler na tela sempre funciona.
- **1.23.0 / Monitorias 4.14.0** (publicada): **Diário de bordo** (migração
  31). Todos registram no Performance (Registrar → Diário de bordo) processos
  novos, treinamentos, autorizações e exceções; protocolo obrigatório; todos
  veem todos os registros. Palavras como "autoriz", "liberad", "diretoria",
  "gestão", "exceção" exigem dizer quem autorizou (ou marcar que o texto só
  menciona). Autorização da gestão ou diretoria feita por quem não é gestor
  fica **aguardando aprovação**: o gestor aprova ou devolve com comentário
  (pendência no Início), e o autor corrige e reenvia. No Monitorias, gestor e
  qualidade consultam em "Diário de bordo"; ao salvar uma monitoria cujo
  protocolo tem autorização ou exceção no diário, o monitor responde se
  impacta (com justificativa) — fica em `diario_citacoes`. Fluxo de
  aprovação testado com o perfil Teste de acesso.
- **1.24.0 / Monitorias 4.14.1** (publicada): **aprovação do diário pelo
  cargo** (migração 33). Gestor, Pleno e Analista registram autorização da
  gestão ou diretoria e ela conclui direto; júnior (e quem não tem cargo) vai
  para aprovação. Aprovam ou devolvem o gestor e o Pleno, nunca o próprio
  registro; excluir segue só do gestor. O Início do Pleno mostra os registros
  que aguardam. Os cargos são lidos pelo nome ("Atendente Pleno",
  "Analista") em `cargo_atual_nome()`: renomear um desses cargos exige
  ajustar `conclui_diario_direto()` e `aprova_diario()`. Testado com o
  Teste de acesso sem cargo e com o cargo Pleno temporário (removido).

Visão de celular fica fora da revisão, por decisão do gestor.

---

## Regras que valem hoje

**Cota.** A pontuação é a soma de um extrato — regra × peso do cargo, por
pessoa e semana. Ciclo do dia 26 ao 25. Meta de 5.000 em todos os cargos.

**Cargos.** Júnior pontua por tudo; Pleno recebe a média dos Juniores × 1,2;
Analista pontua por chamados; Gestor recebe a média de Juniores e Analista ×
1,5. Quem compõe cada média é configurável na tela.

**Mês parcial não compõe a média do cargo** (migração 23). Quem entrou ou saiu
no meio da competência fica de fora da média, mantendo o próprio extrato. A
regra nasceu do desligamento do Bruno Aguiar em 11/09: o mês pela metade dele
derrubava a média dos Juniores e custava 358 pontos à Suyara e 447 ao Gestor.

**Pagamento** (migrações 24 a 26):

- valor por ponto é informado pelo gestor, por competência, e costuma chegar
  até o dia 10 do mês seguinte;
- bônus de equipe = 10% da média dos Juniores, **só quando todos os que têm
  direito batem a meta** — Juniores e Analista. Um que não bate, ninguém
  recebe. Pleno e Gestor não recebem o bônus: já têm multiplicador;
- **abaixo da meta não se calcula valor**: é para isso que a meta existe;
- tudo sai do fechamento, não do extrato ao vivo — o que se paga é o que foi
  entregue;
- a conta coletiva roda em `bonus_da_competencia`, *security definer*, porque
  calculada dentro da view ela dependia de quem estava olhando: o operador,
  que só enxerga a própria linha, via bônus liberado indevidamente.

**Exibição e contagem** (migração 27). Duas marcas por pessoa, só para a tela
inicial do gestor: aparecer nas listas e entrar nas médias. Não tocam em
pontuação nem em pagamento. Hoje estão desmarcadas para Luciana, Mateus,
Matheus Camargo, Suyara e Teste de acesso.

**Atendimento presencial** (migração 28). O operador registra o próprio
atendimento — data, ID e nome do cliente, demanda tratada. Duas travas, no
banco e na tela:

- vale **a partir de 26/09/2026** (ciclo de outubro). Setembro já tem o
  presencial lançado à mão pelo gestor, e contar as duas fontes dobraria;
- prazo de **2 dias úteis** depois do atendimento — sexta vale até terça.
  Feriado não conta; o gestor não passa pela trava, porque é quem responde
  quando alguém perde o prazo.

Desde a migração 29, o extrato conta o registro a partir de **26/08/2026**
(competência de setembro, importada da planilha). Quem acessa o banco direto
pelo SQL Editor não passa pela trava de prazo; pelo site, nada mudou. Registro
anterior a 26/09 só o gestor apaga.

**Competência que a tela abre** (1.13.0, `lib/competencia.ts`). Início,
Extrato e Fechamento abrem no mês anterior enquanto ele não foi fechado **e**
o mês novo não tem volume, avaliação, lançamento ou monitoria. Presencial não
conta como dado: o operador registra desde o dia 26. Lançamentos e Presencial
seguem abrindo no mês do calendário. Mês escolhido no seletor vale sempre.

**Mês aberto das Monitorias** (migração 30, Monitorias 4.12.0). O mês
aberto é o seguinte ao último fechamento da cota (`mes_aberto_das_monitorias`).
Enquanto setembro não for fechado no Performance, o site de Monitorias fica em
setembro — painel, lista e relatórios não mostram outubro — e o banco recusa
monitoria de competência posterior (gatilho `monitorias_mes_aberto`). Fechar a cota
libera o mês seguinte sozinho. Ao aplicar, havia 1 monitoria de outubro já
lançada: fica guardada, fora das telas e sem edição, até setembro fechar. Em
monitoria nova a data do atendimento começa vazia: preenchida com hoje, era
salva sem conferir.

**Cor do C-SAT**: verde a partir de 90%, âmbar de 85% a 90% (era verde-amarelado até a 1.15.0),
vermelho abaixo. A meta continua 95%.

**C-SAT do mês é agregado**, não média das semanas: positivas ÷ avaliações. A
diferença aparece quando as semanas têm tamanhos diferentes — a Rayssa fechou
71,4% (5 de 7) onde a média simples daria 83,3%. É o mesmo critério da
planilha antiga.

---

## Setembro e agosto de 2026

**Contraprova concluída.** Setembro conferido célula a célula contra a
planilha, nos dois canais, sem divergência individual. As únicas diferenças
eram de critério na linha de média, e duas células do "Geral" dos Executivos
que não seguem nem a regra da própria planilha.

**Agosto foi substituído pela planilha do cálculo externo** (11 pessoas), com
o valor anterior de cada um registrado em `fechamento_alteracoes`. Valor por
ponto de agosto: R$ 0,033445. Bônus não saiu — cinco Juniores abaixo da meta.
Seis pessoas receberam, de R$ 173,96 a R$ 269,07.

**Presencial de setembro substituído pela planilha** (migração 29, 28/09).
Os lançamentos manuais (só a quantidade por operador, 16 no total) saíram,
com cópia em `lancamentos_substituidos`; entraram as 31 linhas da aba 09-2026
de `Atendimentos presenciais - Expansão.xlsx`, com data, cliente e demanda.
A estrutura está em `supabase/29-presencial-de-setembro.sql`; as linhas, com
nome e ID de clientes, em `dados/29-presencial-de-setembro-linhas.sql`, fora
do git.
Mudou a quantidade de Ibson (4→6), João (0→1), Pedro (3→5) e Rayssa (0→10);
Rafael e Suyara ficaram iguais. Setembro ainda não estava fechado. A
contraprova de setembro não vale mais para o presencial. A linha 3 da planilha
veio sem data e entrou como 09/09, informada pelo gestor; mesmo cliente no
mesmo dia conta como atendimentos separados.

**Bruno Aguiar**: desligado em 11/09, registrado na tela de Atendentes com a
ficha e a cota congeladas. As 114 avaliações de setembro foram reatribuídas a
Ibson, João, Rayssa e Rafael sob duas travas — nenhuma faixa de C-SAT podia
cair e ninguém podia perder ponto —, cada linha marcada com a observação
"Reatribuído de Bruno Aguiar (desligado) em 24/09/2026". O volume dele foi
redistribuído pelo gestor.

---

## Pendências

**Antes de divulgar à equipe**

- trocar as senhas ainda padrão;
- criar o monitor do Performance no Better Stack (o de Monitorias já existe).

**Trabalho em aberto**

- **Reimportar as avaliações de setembro** até 25/09 antes do fechamento: a
  última importação foi em 23/09, e a 4ª semana está parcial nos dois canais
  (145 em Expansão, 70 em Diretores-Expansão). O volume já está lançado;
- **marcar a origem do fechamento** (calculado × importado), para a tela
  mostrar detalhe semanal só de quem foi calculado pelo painel;
- **documentação**: MODELO-PAINEL e HOSPEDAGEM estão na 1.4.0, e o documento
  de apresentação também. Atualizar quando a sequência estabilizar;
- **reconferir o limite de CPU da Cloudflare** antes de entregar o material à
  TI: o documento afirma 10 ms, mas medições de 24/09 mostraram folga maior;
- **migrar para servidores internos** — pacotes e guia já entregues.

---

## Como trabalhar neste projeto

- **Commit e tag antes do deploy.** Em setembro três versões foram ao ar sem
  commit; a numeração foi recontada em 24/09 e a regra ficou registrada em
  `lib/versoes.ts`.
- **MAJOR** = muda regra de cálculo que altera competência já calculada;
  **MINOR** = recurso; **PATCH** = correção.
- **SQL sempre com uma linha de conferência no fim.** O editor do Supabase
  executa só o trecho selecionado, e isso já fez uma migração parecer aplicada
  sem estar.
- `create or replace view` **não aceita** coluna nova no meio da lista nem
  troca de tipo de coluna existente. Coluna nova entra no fim.
- Migração nunca roda sozinha: o gestor executa no SQL Editor, e só depois o
  código correspondente é publicado.
