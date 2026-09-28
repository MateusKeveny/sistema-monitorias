# Continuidade — Painel de Performance

Onde o trabalho parou, o que já vale como regra e o que ficou pendente.
Escrito em 28/09/2026. Para o modelo de dados completo, ver
[MODELO-PAINEL.md](MODELO-PAINEL.md); para infraestrutura,
[HOSPEDAGEM.md](HOSPEDAGEM.md).

---

## Estado em 28/09/2026

| | |
|---|---|
| Publicado | Performance **1.11.0** · Monitorias **4.11.2** |
| No código, sem publicar | **1.12.0** — seletor de competência na tela inicial |
| Branch | `painel-performance` (a `main` segue intocada) |
| Migrações no banco | 01 a 28, todas aplicadas |
| Endereços | `painel-performance.expansao.workers.dev` · `painel-monitorias.expansao.workers.dev` |

### O que falta para a 1.12.0 ir ao ar

O código está pronto e compila (`tsc` e `build` conferidos). Falta a sequência
de publicação:

1. `lib/versoes.ts`: `VERSAO_COTA` de `'1.11.0'` para `'1.12.0'`;
2. commit e tag `cota-v1.12.0`, **antes** do deploy;
3. `npm run cf:deploy`.

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

**Cor do C-SAT**: verde a partir de 90%, verde-amarelado de 85% a 90%,
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
- criar o monitor do Performance no Better Stack (o de Monitorias já existe);
- publicar a 1.12.0.

**Trabalho em aberto**

- **Semana 4 de setembro** sem volume lançado — o ciclo fechou em 25/09;
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
