# Painel de Cota — modelo de dados

Referência do que está em `supabase/12-painel-de-cota.sql` e
`supabase/13-calculo-da-cota.sql`. O SQL explica *o quê*; aqui fica o *porquê*
e o que ainda está em aberto.

Escrito em 01/09/2026, a partir do `ESPECIFICACAO.md` do projeto do painel, da
planilha fechada de julho (`Dashboard Expansão - 26-06 a 25-07.xlsx`) e do
banco atual.

---

## O princípio

A cota deixa de ser um número guardado e passa a ser **a soma de um extrato**.

Cada linha é *(pessoa, competência, semana, regra, quantidade, peso)*, e a cota
é `soma(quantidade × peso)`. É o mesmo formato da aba de cada atendente na
planilha — categoria, pontuação, feito, cota. A diferença é que lá o extrato é
desenhado à mão em 48 blocos de fórmula, e aqui ele é derivado do dado bruto
por uma view.

Três defeitos conhecidos deixam de ser possíveis:

1. **O mensal é a soma das semanas, por definição.** Não existe segundo cálculo
   para divergir do primeiro.
2. **Nenhuma categoria pode existir na semana e sumir no mês**, porque não há
   duas listas de categorias.
3. **A monitoria casa por id, não por nome.** Era assim que ela virava zero
   silenciosamente para a Allana e a Denise, cujo nome diverge entre as fontes.

---

## O que já existia e foi aproveitado

O projeto do painel já tinha construído boa parte da estrutura, e ela está boa.
Nada foi recriado do zero:

| Tabela | Situação | O que mudou |
|---|---|---|
| `regras` | 33 linhas, completa | ganhou políticas de acesso |
| `atendimentos` | 4.027 linhas | vira histórico; o dado migra para `avaliacoes` |
| `cotas` | 12 linhas | vira histórico, só leitura |
| `volume_semanal` | vazia | refeita com `pessoa_id` e competência em `date` |
| `lancamentos` | vazia | idem, mais rastro de autor |
| `atendentes` | 12 linhas | `nome_huggy` copiado para `pessoas`; fica redundante |

`regras` já é exatamente a tabela de pesos e motivos pedida: chave, grupo,
rótulo, peso, faixa e ordem. Acrescentar categoria ou corrigir peso é
`insert`/`update`, nunca alteração de código — e é isso que permite a tela de
administração funcionar como a de critérios do monitorias.

---

## As entradas

**`volume_semanal`** — o relatório semanal do Huggy. É daqui que sai
`finalizados`, que multiplica quase toda a cota. Não confundir com a contagem
de `atendimentos`: a base só guarda atendimento que gerou avaliação, e a
diferença é real (102 finalizados contra 98 avaliações na 1ª semana da Allana).

**`avaliacoes`** — as avaliações de **todos os canais**, distinguidos pela
coluna `origem`: `huggy` e `diretores`. Notas `-1` e `0` são inválidas: ficam
gravadas, mas fora da contagem e fora do denominador do C-SAT.

Uma tabela só, e não uma por canal, porque as regras são as mesmas — as cinco
faixas de C-SAT e os cinco pesos de nota valem para os dois. Duas tabelas
significariam a regra escrita duas vezes, que é justamente o defeito da
planilha: lá os blocos aparecem duplicados e um deles saiu desalinhado sem
ninguém notar.

**O que a faixa de C-SAT multiplica muda por canal, de propósito:**

| Canal | Multiplica | Por quê |
|---|---|---|
| `huggy` | finalizados do relatório de volume | a base só tem quem avaliou; contá-la subestimaria (102 finalizados contra 98 avaliações) |
| `diretores` | a contagem da própria base | não existe relatório de volume separado para esse canal |

A medição de **executivos** deixou de existir e sai de circulação pelo campo
`ativo` das regras, não por `delete`: fechamentos antigos referenciam essas
chaves, e apagá-las quebraria o histórico do que foi entregue.

**`monitorias`** — já pronta, ligada por `pessoas.id`, escala 0 a 1.

**`lancamentos`** — o que não existe em sistema nenhum e o gestor digita:
diretores, faixas de tempo de resposta, transferências, demandas extras. Cada
linha guarda quem lançou e quando.

Duas regras não são `quantidade × peso` e sim valor digitado, marcadas com
`valor_manual`: **Atestado**, cujo desconto é decidido conforme a quantidade de
faltas, e **Inconsistência de atendimentos** — o "zera o dia", que na planilha é
texto sem fórmula nenhuma por trás.

**Conferência.** Todo atendimento a diretores levou algum tempo para ser
respondido, então as três faixas de tempo somadas têm que dar o total de
atendimentos — em julho batem exatamente (602 e 602). A view
`vw_lancamentos_a_conferir` lista quando não bate, para a tela avisar. Avisa,
não bloqueia. Sem isso, digitar 500 numa faixa e esquecer 102 custa 306 pontos
que não são creditados, com a cota fechando menor e com aparência normal.

**A meta é uma só.** Fica no grupo `config` da tabela `regras` e vale para
todos: alterá-la é um `update` numa linha, e todo mundo passa a ser medido pelo
novo valor no mesmo instante. Guardá-la por pessoa permitiria metas divergentes
sem ninguém perceber — e como ela é o denominador do "quanto falta", duas
pessoas com o mesmo desempenho apareceriam com atingimentos diferentes. Ciclos
já fechados não são afetados: o fechamento grava a meta que valia no dia.

---

## As regras confirmadas contra a planilha fechada

Refiz o mês de julho do Pedro linha a linha e fecha em **9.059,75**, idêntico à
célula. As quatro semanas da Allana em agosto também fecham (414, 1.067, 1.058
e 848, somando 3.387).

**C-SAT da semana** = `(notas 4 + 5) ÷ (notas válidas)`. A faixa define o peso,
e o peso multiplica os **finalizados**, não as avaliações.

| Faixa | Peso |
|---|---|
| ≥ 95% | +1 |
| 90% a 94,9% | +0,5 |
| 85% a 89,9% | +0,25 |
| 80% a 84,9% | −0,25 |
| < 80% | −1 |

**Semana sem nenhuma avaliação válida não gera linha de C-SAT.** Nem positiva
nem negativa. Na planilha ela daria zero, cairia em "< 80%" e aplicaria −1 por
finalizado — punindo quem trabalhou e não foi avaliado.

**TME** é o da equipe, igual para todos na semana, aplicado aos finalizados de
cada um. Os três pesos são zero hoje.

**Monitoria** é a única regra que não é quantidade × peso: `75 × média` quando a
média passa de 85%, zero quando não passa. O teste é estritamente maior, e a
média é sobre as monitorias que existirem — não sobre quatro fixas. Confirmado
na planilha de julho: média 0,99 rende 74,25, não 75.

**Diretores** tem bloco próprio: o atendimento mais três faixas de tempo de
resposta, todos lançados à mão. O bloco de executivos existia na planilha e
saiu — a medição não existe mais.

---

## Fechamento

O extrato é vivo e reflete sempre a regra atual. O **fechamento** congela o que
foi entregue: `fechamentos_cota` guarda o resultado por pessoa e competência, e
`fechamento_linhas` guarda cópia de cada linha do extrato naquele momento.

Existe porque a pontuação vira remuneração e é repassada a outro departamento.
Se um peso for corrigido em outubro, julho continua valendo 9.059,75 — que foi
o número enviado. Sem isso, reabrir julho depois de qualquer ajuste devolveria
outro número, e não haveria como explicar o que foi pago.

Não há caminho de exclusão, de propósito.

---

## Quem vê o quê

Reaproveita as guardas do monitorias: `pessoa_atual()`, `ve_o_time()`,
`eh_gestor()`. Nada de lista de e-mails no código.

| | Operador | Qualidade | Gestor |
|---|---|---|---|
| Próprio extrato e fechamento | sim | sim | sim |
| Extrato do time | não | sim | sim |
| Importar volume e avaliações | não | não | sim |
| Lançar manual | não | não | sim |
| Fechar o ciclo | não | não | sim |

As políticas antigas de `atendimentos` e `cotas` são removidas pelo nome e
substituídas. O conteúdo delas nunca foi levantado, e sistema que remunera não
convive com regra de acesso desconhecida — em vez de auditar, substitui-se por
regra conhecida.

**A média da equipe** que o operador vê hoje é a constante `82,93` escrita no
código, porque ele não pode ler as linhas dos colegas. Passa a vir de
`csat_da_equipe()`, que devolve só o agregado.

---

## O relatório

Sai do extrato, na ordem da planilha, que é a estrutura que o outro
departamento já reconhece:

1. C-SAT geral e por semana, coluna por atendente
2. C-SAT executivos
3. TME médio — *Média Geral* e *Média Bonificável*
4. Monitorias por semana
5. Total de avaliações e distribuição das notas 1 a 5
6. Volume por semana e média semanal
7. Comparativo com o mês anterior
8. Resumo Cota — pontuação e quanto falta

A exportação reaproveita `lib/xlsx-escrever.ts` e a rota `/api/exportar`, que já
funcionam no Cloudflare.

---

## Correções ao que eu havia afirmado antes

Duas conclusões que tirei do arquivo de teste **não se sustentam** na planilha
fechada:

- A Cota Mensal **tem** linhas de monitoria (uma por semana, linhas 23 a 27).
- As faixas de C-SAT **somam exatamente** os finalizados. O descompasso de +2
  era do arquivo de teste.

E a aba do Pedro não serve de norte: 88% da cota dele vem de digitação manual
porque o atendimento a diretores não tem exportação de sistema. Para a maioria
da equipe a parte automática é que domina.

---

## Onde parei

**Nada foi executado no banco.** As migrações 12 e 13 estão escritas e
conferidas (delimitadores, parênteses e existência das colunas), mas nunca
rodaram — a sintaxe só o Supabase confirma.

O painel foi pausado aqui em 01/09/2026 para um ajuste no sistema de
monitorias. Ponto de retorno: a tag `painel-cota-modelo`.

Retomado em 14/09/2026. Decisões do gestor nessa data:

- **Regras por cargo, configuráveis na plataforma.** O catálogo de regras é
  um só (rótulo, grupo, faixas). O peso e a meta ficam em `pesos_por_cargo`,
  e o cargo de cada pessoa em `cargos_da_pessoa`, com vigência por
  competência, para que uma promoção não altere meses anteriores. As
  migrações partem de um cargo "Atendente" com os pesos atuais e todos os
  avaliados nele. Os demais cargos (Júnior, Pleno, Analista...) são criados
  pela plataforma.
- **Avaliações de diretores por lançamento manual**, em `avaliacoes` com
  `origem = 'diretores'` e o campo aberto `observacao`.
- **Os três cargos** (migração 17):
  - *Atendente Júnior* — todas as regras. Todos os avaliados.
  - *Atendente Pleno* (Suyara Martins) — média dos resultados mensais dos
    Júniors × 1,2, mais as demandas extras que forem cadastradas. Ex.: Allana
    4.500, Bruno 4.000, Rafael 5.000 → 4.500 × 1,2 = 5.400. A média entra
    como uma linha do extrato, para o fechamento guardar a conta e não só o
    total. Só entra na média quem pontuou no mês.
  - *Analista* (Matheus Camargo) — lançamentos manuais: tratativas de chamados
    (20), SLA ≤ 2 dias (5), SLA > 2 dias (−5). Meta 5.000. As faixas de SLA
    são conferidas contra o total de chamados, como as de diretores.
- **"Recebe por média" é configuração do cargo** (migração 18): em
  `cargos_referencia`, cada cargo escolhe quais cargos compõem a sua média;
  o multiplicador é o peso de `media_da_equipe`. Pleno = média dos Júniors;
  *Gestor* = média de Júnior e Analista × 1,5 (o Pleno não compõe a média do
  Gestor no cenário atual). A seleção é por cargo, não por pessoa. As médias são
  encadeadas — a do Gestor usa o resultado completo do Pleno — e configuração
  circular é bloqueada por gatilho.

## Em aberto

**Passos técnicos, na ordem**

1. Rodar `12-painel-de-cota.sql` e depois `13-calculo-da-cota.sql`.
2. Conferir se `nome_huggy` chegou completo em `pessoas` e então apagar
   `atendentes` (a linha está comentada no fim da migração 12).
3. Construir o importador do relatório semanal do Huggy. É ele que destrava a
   cota completa: sem `volume_semanal` não há linha de Huggy, de C-SAT nem de
   TME.
4. Reimportar as avaliações com procedência, comparar com `atendimentos` — é aí
   que a diferença de 16 registros entre planilha e banco aparece — e só então
   apagar a tabela antiga.
5. As telas. **Feitas na v4.12.0:** cargos e pesos, cargo de cada pessoa
   (em Configurações) e lançamentos manuais com avaliações de diretores e
   conferência das faixas (em "Lançamentos de cota"). **Faltam:** extrato
   semanal, fechamento e relatório do ciclo.

## Decisões de 16/09/2026

- **Hub substituiu o Huggy em 03/09/2026.** Importação em Performance →
  Importar (migração 19). Setor Expansao → origem `huggy`; Diretores-Expansao
  → origem `diretores`. Entram só notas 1 a 5; data + protocolo repetidos são
  ignorados; pessoa sem "Nome no Hub" fica de fora com aviso, sem bloquear.
  Volume de finalizados continua manual.
- **C-SAT** = notas 4 e 5 ÷ notas 1 a 5, por pessoa, semana (pela data da
  avaliação) e canal. Na tela inicial do operador há seletor de canal, que abre
  no canal com mais avaliações.
- **Média da equipe** inclui todos que têm avaliação no canal, gestores
  inclusive — decisão do gestor.

## Situação em 18/09/2026 (Performance 0.11.0)

Pronto e publicado em `painel-performance.expansao.workers.dev`: importação do
Hub, volume e lançamentos por canal, configuração de cargos, telas iniciais do
operador e do gestor, extrato (semanas × mês, blocos por canal, composição da
média), fechamento com correção e histórico (migração 22) e exportação em dois
formatos — detalhado e resumo no layout de `Cota expansão.xlsx`.

Em andamento: o gestor está conferindo os números contra a planilha antiga.

Antes de divulgar: trocar senhas ainda padrão, monitor do Performance no
Better Stack, versão 1.0.0.

## Situação em 24/09/2026 (Performance 1.4.0)

**Contraprova concluída.** O gestor conferiu setembro contra a planilha antiga,
célula a célula, nos dois canais ("C-SAT Huggy" = Expansão, "C-SAT Executivos"
= Diretores-Expansão). Todos os números individuais bateram. As duas únicas
diferenças foram de critério e de fórmula, não de cálculo:

- a **média da equipe** da planilha é a média simples das porcentagens,
  ignorando quem está em 0%; a do painel é agregada (soma de positivas ÷ soma
  de avaliações), que pondera por volume. A da planilha reproduz exatamente as
  cinco linhas do Huggy. Nenhuma das duas afeta pagamento — a faixa que pontua
  usa o C-SAT individual;
- duas células do "Geral" dos Executivos (semana 11/09–18/09 e Mensal) não
  seguem nem a regra da própria planilha. Provável erro de intervalo na
  fórmula.

**Métricas configuráveis pela tela** (0.13.0). Em Configuração: editar o nome
de cada métrica, os limites das faixas — TME em minutos e C-SAT em %, com a
conversão na tela, porque o banco guarda segundos e fração —, ligar e desligar,
e criar métrica nova. Métrica nova é sempre de **lançamento manual**: as
automáticas saem de cálculo no banco e não têm como nascer de um cadastro de
tela. O nome do cargo também é editável, menos o do cargo de base, que é
reconhecido pelo nome e serve de referência para os demais.

**Exportação corrigida** (0.14.1). Ela nunca baixava: `/api/cota/exportar`
começa com `/api` e o middleware a tratava como caminho de outro sistema,
redirecionando para a tela inicial antes de executar a rota. As rotas de API da
cota passaram a constar entre os caminhos do sistema.

**Entrada, saída e registro de quem sai** (0.15.0, migração 23). A chave
`ativo` misturava estar na operação e ter login, e não tinha data — sem data o
painel não distingue um mês inteiro de um mês pela metade. Agora:

- `pessoas.admitido_em` e `pessoas.desligado_em`. Em branco = já estava antes
  do painel existir;
- **mês parcial não compõe a média do cargo**, dos dois lados — quem sai e quem
  é admitido no meio da competência. O extrato da pessoa continua intacto;
- a tabela `saidas` guarda a foto do dia da saída: ficha cadastral e a cota de
  cada competência. Ela existe porque o extrato é vivo — quando as avaliações
  de quem saiu são reatribuídas, o mês dele esvazia e não sobra prova;
- `registrar_saida` grava a data, a foto e encerra o acesso num passo só;
  `reverter_saida` devolve o acesso e mantém o registro, marcado como revertido;
- a tela **Atendentes** mora só no Performance; o efeito vale nos dois sistemas,
  porque o cadastro é o mesmo banco e toda página interna barra quem está sem
  acesso.

### O caso que originou a regra

Bruno Aguiar, desligado em 11/09/2026. Setembro fechou com uma semana
trabalhada (964,75) e esse mês parcial derrubou a média dos Juniores de
3.351,36 para 3.053,03 — menos 358 na Suyara (Pleno) e menos 447 no Gestor.
Resolver com `ativo` estaria errado: tiraria o Bruno também de **agosto**, mês
que ele trabalhou inteiro e em que ficou acima da média (1.346,50 contra
1.139,74). Daí a regra ser por data, e não por chave liga/desliga.

Por decisão do gestor, as **114 avaliações** dele em setembro foram
reatribuídas a Ibson, João, Rayssa e Rafael, sob duas travas: nenhuma faixa de
C-SAT semanal podia cair e ninguém podia terminar o mês com menos ponto. As
positivas entram primeiro e abrem folga para as notas baixas caberem; a
divisão saiu em 29/29/28/28 e nada sobrou. Cada linha movida ficou com a
observação "Reatribuído de Bruno Aguiar (desligado) em 24/09/2026", que permite
auditar e desfazer. O volume de finalizados foi redistribuído pelo gestor na
tela de Lançamentos.

**Telas de Lançamentos e Configuração** passaram a mostrar quem foi desligado:
em Lançamentos, só no mês em que ainda tem dado; em Configuração, sempre, por
último e com etiqueta. Sem isso não havia como acertar o volume de quem sai no
meio da competência — que é justamente quando o acerto é preciso.

Antes de divulgar, continua valendo: trocar senhas ainda padrão, monitor do
Performance no Better Stack, versão 1.0.0.

### Versionamento

Revisto em 24/09/2026. A numeração anterior da cota (0.x) contava publicações,
não entregas: três versões — 0.12.0, 0.13.0 e 0.14.0 — foram ao ar sem commit
correspondente, ou seja, houve código em produção com número que não existia no
repositório.

Recontada pelo que foi de fato entregue, a partir da estreia em produção:

| Entrega | Tipo | Versão |
|---|---|---|
| Estreia em produção: importação, lançamentos, extrato, fechamento, exportação (18/09) | — | 1.0.0 |
| Métricas editáveis e nome do cargo | recurso | 1.1.0 |
| Criação de métricas pela tela | recurso | 1.2.0 |
| Desligados nas telas de Lançamentos e Configuração | recurso | 1.3.0 |
| Correção da exportação (middleware) | correção | 1.3.1 |
| Painel de Atendentes e regra de mês parcial | recurso | **1.4.0** |

A regra de mês parcial **não** alterou competência alguma já calculada —
julho (190,88), agosto (1.139,74) e setembro (3.886,57) seguem iguais —, por
isso é MINOR e não MAJOR.

Regra daqui em diante, para os dois sistemas:

- **MAJOR** — muda regra de cálculo que altera pontuação de competência já
  calculada, ou obriga a refazer um envio;
- **MINOR** — recurso novo;
- **PATCH** — correção, sem mudar número de ninguém;
- **commit e tag antes do deploy**, sempre.
