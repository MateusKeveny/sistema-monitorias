# Hospedagem — Monitorias de Qualidade, Painel de Performance e Agenda da Gestão

Documento para a equipe de TI avaliar a migração para servidores internos da
IGreen. Situação em 21/10/2026.

---

## 1. O que são os três sistemas

**Um único código-fonte atende os três sistemas.** Não são três projetos: é um
aplicativo Next.js (versão 16) publicado três vezes. Cada publicação mostra só
o seu sistema.

| Sistema | Endereço atual | Versão | Para que serve |
|---|---|---|---|
| Monitorias de Qualidade | `painel-monitorias.expansao.workers.dev` | 5.7.0 | Monitorias de qualidade dos atendimentos: lançamento por sorteio de protocolo, painel, relatórios e consulta ao diário de bordo |
| Painel de Performance | `painel-performance.expansao.workers.dev` | 2.9.0 | Cota de pontos por cargo: importação das avaliações (Hub), do volume (colado do Hub) e dos chamados do Analista (painel ELO), importação de meses anteriores por planilha, lançamentos, extrato, projeção, simulação de cenários, fechamento, pagamento (com o valor encaminhado pelo RH), conferência diária do cálculo, avisos no sino e no canto da tela (Web Push), exportação para o portal, atendentes, diário de bordo, consulta das monitorias, acessos e histórico de pesos |
| Agenda da Gestão | `painel-agenda.expansao.workers.dev` | 1.5.1 | Agenda pessoal do gestor com lembretes no computador/celular (Web Push e Telegram). **Banco e login próprios** (outro projeto Supabase) |

Qual sistema cada publicação mostra é decidido em `lib/sistema.ts`:

- endereço começando com `painel-performance.` → Performance;
- endereço começando com `painel-agenda.` → Agenda;
- qualquer outro endereço → Monitorias, **a menos que** a variável de ambiente
  `SISTEMA` esteja definida: `cota` → Performance, `agenda` → Agenda.

Num servidor interno, cada sistema roda como **uma instância separada**. Os
pacotes abaixo foram montados para os dois painéis; a Agenda usa o mesmo
código com `SISTEMA=agenda` e as variáveis do banco dela (seção 5):

| Pacote | Sistema | Variável |
|---|---|---|
| `Monitorias de Qualidade - codigo.zip` | Monitorias | `SISTEMA` vazio |
| `Painel de Performance - codigo.zip` | Performance | `SISTEMA=cota` |

Os pacotes têm o mesmo código. Uma correção feita em um precisa ser
aplicada no outro — ou, melhor, mantida num repositório só e publicada nos dois.

> O antigo "Painel de Performance" (projeto Vite, em
> `OneDrive/Projetos/Painel de performace`) está **descontinuado**. O site dele
> foi excluído em 14/09/2026 e ele não faz parte deste pacote.

---

## 2. Como está hospedado hoje

```
Navegador ──HTTPS──► Cloudflare Workers (3 Workers, plano gratuito)
                          │
                          ├──HTTPS──► Supabase dos painéis (PostgreSQL + login)
                          │             projeto uahkplwssonbxzydjytb
                          └──HTTPS──► Supabase da Agenda (outro projeto, login próprio)

Better Stack ──► /api/saude  (monitoramento de queda, nos três sites)

Supabase dos painéis ──HTTPS──► Microsoft Teams (avisos automáticos, pg_net + pg_cron)
Supabase dos painéis ──pg_cron──► resumo do mês aberto (a cada minuto) e conferência do cálculo (06:00)
Supabase da Agenda ──pg_net──► /api/agenda/enviar ──► Web Push / Telegram (lembretes)
Performance ──Web Push──► computador do atendente (avisos do sino, para quem ativou)
```

| Camada | Serviço | Plano | Observação |
|---|---|---|---|
| Aplicação | Cloudflare Workers — `painel-monitorias`, `painel-performance` e `painel-agenda` | Gratuito | Conta da operação Expansão. Publicação com OpenNext (`npm run cf:deploy`) |
| Banco de dados | Supabase (PostgreSQL 15+) — dois projetos: o dos painéis e o da Agenda | Verificar no painel do Supabase | Também faz o **login** dos usuários |
| Monitoramento | Better Stack | Gratuito | Vigia `/api/saude` dos sites |
| Avisos | Microsoft Teams (Workflows) | — | O **banco** posta os cartões: semana encerrada, mês fechado, lembrete de fechamento, novidades do diário, report novo |
| Tarefas agendadas | pg_cron, dentro do banco | — | Painéis: `avisos-das-oito` (8h), `resumo-do-mes` (a cada minuto: mantém pronto o cálculo do mês aberto) e `conferencia-do-calculo` (06:00: confere se o cálculo bate entre si). Agenda: `agenda-avisos` e `agenda-ciclo` (a cada minuto) |
| Notificações no computador | Web Push (padrão dos navegadores) | — | Chave VAPID única para Agenda e Performance; a privada é segredo dos Workers |

### Por que migrar

O plano gratuito da Cloudflare dá **10 ms de processamento por acesso**. As
telas foram otimizadas para caber nisso, mas é um teto baixo:

- em 01/09/2026 o sistema caiu (erro 1102) quando várias páginas foram
  carregadas ao mesmo tempo;
- em 05/10/2026 o erro 1102 voltou no Performance, agora no uso normal: os
  registros da Cloudflare mostraram páginas gastando de 11 a 360 ms, a tela
  de login inclusive. A versão 1.35.4 reduziu o consumo (ícone do site servido
  como arquivo e menos consultas ao banco por acesso), mas o limite de 10 ms
  **está confirmado** e o sistema já opera no teto;
- a alternativa sem migrar é o plano pago dos Workers (US$ 5/mês, 30 s de
  processamento por acesso). Decisão do gestor: aguardar a migração;
- em 21/10/2026 o Next.js 15 saiu do suporte e o sistema foi para o Next.js
  16 (2.2.1 / 5.6.3 / 1.5.1). Com ele, um erro 1102 ainda pode aparecer numa
  primeira carga mais pesada; o F5 resolve;
- em 13/10/2026 o impacto foi reduzido: a renovação do login passou para o
  navegador (1.39.2 — um 1102 não derruba mais a sessão) e as telas ficaram
  mais leves (1.39.3 a 1.40.0 — consultas em paralelo, mês fechado lido do
  congelado e o mês aberto guardado pronto no banco). O Extrato do gestor
  caiu de ~3,2 s para ~0,6 s. O teto de 10 ms continua; o erro pode voltar a
  aparecer numa tela, e o F5 resolve;
- a leitura de planilhas teve de ser feita no navegador do usuário, e não no
  servidor, para não estourar o limite;
- recursos futuros ficam limitados por esse teto.

Num servidor próprio esse limite **não existe**.

---

## 3. O que o servidor interno precisa

| Item | Requisito |
|---|---|
| Sistema | Linux ou Windows Server com **Node.js 20.9 ou superior** (exigência do Next.js 16; testado no 24) |
| Memória | estimativa: ~512 MB por instância (três instâncias: ~1,5 GB) |
| Disco | estimativa: ~500 MB por instância, com as dependências |
| Rede de saída | HTTPS (443) para `*.supabase.co`, se o banco continuar no Supabase. Com o banco interno, o **servidor do banco** precisa de saída HTTPS para os endereços de Workflows do Microsoft Teams (avisos) |
| Rede de entrada | HTTPS obrigatório, com proxy reverso (Nginx, IIS, Apache) na frente do Node |
| Endereços | Três nomes internos, um por sistema. Ex.: `monitorias.igreen.local`, `performance.igreen.local` e `agenda.igreen.local` |

HTTPS é obrigatório: o login usa cookies de sessão seguros, que o navegador não
envia em conexão sem criptografia.

---

## 4. Como publicar no servidor

Os comandos são os mesmos nas três instâncias; só muda a variável `SISTEMA`.

```bash
# 1. Instalar as dependências (usa as versões exatas do package-lock.json)
npm ci

# 2. Criar o arquivo .env.local (seção 5) — ANTES do build

# 3. Gerar a versão de produção
npm run build

# 4. Subir o servidor (escolha a porta)
npx next start -p 3000        # Monitorias
SISTEMA=cota npx next start -p 3001   # Performance
SISTEMA=agenda npx next start -p 3002 # Agenda
```

Para manter no ar após reinício do servidor, use o gerenciador de serviços da
casa (systemd, PM2, NSSM no Windows…) e aponte o proxy reverso de cada endereço
para a porta correspondente.

### Dois ajustes obrigatórios no código antes do build

1. **Endereço das monitorias** — em `lib/sistema.ts`, a constante
   `ENDERECO_MONITORIAS` aponta para o endereço atual na Cloudflare. O
   Performance usa esse endereço para abrir uma monitoria. Trocar pelo novo
   endereço interno.
2. **Publicação na Cloudflare** — os scripts `cf:build`, `cf:deploy` e o
   arquivo `wrangler.jsonc` só servem para a Cloudflare. No servidor interno
   eles não são usados e podem ser ignorados.

---

## 5. Variáveis de ambiente

Os valores **não estão no pacote**, por segurança. Devem ser pedidos ao
responsável (Mateus Keveny) e gravados no arquivo `.env.local` de cada
instância.

| Variável | Onde é usada | Sensível? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Aplicação (servidor e navegador) | Não — é pública |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Aplicação (servidor e navegador) | Não — é pública; a proteção dos dados é feita no banco |
| `SUPABASE_URL` | Somente scripts de manutenção (`scripts/`) | Não |
| `SUPABASE_SERVICE_ROLE_KEY` | Somente scripts de manutenção | **Sim — dá acesso total ao banco.** Nunca colocar no servidor web |
| `SENHA_PADRAO` | Somente o script de criação de acesso | **Sim** |
| `SISTEMA` | Aplicação | Não. `cota` no Performance; `agenda` na Agenda; vazio nas Monitorias |
| `NEXT_PUBLIC_AGENDA_SUPABASE_URL` / `NEXT_PUBLIC_AGENDA_SUPABASE_ANON_KEY` | Agenda (projeto Supabase dela) | Não — públicas |
| `VAPID_PUBLICA` | Agenda e Performance (notificações no computador) | Não — vai para o navegador |
| `VAPID_PRIVADA` | Agenda e Performance (assinatura das notificações) | **Sim** |
| `AGENDA_SEGREDO` / `PONTE_SEGREDO` | Agenda (chamadas do banco da agenda e ponte com o dos painéis) | **Sim** |
| `TELEGRAM_TOKEN` | Agenda (lembretes pelo Telegram) | **Sim** |

As variáveis `NEXT_PUBLIC_*` são embutidas no momento do `npm run build`:
trocar o valor exige gerar o build de novo.

---

## 6. Banco de dados

A IGreen pretende levar **também o banco** para servidor interno. O destino
define o tamanho do trabalho:

| Destino | O que muda no código | Esforço |
|---|---|---|
| **Supabase *self-hosted*** (instalado nos servidores da IGreen, via Docker) | Nada. Troca só o endereço e as chaves no `.env.local`, e o build é gerado de novo | Baixo |
| **PostgreSQL comum**, sem Supabase | O sistema depende de três peças do Supabase: o **login** (usuários e senhas), a **API automática** pela qual o site lê e grava, e as **permissões por usuário** (`auth.uid()` nas regras do banco). Tudo isso teria de ser reescrito | Alto — projeto à parte |

**Recomendação: Supabase self-hosted.** É PostgreSQL por baixo, roda na
infraestrutura da IGreen e não tem nenhum dos limites atuais.

### Como migrar os dados

1. **Acesso ao banco atual.** A cópia usa a conexão direta com o PostgreSQL,
   não as chaves da aplicação: supabase.com → projeto → **Project Settings →
   Database → Connection string**. A senha do banco pode ser redefinida nessa
   tela. Endereço e senha são **secretos** e vão por canal seguro.
2. **Copiar o banco inteiro, incluindo o esquema `auth`.** É nele que ficam
   os usuários e as senhas (criptografadas). Sem ele, todo mundo teria de criar
   senha de novo. Seguir o guia oficial do Supabase de *backup e restauração
   pela linha de comando*, que separa papéis, estrutura e dados.
3. **Chaves novas.** O banco novo gera URL e chaves próprias. Atualizar o
   `.env.local` das duas instâncias e **gerar o build de novo** — as variáveis
   `NEXT_PUBLIC_*` ficam embutidas no build.
4. **Janela sem uso.** O que for gravado no banco atual depois da cópia não
   chega ao novo. Combinar a virada para um momento sem lançamentos, de
   preferência logo depois de um fechamento de ciclo.
5. **Conferir.** `/api/saude` das duas instâncias respondendo `"estado":"ok"`,
   login de um usuário de cada papel, o extrato de um mês já fechado igual ao
   de antes, as tarefas agendadas recriadas (`cron.job`) e o Extrato do mês
   aberto mostrando "Atualizado às" com horário recente. `select * from
   public.conferir_resumo();` deve dar zero em todas as linhas.

Os dois sistemas usam **o mesmo banco** e precisam continuar juntos: a
migração leva os dois de uma vez.

### Estrutura

As migrações estão em `supabase/`, numeradas na ordem em que foram aplicadas
(01 a 78). O banco de produção já está com **todas aplicadas**. As da Agenda
estão em `supabase/agenda/` (01 a 04), no projeto dela.

- `00-instalar-tudo.sql` é um atalho antigo que junta as primeiras migrações;
  não usar junto com elas.
- Uma instalação do zero em outro banco **não é trivial**: a migração 12
  aproveita tabelas de um sistema anterior (`atendimentos`, `atendentes`).
  Por isso a migração é por **cópia do banco atual**, como descrito acima, e
  não rodando as migrações do zero.

### Recursos do Supabase além do banco

O banco novo precisa oferecer, além do PostgreSQL e do login:

- **pg_net e pg_cron** (migração 40). O próprio banco posta os avisos no
  Teams e roda a rotina diária das 8h (horário de Brasília). Sem essas
  extensões, os avisos param; o resto do sistema segue funcionando. Os
  endereços dos Workflows ficam na tabela `avisos_teams` e vão junto na cópia.
- **pg_cron também mantém o resumo do mês aberto** (migração 58, tarefa
  `resumo-do-mes`, a cada minuto). As telas do Performance leem o cálculo do
  mês aberto já pronto, em tabelas de resumo; gatilhos marcam quando algum
  dado muda e a tarefa recalcula. **Sem a tarefa, nada quebra e nenhum número
  fica errado**: passados 40 minutos sem atualização, as telas voltam sozinhas
  ao cálculo ao vivo — só ficam mais lentas (~3 s no Extrato).
- **pg_cron roda a conferência do cálculo** (migração 72, tarefa
  `conferencia-do-calculo`, 06:00): confere se o resumo bate com o cálculo
  completo e se os fechamentos somam o resultado congelado. Divergência vira
  pendência na tela do gestor; nada é corrigido sozinho.
- **As tarefas agendadas não vão na cópia.** Elas ficam no esquema `cron`,
  fora do `public`. Depois de restaurar o banco, recriá-las rodando de novo o
  bloco final `do $ … cron.schedule …` das migrações 40, 58 e 72 (e, no
  banco da Agenda, das migrações 01 e 03 dela), e conferir com
  `select jobname, schedule, active from cron.job;`.
- **Storage** (migração 44). O bucket privado `reportes` guarda os prints
  anexados em "Reportar problema". A cópia do banco **não** leva os arquivos:
  eles precisam ser copiados à parte, ou os reports antigos ficam sem imagem.
- **Endereço dos sites no banco.** Os links dos cartões do Teams saem de
  `endereco_do_site()`. Com endereços novos, ajustar a função.

### Segurança dos dados

- As permissões são aplicadas **dentro do banco** (Row Level Security): um
  operador só recebe os próprios dados, mesmo que acesse a API diretamente.
- Os papéis são Gestor, Qualidade e Operador, definidos na tabela `pessoas`.
- Os dois sistemas usam as mesmas contas: o mesmo e-mail e senha valem nos dois.
- Senha esquecida é redefinida pelo gestor, na tela Atendentes: o sistema gera
  uma senha temporária, encerra as sessões abertas e obriga a troca no
  próximo acesso. Cada redefinição fica registrada.
- Os chamados do Analista vêm da exportação do painel ELO, importada pelo gestor (tabela `chamados_elo`, migrações 53 a 55); a planilha é lida no navegador, como a do Hub.
- Cada abertura dos painéis fica registrada (tabela `acessos`, migração 52) e
  só o gestor consulta, na tela Acessos do Performance.

---

## 7. Monitoramento

`GET /api/saude` consulta o banco de verdade e responde:

```json
{"estado":"ok","sistema":"cota","versao":"5.7.0","versoes":{"monitorias":"5.7.0","cota":"2.9.0","agenda":"1.5.1"},"ms":95}
```

- `200` com `"estado":"ok"`: aplicação e banco funcionando;
- `503` com `"estado":"falha"`: a aplicação não alcançou o banco.

Não exige login e não devolve nenhum dado do sistema. Serve para qualquer
ferramenta de monitoramento da TI.

---

## 8. O que vai no pacote

| Pasta / arquivo | Conteúdo |
|---|---|
| `app/` | Páginas e rotas de API (Next.js App Router) |
| `componentes/` | Componentes de tela |
| `lib/` | Regras compartilhadas, acesso ao banco, versões, seleção de sistema |
| `supabase/` | Migrações do banco, em ordem |
| `scripts/` | Scripts de manutenção (importação; criação de acesso, hoje substituída pelo botão "Criar acesso" na ficha do atendente) — uso manual |
| `docs/` | Documentação, incluindo este arquivo e o modelo da cota |
| `middleware.ts` | Controle de sessão e separação entre os três sistemas. O Next.js 16 sugere o nome `proxy.ts`; ficou o antigo porque, na Cloudflare, o novo roda em modo experimental (num servidor próprio, a troca é livre) |
| `public/agenda-sw.js`, `public/cota-sw.js` | Service workers das notificações no computador (Agenda e Performance) |
| `package.json` / `package-lock.json` | Dependências com versões exatas |
| `.env.example` | Modelo das variáveis (sem valores) |

**Não vão no pacote**, de propósito: `node_modules/` (recriada pelo `npm ci`),
os builds (`.next/`, `.open-next/`), as chaves (`.env.local`, `.dev.vars`) e a
pasta `dados/`, que contém avaliações nominais de pessoas.
