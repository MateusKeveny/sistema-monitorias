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

**Diretores e Executivos** são dois blocos distintos, cada um com suas próprias
três faixas de tempo de resposta.

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

## Em aberto

1. Conferir se `nome_huggy` chegou completo em `pessoas` e então apagar
   `atendentes` (a linha está comentada no fim da migração 12).
2. Destino da tabela `cotas`, cujo `dados_tabela` é um blob JSON que não dá
   para auditar. Provavelmente vira histórico e sai de uso.
3. O layout atualizado do relatório, que o Mateus vai encaminhar. Não muda o
   SQL: categorias são dados, não estrutura.
