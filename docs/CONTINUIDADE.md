# Continuidade — Painel de Performance

Onde o trabalho parou, o que já vale como regra e o que ficou pendente.
Escrito em 28/09/2026, atualizado em 08/10/2026. Para o modelo de dados completo, ver
[MODELO-PAINEL.md](MODELO-PAINEL.md); para infraestrutura,
[HOSPEDAGEM.md](HOSPEDAGEM.md).

---

## Estado em 08/10/2026

| | |
|---|---|
| Publicado | Performance **2.10.0** · Monitorias **5.7.0** · Agenda **1.7.0** (26/10/2026) |
| Branch | `painel-performance`, com os três sites (a `main` segue intocada) |
| Migrações no banco | 01 a 78, todas aplicadas (a agenda tem banco próprio: 01 a 03) |
| Endereços | `painel-performance.expansao.workers.dev` · `painel-monitorias.expansao.workers.dev` · `painel-agenda.expansao.workers.dev` |

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
  Setembro foi reenviado ao portal com o arquivo novo e fechado.
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
- **Performance 1.37.1** (correção de tela, sem migração): **"Como a média
  foi formada" volta a fechar com a média**, no extrato e na tela do Pleno.
  Em mês fechado, a média vinha do fechamento e os nomes da lista do cálculo
  de hoje: o peso de tratativa do Analista (20 → 15 em 08/10) derrubou o
  Matheus de 12.250 para 8.960 na lista de setembro, e a média seguiu 6.582,65.
  E a média não leva o atestado (migração 49), mas a lista mostrava o
  resultado com ele (Rayssa, 1 dia: 6.533 na média, 6.322 no resultado).
  `lib/resultado-na-media.ts` devolve o valor que cada um levou para a
  média — congelado em mês fechado, sem o atestado — e a lista mostra
  "6.322 com o atestado" embaixo. Nada muda em pontuação nem em pagamento.
- **Performance 1.37.2** (só tela): o quadro "Como a média foi formada" (extrato)
  e a lista da média do Pleno mostram **uma casa decimal fixa** — cartões,
  média e totais (9.873,97 → 9.874,0) —, para a conta fechar à vista.
- **Performance 1.37.3** (só tela): no extrato de quem recebe pela média com
  demanda tratada (Pleno), a conta virou três linhas — Média da equipe
  recebida, Demanda tratada e Cálculo: (média + demanda) × 1,2 = total. Antes
  eram média × 1,2 e realizado × 0,2 em linhas separadas, e o total do
  quadro (7.143,6) não era o resultado dela (8.223,6). Sem demanda, como o
  Gestor, segue média × multiplicador.
  Na mesma versão, "De onde vieram os pontos" de quem recebe pela média mostra
  os valores antes do multiplicador (média recebida e cada demanda) e a conta
  embaixo; saiu a linha "Multiplicador sobre a pontuação realizada". Os
  cartões das semanas só mostram C-SAT e Monitoria para quem é medido por
  eles; os demais veem o que a semana teve (ex.: Atendimento presencial 4×).
  E as tabelas por canal não listam mais faixa de C-SAT ou categoria vazia.
- **Performance 1.38.0** (migração 53): **chamados do Analista importados do
  painel ELO**, no lugar do lançamento manual de tratativas e SLA. Importar
  ganhou abas internas — Avaliações (Hub) e Chamados (ELO). A exportação do
  ELO é lida no navegador (aba "Chamados (N)") e vai para
  `importar_chamados`: protocolo é a chave, chamado novo entra, o que mudou é
  atualizado. Ciclo pela abertura (26 a 25), não pelo corte do ELO. Conta só
  resolvido: com conclusão e não Cancelado (Recusado conta, foi analisado).
  Prazo de 2 dias úteis completos sobre o tempo total: no prazo com tempo
  útil < 3,0 (o ELO conta dia útil de 24 h, sem sábado e domingo). Fora do
  prazo vai para a **fila de atrasos** (Importar → Chamados), com a divisão
  entre o tempo de quem trata (abertura → ClickUp, `tempo_interno`) e o do TI
  (`tempo_ti`), o motivo do ELO e a **justificativa** que quem tratou escreve
  no próprio extrato (`justificar_atraso_chamado`), que chega na hora; a
  gestão decide manter ou retirar o desconto (`decidir_atraso_chamado`), e a
  pendência aparece em "Precisa de você". Os pontos saem das regras de sempre
  (`chamados_tratados`, `chamados_sla_ate_2d`, `chamados_sla_acima_2d`): a
  importação escreve as quantidades em `lancamentos` com `gerado_por =
  chamados_elo` e `recalcular_chamados(mês)` as refaz a cada importação ou
  decisão; mês fechado não muda. A conferência de faixas ignora as geradas.
  O responsável casa com `pessoas.nome_elo` ("Matheus Scariot" = Matheus
  Camargo); outro nome fica para redistribuição. Extrato de quem tem chamados
  ganha a aba **Chamados**: tempo médio total, de quem trata e do TI,
  repasses lentos, por semana, atrasos com justificativa e a lista do mês.
  Tempos em horas (`tempoUtil`: 0,30 → 7h12; 3,43 → 3 dias úteis e 10h).
  **Migração 54**: a importação é em três passos, como a do Hub — escolher,
  conferir (`conferir_chamados`, que compara com o banco sem gravar: novos,
  mudados, sem mudança, e na cota resolvidos, no prazo, fora do prazo, em
  aberto, cancelados, de mês fechado, responsável fora) e só então Importar.
- **Performance 1.38.1** (correção): no acesso do Analista, o clique na aba
  Chamados do extrato não completava (o servidor respondia 200, a tela não
  trocava); pelo endereço direto abria. As abas internas de Extrato e Importar
  passaram a ser `<a>` (página inteira) em vez de `Link`. Não reproduziu com o
  acesso de gestor — se voltar a acontecer com outro `Link`, é o mesmo caso.
- **Performance 1.38.2** (migração 55): **chamados lidos direto pela cota, como
  o Hub.** Na 53 a importação gravava as quantidades em `lancamentos`, que
  apareciam na tela de Lançamentos e podiam ser editadas por engano. Agora
  `vw_extrato_quantidades` lê `chamados_elo` (a partir de outubro/2026; o
  corpo é o da 29, mais a parte dos chamados), as linhas geradas foram
  apagadas e `recalcular_chamados` não grava mais. Mesmos números: outubro
  do Analista segue 232 tratativas e 230 no prazo. As regras de SLA viram
  "Resolvidos no prazo (2 dias úteis)" e "Resolvidos fora do prazo". HOSPEDAGEM e MODELO-PAINEL
  atualizados para a 1.38.2.
- **Performance 1.39.0** (migração 56): **histórico de alteração de pesos.**
  Gatilho em `pesos_por_cargo` registra em `pesos_historico` toda mudança de
  peso, meta, multiplicador da média e métrica ligada/desligada — quem,
  quando, de quanto para quanto, para qual mês (`vale_para`) e o motivo. O
  motivo vem da tela na mesma gravação (`motivo_alteracao`), e o gatilho o
  limpa depois de registrar. Obrigatório na matriz e no editor do cargo
  quando muda meta ou média; cargo novo grava "Cargo criado copiando os
  pesos de X". Só o gestor lê, em Configuração → Histórico de alterações.
  **Sem aviso no extrato**, por decisão do gestor: o ajuste é explicado no
  feedback de cada um. As mudanças de 09/10 (Analista: tratativa 20 → 15,
  no prazo 5 → 3) são anteriores ao registro.
  **Migração 57**: a tela grava com upsert, e o BEFORE INSERT da 56 disparava
  mesmo quando virava update (uma "criação" falsa e o motivo perdido). Agora
  são dois gatilhos: BEFORE UPDATE (registra com o motivo e limpa a coluna) e
  AFTER INSERT (só criação de verdade). As linhas do teste de 09/10 saíram.
- **Performance 1.39.2 · Monitorias 5.3.4** (correção, sem migração): **a sessão
  não cai mais com o erro 1102.** Teste de 13/10 com perfil de operador: o 1102
  vem e vai (telas de 300 ms passam, o login com 11 ms foi barrado), e um corte
  durante a renovação do login no middleware deixava a pessoa deslogada — o
  passe novo se perdia e o antigo já estava invalidado. Agora o middleware não
  chama o Supabase: lê só a validade do cookie (`lib/sessao-cookie.ts`, que
  junta os pedaços `.0/.1` e decodifica o "base64-"); vencido ou a 60 s de
  vencer, manda para `/auth/renovar`, que renova no navegador (`getSession`) e
  volta ao destino. `ManterSessao` no layout liga a renovação automática do
  cliente do navegador. O atalho "login com sessão vai para o início" saiu do
  middleware (sem o Supabase, causaria laço com sessão encerrada), e
  `exigirPerfil` separa "sessão encerrada" de "perfil ausente". Testado no
  local: passe vencido renova e volta à tela com os parâmetros; passe recusado
  vai ao login com a mensagem certa, sem laço. **O 1102 continua** — o plano
  gratuito segue no limite —, mas não derruba mais a sessão.
- **Performance 1.39.3 · Monitorias 5.3.5** (leveza, sem migração): as
  consultas do layout (exclusões pendentes, avisos de reporte, leitura do
  diário) rodam em paralelo com `Promise.all`; Smart Placement ligado no
  `wrangler.jsonc` (`placement.mode = smart`, herdado pelo env performance);
  `optimizePackageImports: ['recharts']` no `next.config.mjs`. Medição antes,
  logado no Performance (fetch da página inteira, média de 4): Painel ~1,7 s,
  Extrato ~1,4 s, aba Chamados ~1,2 s, saúde ~0,4 s. Próxima etapa, se valer:
  revisar consultas repetidas do extrato e da importação.
- **Performance 1.39.4 · Monitorias 5.3.6** (leveza, 2ª etapa, sem migração):
  Extrato em três rodadas de consultas (eram nove): perfil ∥ competência;
  depois tudo da pessoa junto, com os pesos de todos os cargos e
  `cargos_referencia` inteiros (tabelas pequenas) para não esperar o cargo;
  por fim congelado ∥ lista da média ∥ ajustes da média.
  `lib/resultado-na-media.ts` ganhou `ajustesDaMedia` (vai ao banco, não
  depende dos resultados) e `aplicarNaMedia`. `PainelPleno` no mesmo
  esquema. Início: perfil ∥ competência; o selo do gestor virou componente
  próprio (`SeloDoGestor`), que busca em paralelo com o painel; o caminho do
  Pleno busca cargo, média e `aprova_diario` juntos. Conferência: 41 telas
  (Início em 3 meses; Extrato de 12 pessoas × ago/set/out) e o PainelPleno da
  Suyara × 3 meses, idênticos ao código anterior.
  **O que a medição mostrou** (tempo de cada consulta, servidor local): o
  limite agora é o banco. `vw_cota_mensal` de todos leva ~2 s, a de uma
  pessoa ~0,6 s, `vw_extrato_cota` de uma pessoa ~0,6–1 s, `vw_sem_cargo`
  ~0,9 s; consultas pesadas em paralelo disputam a CPU do banco e ficam mais
  lentas cada uma. A lista da média é filtrada por cargo no código (com
  `in('cargo', …)` chegou a ~6,5 s junto de outra consulta pesada). Próximo
  ganho grande só no SQL do cálculo (com conferência antes/depois).
  Medido no site publicado com o gestor: Extrato de um Júnior ~0,9 s, Início
  ~2,5 s, Extrato próprio de outubro ~3,2 s, de setembro ~4 s; operador ~0,4 s.
- **Performance 1.39.5 · Monitorias 5.3.7** (leveza, sem migração): **mês
  fechado não recalcula.** O Extrato buscava `vw_extrato_cota` e
  `vw_cota_mensal` ao vivo também em mês fechado, só para o cargo, o nome e
  quem compõe a média — os valores já vinham do congelado. Agora a 1ª rodada
  é só de tabelas leves (o cargo vem de `cargos_da_pessoa`, mesma regra de
  `cargo_na_competencia`); a 2ª depende do mês: fechado lê
  `fechamento_linhas` e `equipeCongelada` (`lib/resultado-na-media.ts`);
  aberto segue no cálculo ao vivo. `equipeCongelada` reproduz a lista da
  view: resultado do fechamento, cargo do cadastro na competência (não o texto
  do fechamento — agosto traz o Matheus como Analista), nome atual,
  `mes_inteiro_na_operacao` em código e só quem tem pontos do mês
  (`vw_extrato_direto`, ~0,4 s) — sem isso o Matheus entrava na lista de
  agosto, mês importado da planilha externa em que ele não tem pontos no
  sistema; o gestor decidiu manter como era. Conferência: os 24 extratos de
  ago/set (12 pessoas) idênticos. Setembro do gestor: ~4 s → ~1 s (local).
  No site publicado: agosto ~1,3 s, setembro ~1,5 s — mas outubro (aberto)
  piorou de ~3,2 s para ~4 s: o extrato ao vivo passou a esperar o
  fechamento e as quatro consultas pesadas saíam juntas na 2ª rodada,
  disputando o banco.
- **Performance 1.39.6 · Monitorias 5.3.8** (correção, sem migração): no mês
  corrente (`competencia === atual`, nunca fechado) o extrato ao vivo da
  pessoa sai já na 1ª rodada, como na 1.39.4; nos outros meses, só depois de
  saber se fechou. Conferido: os 12 extratos de outubro e amostra de
  setembro idênticos.
- **Performance 1.40.0 · Monitorias 5.4.0** (**migração 58**): **resumo do
  mês aberto.** Tabelas `resumo_extrato`, `resumo_cota_mensal` e
  `resumo_sem_cargo`, criadas a partir das views (`create table … as select
  * from vw_… with no data`: mesmas colunas e tipos). Gatilhos por comando
  (`resumo_mudou`) em volume_semanal, avaliacoes, monitorias, lancamentos,
  atendimentos_presenciais, chamados_elo, regras, pesos_por_cargo, cargos,
  cargos_da_pessoa, cargos_referencia e pessoas só inserem uma linha em
  `resumo_mudancas` — nada trava. `atualizar_resumo()` (pg_cron
  `resumo-do-mes`, a cada minuto; uma rodada por vez, por advisory lock)
  apaga as mudanças que vê e recalcula os meses mantidos (competência atual e
  anterior) se houve mudança, se nunca calculou ou se passou de 30 min.
  `situacao_do_resumo()` diz às telas quando cada mês foi calculado e se há
  mudança pendente; `conferir_resumo()` compara com as views linha a linha.
  No app: `lib/resumo.ts` (`fonteDoMes`: resumo se o mês está nele e foi
  calculado há < 40 min; senão as views) usado no Extrato, PainelGestor,
  PainelPleno, PainelAtendente, Comparativo e em `ajustesDaMedia`;
  `componentes/CarimboDoResumo.tsx` ("Atualizado às", "Atualizando…",
  consulta a cada 15 s com pendência e 60 s sem, `router.refresh()` e realce
  dos números que mudaram). Fechamento e exportação seguem nas views.
  Conferência de 13/10: `conferir_resumo()` zero em tudo (set e out ×
  extrato, resultado, sem cargo); 38 telas idênticas ao código anterior,
  mais Início (set, out) e Comparativo comparados com o código publicado no
  mesmo banco, idênticos. Local: Extrato de out do gestor ~3,2 s → ~0,5 s;
  dos demais 0,4–0,9 s; Início ~1 s.
  **Atenção em migração futura:** se mudar as colunas de `vw_extrato_cota`,
  `vw_cota_mensal` ou `vw_sem_cargo`, recrie a tabela de resumo
  correspondente (o `insert … select *` depende das mesmas colunas), e se o
  cálculo passar a ler uma tabela nova, ponha nela o gatilho `resumo_mudou`.
- **Performance 1.41.0 · Monitorias 5.5.0** (sem migração): tela Presencial
  pega o cargo em `cargos_da_pessoa` (na competência) e os pesos do
  presencial numa consulta só — antes lia `vw_extrato_cota` sem filtro de mês.
  HOSPEDAGEM e o documento da TI (Claude Docs) atualizados: versões,
  migrações 01–58, pg_cron também para o resumo e o passo de recriar as
  tarefas agendadas depois da cópia do banco (o esquema `cron` não vai junto).
  E os gráficos semanais do Início (C-SAT, Volume, TME; PainelGestor e
  PainelAtendente) ganham `comparacao` no `GraficoDeLinha`: o mês anterior
  em cinza, sem valores escritos (`<title>` no ponto) e legenda "Outubro /
  Setembro". Os dados do mês anterior já vinham (usados no "vs setembro"):
  nenhuma consulta nova.
- **Performance 1.41.1 · Monitorias 5.5.1** (correções, sem migração), da
  bateria de testes de 14/10: 24 endereços sem login no publicado; 97
  variações de tela com o gestor (parâmetros válidos e inválidos); carga de 8
  acessos simultâneos × 3 rodadas (tudo certo, com o resumo do mês). Achados e
  correções: (1) redirecionamento aberto no login e em /auth/renovar →
  `lib/destino.ts` (`destinoInterno`: interpreta como o navegador e só aceita
  a mesma origem; testado contra //, /, \, /	/, javascript:); (2) 119
  consultas liam só `data` — falha do banco virava "vazio" → `lib/consultas.ts`
  (`todas` = Promise.all que confere, `conferida`, `dados`) nas telas de
  números; permissão negada (42501) segue como antes, para não quebrar a tela
  do atendente; o Extrato valida o id da pessoa antes de consultar
  (`?pessoa=lixo` volta ao próprio extrato); (3) `app/error.tsx`: "Tentar de
  novo" = `router.refresh()` + `reset()`; (4) middleware leva a query ao
  `proximo` do login; (5) `mesValido` (`lib/formatar.ts`, 01–12, 2000–2099)
  em competencia, mes-aberto, presencial, lançamentos, importar e exportação;
  (6) `/api/exportar` responde 400 para mês inválido e aceita AAAA-MM.
  Atenção para quem testar: a tela de erro é desenhada no navegador — no HTML
  da resposta o sinal é o texto "O banco não respondeu" no payload.
- **Performance 1.42.0 · Monitorias 5.5.2** (sem migração; primeira versão
  pela regra unificada de 14/10, topo do CHANGELOG): Comparativo a partir de
  `PRIMEIRO_MES = '2026-08-01'` (decisão do gestor) e só calcula ao vivo o mês
  aberto fora do resumo que tem algum dado de origem (volume, C-SAT,
  monitoria, lançamento, presencial, chamado); perfil ∥ competência ∥
  situação do resumo. Conteúdo conferido igual ao anterior (3/6/12 meses)
  antes do corte de agosto. `app/error.tsx` aponta o Reportar problema.
  A proteção de `lib/consultas.ts` chegou ao Fechamento (`todas`) e aos
  Relatórios das Monitorias (ranking, critérios e feedback, com `conferida`;
  em critérios o import é só `conferida`, porque a tela tem uma variável
  `todas`). Varredura: 31 telas do Performance e 24 das Monitorias, sem sinal.
  **Varredura antes de publicar:** `scripts/varredura-navegador.js` — colar
  no console de uma aba logada como gestor (local ou publicado); abre todas
  as telas do sistema da aba, com parâmetros válidos e inválidos, e lista
  FALHA-BANCO, ERRO-SERVIDOR, HTTP, TEXTO-SUSPEITO, 1102 e LENTA. Primeira
  rodada: 31 telas do Performance, nenhum sinal.
- **Agenda da Gestão 1.0.0** (migração 59 no banco dos painéis; banco próprio
  em `supabase/agenda/`): terceiro site, `painel-agenda.expansao.workers.dev`,
  publicado em 14/10 a partir do worktree `sistema-monitorias-agenda` e
  depois juntado a `painel-performance`. Tudo em [AGENDA.md](AGENDA.md).
  Variáveis próprias no `.env.local`: `NEXT_PUBLIC_AGENDA_*`, `VAPID_*`,
  `AGENDA_SEGREDO`, `PONTE_SEGREDO` — não gerar de novo. `cf:deploy` publica
  os três sites; `cf:deploy:agenda` só a agenda.
- **Agenda 1.1.0 — avisos pelo Telegram** (ainda não publicada;
  `supabase/agenda/02-telegram.sql`): o aparelho do gestor bloqueia
  notificação do navegador, então os avisos também saem por um bot.
  `agenda_destinos` junta aparelhos e conversa; `agenda_disparar` e
  `agenda_testar` foram redefinidas no 02 para usar isso. Webhook em
  `/api/agenda/telegram` (fora do middleware), com a senha
  `seloDoItem('telegram', AGENDA_SEGREDO)`. Segredo novo só o
  `TELEGRAM_TOKEN`. Passos em [AGENDA.md](AGENDA.md#avisos-pelo-telegram-110).
  Publicada em 14/10 com 1.2.0 (Brave no Windows: push do Google desligado
  por padrão), 1.2.1 (chaves) e 1.2.2 (código do Telegram para colar no bot).
- **Performance 1.43.0 · Agenda 1.3.0** (migração 60 nos painéis;
  `supabase/agenda/03-lembrete-do-ciclo.sql` na agenda): semana encerrada sem
  chamados importados vira pendência (`chamados_por_semana_interno`, mesma
  regra de "encerrada" das semanas sem volume) — no Precisa de você, fora do
  `todas` para não quebrar a tela antes da migração — e Importar → Chamados
  ganha o quadro "Chamados por semana" com **Sem chamados**
  (`semanas_sem_chamados`). Na agenda, `agenda_disparar_ciclo` chama o site
  na hora do resumo; o site manda "Relatórios do ciclo para subir" só se a
  ponte tiver `sem_volume:` ou `sem_chamados:`.
- **Performance 1.49.0** (**migração 66**): (1) `MatrizDePesos` ganha
  `CopiarDoCargoBase` — com o editor de um cargo aberto (não o
  `CARGO_BASE`), copia para a matriz os pesos do Júnior nos grupos marcados
  (`grupoDa`); vira alteração pendente, salva pelo mesmo upsert com motivo
  (histórico da migração 56). (2) Métricas da semana: tabela
  `metricas_desligadas` (mês, semana, canal, motivo, `tem_registro_diario`,
  `diario_registro_id`), leitura só do gestor; `desligar_metrica` /
  `religar_metrica` (gestor, recusam mês com fechamento);
  `metrica_desligada()` (security definer) usada no trecho do TME de
  `vw_extrato_quantidades` — recriada com o texto exato da 55 mais o
  filtro; `semanas_sem_tme()` para o Extrato marcar a semana sem o motivo;
  gatilho `resumo_mudou` na tabela. Conferência da migração: view idêntica
  antes/depois (0/0). Teste real de 16/10 (autorizado): TME da 1ª semana de
  outubro da Expansão desligado e religado — o Extrato do Pedro Lucas foi de
  2.060 a 2.102 (+42, a faixa −1 × 42 atendimentos), com o aviso, e voltou a
  2.060; o resumo acompanhou nas duas vezes. Tela: `/cota/metricas`
  (`PainelMetricasDaSemana`).
- **Performance 1.50.0 · Monitorias 5.6.0** (**migração 67**): tabela
  `diario_visibilidade` (tipo, quem: todos | gestao | gestor, `autor_ve`),
  mudada pela tela via `definir_visibilidade_diario` (só gestor).
  `pessoa_ve_diario(pessoa, tipo, autor)` — "gestão" igual a
  `aprova_diario()` (gestor ou cargo Pleno hoje), calculada para qualquer
  pessoa — é a regra de `diario_leitura` (substitui a da 51) e filtra
  `leituras_do_diario` (a da 39); `aviso_diario_novo` (a da 51) só avisa
  tipo visível a todos. Tela: `QuemVeODiario` na aba Diário de bordo da
  Configuração; `DiarioDeBordo` recebe `tiposDaEquipe` para os filtros.
  Conferido: configuração inicial e contagem por tipo (6 processos, 3
  autorizações, 3 exceções, 2 problemas); telas do gestor sem falha.
- **Performance 1.51.0 · Monitorias 5.6.1** (**migração 68**):
  `criar_acesso(pessoa, email, papel)` — security definer, só gestor, no
  modelo de `redefinir_senha` (32): grava e-mail e papel na pessoa, insere em
  `auth.users` + `auth.identities` com senha temporária (alfabeto sem
  0/O/1/l/I) ou, havendo conta com o e-mail, só vincula e troca a senha;
  `senha_definida = false`; registro em `acessos_criados`. O gatilho
  `tratar_novo_usuario` (11) também liga pelo e-mail. `salvar_nome_elo`
  grava `nome_elo` (índice único) e passa para a pessoa os chamados de mês
  aberto sem dono com esse responsável. Ficha (`PainelAtendentes`): seções
  "Nome no ELO" e "Acesso" (sem login), pendência "sem acesso ao painel".
  **Teste de 16/10**: pessoa de teste criada pelo gestor, acesso criado pelo
  botão, login com a senha temporária pediu a troca; depois apagadas pessoa e
  conta. Os scripts `acesso`/`vincular` continuam no repositório, mas não
  são mais o caminho. Observação: o navegador embutido do Claude não mostra
  `confirm()` (responde "cancelar"); botões com confirmação se testam no
  navegador normal.
- **Performance 1.51.1 · Monitorias 5.6.2** (sem migração): `lib/erro-amigavel.ts`
  (`mensagemDoErro`): recusa do banco (42501, PGRST301/303, RLS, JWT) →
  pergunta quem está logado (`getUser` + `papel_atual`); sem conta válida, avisa
  e manda a `/login?erro=sessao-encerrada` em 2,5 s; com conta, "Você não tem
  permissão". As 45 telas que faziam `setErro(error.message)` passaram a usá-la
  (28 componentes), menos o `FormularioItem` da Agenda, que tem banco e
  login próprios. Teste do gestor (16/10): conta apagada com a tela aberta foi
  barrada pela RLS ao confirmar a leitura obrigatória; ao recarregar, vai ao
  login.
- **Performance 1.52.0** (migração 69): `lib/planilha-mes-anterior.ts` lê o
  "Dashboard Expansão" no navegador (abas por pessoa com "Tiragem semanal",
  "Volume de atendimentos e TME", "Atendimentos e Avaliações"); o ciclo sai do
  período da última semana e o ano das datas. `importar_mes_anterior(p jsonb)`
  (gestor, security definer) grava avaliacoes, volume_semanal e
  fechamentos_cota/fechamento_linhas com `importacao_id` (cascata para o
  `desfazer_importacao_mes`); recusa mês ≥ primeiro fechamento do sistema
  (agosto/2026), mês já importado, fechado ou com volume. Linhas do extrato com
  regra `planilha_*`. Pessoa sem cadastro → `pessoas` inativa com
  `criada_pela_importacao`. O aviso "mês fechado" do Teams ignora fechamento
  importado. Comparativo: início = mês importado mais antigo. Junho e julho
  importados em 19/10 (Emanuelly Vieira cadastrada como histórico; Clara =
  Luciana Freire pelo e-mail). Pendente, se o gestor quiser: o volume de
  agosto, que nunca entrou (o backup de agosto o tem).
- **Performance 1.53.0** (sem migração): `/cota/simulacao` (gestor) carrega o
  extrato do mês aberto (resumo ou view, em páginas de 1.000) e o
  `lib/simulacao.ts` refaz no navegador: semanas tiradas, TME
  invertido (semana desligada em Métricas volta pela faixa do TME da equipe ×
  finalizados), faixas de C-SAT reescolhidas pelo C-SAT da semana, presenciais,
  pesos (linha de valor digitado fica como está) e as derivadas (multiplicador
  sobre o realizado; atestado e média da equipe em proporção). Cenário vazio
  bate com o resultado de hoje (conferido em outubro: 11 pessoas, 39.903 pts).
- **Performance 1.54.0** (migração 70): `importacoes_mes.tipo` ('completo' |
  'volume') e `importar_volume_mes(p jsonb)` — só mês fechado pelo sistema e
  sem nenhum volume; grava só `volume_semanal`. A tela recebe `semVolume`
  (meses fechados sem volume) e entra no modo "Só o volume". Agosto/2026
  importado em 19/10 do `Backup_Metas_08-2026.xlsm` (o `09_2026` é versão
  anterior: aba da Clara copiada da Allana e C-SAT semanal repetido no Resumo).
- **Performance 2.0.0** (migração 71): `cargos.recebe_cota`;
  `cargo_na_competencia` devolve nulo para cargo sem cota (todo o cálculo
  depende dela); `vw_sem_cargo` passa a olhar se há cargo nenhum. Cargo
  "Diretora" (sem cota) e a Luciana nele desde 06/2026; os fechamentos dela
  (06 e 07/2026, os únicos que existiam) retirados com registro em
  `fechamento_alteracoes` (campo 'retirada'). `vw_lancamentos_pendentes`,
  `mover_volume` (soma na mesma semana/canal, tempos ponderados),
  `mover_lancamento`, `resolver_pendente` ('manter' marca `sem_cota_ok`,
  'apagar'), tudo em `realocacoes`. Simulação: `tmeMinimos`, `pesosTodos` e a
  projeção sobre `semanasLancadas` (semanas com volume).
- **Performance 2.1.0** (migração 72): `lib/colar-do-hub.ts` (texto copiado do
  Hub, um valor por linha; resolvidos → finalizados, TME útil → TME) no
  `VolumeSemanal`; nome não reconhecido ligado à mão vai para
  `salvar_nome_hub(p_extra)`. `ProjecaoDaCota` (cliente) +
  `lib/base-do-mes.ts`: projeção pela `simular` sem cenário, semanas lançadas
  pelo `vw_tme_equipe`; o multiplicador da média sai da própria linha.
  `conferencias_calculo`, `conferir_calculo()` (resumo × view — pula se há
  mudança na fila, porque a API barra o delete sem where do
  `atualizar_resumo`; fechamentos ≥ 09/2026 sem ajuste manual; sem cargo +
  pendentes), `registrar_conferencia()` e pg_cron `conferencia-do-calculo`
  (09:00 UTC). Tela `/cota/conferencia`. Transferidos/fila: colunas
  removidas e as três funções que gravavam refeitas.
- **Performance 2.2.0** (migração 73): `valores_rh` (pessoa × mês, só quem
  fechou e bateu a meta) e `salvar_valores_rh(p_mes, p_valores, p_motivo)`,
  com `valores_rh_alteracoes`. `PagamentoDoMes` virou componente de cliente
  com a coluna; o extrato mostra o valor do RH quando existe.
- **Performance 2.3.0** (migração 74): `avisos_da_pessoa` (chave única por
  aviso), gatilhos `aviso_semana_lancada` (volume_semanal, mês aberto, sem
  importação) e `aviso_valor_do_mes` (valores_rh), `marcar_avisos_lidos()`;
  `SinoDeAvisos` no `MenuLateral` (só no Performance), lido no navegador.
  Aviso no canto da tela (Web Push, como a Agenda) ficou como opção futura.
- **Build (21/10/2026):** o OpenNext passou a recusar o Next.js 15 (mais de 2
  anos desde o lançamento). Os scripts `cf:*` usam
  `--dangerouslyUseUnsupportedNextVersion` por decisão do gestor, para publicar
  a 2.1.0 sem esperar. **Resolvido na 2.2.1 / 5.6.3 / 1.5.1:** Next.js 16.4.2,
  OpenNext 1.20.13, wrangler 4.151, sem a opção. Pendente: renomear
  `middleware.ts` para `proxy.ts` (muda o runtime na Cloudflare; testar à parte).

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

Resolvidos ou decididos pelo gestor em 08/10/2026 — não voltar a cobrar:
senhas padrão trocadas; monitor do Performance criado no Better Stack;
setembro reimportado, reenviado ao portal e fechado; Workers Paid só depois
da migração para os servidores internos; Protocolos_Detalhado segue o padrão
já estabelecido; a importação do Hub acompanha a semana (semana em andamento
não tem o que importar); origem do fechamento descartada (só agosto foi
importado).

**Trabalho em aberto**

- **documento de apresentação**: ainda na 1.4.0. MODELO-PAINEL e HOSPEDAGEM
  foram atualizados em 08/10/2026 (Performance 1.37.0, Monitorias 5.3.1), com
  o limite de 10 ms confirmado pelo Error 1102 de 05/10;
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
