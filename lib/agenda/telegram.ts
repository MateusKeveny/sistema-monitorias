import { seloDoItem } from '@/lib/agenda/webpush';

/**
 * Avisos pelo Telegram (supabase/agenda/02-telegram.sql) — para quem não pode
 * receber notificação do navegador.
 *
 * Configuração, no Worker `painel-agenda` e no `.env.local`:
 *   TELEGRAM_TOKEN — segredo; o token que o @BotFather entrega ao criar o bot.
 *
 * O endereço do webhook e a senha que o Telegram manda em cada chamada são
 * registrados por `node scripts/chaves-da-agenda.js telegram`. A senha não é
 * mais um segredo para guardar: sai do AGENDA_SEGREDO (seloDoWebhook).
 */
export const ENDERECO_AGENDA = 'https://painel-agenda.expansao.workers.dev';

export const tokenDoTelegram = () => process.env.TELEGRAM_TOKEN || null;

/** Senha do webhook: o Telegram manda no cabeçalho X-Telegram-Bot-Api-Secret-Token. */
export const seloDoWebhook = (segredo: string) => seloDoItem('telegram', segredo);

export type Botao = { text: string; callback_data?: string; url?: string };

/** Uma chamada à API de bots. Devolve o status HTTP e a resposta. */
export async function chamarTelegram(token: string, metodo: string, corpo: object) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${metodo}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const json = await r.json().catch(() => null) as { ok?: boolean; result?: unknown; description?: string } | null;
  return { status: r.status, json };
}

export const escaparHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Nome do bot (@usuario), para o link de conexão. Null se não configurado. */
export async function nomeDoBot(): Promise<string | null> {
  const token = tokenDoTelegram();
  if (!token) return null;
  try {
    const { json } = await chamarTelegram(token, 'getMe', {});
    return (json?.result as { username?: string } | undefined)?.username ?? null;
  } catch {
    return null;
  }
}

/**
 * Botões de um lembrete. O callback leva a ação e o item: "c:<id>" Concluir,
 * "a:<id>" Adiar 15 min, "r:<id>" Reagendar (o bot pergunta para quando).
 */
export const botoesDoItem = (item: string): Botao[][] => [
  [
    { text: '✓ Concluir', callback_data: `c:${item}` },
    { text: 'Adiar 15 min', callback_data: `a:${item}` },
  ],
  [{ text: '🗓 Reagendar', callback_data: `r:${item}` }],
];

/** Mensagem de um aviso: título em negrito, texto e o botão de abrir a agenda. */
export function mensagemDoAviso(aviso: { titulo: string; corpo: string; url: string; item?: string | null }) {
  const texto = [`<b>${escaparHtml(aviso.titulo)}</b>`, aviso.corpo ? escaparHtml(aviso.corpo) : null]
    .filter(Boolean).join('\n');
  // Endereço completo leva a outro site (o lembrete do ciclo abre o Importar do Performance).
  const externo = aviso.url.startsWith('https://');
  const teclado: Botao[][] = [
    ...(aviso.item ? botoesDoItem(aviso.item) : []),
    [externo ? { text: 'Abrir no Performance', url: aviso.url }
      : { text: 'Abrir a agenda', url: `${ENDERECO_AGENDA}${aviso.url.startsWith('/') ? aviso.url : '/agenda'}` }],
  ];
  return { text: texto, parse_mode: 'HTML', reply_markup: { inline_keyboard: teclado } };
}
