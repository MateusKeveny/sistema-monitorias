# Continuidade — Painel de Performance

Onde o trabalho parou, o que já vale como regra e o que ficou pendente.
Escrito em 28/09/2026, atualizado em 29/09/2026. Para o modelo de dados completo, ver
[MODELO-PAINEL.md](MODELO-PAINEL.md); para infraestrutura,
[HOSPEDAGEM.md](HOSPEDAGEM.md).

---

## Estado em 29/09/2026

| | |
|---|---|
| Publicado | Performance **1.37.0** · Monitorias **5.3.1** (deploy de 07/10/2026, migração 52) |
| Branch | `painel-performance` (a `main` segue intocada) |
| Migrações no banco | 01 a 51, todas aplicadas |
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
- **1.25.0** (publicada; Monitorias sem mudança): **quem autorizou por
  lista** e **liberação por pessoa** (migração 34). Gestão e diretoria
  escolhem o nome numa lista fixa em `AUTORIZADORES` (lib/diario.ts: gestão
  Mateus Keveny e Suyara Martins, diretoria Luciana Freire — mudou alguém,
  ajustar ali); "Outro" pede nome, cargo e setor, gravados juntos como
  "Nome · Cargo · Setor". Na ficha da pessoa (Atendentes → Diário de bordo)
  o gestor liga "Registra autorizações sem aprovação"
  (`pessoas.diario_conclui_direto`), para um júnior de confiança concluir
  direto. A 34 também corrige a lista do diário para o operador, que via os
  registros dos colegas sem autor (função `nomes_das_pessoas`, só id e
  nome). Chave na ficha conferida pelo gestor no site publicado.
- **1.26.0 / Monitorias 4.14.2** (publicada): **protocolo só em autorização
  e exceção** (migração 35). Processo novo e treinamento não mostram o campo
  e gravam sem protocolo; uma trava no banco (`diario_protocolo_quando_exige`)
  segue exigindo o protocolo em autorização e exceção. Na consulta do
  Monitorias, registro sem protocolo aparece com "—".
- **1.27.0 / Monitorias 4.15.0** (publicada): **dia do ocorrido e validade**
  (migração 36). Gestor e Pleno escolhem o dia do ocorrido (hoje ou antes) e
  podem marcar "Tem validade" com "Vale até" (`valido_ate`). Vencido, o
  registro continua no diário, na consulta e no aviso da monitoria, com o
  selo "Vencido em". Para os demais, o banco grava hoje e sem validade; na
  correção de um devolvido, dia e validade ficam como estavam.
- **1.28.0 / Monitorias 4.15.1** (publicada): **renovar a validade** (migração
  37). Nos 7 dias antes de vencer, o selo fica âmbar ("Vence em N dias") e
  gestor e Pleno veem "Renovar validade" (função `renovar_registro_diario`);
  vencido não se renova. Cada renovação fica em `diario_renovacoes`, e o
  registro mostra a última e a validade original. Filtro "Vencendo" no diário
  e pendência "vencem em até 7 dias" no Início do gestor e do Pleno. O
  registro com dia do ocorrido para trás mostra também quando foi registrado.
  A janela de 7 dias está na migração 37 e em `DIAS_PARA_RENOVAR`
  (lib/diario.ts): mudar nos dois. Conferida pelo gestor no site publicado.
- **1.29.0** (publicada; Monitorias sem mudança): **leitura obrigatória do
  diário** (migração 38). Processo novo e treinamento concluídos que ainda
  valem (validade em dia, ou sem validade e até 30 dias) precisam de "Li e
  estou ciente" de toda pessoa ativa com acesso, menos o gestor e o autor.
  Com leitura pendente, o layout do Performance troca o painel inteiro pela
  tela "Novidades do diário" (`LeituraObrigatoria`) até confirmar tudo —
  vale para endereço direto; checado a cada carregamento. Confirmações em
  `diario_leituras`, sem alterar nem apagar; `leituras_do_diario()` entrega
  tudo a gestor e Pleno. Diário: "Lido por X de Y" com quem leu e quem falta
  e filtro "Leitura pendente"; Início do gestor e do Pleno: "N pessoas com
  leitura pendente"; ficha em Atendentes: pendências e última confirmação.
  Testado com o Teste de acesso nos 3 processos reais da Suyara (confirmações
  de teste apagadas). A migração 39 marca o Teste de acesso como
  `perfil_de_teste`, fora da leitura. Conferida pelo gestor no site publicado.
- **1.30.0** (publicada; Monitorias sem mudança): **avisos no Teams**
  (migração 40). O banco posta cartões (Adaptive Card) em Workflows do Teams
  via pg_net: "Semana encerrada" (canal da equipe) e "Lembrete de fechamento"
  (só o gestor, diário até `fechamentos_cota` ter a competência anterior)
  pela rotina `avisos_das_oito` no pg_cron às 11h UTC (8h de Brasília);
  "Monitorias liberadas" (Pleno e qualidade) pela tela Importar, via
  `aviso_relatorio_importado`, quando entram avaliações novas. Endereços em
  `avisos_teams` (só gestor), colados em Configuração › Avisos no Teams, com
  "Enviar teste" e a resposta HTTP do último envio (`situacao_dos_avisos`,
  lê `net._http_response`, que o Supabase guarda por poucas horas).
  `avisos_enviados` impede repetir a mesma semana ou o mesmo dia. Os links
  dos cartões usam `endereco_do_site()`: se os endereços dos sites mudarem,
  ajustar ali. Workflows criados no Teams e testados pelo gestor no site
  publicado.
- **1.31.0** (publicada): **aviso de mês fechado** (migração 41). Gatilho em
  `fechamentos_cota` posta "Setembro fechado" no endereço do aviso
  "semana_encerrada" (canal da equipe), uma vez por competência, com link
  para o extrato do mês. Textos da tela de avisos com os nomes reais dos
  modelos do Teams ("Enviar alertas de webhook para um canal/chat").
- **1.31.1** (publicada; numerada como correção por decisão do gestor):
  **aviso de novidades do diário** (migração 42). Processo ou treinamento
  concluído (ao registrar ou ao ser aprovado) e que ainda exige leitura vira
  cartão no destino `diario_novidades`, uma vez por registro: resumo de até
  280 caracteres e botão para o painel, onde a leitura é confirmada. Configurado
  e testado pelo gestor no site publicado.
- **1.32.0** (publicada): **abas no diário** (migração 43). "Meus registros
  com a gestão" / "Registros dos atendentes" (`diario_privados`): texto
  livre que só o autor e a gestão (gestor e Pleno) veem; a gestão aprova
  (continua privado) ou devolve com comentário (`decidir_registro_privado`);
  pendência no Início do gestor e do Pleno. "Anotações do gestor"
  (`diario_anotacoes`): só papel gestor lê, cada um edita as próprias, com
  "Sobre" opcional que aparece na ficha da pessoa em Atendentes. Tudo na RLS;
  testado com o Teste de acesso, inclusive leitura direta pela API (vazia) e
  tentativa de gravar anotação (403).
- **1.33.0 / Monitorias 4.16.0** (publicada): **reportar problema**
  (migração 44). Botão no menu dos dois sites (`BotaoReportar`) com texto,
  "o que esperava", print opcional (Ctrl+V ou arquivo, bucket privado
  `reportes`, pasta da pessoa, 5 MB) e tela, versão e navegador automáticos.
  `/reportes` nos dois sites (entrou em `CAMINHOS_COTA`): autor vê os
  próprios e a resposta; gestor vê todos, responde, marca em análise,
  resolve ou reabre. Número no botão: respostas novas (autor, apagado ao
  abrir) ou reports novos (gestor). Pendência no Início do gestor e quinto
  aviso do Teams, "reporte_novo". Testado com o Teste de acesso e o gestor.
  Aviso no Teams configurado e conferido pelo gestor no site publicado.
- **1.34.0** (publicada; Monitorias sem mudança): **importação de vários
  arquivos e notas guardadas** (migração 45). O importador lê vários .xlsx de
  uma vez (no navegador), com linha por arquivo e total; mesma avaliação
  (data + protocolo) entra uma vez, mesmo repetida entre arquivos; arquivo com
  erro sai sem travar os outros; conversa só com o robô ("Sem atendente…" ou
  vazio) é ignorada. Nota de atendente não reconhecido vai para
  `avaliacoes_guardadas` (só gestor, fora da cota). Quadro "Notas guardadas"
  em Importar: atribuir (com opção de gravar o nome em
  `pessoas.nomes_hub_extras`) ou descartar. Salvar o Nome no Hub na ficha
  (`salvar_nome_hub`) atribui sozinho as guardadas com o nome e avisa se
  tocou mês fechado — o fechamento não muda. Agosto não tem avaliações de
  Diretores no banco e não deve ser importado (decisão do gestor).
- **1.35.0 / Monitorias 4.16.1** (publicada): **problema operacional no
  diário** (migração 46). Tipo `problema` com subcategoria obrigatória
  (`diario_subcategorias`, editável em Configuração › Diário de bordo:
  incluir, renomear, reordenar, desativar — sem excluir). Só gestor e Pleno
  registram (RLS), toda a equipe vê; sem protocolo, validade opcional, sem
  leitura obrigatória; avisa no Teams em "Novidades do diário". **Migração
  47** corrige o aviso do diário: registro sem validade e com dia do
  ocorrido antigo passava no filtro (comparação nula no IF) e avisava — um
  cartão de teste saiu no canal da equipe em 02/10.
- **1.35.1** (correção de cálculo, migração 48): quem recebe pela média
  passa a ter **(média + pontuação realizada) × peso** — Pleno, 1,2. No
  extrato, linha `media_sobre_realizado` = realizado × (peso − 1), ao lado
  da média; `media_do_cargo` usa a mesma regra quando um cargo de
  referência também recebe pela média. Tela do Pleno mostra Média +
  Realizado = Soma × 1,2; meses fechados antes mantêm a conta antiga.
  Setembro da Suyara: 8.007,63 → 8.223,63.
- **1.35.2** (correção de cálculo, migração 49): **atestado por dias**. O
  lançamento é em dias (`regras.valor_manual` = false); o desconto é
  (pontuação do mês, antes do atestado ÷ dias do ciclo 26–25) × dias,
  arredondado uma vez só — exemplo 6.500 ÷ 30 × 3 = 650. Calculado em
  `vw_extrato_cota` (CTE `base` sem o atestado + linha do atestado); a média
  dos cargos de referência não leva o atestado. Nenhum atestado lançado até
  então.
- **Migração 50** (só banco, 02/10): a 49 usava CTEs referenciadas duas vezes
  na `vw_extrato_cota`; o Postgres as materializava e cada consulta montava o
  extrato de todos em todos os meses — o "Fechar setembro" deu *statement
  timeout* (nada foi fechado). A view voltou ao formato da 48 (partes unidas,
  filtro chegando a cada uma) e o atestado sai de
  `pontuacao_antes_do_atestado(pessoa, mês)`, chamada só nas linhas de
  atestado. **Cuidado futuro: não usar CTE referenciada mais de uma vez nessa
  view.**
- **1.35.3** (correção da exportação para o portal, `/api/cota/exportar`):
  o portal parava de ler a linha na primeira célula ausente — setembro chegou
  só até "Tempo de resposta acima de 1h00". Agora nenhuma célula fica vazia
  (C-SAT sem avaliação = "-", como o histórico do portal; quantidades = 0), e
  `lib/xlsx-escrever` escreve texto em coluna numérica em vez de omitir.
  Três colunas novas **no fim** (para não deslocar as que o portal lê): TME
  Médio Equipe até 15 / até 30 / acima de 30 min (Huggy), com os
  atendimentos de cada faixa. Semana sem TME lançado não entra em faixa.
  Falta: reenviar setembro ao portal com o arquivo novo.
- **1.35.4** (migração 51): **problema operacional só da gestão** — gestor e
  Pleno registram e veem (RLS `diario_leitura`), sem aviso no Teams; filtro
  "Problemas" só para a gestão. **Error 1102 em 05/10**: o Performance passou
  a estourar o limite de 10 ms de CPU por requisição do plano gratuito do
  Workers (logs: `exceededCpu`, até a tela de login gasta 11 a 360 ms). Na
  1.35.4: `public/favicon.ico` (antes cada página gerava uma segunda chamada
  ao Worker para um 404 de ~50 ms) e o middleware não chama o Supabase quando
  não há cookie de sessão. Isso só reduz: a solução é o **Workers Paid**
  (US$ 5/mês, 30 s de CPU) — decisão do gestor.
- **1.36.0** (só telas, sem migração): **Monitorias no menu do Performance**.
  O item leva a `/cota/monitorias`, que já existia desde a 1.17.0 mas só era
  alcançada pelo Comparativo. Para gestor e qualidade/Pleno a tela abre agora
  na **equipe toda**, com o mesmo resumo da tela inicial das Monitorias — nota
  média do mês, comparação com o mês anterior, zeradas, quantos estão abaixo
  de 85%, a linha mês a mês, o ranking, os critérios de maior impacto e a
  cobertura do ciclo. O nome no ranking abre as monitorias da pessoa, e de lá
  o link "‹ Equipe toda" volta. O seletor do topo escolhe atendente e mês
  (`?pessoa=` e `?mes=`, navegação pura, sem JavaScript). O operador segue
  vendo só as próprias.
- **Monitorias 5.0.0** (só telas, sem migração): **repaginação das Monitorias**
  no visual do Performance, decidida pelo gestor para o site inteiro de uma
  vez. `MenuLateral` passou a servir os dois sistemas (recebe `sistema`, lê
  `ITENS[sistema]`, mostra o contador de exclusões) e o `layout.tsx` deixou de
  ter dois caminhos. O `Cartao` saiu do `ui.tsx`: todas as telas usam `Quadro`,
  e as tabelas dentro dele levam `noQuadro` — por isso `CoberturaDoCiclo` não
  precisa mais do `noPerformance` da 1.36.0. `Indicador` e os esqueletos
  ficaram iguais aos cartões de lá. No menu, acende só o endereço mais
  específico; antes "Monitorias" e "Nova monitoria" acendiam juntas.
  A tela de uma monitoria ganhou os três `Indicador` do topo, e a ficha
  deixou de repetir operador, data e canal. Corrigidos junto: a barra fixa da
  Nova monitoria passava por cima do menu (`lg:left-60`) e a coluna Assunto do
  diário ficava espremida (`min-w-[20rem]`).
  **O 1º número aqui marca a virada de visual, não mudança de cálculo** — a
  regra abaixo reserva o MAJOR para o que obriga a refazer envio, e nenhum
  número de ninguém mudou. Decisão do gestor.
- **Monitorias 5.1.0** (só telas, sem migração): **Nova monitoria por sorteio**,
  a reformulação que ficou pendente da 5.0.0. O protocolo não é mais digitado:
  o monitor escolhe o atendente e a semana, e o painel sorteia um atendimento
  de `avaliacoes` — a tabela que recebe o relatório do Hub, que a qualidade já
  lê pela RLS `ve_o_time()`. Ao escolher o atendente, duas consultas trazem o
  ciclo inteiro (`avaliacoes` entre a 1ª e a 4ª semana da competência aberta, e
  as `monitorias` dela), e a tela agrupa por semana com `semanaDoCiclo`.
  Fora do bolo: protocolo já monitorado e os descartados na sessão (nada é
  gravado; em outra sessão voltam).
  Cada semana mostra seu estado: `cheia` (4 lançadas), `vazia` (nenhum
  atendimento importado), `futura` (ainda não começou — só essa fica
  desabilitada; **a semana em curso é selecionável**, senão não dava para
  avaliar o atendimento do dia) ou o normal. A tela abre na primeira que ainda
  dá para monitorar.
  **Com a semana concluída não há sorteio nem campo manual** — era por ali que
  dava para furar o limite de 4 por semana. O campo manual (protocolo + data)
  só aparece quando a semana ainda cabe monitoria.
  Um critério marcado **Não só conta como respondido com a evidência escrita**
  (`semEvidencia`); só em lançamento novo, para não travar a edição de uma
  monitoria antiga. O relatório de avaliações **não traz TMA**: o importador lê
  data, protocolo, atendente, nota e tabulação, e o tempo segue digitado pelo
  monitor.
  Conferido com 3 monitorias de teste em Ibson Santos, que fecharam a 1ª semana
  e foram excluídas em seguida (ficam em Monitorias › Excluídas).
- **Monitorias 5.2.0** (só telas, sem migração): **o mês pelas setas** no
  Painel, no Ranking mensal e nos Critérios mais reprovados, no lugar do campo
  com o botão "Ver". `SetasDeCompetencia` ganhou `disponiveis?: string[]`: com
  a lista, anda só pelos meses que têm monitoria e apaga a seta na ponta — sem
  ela, segue de mês em mês como na cota, que não mudou.
  **Pegadinha que custou uma rodada:** as setas põem `?mes=2026-09` no endereço
  e as telas das Monitorias comparam com `mes_referencia`, que é `2026-09-01`;
  o mês não trocava e caía no mais recente **em silêncio**. Daí o `mesCompleto`
  em `lib/mes-aberto.ts` — a cota já resolvia isso no `resolverCompetencia`.
  O mês virou `h2` ao lado do título da tela, e o subtítulo passou a trazer o
  volume, que antes repetia o mês.
- **Monitorias 5.3.0 · Performance 1.36.1** (só telas, sem migração):
  **semana atual na Cobertura do ciclo**. `CoberturaDoCiclo` ganhou
  `competencia` (para as datas de cada semana, via `periodoDaSemana`) e
  `comLink`. A semana atual é a primeira não encerrada que já começou; num mês
  passado não há semana atual, nem link. Com `comLink` (só na tela inicial do
  Monitorias) o nome abre `/monitorias/nova?operador=<id>`; a página só repassa
  o id se ele estiver entre os avaliados ativos, e o formulário abre na
  primeira semana com vaga (`semanaPadrao`). No Performance o quadro vem sem
  link.
- **Performance 1.37.0 · Monitorias 5.3.1** (migração 52): **Acessos**. Tabela
  `acessos` com uma linha por pessoa, sistema e dia (primeiro, último,
  aberturas). `RegistrarAcesso`, no layout interno (também na leitura
  obrigatória), chama `registrar_acesso(sistema)` do navegador direto no
  banco, para não gastar CPU do Worker; o layout não remonta ao trocar de
  tela, então cada carregamento conta uma abertura. Só o gestor lê (RLS
  `eh_gestor()`). Tela `/cota/acessos`, só no Performance (Administrar), com
  seletor Performance | Monitorias por `?sistema=`; quem está parado há mais
  de 30 dias vem de `vw_ultimo_acesso` (security_invoker), e quem nunca
  acessou mostra o último login de `ultimo_login_das_pessoas()`. O histórico
  começa em 07/10/2026.

Visão de celular fica fora da revisão, por decisão do gestor. Os painéis são
usados só no computador.

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
