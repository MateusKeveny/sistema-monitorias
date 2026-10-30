# Histórico de versões

Numeração em três partes: **crítico . atualização . correção**. A regra vale
igual para os dois sistemas — Monitorias (este arquivo) e Performance (a cota,
`VERSAO_COTA` em `lib/versoes.ts`) — e é esta; `lib/versoes.ts` aponta para cá.

- **1º número — crítico**: falha de segurança que **expunha dados** a quem não
  devia vê-los (ex.: 2.0.0, operador via monitorias de outro); ou mudança que
  reescreve dados já existentes, ou regra de cálculo que altera competência já
  calculada — o que foi reportado ou enviado antes deixa de valer.
- **2º número — atualização**: funcionalidade nova ou mudança de comportamento
  que quem usa percebe (tela, informação ou regra nova).
- **3º número — correção**: conserto ou ajuste sem mudança de comportamento
  esperado, incluindo brecha de segurança **sem vazamento de dados** (ex.:
  5.5.1, redirecionamento para fora depois do login) e ganho de desempenho.

**Suba só o sistema que mudou.** Os dois vivem no mesmo código e são
publicados juntos, mas mudança só no Performance não muda a versão das
Monitorias, e vice-versa. Mudança no que é dos dois (login, sessão, menu,
diário, tela de erro) sobe os dois. Cada entrada abaixo diz de qual sistema é.

**Commit e tag antes do deploy**: `vX.Y.Z` para as Monitorias, `cota-vX.Y.Z`
para o Performance.

> **Nota de 14/10/2026 — desvio de 5.3.6 a 5.5.0.** Entre 13 e 14/10 a versão
> das Monitorias subiu junto com publicações que só mudaram o Performance
> (5.3.6, 5.3.7, 5.3.8, 5.4.0 e 5.5.0): nessas versões **nada mudou nas
> Monitorias**, e as entradas abaixo descrevem o Performance. Ficam como estão
> — estão no ar, com tag e citadas na documentação da TI —, e a regra acima
> passa a valer daqui em diante. Revisão do mesmo dia, também sem renumerar:
> 5.3.2 (folha de feedback com falha crítica e observações) seria
> atualização, não correção; 4.5.0 (queda pelo erro 1102) seria correção; e
> 4.14.1, 4.14.2, 4.15.1 e 4.16.1 (comportamento do diário, que as Monitorias
> também mostram) seriam atualização.

---

## Agenda da Gestão 1.8.1

Sem migração. Não muda as Monitorias nem o Performance.

- **Agenda (correção): /reagendar mais tolerante.** "/reagendar escola de
  líderes de ontem para hoje 15h" não achava o lembrete por causa de "de
  ontem"; palavras como ontem, hoje, evento e lembrete ficam fora da busca.
  Sem "para" ("/reagendar escola de líderes amanhã 14h"), o bot separa o nome
  da data sozinho. Sem achar nada, lista os lembretes em aberto.
- **Agenda (correção): repetição reagendada só nesta vez** não mostra mais
  "16:00–16:00": o fim é da série, e a ocorrência movida fica com o novo
  início.

## Agenda da Gestão 1.8.0

`supabase/agenda/07-reagendar-pelo-telegram.sql` (banco da agenda). Não muda
as Monitorias nem o Performance.

- **Agenda (atualização): reagendar pelo Telegram.** Os avisos ganham
  **🗓 Reagendar** (o bot pergunta para quando); responder a um aviso com a
  nova data ("amanhã 10h", "sexta das 14h às 15h") também reagenda; e
  `/reagendar <nome> para <quando>` acha o lembrete pelo nome — com vários,
  mostra botões para escolher. Sem hora na frase, mantém a hora; com duração,
  o fim anda junto. No que se repete, muda só esta vez.
- **Agenda (atualização): Reagendar na notificação do computador.** Os botões
  passam a ser **Concluir** e **Reagendar** (o navegador do computador mostra
  só dois); Reagendar abre a agenda com o lembrete no formulário. Onde cabem
  três (Android), vai também o Adiar 15 min.

## Performance 2.11.4

Sem migração. Não muda as Monitorias nem a Agenda.

- **Performance (correção): nome das regras do iGreen Mob na lista de
  lançamentos.** Em Lançamentos, as linhas de C-SAT e de notas do iGreen Mob
  apareciam com a chave interna (`outro_setor_igreen_mob__nota_5`); agora
  aparecem com o nome ("Nota 5 · iGreen Mob").

## Performance 2.11.3

Sem migração. Não muda as Monitorias nem a Agenda.

- **Performance (correção): o C-SAT do iGreen Mob no extrato.** O quadro do
  iGreen Mob não mostrava o percentual de C-SAT. Agora aparece no cartão da
  semana (ao lado de Exp e Dir), no detalhe da semana e no resumo do mês, com
  a linha "C-SAT no mês" e as semanas marcadas em cada faixa, como nos
  canais. O percentual sai das notas de 1 a 5 do próprio extrato (4 e 5 sobre
  o total), a mesma conta do cálculo.

## Agenda da Gestão 1.7.0

`supabase/agenda/06-itens-do-resumo.sql` (banco da agenda). Não muda as
Monitorias nem o Performance.

- **Agenda (atualização): resumo do dia por extenso no Telegram.** Em vez de
  "3 para hoje · 1 atrasado", o resumo lista o que está agendado hoje (com
  horário ou "dia inteiro"), os atrasados (desde quando), as pendências do
  sistema e os avisos de férias. A notificação do celular segue curta.

## Agenda da Gestão 1.6.0

`supabase/agenda/05-horario-de-termino.sql` (banco da agenda) e migração 78
(banco dos painéis). Não muda as Monitorias nem o Performance.

- **Agenda (atualização): começo e fim.** "das 14h00 às 16h00", "das 9 às
  11", "14:00 - 15:30", "de 14h até 16h" e "entre 10 e 11h" viram compromisso
  das 14:00 às 16:00 — antes ficava só um dos horários e o resto ia para o
  título. O formulário ganha **Até**, a lista mostra "14:00–16:00" e o aviso
  diz "Das 14:00 às 16:00".
- **Agenda (atualização): excluir pelo menu.** O menu ⋯ de cada linha tem
  **Excluir**; no que se repete, **Excluir repetição** apaga a série toda.
- **Agenda (correção): valor por ponto preso.** A ponte seguia a regra antiga
  e cobrava o valor por ponto de mês que já tem o valor do RH; agora segue a
  do painel (2.3.1).

## Performance 2.11.2

Sem migração. Não muda as Monitorias nem a Agenda.

- **Performance (correção): a tela do iGreen Mob igual às outras.** Em
  Lançamentos, o iGreen Mob vira aba (ao lado de Expansão e
  Diretores-Expansão), com os mesmos cartões por semana — resolvidos, pessoas
  e avaliações importadas — e, ao abrir a semana, só o volume salvo e a área
  de colar. Salvar já recalcula os pontos (sai o "Calcular pontos"
  separado). O quadro explicativo sai das abas Expansão e Diretores.

## Performance 2.11.1

Sem migração. Não muda as Monitorias nem a Agenda.

- **Performance (correção): atalho "iGreen Mob" em Lançamentos.** Ao lado de
  Expansão e Diretores-Expansão, um botão por setor do bypass (2.11.0) que
  leva direto ao quadro dele — só no mês em que houve atendimento de outro
  setor.

## Performance 2.11.0

Migrações 80 e 81 (banco dos painéis). Não muda as Monitorias nem a Agenda.

- **Performance (atualização): bypass de outubro para outro setor com as
  regras da Expansão.** PROVISÓRIO, até a árvore de setores (plano da 3.0).
  Em Lançamentos, "Outro setor com as regras da Expansão": cola-se a tabela
  de analistas do Hub filtrada no setor (o iGreen Mob), por semana — só os
  atendentes da equipe entram; quem é da equipe do setor ou não tem cota
  aparece identificado e é ignorado — e "Calcular pontos" lança, com os
  pesos da Expansão copiados cargo a cargo: atendimento (resolvidos × peso),
  a faixa de C-SAT da semana (calculada só com as avaliações do setor) e as
  notas de 1 a 5. Calcular de novo substitui. Não muda o cálculo da cota:
  tudo entra como lançamento. Decisão do gestor, 26/10/2026.
- **Performance (atualização): outro setor em quadro próprio no extrato.**
  No resumo do mês e nos cartões de semana, "iGreen Mob · regras da Expansão",
  separado dos finalizados da Expansão.
- **Performance (correção): demanda extra pendente.** Sai a opção que contava
  as linhas do relatório de C-SAT como volume (o volume vem dos resolvidos do
  Hub); os lançamentos feitos por ela em outubro foram desfeitos.

## Performance 2.10.0

Sem migração. Não muda as Monitorias nem a Agenda.

- **Performance (atualização): "Meu C-SAT" no menu.** Uma tela para cada
  atendente ver as próprias avaliações do Hub — as mesmas do cálculo do C-SAT
  — separadas de 1 a 5, com o total, as positivas (4 e 5) e as abaixo de 4.
  As notas 1 a 3 vêm em lista, com data, tabulação e o protocolo, com um ícone
  discreto para copiar e revisar o atendimento. Um quadro por canal; setas de
  mês. Vale para qualquer cargo (o Início do Pleno e do Analista não tem
  C-SAT). Gestor e qualidade escolhem a pessoa.
- **Cópia de teste do Performance** (`painel-performance-teste`,
  `npm run cf:deploy:teste`): o mesmo código e o mesmo banco, para acompanhar
  uma mudança antes do site oficial. Só nela o gestor tem "Ver como", que abre
  o Início de um atendente como ele vê.

## Performance 2.9.1

Sem migração. Não muda as Monitorias nem a Agenda.

- **Performance (correção): o mês só vira quando o anterior fecha.**
  Lançamentos abria no mês do calendário — no dia 26 já pulava para o mês
  novo, com o anterior ainda em fechamento. E as outras telas (Início,
  Extrato, Fechamento…) também viravam assim que o mês novo ganhava o
  primeiro dado, como um Colar do Hub. Agora todas abrem no mês que ainda
  está para fechar até o fechamento sair; o mês novo continua pelas setas.

## Performance 2.9.0

Migração 78 (banco dos painéis). Não muda as Monitorias nem a Agenda.

- **Performance (atualização): atendimentos de outros setores viram demanda
  extra pendente.** O relatório do Hub com setor que não é Expansão nem
  Diretores-Expansão (o iGreen Mob, por exemplo) era recusado inteiro. Agora
  as avaliações entram normalmente e os atendimentos do outro setor — com ou
  sem nota, por pessoa e semana — ficam guardados sem pontos, com a opção já
  marcada na importação. Em Lançamentos, "Demandas extras pendentes": escolher
  a regra e lançar (vira um lançamento normal, com a quantidade de
  atendimentos) ou descartar. O Fechamento avisa o que ainda está pendente.
  O mesmo atendimento (data e protocolo) não é guardado duas vezes; a nota
  dele não entra no C-SAT; atendimento de quem não tem ficha no painel fica
  de fora. A pontuação fica para quando a regra existir — decisão do gestor,
  26/10/2026.
- **Plano da 3.0 (documento):** setores e canais em árvore, em
  `docs/PLANO-SETORES.md`, para aprovação. Nada do sistema muda.

## Performance 2.8.2

Sem migração. Não muda as Monitorias nem a Agenda.

- **Performance (correção): Fechamento mais rápido.** As consultas da tela
  esperavam umas pelas outras em quatro etapas (login, origem do cálculo,
  dados, valores do RH); agora saem juntas, com a conferência do gestor. Os
  dados da tela ficam prontos em 0,2 a 0,3 s.

## Performance 2.8.1

Sem migração. Não muda as Monitorias nem a Agenda.

- **Performance (correção): valores de um mês aparecendo no outro.** No
  Fechamento, ao trocar de mês pelas setas, os campos do Pagamento (valor do
  RH) e do valor por ponto continuavam com o que estava no mês anterior — e
  salvar gravaria no mês novo. Agora cada mês recomeça os campos.
- **Performance (correção): Fechamento lento.** A tela recalculava a cota do
  mês inteiro a cada acesso (3 a 6 s), até em mês fechado. Agora lê o resumo
  pronto no mês aberto e, em mês já fechado, não recalcula: "Conferir quem
  ficou em aberto" faz o cálculo só quando pedido. Abre em 0,6 a 1 s. Fechar
  continua igual — o banco calcula na hora.

## Performance 2.8.0

Migração 77 (banco dos painéis). Não muda as Monitorias nem a Agenda.

- **Performance (atualização): valor do RH para quem ficou abaixo da meta.**
  O valor do RH é o que o RH mandou pagar: agora vale para qualquer pessoa
  fechada no mês, não só para quem bateu a meta. No Pagamento, a linha fica
  com "pago pelo RH"; o atendente vê o valor no extrato, no histórico e no
  Início. Pedido ao corrigir agosto (22/10/2026).
- **Performance (atualização): remover o valor por ponto.** No fechamento,
  "Remover valor" tira o valor por ponto do mês, com motivo; a remoção entra
  no histórico de correções como "removido".

## Performance 2.7.0 · Monitorias 5.7.0

Sem migração. Não muda a Agenda.

- **Monitorias (atualização): lista "Por atendente".** Na lista de
  monitorias, com um atendente escolhido, a tela abre no formato do
  Performance: "O que mais se repete" e as monitorias em blocos, mês a mês,
  cada uma com o link para abrir. O botão "Tabela" volta à tabela; sem
  atendente, ou na busca por código/protocolo, continua a tabela.
- **Monitorias e Performance (atualização): "O que mais se repete na
  equipe".** Na tela inicial do site de Monitorias (gestor e qualidade) e em
  Monitorias da equipe, no Performance: os critérios reprovados nos últimos 3
  meses em toda a equipe, até 10, com quantas pessoas tiveram cada um no mês
  mais recente.
- **Performance (correção): tendência do "O que mais se repete".** Comparava
  a contagem do mês, e o mês em andamento, com menos monitorias, parecia
  sempre melhor. Agora compara as vezes por monitoria de cada mês, com uma
  margem para não chamar ruído de mudança.

## Performance 2.6.0

Migração 76 (banco dos painéis). Não muda as Monitorias nem a Agenda.

- **Performance (atualização): "O que mais se repete".** Na tela de
  monitorias do atendente, entre o gráfico e a lista do mês: os critérios
  reprovados nos últimos 3 meses, com a contagem de cada mês, o total, a
  tendência (aumentou, diminuiu, estável ou resolvido) e a última observação
  — o ponto de partida para o feedback. A falha crítica entra como uma linha
  própria.
- **Performance (atualização): aviso de semana de monitorias concluída.** No
  sino, quando sai a 4ª monitoria da pessoa numa semana do ciclo. Um aviso
  por semana; mês ainda não liberado não avisa. Só no sino: as monitorias são
  salvas no site de Monitorias, que não dispara o aviso no canto da tela.
- **Performance (atualização): "Suas monitorias" no Início do atendente** no
  formato novo da 2.5.0 (blocos, filtros e o motivo da falha crítica, que
  também aparecia ali como "Todos os critérios atendidos").

## Performance 2.5.0

Sem migração. Não muda as Monitorias nem a Agenda.

- **Performance (atualização): lista de monitorias do atendente mais clara.**
  Cada monitoria fica num bloco próprio, com a nota em destaque à esquerda e
  a cor da faixa; o que melhorar vem em quadros separados, um por critério, e
  o parecer à parte. Em cada mês, filtros: Todas · Com algo a melhorar ·
  Falha crítica.
- **Performance (correção): monitoria zerada por falha crítica.** Aparecia
  como "Todos os critérios atendidos", porque o motivo do zeramento não é um
  critério reprovado. Agora mostra "Por que zerou" com o motivo registrado.

## Performance 2.4.0

Migração 75 (banco dos painéis). Segredo novo no Worker do Performance:
`VAPID_PRIVADA` (`node scripts/chaves-da-agenda.js performance`). Não muda as
Monitorias nem a Agenda.

- **Performance (atualização): avisos também no canto da tela.** No sino,
  "Receber também no canto da tela" inscreve o computador para receber os
  avisos (semana lançada, valor do mês) como notificação do navegador, mesmo
  com o painel fechado — o mesmo mecanismo da Agenda (Web Push), sem Teams.
  Quem envia é o próprio site, logo depois que o gestor salva o volume ou os
  valores do RH. No Brave é preciso ligar "Usar os serviços do Google para
  mensagens push". Os avisos que já existiam não são reenviados.
- **Correção (só no computador de desenvolvimento): sessão em laço.** Em
  localhost os três sistemas dividem os cookies, e o painel lia o login
  vencido da Agenda e ficava em "Renovando a sua sessão…". Cada sistema lê
  agora só o cookie do seu projeto. Nos sites publicados nada muda.

## Performance 2.3.1

Sem migração. Não muda as Monitorias nem a Agenda.

- **Performance (correção): valor por ponto com o valor do RH informado.**
  Com o valor do RH informado no mês, o valor por ponto deixa de ser cobrado:
  sai a pendência "Valor por ponto … não informado" do Início, e no
  Pagamento o aviso vira uma nota (o valor por ponto fica opcional, para
  conferir o calculado com o do RH).

## Performance 2.3.0

Migração 74 (banco dos painéis). Não muda as Monitorias nem a Agenda.

- **Performance (atualização): o sino de avisos.** No topo do menu do
  Performance, um sino com o número de novidades. O atendente é avisado
  quando a semana dele é lançada (o primeiro volume da pessoa na semana,
  digitado ou colado do Hub) e quando o valor do mês sai (o valor do RH).
  Cada aviso leva ao extrato ou ao histórico; abrir a lista marca como lido.
  Sem Teams e sem permissão do navegador — decisão do gestor, 21/10/2026.
  Cada aviso sai uma vez; volume importado de planilha não avisa. Os valores
  do RH de setembro, já informados, avisaram ao rodar a migração.

## Performance 2.2.2

Sem migração. Não muda as Monitorias nem a Agenda.

- **Performance (correção): valor do RH para o atendente.** O extrato só
  mostrava o valor do RH quando o valor por ponto do mês já estava definido;
  sem ele, aparecia "Valor por ponto ainda não informado". Agora o valor do
  RH aparece sempre que existe — no extrato, no Histórico (e no "Total
  recebido") e em "Seus últimos meses" no Início. Achado no teste do gestor
  com o acesso do Pedro (setembro/2026).

## Performance 2.2.1 · Monitorias 5.6.3 · Agenda 1.5.1

Sem migração. Vale para os três sites.

- **Os três (correção): Next.js 16.** Next.js 15.5 → 16.4.2, OpenNext
  (Cloudflare) 1.20.13 e wrangler 4.151. O Next.js 15 saiu do suporte em
  21/10/2026 (dois anos do lançamento) e a publicação vinha usando uma
  liberação; agora volta a uma versão com correções de segurança, sem a
  liberação. Nada muda no uso. Testadas antes de publicar: 22 telas do
  Performance, 15 das Monitorias e as da Agenda, mais login, sessão e o
  redirecionamento entre sites. Pendente, à parte: o arquivo `middleware.ts`
  passou a se chamar `proxy.ts` no Next.js 16 (o nome antigo segue valendo).
- **Performance (correção): salvar o valor do RH.** O botão mostra "Salvo,
  atualizando a tela…" enquanto o Fechamento recarrega — antes parecia que
  nada tinha acontecido.

## Performance 2.2.0

Migração 73 (banco dos painéis). Não muda as Monitorias nem a Agenda.

- **Performance (atualização): valor encaminhado pelo RH.** No Fechamento,
  quadro Pagamento, a coluna **Valor do RH (R$)**: o gestor digita o que o RH
  mandou pagar a cada pessoa que bateu a meta. Com valor por ponto
  informado, a tela mostra o calculado ao lado e diz se confere ou a
  diferença; sem ele, só guarda e mostra. Mudar um valor já informado pede o
  motivo; tudo fica em `valores_rh_alteracoes`. O atendente vê no extrato o
  valor do RH no lugar do calculado (decisão do gestor, 21/10/2026).

## Performance 2.1.0

Migração 72 (banco dos painéis). Não muda as Monitorias nem a Agenda.

- **Performance (atualização): colar do Hub.** No volume da semana, **Colar do
  Hub** lê a tabela de analistas copiada do Hub (Ctrl+C, filtrada por canal e
  semana) e preenche o quadro: resolvidos como finalizados, TMA e TME útil
  (decisão do gestor, 21/10/2026). Casa pelo Nome no Hub; quem não casar fica
  em alerta e, ligado à mão, é lembrado. Nada é gravado até "Salvar".
- **Performance (atualização): projeção do mês.** No Início do gestor, o quadro
  de pontuação do mês aberto mostra, por pessoa, a barra do que já fez e até
  onde chega no ritmo atual, com "na meta / deve bater / em risco / abaixo", e
  os totais (na meta hoje, devem bater, em risco). A cota do cargo Gestor não
  aparece. O atendente ganha "Seu ritmo": hoje → no ritmo atual e quanto falta
  por semana. Mesma conta da Simulação.
- **Performance (atualização): conferência do cálculo.** Todo dia às 06:00
  (e em "Conferir agora"), de setembro/2026 em diante: resumo do mês = cálculo
  completo; fechamentos: soma das linhas = resultado congelado; ninguém
  pontuando fora; e, na tela, a simulação sem cenário = resultado de hoje.
  Divergência vira pendência no Início. Já na primeira rodada achou a
  projeção zerando a média de quem recebe pela média — corrigido antes de
  publicar.
- **Performance (correção): sem transferidos e fila.** Saem das telas e do
  banco (não são mais métrica no Hub).

## Performance 2.0.1

Sem migração. Não muda as Monitorias nem a Agenda.

- **Performance (correção): aviso de pendentes de realocação no fechamento.**
  O aviso antes de fechar o mês, que já cobrava quem está sem cargo e as
  faixas que não fecham, passa a cobrar também volume e lançamentos
  pendentes de realocação (de quem está em cargo sem cota): fechar sem
  decidir congelaria esses pontos fora de todo mundo.

## Performance 2.0.0

Migração 71 (banco dos painéis). Não muda as Monitorias nem a Agenda.
**Crítico (1º número):** reescreve competência já fechada — os fechamentos
da Luciana Freire de junho (213 pts) e julho (183 pts) foram retirados, por
decisão do gestor (20/10/2026). Cada um ficou registrado em
`fechamento_alteracoes` antes de sair.

- **Performance (atualização): cargo sem cota.** Em Configuração › Pesos por
  cargo, cada cargo tem **Recebe cota**. Desligado, quem está no cargo não tem
  extrato nem resultado a partir do mês em que entrou nele, e sai do
  fechamento, da exportação, da pontuação no Comparativo e das médias. O
  acesso é o do papel. Cargo novo **Diretora** (sem cota); a Luciana está
  nele desde 06/2026, com o papel Gestor (vê tudo) e fora das listas e médias.
- **Performance (atualização): realocação de lançamentos.** Em Lançamentos,
  o quadro **Pendentes de realocação** lista volume e lançamentos do mês
  aberto de quem está sem cargo ou em cargo sem cota (não pontuam para
  ninguém): passar para outra pessoa, manter sem cota ou apagar. E **⇄ mover**
  em cada volume semanal e lançamento manual, para corrigir a pessoa sem
  digitar de novo (volume na mesma semana e canal soma). Tudo registrado.
- **Performance (atualização): simulação com TME e projeção.** Faixas de TME
  por canal com limite (minutos) e pontos editáveis — a faixa de cada semana é
  reescolhida pelo TME da equipe —, e a **projeção do mês**: a média das
  semanas com volume lançado, já com o cenário, vale para as que faltam; quem
  deve bater a meta.

## Performance 1.54.0

Migração 70 (banco dos painéis). Não muda as Monitorias nem a Agenda.

- **Performance (atualização): importar só o volume de um mês do sistema.**
  Na aba Importar › Mês anterior, um mês já fechado pelo sistema e sem volume
  (caso de agosto/2026, que entrou só pelo resultado e pelas avaliações) entra
  no modo **Só o volume**: da planilha vêm finalizados, transferidos, fila, TMA
  e TME por pessoa e semana, e Diretores e Executivos. O fechamento e as
  avaliações não mudam; "Desfazer" apaga só esse volume. O ciclo lido da
  planilha passa a fechar sempre no dia 25. Volume de agosto/2026 importado
  pelo gestor em 19/10 (Backup_Metas_08-2026).

## Performance 1.53.0

Sem migração. Não muda as Monitorias nem a Agenda.

- **Performance (atualização): simulação de cenários.** Nova tela
  **Simulação** (Administrar, só o gestor), sobre o mês aberto: tirar ou
  devolver o TME de uma semana de um canal, mudar os limites das faixas de
  C-SAT, os pesos e a meta de um cargo, tirar uma semana de uma pessoa (ex.:
  atestado) e somar presenciais. Mostra por pessoa hoje × simulado, quem
  passa a bater ou deixa de bater a meta, e os totais da equipe. Nada é
  gravado: o cálculo roda na tela a partir do extrato de hoje; recarregar
  descarta. Quem recebe pela média tem a média refeita na proporção dos
  resultados simulados dos cargos de referência.

## Performance 1.52.0

Migração 69 (banco dos painéis). Não muda as Monitorias nem a Agenda.

- **Performance (atualização): importar mês anterior.** Em Importar, a aba
  **Mês anterior (planilha)** traz os meses antes do sistema a partir do
  "Dashboard Expansão" de cada mês: uma linha por atendimento (com nota e
  tabulação), o volume por pessoa e semana (finalizados, transferidos, fila,
  TMA e TME), Diretores e Executivos (canal Diretores-Expansão) e o resultado
  de cada pessoa, que entra **congelado** como na planilha, linha a linha no
  extrato. A prévia confere, por pessoa, se as 4 semanas mais o que só conta
  no mês dão o resultado. E-mail sem cadastro não é descartado: liga-se a uma
  pessoa ou se cadastra como histórico (inativa, sem login, fora das
  monitorias). Monitorias da planilha não entram. "Desfazer" apaga a
  importação inteira. O Comparativo passa a começar no mês importado mais
  antigo; a C-SAT desses meses é a do sistema (positivas sobre avaliações do
  mês inteiro), não a média de médias da planilha. Junho e julho/2026
  importados pelo gestor em 19/10.
- **Performance (atualização): transferidos e fila no volume.** Lançamentos ›
  Volume (Expansão) ganha as colunas opcionais Transferidos e Fila. Não pontuam.

## Performance 1.51.1 · Monitorias 5.6.2

Sem migração. Não muda a Agenda.

- **Monitorias e Performance (correção): recusa do banco em português.**
  Quando o banco recusa uma gravação, a tela não mostra mais "new row violates
  row-level security policy…". Se a conta não vale mais (apagada, encerrada
  ou vencida), avisa e leva ao login; se a pessoa existe mas a ação não é
  dela, diz "Você não tem permissão para fazer isso". Vale em todas as telas
  que gravam algo. Achado no teste do gestor de 16/10: uma conta apagada, com
  a tela ainda aberta, foi barrada pelo banco — correto —, mas com a mensagem
  técnica.

## Performance 1.51.0 · Monitorias 5.6.1

Migração 68 (banco dos painéis). Não muda a Agenda.

- **Performance (atualização): criar acesso pela tela.** Na ficha do atendente,
  quem ainda não entra no painel ganha a seção "Acesso" com e-mail, papel e o
  botão **Criar acesso**: gera a senha temporária (mostrada uma vez; a pessoa
  troca no primeiro acesso) ou, se já existir conta com o e-mail, só vincula.
  Substitui os comandos `npm run acesso` e `npm run vincular`. A lista avisa
  "sem acesso ao painel".
- **Performance (atualização): Nome no ELO na ficha**, como o Nome no Hub.
  Salvar também passa para a pessoa os chamados dos meses abertos que tinham
  ficado sem dono com esse nome.
- **Monitorias (correção):** o aviso do cadastro de pessoas aponta para o
  "Criar acesso" do Performance.

## Performance 1.50.0 · Monitorias 5.6.0

Migração 67 (banco dos painéis). Não muda a Agenda.

- **Performance e Monitorias (atualização): quem vê cada tipo de registro do
  diário é configurável.** Configuração › Diário de bordo ganha "Quem vê cada
  tipo de registro": para Processo, Treinamento, Autorização, Exceção e
  Problema operacional, quem vê (todos, a gestão — gestor e Pleno — ou só o
  gestor) e se quem registrou continua vendo o próprio. Começa com
  **autorização e exceção só para a gestão**, cada um vendo o que registrou;
  problema operacional da gestão; processo e treinamento para todos. A regra é
  do banco: vale também na consulta do diário pelo Monitorias, e os filtros do
  diário mostram só os tipos que a pessoa vê. Se processo ou treinamento forem
  restritos, a leitura obrigatória só é cobrada de quem vê e o aviso não vai
  para o canal do Teams.

## Performance 1.49.0

Migração 66 (banco dos painéis). Não muda as Monitorias nem a Agenda.

- **Performance (atualização): copiar a pontuação do Júnior.** Em
  Configuração › Pesos por cargo, ao abrir um cargo que não é o Júnior, o
  quadro "Copiar a pontuação do Júnior" traz de uma vez os pesos dele, nos
  grupos escolhidos. As células copiadas ficam em âmbar e só valem com
  "Salvar e recalcular", com o motivo — e entram no histórico de pesos. Meta
  e média não são copiadas.
- **Performance (atualização): Métricas da semana.** Tela nova em Administrar,
  só do gestor: o TME de cada semana e canal (Expansão e Diretores — o tempo
  de resposta dos Diretores é o próprio TME Diretores) pode deixar de contar.
  Desligar pede o motivo e pergunta se houve registro no diário de bordo, e
  qual. Vale para a equipe toda do canal, só em mês aberto; o motivo é só da
  gestão, e o Extrato de cada um mostra "TME não contabilizado nesta semana".

## Performance 1.48.1

Migração 65 (banco dos painéis). Não muda as Monitorias nem a Agenda.

- **Performance e Agenda (correção): prazo de saída fixo.** Na 1.47.0 o "sair
  até" andava com os dias já tirados. Agora é sempre 30 dias antes do fim do
  período concessivo.
- **Performance (correção): período concluído à vista.** Quando um período
  anterior está quitado, a tabela de prazos mostra "✓ … concluído" embaixo do
  período aquisitivo, em vez de pular para o próximo em silêncio.

## Performance 1.48.0

Sem migração. Não muda as Monitorias nem a Agenda.

- **Performance (atualização): dias tirados fora do sistema.** O botão
  **Período tirado fora do sistema** abre um campo para informar quantos dias
  foram tirados (sugere o que falta no período), em vez de creditar 30 direto.

## Performance 1.47.0 · Agenda da Gestão 1.5.0

Migração 64 (banco dos painéis). Não muda as Monitorias.

- **Performance e Agenda (atualização): prazo de saída.** Pela CLT as férias
  têm de terminar dentro do período concessivo; o "sair até" passa a ser o
  fim dele menos os dias a tirar (30 dias antes, para quem não tirou nada). O
  último dia para sair aparece marcado no calendário (contorno vermelho) e no
  quadro do ano (vermelho cheio), e os avisos falam em prazo de saída.
- **Performance (atualização): período tirado fora do sistema.** Quem tirou
  férias antes do cadastro aparecia com período vencido. Na tabela de prazos,
  **Período tirado fora do sistema** credita 30 dias (e dá para desfazer).
- **Performance e Agenda (atualização): dias em vez do último dia.** No
  cadastro escolhe-se a saída e a quantidade de dias (atalhos de 5 a 30); o
  último dia e o retorno aparecem calculados.
- **Performance (atualização): aprovar planejadas.** Férias planejadas ganham
  o botão **Aprovar** na lista.

## Performance 1.46.0 · Agenda da Gestão 1.4.1

Migração 63 (banco dos painéis). Não muda as Monitorias.

- **Performance (atualização): admissão na empresa.** A ficha em Atendentes
  ganha **Na empresa desde**, ao lado de **Na equipe desde**. A da empresa só
  vale para as férias: quem veio transferido conta o período aquisitivo de lá.
  A da equipe segue sendo a da cota, sem mudança. Sem a da empresa, as férias
  usam a da equipe.
- **Performance (atualização): o ano inteiro.** Ao lado do calendário de
  Férias, os 12 meses com a mesma sinalização; cada mês abre o calendário dele.
- **Performance e Agenda (atualização): planejadas em amarelo.** Dia com duas
  ou mais pessoas fora passa a ser marcado em rosa, para não confundir.
- **Performance e Agenda (atualização): atenção ao prazo da CLT** só para quem
  completa 1 ano de casa até o fim do ano; os demais aparecem como "menos de
  1 ano".

## Performance 1.45.0

Migração 62 (banco dos painéis). Não muda as Monitorias nem a Agenda.

- **Performance (atualização): Férias para os pares.** A tela Férias passa a
  ser vista por Gestor, Qualidade e quem tem cargo **Atendente Pleno** ou
  **Analista** no mês: calendário, quem está fora e períodos que coincidem.
  Cadastrar, editar e o prazo da CLT continuam só do gestor. Os gestores
  agora entram no cadastro e no prazo, como qualquer pessoa — assim as férias
  do gestor aparecem para os pares.

## Performance 1.44.0 · Agenda da Gestão 1.4.0

Migração 61 (banco dos painéis) e `supabase/agenda/04-minhas-ferias.sql`
(banco da agenda). Não muda as Monitorias.

- **Performance (atualização): Férias.** Nova tela em Administrar → Férias, só
  do gestor: calendário do mês, cadastro dos períodos de cada pessoa
  (aprovada ou planejada) com aviso na hora quando outra pessoa está fora no
  mesmo período, e o **prazo da CLT** de cada um — 30 dias por ano trabalhado,
  a tirar nos 12 meses seguintes, contado pela data de entrada e pelas férias
  cadastradas. Sem data de entrada não há prazo.
- **Agenda (atualização): Férias.** Tela nova com o calendário da equipe
  (pela ponte, só leitura) e as suas férias, que ficam só no banco da agenda.
  O plano do dia e o resumo das 8h (no celular e no Telegram) avisam: saída em
  até 7 dias, retorno, duas pessoas fora ao mesmo tempo e prazo da CLT (aos
  90 e 60 dias e, de 30 dias para baixo, todo dia).

## Performance 1.43.0 · Agenda da Gestão 1.3.0

Migração 60 (banco dos painéis) e `supabase/agenda/03-lembrete-do-ciclo.sql`
(banco da agenda). Não muda as Monitorias.

- **Performance (atualização): semanas sem chamados.** Importar → Chamados
  (ELO) mostra os chamados de cada semana do ciclo. Semana encerrada sem
  nenhum chamado importado vira pendência no **Precisa de você**, como as
  semanas sem volume. Se a semana não teve chamado, **Sem chamados** tira a
  pendência; **Desfazer** volta a cobrar.
- **Agenda (atualização): lembrete dos relatórios do ciclo.** No horário do
  resumo, chega "Relatórios do ciclo para subir" com as semanas sem
  atendimentos ou sem chamados, e o botão para o Importar do Performance. O
  primeiro aviso é no dia seguinte ao fim da semana (3, 11, 19 e 26), e ele
  se repete a cada dia até o relatório subir. Segue a chave **Pendências do
  Performance** dos Ajustes.

## Agenda da Gestão 1.2.2

Só Agenda (correção).

- **Conectar Telegram funcionava só na primeira conversa com o bot.** Com a
  conversa já aberta, o Telegram não manda o código do link, e o bot
  respondia "Eu só entrego os avisos…". Agora Ajustes mostra o código com
  **Copiar**, e o bot aceita o código enviado como mensagem.

## Agenda da Gestão 1.2.1

Só Agenda (correção).

- As chaves liga/desliga de Ajustes → Resumo do dia mostravam a bolinha
  fora do lugar: ligada, vazava para fora do trilho; desligada, ficava à
  direita e parecia ligada.

## Agenda da Gestão 1.2.0

Só Agenda (atualização). Não muda Monitorias nem Performance.

- **Brave como aplicativo no Windows**: Ajustes → Instalar como aplicativo
  ganha os passos do Brave, inclusive o ajuste que ele exige para
  notificação (serviço de push do Google, que vem desligado) e o de rodar em
  segundo plano.
- Se o Brave recusar a ativação das notificações, a tela explica o ajuste em
  vez de mostrar o erro técnico. A lista de aparelhos passa a mostrar
  "Windows · Brave" (antes saía como Chrome).

## Agenda da Gestão 1.1.0

Só Agenda (atualização). Não muda Monitorias nem Performance.

- **Avisos pelo Telegram**, para aparelho que não aceita notificação do
  navegador: os lembretes e o resumo do dia chegam como mensagem de um bot,
  com os botões **Concluir**, **Adiar 15 min** e **Abrir a agenda**. Em
  Ajustes, **Conectar Telegram** liga a conta com um toque, sem digitar
  número nenhum. Os dois canais podem ficar ligados juntos.
- Banco da agenda: `supabase/agenda/02-telegram.sql`. Ligar o bot:
  [docs/AGENDA.md](docs/AGENDA.md#avisos-pelo-telegram-110).

## Agenda da Gestão 1.0.0

Terceiro site do mesmo código (`painel-agenda.expansao.workers.dev`,
`VERSAO_AGENDA` em `lib/versoes.ts`), publicado em 14/10/2026. Não muda a
versão das Monitorias nem do Performance. Detalhes em
[docs/AGENDA.md](docs/AGENDA.md).

- **Banco e login próprios:** projeto Supabase só da agenda
  (`supabase/agenda/01-agenda.sql`), login por nome de usuário, perfil único.
- **Meu dia** (entrada por frase e plano do dia), **Próximos**, **Feitos** e
  **Ajustes**; instalável no celular, com notificações (Web Push) que tocam
  na hora do lembrete ou no resumo do dia.
- **Ponte só de leitura** com os painéis (migração 59): as pendências do
  "Precisa de você" do Performance entram no plano do dia. Nada da agenda vai
  para o banco dos painéis.
- Assistente por regras, sem API de IA.
- Publicação só da agenda: `npm run cf:deploy:agenda`. O `cf:deploy` completo
  passa a publicar os três sites.

## 5.5.2 · Performance 1.42.0

- **Monitorias e Performance:** falha do banco também deixa de virar "vazio"
  no **Fechamento** e nos **Relatórios** das Monitorias (ranking, critérios e
  folha de feedback): a tela avisa em vez de mostrar lista vazia.
- **Monitorias e Performance:** a tela de erro indica o botão **Reportar
  problema**, no menu, em vez de "avise a Qualidade".
- **Só Performance (atualização):** o **Comparativo começa em agosto/2026**,
  o primeiro mês com dados do sistema — maio a julho apareciam como "sem
  dado". A tela ficou mais rápida (~2,4 s → ~1 s no teste local): esses meses
  e os sem nenhum dado de origem não vão mais ao cálculo ao vivo, e o perfil e
  o mês saem juntos.
- Ferramenta: `scripts/varredura-navegador.js`, a varredura de telas da
  bateria de testes de 14/10, para rodar no console antes de publicar.

## 5.5.1

Correções da bateria de testes de 14/10/2026 (nenhuma muda número ou visual):

- **Segurança: o login só volta para endereço do próprio site.** Um link do
  painel com `?proximo=//outro-site` levava a pessoa, depois de digitar a
  senha, para fora. A renovação da sessão tinha a mesma brecha com barra
  invertida.
- **Falha do banco não aparece mais como "vazio".** Nas telas de números
  (Início, Extrato, Comparativo, Histórico), se o banco não responder, a tela
  diz "Algo deu errado" em vez de mostrar lista vazia ou "Sem pontuação".
- **"Tentar de novo"** na tela de erro busca os dados de novo no servidor.
- **O login guarda os parâmetros do endereço**: o link do extrato de um mês e
  de uma pessoa volta para ele depois de entrar.
- Mês impossível na URL (`2026-13`) não mostra mais "Invalid Date"; a
  exportação das monitorias responde "mês inválido" em vez de erro 500 e
  aceita o mês como AAAA-MM.

## 5.5.0

- **Gráficos semanais do Início com o mês anterior.** C-SAT, Volume e TME
  por semana mostram, atrás da linha do mês, o mês anterior em cinza, semana a
  semana, só para comparar (o valor aparece ao passar o mouse). Vale para o
  Início do gestor e para o do atendente, com os números dele.
- **Tela Presencial mais leve.** O peso do presencial no cargo de quem está
  olhando vinha de uma linha qualquer do extrato ao vivo, de todos os meses;
  agora o cargo vem do cadastro na competência.
- Documentação da hospedagem e da apresentação para a TI atualizadas: versões,
  migrações até a 58 e a dependência do pg_cron para o resumo do mês.

## 5.4.0

- **Resumo do mês aberto (migração 58).** O resultado do mês aberto fica
  guardado pronto, em vez de ser recalculado a cada abertura de tela. O banco
  recalcula sozinho em até 1 minuto depois de qualquer importação,
  lançamento, monitoria ou mudança de peso e cadastro. Extrato, Início e
  Comparativo leem o resumo: o Extrato de quem recebe pela média caiu de
  ~3,2 s para ~0,5 s; o Início do gestor, de ~2,5 s para ~1 s (local).
- **"Atualizado às HH:MM"** ao lado do mês. Com mudança pendente vira
  "Atualizando…", e a tela troca os números sozinha quando o resumo fica
  pronto, realçando por um instante o que mudou.
- O fechamento e a exportação continuam no cálculo ao vivo. Se o resumo não
  estiver em dia (mais de 40 min), as telas voltam ao cálculo ao vivo.

## 5.3.8

- **Extrato do mês corrente de volta ao tempo da 5.3.6.** A 5.3.7 deixou o
  mês aberto ~0,8 s mais lento: o extrato ao vivo esperava saber se o mês
  estava fechado. No mês corrente ele volta a sair logo de início.

## 5.3.7

- **Extrato de mês fechado sem recalcular.** Os números já vinham do
  congelado, mas a tela ainda pedia o cálculo ao vivo para saber o cargo e
  quem formou a média, e descartava os valores. Agora o mês fechado lê o
  fechamento e o cadastro. O Extrato de setembro do gestor caiu de ~4 s para
  ~1 s. Os 24 extratos de agosto e setembro conferidos, idênticos.

## 5.3.6

- **Extrato e Início do Performance mais rápidos.** As consultas saem em menos
  rodadas: o Extrato fazia nove esperas seguidas e agora faz três; o perfil e a
  competência do mês saem juntos; o selo do mês não segura mais o painel do
  gestor. Para quem recebe pela média, o Extrato do gestor caiu de ~4,5 s para
  ~3,3 s (medido no servidor local). Os números não mudam: 41 telas conferidas
  antes e depois, idênticas.

## 5.3.5

- **Telas mais leves.** As consultas que rodam a cada clique (menu, avisos de
  reporte, leitura do diário) saem juntas, e não mais uma atrás da outra. O
  Worker passa a usar o Smart Placement da Cloudflare, rodando perto do banco
  quando isso encurta as idas ao Supabase. Os gráficos carregam só as partes
  usadas da biblioteca. Nada muda na tela.

## 5.3.4

- **A sessão não cai mais por causa do erro 1102.** Quem renova o login agora é
  o navegador, direto com o Supabase; o servidor só lê a validade. Quem volta
  com a sessão vencida passa por uma renovação rápida e segue para a tela, sem
  pedir login. Sessão encerrada pelo gestor leva ao login com a mensagem "Sua
  sessão foi encerrada".

## 5.3.3

- **"Falha crítica" no lugar de "zeramento"** em todo o sistema: no formulário
  ("Falha crítica", "Descrição da falha crítica"), na página da monitoria, na
  folha de feedback, nos cartões e colunas ("Falhas críticas"), no filtro da
  lista, no gráfico de evolução e no Excel. Os nomes internos no banco não
  mudam.

## 5.3.2

- **Folha de feedback individual:** a monitoria zerada mostra o **motivo do
  zeramento**. Antes aparecia "0% · zerada" com "Todos os critérios
  atendidos", sem explicar o zero.
- Cada critério com observação aparece no protocolo, reprovado (✕) ou atendido
  (✓), e a observação geral ganha o título "Observação geral".
- O CSV da lista de monitorias ganha a coluna do motivo do zeramento (o Excel
  já trazia).

## 5.3.1

- Cada abertura do painel passa a ser registrada (migração 52), para a tela
  **Acessos** do Painel de Performance, que só o gestor vê. Nada muda na tela
  das Monitorias.

## 5.3.0

- **A Cobertura do ciclo destaca a semana atual.** A coluna da semana em
  andamento mostra o andamento de cada pessoa ("2 de 4", ou "4 de 4 ✓" em
  verde) e o topo do quadro diz quantos já completaram a semana. Ela continua
  fora da cobrança: o "No prazo" olha só as semanas encerradas.
- Cada semana traz as datas no cabeçalho.
- **O nome leva à Nova monitoria** com a pessoa já escolhida, na primeira
  semana que ainda tem vaga. No Performance o destaque aparece igual, mas sem
  o link — lá a tela é de consulta.

## 5.2.0

- **O mês troca pelas setas**, como no Painel de Performance, no Painel, no
  Ranking mensal e nos Critérios mais reprovados. Saiu o campo de mês com o
  botão "Ver": eram dois cliques para ir ao mês vizinho, que é quase sempre o
  que se quer.
- As setas andam só pelos meses que têm monitoria; na ponta mais antiga a seta
  fica apagada. Nos Critérios, "Todo o período" ficou no botão ao lado.

## 5.1.0

- **Nova monitoria por sorteio.** O protocolo deixou de ser digitado: escolha o
  atendente e a semana do ciclo, e o painel sorteia um atendimento já importado
  do Hub. O cartão traz o protocolo, com botão de copiar e de sortear outro, a
  data, a semana, o nº da monitoria e a tabulação que o atendente registrou.
- Cada semana mostra como está: quantas monitorias já tem, **concluída**,
  **sem atendimentos** importados, ou ainda não começou. A tela abre na
  primeira semana que ainda dá para monitorar.
- Com a semana concluída não há sorteio **nem campo para digitar** — era por
  ali que dava para passar das 4 monitorias da semana.
- Digitar o protocolo à mão continua possível enquanto a semana couber
  monitoria, para um atendimento específico ou quando o relatório da semana
  ainda não foi importado.
- Um critério marcado como **Não só conta como respondido depois que a
  evidência estiver escrita**, e o contador mostra quanto falta. Vale para
  monitorias novas; editar uma antiga não fica travado por isso.

## 5.0.0

- **Visual novo**, igual ao do Painel de Performance. O menu saiu do topo e
  virou uma coluna à esquerda, com os grupos Registrar, Analisar e
  Administrar. Os quadros ficaram arredondados e sem borda, as tabelas
  encostam na borda do quadro e o conteúdo ocupa a tela toda em monitor
  grande. Em janela estreita o menu do topo continua como era.
- A tela de uma monitoria abre com três números em destaque — nota final,
  operador e critérios reprovados. A nota saiu do canto do cabeçalho, onde
  sumia em tela estreita, e a ficha deixou de repetir o que já está acima.
- Correções que vieram junto: na Nova monitoria, a barra da nota calculada
  não passa mais por cima do menu; na consulta do diário, a coluna Assunto
  não fica mais espremida.

O 1º número mudou por ser a virada de visual do sistema inteiro: nenhuma
conta mudou, e nenhuma nota ou pontuação já reportada foi alterada.

## 4.16.1

- Consulta do diário: o tipo novo "Problema operacional" aparece com a
  subcategoria (ex.: "Problema operacional · Hub").

## 4.16.0

- **Reportar problema**: botão no menu. Conte o que aconteceu e, se quiser,
  cole um print (Ctrl+V). A tela, a versão e o navegador vão junto. Em
  "Reports" você acompanha a resposta da gestão; o gestor vê todos.

## 4.15.1

- Consulta do diário: nos 7 dias antes de vencer, a validade aparece como
  "Vence em N dias"; e o registro com dia do ocorrido anterior mostra também
  a data em que foi registrado.

## 4.15.0

- Consulta do diário e aviso na monitoria mostram a **validade** do registro:
  "Vale até" enquanto vale, "Vencido em" depois. O vencido continua na
  consulta.
- A data do registro pode ser a do dia do ocorrido, escolhida pela gestão
  no Painel de Performance.

## 4.14.2

- Consulta do diário: processo novo e treinamento podem não ter protocolo; a
  coluna mostra "—". Autorização e exceção continuam sempre com protocolo.

## 4.14.1

- No aviso do diário ao salvar a monitoria, "aguardando aprovação do gestor"
  passa a "aguardando aprovação": o Pleno também aprova registros.

## 4.14.0

Diário de bordo: consulta dos registros do dia a dia da equipe.

- Nova tela **Diário de bordo** (gestor e qualidade): processos novos,
  treinamentos, autorizações e exceções registrados pela equipe no Painel de
  Performance, com busca por protocolo, assunto ou texto e filtro por tipo.
- Ao salvar uma monitoria, se o protocolo tiver **autorização ou exceção**
  no diário, o monitor vê o registro e responde se ele **impacta** a
  avaliação — com justificativa quando impacta. A resposta aparece na
  consulta do diário.

## 4.13.0

Recuperação de senha: quem esqueceu a senha agora tem um caminho.

- No login, **"Esqueci minha senha"** orienta a procurar o gestor.
- O gestor redefine pela ficha da pessoa, no Painel de Performance
  (Atendentes → Acesso): o banco gera uma **senha temporária aleatória**,
  mostrada uma única vez, encerra as sessões abertas e obriga a troca no
  primeiro acesso. A senha padrão não é reaproveitada — todos a conhecem.
- Cada redefinição fica registrada (quem, de quem, quando), sem a senha.

## 4.12.0

O mês seguinte das monitorias só abre depois do fechamento da cota.

- Enquanto a cota do mês não é fechada, as monitorias do mês seguinte ficam
  bloqueadas — a trava é do banco (migração 30), não só da tela.
- A data do atendimento começa **vazia** no lançamento novo: preenchida com
  a data de hoje, ela era salva sem ser conferida.

## 4.11.1

Corrige a exportação, que vinha cortada em 1.000 linhas.

- O PostgREST devolve no máximo **1.000 linhas por consulta e não avisa quando
  corta**. A aba de critérios tem cerca de 19 linhas por monitoria, então
  passou desse teto com 53 monitorias — o arquivo vinha truncado desde então,
  com aparência de completo.
- Medido hoje: `vw_feedback_individual` tem **2.299 linhas** e a exportação
  entregava **1.000**. Faltavam 56% dos critérios em todo arquivo gerado.
- A leitura passa a ser paginada, e a ordenação de cada consulta termina em
  colunas que não empatam. Sem isso, duas páginas seguidas poderiam repetir uma
  linha e pular outra — a mesma perda silenciosa, agora no meio do arquivo.

## 4.11.0

Nova aba **Por semana** na exportação: uma linha por operador e semana.

- Colunas: competência, operador, semana, a nota da 1ª, 2ª, 3ª e 4ª monitoria,
  quantidade e média. É o insumo do cálculo da cota, onde a monitoria entra
  pela média da semana.
- A média é sobre as monitorias **que existirem**, e não sobre quatro fixas:
  uma semana com duas monitorias tem a média das duas, e não das duas mais
  dois zeros. A diferença muda a pontuação inteira.
- O agrupamento é por identificador do operador, nunca pelo nome — dois
  homônimos virariam uma linha só, com as notas embaralhadas.
- Também em CSV, por `?formato=csv&relatorio=semanal`.
- O **código da monitoria** passa a constar na aba Monitorias e no CSV, para
  chegar ao registro a partir do arquivo.

Os pontos não são calculados aqui de propósito: a regra da monitoria
(75 × média, quando passa de 85%) pertence ao cadastro de regras do painel de
cota, e repeti-la neste arquivo criaria uma segunda definição para o mesmo
número.

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
