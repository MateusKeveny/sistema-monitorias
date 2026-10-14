# Agenda da Gestão

Terceiro site do mesmo código, ao lado das Monitorias e do Performance.
Endereço: `painel-agenda.expansao.workers.dev`.

**Banco e login próprios**: um projeto Supabase só da agenda
(`supabase/agenda/`). Lembretes de trabalho e pessoais não ficam no banco dos
painéis. Login por **nome de usuário**, perfil único ("usuário").

## O que faz

- **Meu dia**: a entrada do assistente ("sexta às 10 cobrar relatório",
  "todo dia 5 conferir pagamento") e o **plano do dia**, que junta lembretes
  e pendências do Performance numa ordem só, com o motivo de cada item.
- **Próximos**: 30 dias, com as repetições projetadas.
- **Feitos**: o que foi concluído, com "Desfazer".
- **Ajustes**: notificação por aparelho, resumo do dia, instalação, senha.

O "assistente" funciona por regras (`lib/agenda/interprete.ts` e
`lib/agenda/plano.ts`), sem API de IA e sem custo.

## Como funciona

```
Projeto da AGENDA                              Projeto dos PAINÉIS
  pg_cron (a cada minuto) ─ agenda_disparar()    pendencias_para_agenda(segredo)
     └ pg_net ─► painel-agenda /api/agenda/enviar ──(só leitura)──┘
                    └ Web Push cifrado ─► Google / Microsoft ─► aparelho
  Notificação "Concluir"/"Adiar" ─► /api/agenda/acao (selo por item)
```

- **Ponte**: o site da agenda, no servidor, lê as pendências do Performance
  (`supabase/59-ponte-da-agenda.sql`) com o `PONTE_SEGREDO`. Só textos e
  contagens vêm de lá; nada da agenda vai para lá.
- Quem vê as pendências: `usuarios.ve_pendencias = true` no banco da agenda.
- Login: o usuário `mateuskeveny` é `mateuskeveny@agenda.local` no Supabase
  (`lib/agenda/usuario.ts`). Rotas próprias: `/agenda/entrar` e
  `/agenda/renovar`; o middleware só aceita o cookie do projeto da agenda.
- Lembrete com hora toca na hora. Sem hora, entra no resumo do dia (padrão
  8h, dias úteis).

## Colocar no ar (uma vez)

1. **Projeto da agenda** — no Supabase, New project. Depois:
   `node scripts/chaves-da-agenda.js projeto <Project URL> <anon public>`.
2. **Banco da agenda** — colar `supabase/agenda/01-agenda.sql` no SQL Editor
   do projeto **da agenda**. A conferência no fim mostra 6 tabelas.
3. **Usuário** — Authentication → Users → Add user → Create new user:
   e-mail `mateuskeveny@agenda.local`, a senha, "Auto Confirm User" marcado. Depois,
   no SQL Editor da agenda:
   `update public.usuarios set nome = 'Mateus', ve_pendencias = true where usuario = 'mateuskeveny';`
4. **Ponte** — colar `supabase/59-ponte-da-agenda.sql` no SQL Editor do
   projeto **dos painéis**.
5. **Chaves** — `node scripts/chaves-da-agenda.js gerar` (cria o que faltar;
   a `VAPID_PUBLICA` também fica em `wrangler.jsonc`, env `agenda`).
6. **Publicar** — `npm run cf:deploy:agenda` (só o site da agenda).
7. **Segredos do Worker** — `node scripts/chaves-da-agenda.js worker`.
8. **Ligar envio e ponte** — `node scripts/chaves-da-agenda.js sql`; colar
   `dados/agenda-config.sql` no projeto da agenda e `dados/ponte-config.sql`
   no dos painéis; apagar os dois arquivos.
9. No celular: abrir o endereço no Chrome, entrar, ⋮ → Instalar app, abrir
   pelo ícone → Ajustes → Ativar notificações → Enviar teste.
10. No computador, com o **Brave**: ícone de instalar à direita do endereço
    (ou ☰ → Transmitir, salvar e compartilhar → Instalar página como app).
    A Agenda vira programa no menu Iniciar. Para a notificação do navegador,
    o Brave pede `brave://settings/privacy` → **Usar os serviços do Google
    para mensagens push** ligado e o Brave reiniciado (vem desligado; sem
    isso a inscrição falha com "push service error"). Para tocar com o Brave
    fechado: `brave://settings/system` → continuar executando em segundo
    plano. Se a empresa bloquear, o Telegram cobre.

Trocar a chave VAPID derruba a inscrição de todos os aparelhos: cada um
precisa ativar de novo.

## Avisos pelo Telegram (1.1.0)

Para aparelho que não aceita notificação do navegador (bloqueada pela
empresa, por exemplo). Os mesmos lembretes e o resumo do dia chegam como
mensagem de um bot, com os botões **Concluir**, **Adiar 15 min** e **Abrir a
agenda**. Os dois canais podem ficar ligados juntos.

Como funciona: `agenda_disparar` manda cada aviso para todos os destinos do
usuário (`agenda_destinos`: aparelhos e conversa do Telegram). O site envia
pela API de bots com o `TELEGRAM_TOKEN`. O bot chama `/api/agenda/telegram`
(webhook) quando alguém fala com ele ou toca num botão. A senha do webhook
sai do `AGENDA_SEGREDO`, então não é mais um segredo para guardar.

Ligar (uma vez):

1. **Criar o bot** — no Telegram, conversa com **@BotFather** → `/newbot` →
   um nome ("Agenda da Gestão") e um usuário terminado em `bot`. Ele responde
   com o **token**. O token é senha: não mande em conversa nenhuma.
2. **Token no `.env.local`** — acrescentar a linha `TELEGRAM_TOKEN=<token>`.
3. **Banco** — colar `supabase/agenda/02-telegram.sql` no SQL Editor do
   projeto **da agenda**. A conferência no fim mostra `tabelas_telegram = 2`.
4. **Publicar** — `npm run cf:deploy:agenda` (ou o `cf:deploy` completo).
5. **Token no Worker e webhook** — `node scripts/chaves-da-agenda.js telegram`.
6. **Conectar** — na agenda, Ajustes → **Conectar Telegram** → no Telegram,
   **Iniciar**. De volta à agenda, **Já conectei** e **Enviar teste**. Se o
   bot responder "Eu só entrego os avisos…" (conversa que já existia: o
   Telegram não manda o código), copie o código que aparece em Ajustes e
   envie como mensagem para o bot.

Bot bloqueado ou conversa apagada: o primeiro aviso recusado (403) desliga a
conversa sozinho. Para ligar de novo, repita o passo 6.
