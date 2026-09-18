# Hospedagem — Monitorias de Qualidade e Painel de Performance

Documento para a equipe de TI avaliar a migração para servidores internos da
IGreen. Situação em 18/09/2026.

---

## 1. O que são os dois sistemas

**Um único código-fonte atende os dois sistemas.** Não são dois projetos: é um
aplicativo Next.js publicado duas vezes. Cada publicação mostra só o seu
sistema.

| Sistema | Endereço atual | Versão | Para que serve |
|---|---|---|---|
| Monitorias de Qualidade | `painel-monitorias.expansao.workers.dev` | 4.11.2 | Avaliação de qualidade (C-SAT) dos atendimentos |
| Painel de Performance | `painel-performance.expansao.workers.dev` | 0.11.0 | Cota de pontos por cargo: importação, lançamentos, extrato, fechamento e exportação |

Qual sistema cada publicação mostra é decidido em `lib/sistema.ts`:

- endereço começando com `painel-performance.` → Performance;
- qualquer outro endereço → Monitorias, **a menos que** a variável de ambiente
  `SISTEMA=cota` esteja definida, e aí → Performance.

Num servidor interno, cada sistema roda como **uma instância separada**. Por
isso eles são entregues em **dois pacotes**, cada um já configurado para o seu
sistema e com o arquivo `LEIA-ME.txt` de publicação:

| Pacote | Sistema | Variável |
|---|---|---|
| `Monitorias de Qualidade - codigo.zip` | Monitorias | `SISTEMA` vazio |
| `Painel de Performance - codigo.zip` | Performance | `SISTEMA=cota` |

Os dois pacotes têm o mesmo código. Uma correção feita em um precisa ser
aplicada no outro — ou, melhor, mantida num repositório só e publicada nos dois.

> O antigo "Painel de Performance" (projeto Vite, em
> `OneDrive/Projetos/Painel de performace`) está **descontinuado**. O site dele
> foi excluído em 14/09/2026 e ele não faz parte deste pacote.

---

## 2. Como está hospedado hoje

```
Navegador ──HTTPS──► Cloudflare Workers (2 Workers, plano gratuito)
                          │
                          └──HTTPS──► Supabase (PostgreSQL + login)
                                        projeto uahkplwssonbxzydjytb

Better Stack ──► /api/saude  (monitoramento de queda)
```

| Camada | Serviço | Plano | Observação |
|---|---|---|---|
| Aplicação | Cloudflare Workers — `painel-monitorias` e `painel-performance` | Gratuito | Conta da operação Expansão |
| Banco de dados | Supabase (PostgreSQL 15+) | Verificar no painel do Supabase | Também faz o **login** dos usuários |
| Monitoramento | Better Stack | Gratuito | Vigia `/api/saude` do site de Monitorias |

### Por que migrar

O plano gratuito da Cloudflare dá **10 ms de processamento por acesso**. As
telas foram otimizadas para caber nisso, mas é um teto baixo:

- em 01/09/2026 o sistema caiu (erro 1102) quando várias páginas foram
  carregadas ao mesmo tempo;
- a leitura de planilhas teve de ser feita no navegador do usuário, e não no
  servidor, para não estourar o limite;
- recursos futuros ficam limitados por esse teto.

Num servidor próprio esse limite **não existe**.

---

## 3. O que o servidor interno precisa

| Item | Requisito |
|---|---|
| Sistema | Linux ou Windows Server com **Node.js 20 ou superior** (testado no 24) |
| Memória | estimativa: ~512 MB por instância (duas instâncias: ~1 GB) |
| Disco | estimativa: ~500 MB por instância, com as dependências |
| Rede de saída | HTTPS (443) para `*.supabase.co`, se o banco continuar no Supabase |
| Rede de entrada | HTTPS obrigatório, com proxy reverso (Nginx, IIS, Apache) na frente do Node |
| Endereços | Dois nomes internos, um por sistema. Ex.: `monitorias.igreen.local` e `performance.igreen.local` |

HTTPS é obrigatório: o login usa cookies de sessão seguros, que o navegador não
envia em conexão sem criptografia.

---

## 4. Como publicar no servidor

Os comandos são os mesmos nas duas instâncias; só muda a variável `SISTEMA`.

```bash
# 1. Instalar as dependências (usa as versões exatas do package-lock.json)
npm ci

# 2. Criar o arquivo .env.local (seção 5) — ANTES do build

# 3. Gerar a versão de produção
npm run build

# 4. Subir o servidor (escolha a porta)
npx next start -p 3000        # Monitorias
SISTEMA=cota npx next start -p 3001   # Performance
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
| `SISTEMA` | Aplicação | Não. `cota` na instância do Performance; vazio na de Monitorias |

As variáveis `NEXT_PUBLIC_*` são embutidas no momento do `npm run build`:
trocar o valor exige gerar o build de novo.

---

## 6. Banco de dados

**Recomendação: manter o Supabase e migrar só a aplicação.** O banco não tem o
limite de processamento da Cloudflare, e o Supabase também cuida do **login**
(usuários, senhas, sessões). Tirar o banco do Supabase exige substituir o
sistema de login, o que é um projeto à parte.

Se a IGreen quiser o banco também interno:

- é um PostgreSQL comum, mas o login (esquema `auth` do Supabase) teria de ser
  substituído;
- o Supabase pode ser instalado internamente (versão *self-hosted* via Docker),
  o que preserva o login sem mudar código — é o caminho mais curto nesse caso.

### Estrutura

As migrações estão em `supabase/`, numeradas na ordem em que foram aplicadas
(01 a 22). O banco de produção já está com **todas aplicadas**.

- `00-instalar-tudo.sql` é um atalho antigo que junta as primeiras migrações;
  não usar junto com elas.
- Uma instalação do zero em outro banco **não é trivial**: a migração 12
  aproveita tabelas de um sistema anterior (`atendimentos`, `atendentes`).
  Para mudar de banco, o caminho seguro é **copiar o banco atual** (dump do
  PostgreSQL), e não rodar as migrações do zero.

### Segurança dos dados

- As permissões são aplicadas **dentro do banco** (Row Level Security): um
  operador só recebe os próprios dados, mesmo que acesse a API diretamente.
- Os papéis são Gestor, Qualidade e Operador, definidos na tabela `pessoas`.
- Os dois sistemas usam as mesmas contas: o mesmo e-mail e senha valem nos dois.

---

## 7. Monitoramento

`GET /api/saude` consulta o banco de verdade e responde:

```json
{"estado":"ok","sistema":"cota","versao":"4.11.2","versoes":{"monitorias":"4.11.2","cota":"0.11.0"},"ms":95}
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
| `scripts/` | Scripts de manutenção (importação, criação de acesso) — uso manual |
| `docs/` | Documentação, incluindo este arquivo e o modelo da cota |
| `middleware.ts` | Controle de sessão e separação entre os dois sistemas |
| `package.json` / `package-lock.json` | Dependências com versões exatas |
| `.env.example` | Modelo das variáveis (sem valores) |

**Não vão no pacote**, de propósito: `node_modules/` (recriada pelo `npm ci`),
os builds (`.next/`, `.open-next/`), as chaves (`.env.local`, `.dev.vars`) e a
pasta `dados/`, que contém avaliações nominais de pessoas.
