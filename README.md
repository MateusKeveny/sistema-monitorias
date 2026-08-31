# Sistema de Monitorias de Qualidade (C-SAT)

Substitui a planilha `Dashboard Monitorias.xlsm` por um sistema web com banco de dados
online, três níveis de acesso e relatórios prontos.

- **Front-end:** Next.js 15 (App Router) + Tailwind
- **Banco e autenticação:** Supabase (PostgreSQL)
- **Hospedagem:** Cloudflare Workers (via `@opennextjs/cloudflare`)

---

## O que ele faz

| Tela | Para quê |
|---|---|
| **Painel** | Nota média do mês, zeradas, evolução mês a mês, ranking e os critérios que mais custam nota |
| **Nova monitoria** | Formulário dos 19 critérios com a **nota calculada em tempo real** pelos pesos |
| **Monitorias** | Lista filtrável por operador, mês e zeradas, com detalhe de cada avaliação |
| **Ranking mensal** | Nota média por operador, com comparação contra o mês anterior (▲/▼) |
| **Critérios reprovados** | Taxa de reprovação **e** nota perdida (taxa × peso), que é o que realmente importa |
| **Folha de feedback** | Uma página por operador/mês, pronta para imprimir ou salvar em PDF, com campo de assinatura |
| **Exportação** | Excel com 2 abas (monitorias + critérios) e CSV com separador `;` que o Excel pt-BR abre direto |
| **Configurações** | Edição dos nomes e pesos dos critérios, dos operadores, dos canais e dos usuários — com trava: a soma dos pesos precisa fechar 100% |

### Perfis de acesso

| Cargo | Vê | Monitora | Pesos e cadastros | Acessos | Exclui |
|---|---|---|---|---|---|
| **Gestor** | tudo | sim | sim | sim | direto |
| **Qualidade** | tudo | lança e edita | não | não | solicita, gestor aprova |
| **Operador** | só as próprias | não | não | não | não |

Pessoas ficam numa tabela só. `avaliado` diz quem entra nas monitorias e `auth_id`
diz quem tem login — os dois são independentes, porque há quem seja avaliado sem
acessar o sistema e quem acesse sem ser avaliado. Desativar a pessoa encerra o
acesso de uma vez, sem procurar em dois lugares.

A exclusão pedida pela Qualidade fica pendente até um gestor decidir, e a monitoria
continua valendo nos relatórios enquanto isso. Quem decide o caminho é o banco, pelo
papel de quem chamou — não a interface.

O isolamento é feito por **Row Level Security no próprio Postgres**, não só na interface —
mesmo que alguém chame a API diretamente, não consegue ler os dados de outra pessoa.

---

## Regra de cálculo da nota

Idêntica à da planilha, agora garantida por *trigger* no banco:

```
zerado por falha crítica  ->  nota = 0
caso contrário            ->  nota = 1 − (soma dos pesos dos critérios marcados "Não")
```

Os 19 pesos somam exatamente 1,0000. A extração da planilha recalculou as 52 monitorias
existentes por esta fórmula e bateu com o Excel em **100% dos casos** — a regra está fiel.

A nota nunca é digitada: ela é derivada dos critérios. Alterar um critério recalcula
a monitoria automaticamente.

---

## Instalação

### 1. Criar o projeto no Supabase

Estes passos envolvem criar conta e senha, então **precisam ser feitos por você**:

1. Acesse <https://supabase.com> e crie uma conta (plano Free).
2. **New project** → nome `monitorias`, região `South America (São Paulo)`,
   e defina uma senha forte para o banco (guarde-a).
3. Aguarde ~2 minutos até o projeto subir.

### 2. Criar as tabelas

No painel do Supabase, abra **SQL Editor** e rode os arquivos de `supabase/` **em
ordem numérica**, um de cada vez, colando o conteúdo e clicando em *Run*.

Cada arquivo é uma migração e a ordem importa: `01` a `03` criam o esquema, e os
seguintes o modificam. Num banco novo, todos precisam ser aplicados na sequência.
Todos podem ser rodados mais de uma vez sem estragar nada.

### 3. Configurar as chaves

No Supabase: **Project Settings → API**. Copie os valores para um arquivo `.env.local`
na raiz do projeto (use o `.env.example` como modelo):

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

> A `service_role` ignora todas as regras de segurança. Ela é usada **só** pelo script de
> importação, na sua máquina. Ela nunca entra no Worker do Cloudflare nem no
> navegador — só nos scripts locais.

### 4. Importar os dados da planilha

```bash
npm install
npm run extrair
npm run importar
```

`extrair` lê o `.xlsm` direto do OneDrive e gera `dados/extracao.json` — ele também
**confere** se a nota do Excel bate com o recálculo pelos pesos e avisa qualquer divergência.
`importar` sobe tudo para o Supabase e é idempotente: rodar duas vezes não duplica nada.

Para apontar para outra planilha:

```bash
node scripts/extrair-planilha.js "caminho/para/outra.xlsm"
```

### 5. Rodar

```bash
npm run dev
```

Abra <http://localhost:3000>.

### 6. Criar o primeiro gestor

1. No Supabase: **Authentication → Users → Add user**, com seu e-mail e uma senha,
   marcando *Auto Confirm User*.
2. Ligue a conta à pessoa e defina o papel:

```bash
npm run vincular
npm run papel -- seu.email@igreenenergy.com.br gestor
```

`vincular` liga contas do Supabase às pessoas pelo e-mail — o gatilho do banco já
faz isso em contas novas, e o comando cobre o que ficou para trás. `papel` sem
argumentos lista todo mundo.

A partir daí você libera os demais pela tela **Configurações**, sem linha de comando.

---

## Publicar no Cloudflare Workers

O projeto usa o adaptador [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare),
que empacota o Next.js para rodar no runtime `workerd`.

> **Não rode um build enquanto o `npm run dev` estiver ativo.** Os dois usam a mesma
> pasta `.next`, e o build de produção sobrescreve o do dev — o sintoma é a página abrir
> sem estilo nenhum, com o CSS dando 404. Se acontecer: encerre tudo, apague `.next` e
> suba o dev de novo.

### Testar localmente no runtime do Cloudflare

```bash
npm run cf:preview
```

Sobe em <http://localhost:8788> usando o mesmo motor da produção. As chaves vêm do
arquivo `.dev.vars` (só as duas públicas — a `service_role` nunca entra no Worker).

### Publicar

Primeiro, autentique-se na sua conta — abre o navegador para você aprovar:

```bash
npx wrangler login
```

Cadastre as duas variáveis públicas no Worker:

```bash
npx wrangler secret put NEXT_PUBLIC_SUPABASE_URL
npx wrangler secret put NEXT_PUBLIC_SUPABASE_ANON_KEY
```

E publique:

```bash
npm run cf:deploy
```

Ao final, o wrangler mostra a URL (`https://monitorias.SEU-SUBDOMINIO.workers.dev`).

### Sobre a URL no Supabase

O login por e-mail e senha **não** exige configurar nada: não há redirecionamento
no fluxo. O campo *Site URL* / *Redirect URLs* (em **Authentication → URL
Configuration**) só passa a ser necessário se um dia forem habilitados link mágico,
"esqueci minha senha", confirmação por e-mail ou login social — aí sim a URL de
produção precisa estar cadastrada lá.

> **Nota sobre Windows:** o OpenNext avisa que não é totalmente compatível com Windows
> e recomenda WSL. O build funciona aqui, mas se der erro `EPERM` ao apagar `.open-next`,
> é algum processo `workerd`/`wrangler` antigo segurando os arquivos — encerre-os e
> rode de novo. Para publicações recorrentes, o mais confiável é rodar o deploy por
> uma GitHub Action em Linux.

---

## Fundos da marca

Cada tema tem sua arte, vinda do material de apresentação da IGreen:

| Arquivo | Tema | Origem | Peso |
|---|---|---|---|
| `public/fundo-claro.webp` | claro | arte verde, clareada e dessaturada | 9,6 KB |
| `public/fundo-escuro.webp` | escuro | arte preta, só redimensionada | 13,3 KB |

Os originais tinham 4000×2250 e cerca de 1 MB cada. Em WebP a 2400px caíram
para ~10 KB — mais de 98% menores, sem diferença visível, porque são degradês
suaves, que é o caso em que esse formato rende melhor.

A arte verde original é saturada demais para servir de fundo a uma tela de
trabalho: texto e tabelas por cima ficariam cansativos. Ela foi composta com
branco a 72% e dessaturada, até chegar ao mesmo grau de discrição do fundo
escuro — presente para marcar a identidade, apagada para não disputar com o
conteúdo.

A imagem fica presa à janela (`background-attachment: fixed`) e os cartões e
tabelas têm fundo sólido por cima, então a arte aparece nas margens e nos vãos,
nunca atrás dos números. Na impressão ela é desligada.

Para trocar as artes:

```bash
npm i -D sharp
node -e "require('sharp')('ORIGEM.jpg').resize({width:2400}).webp({quality:72}).toFile('public/fundo-escuro.webp')"
npm remove sharp
```

O `sharp` entra só para a conversão e sai em seguida: é dependência nativa
pesada e não faz parte da aplicação.

## Estrutura do projeto

```
app/
  (interno)/            telas que exigem login
    page.tsx              painel
    monitorias/           lista, detalhe e formulário de lançamento
    relatorios/           ranking, critérios, folha de feedback
    configuracoes/        pesos e liberação de acesso
  login/                tela de entrada
  api/exportar/         geração do Excel e do CSV
componentes/            interface reutilizável
lib/                    cliente Supabase, tipos, formatação pt-BR
  xlsx-escrever.ts      gerador de .xlsx sem dependências (roda em qualquer runtime)
scripts/
  xlsx-lite.js          leitor de .xlsx/.xlsm escrito do zero, sem dependências
  extrair-planilha.js   planilha  -> dados/extracao.json (com conferência da nota)
  importar-supabase.js  extracao.json -> banco (idempotente)
  sincronizar-perfis.js cria perfil de quem já existia em Authentication
  conferir-conexao.js   valida .env.local e a existência das tabelas
  gerar-exportacao.js   gera o .xlsx direto do banco, sem o navegador
supabase/               os SQL (00-instalar-tudo.sql faz tudo de uma vez)
wrangler.jsonc          configuração do Cloudflare Workers
```

---

## Achados na planilha original

Levantados durante a extração — valem uma conferência sua:

- **Protocolo `-500024265`** está negativo e repetido em duas monitorias da Allana Castro.
  A importação remove o sinal; o duplicado permanece para você decidir.
- **Protocolo `260728598061`** aparece na 2ª e na 3ª monitoria do Ibson Santos.
- **`Matheus Camargo` e `Suyara Martins`** constam em *Parâmetros* mas não têm nenhuma
  monitoria lançada.
- O critério **"Atendimento objective"** estava com erro de digitação; a importação
  já o grava como *"Atendimento objetivo"*.
- A aba *Registro de Monitorias* tinha 264 linhas formatadas, mas apenas **52 com dados**.
- A *Base Detalhada* tinha 53 colunas, das quais 52 casaram com o registro — a órfã é
  uma das duplicatas acima.

## Limites conhecidos

- A **semana do ciclo** continua sendo escolhida manualmente, como na planilha, porque o
  ciclo da IGreen não coincide com a semana do calendário (a 1ª semana ia de 26/06 a 02/07).
- Não há edição de monitoria já lançada pela interface — só criação e consulta. Correções
  hoje são feitas no painel do Supabase. É o primeiro candidato natural a evoluir.
- O PDF do feedback sai pela impressão do navegador (Ctrl+P → *Salvar como PDF*), sem
  biblioteca extra.
