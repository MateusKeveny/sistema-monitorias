import { dbSemSessao, segredoDaAgenda } from '@/lib/agenda/envio';
import { ENDERECO_AGENDA, chamarTelegram, escaparHtml, seloDoWebhook, tokenDoTelegram } from '@/lib/agenda/telegram';
import { iguais } from '@/lib/agenda/webpush';
import { sistemaDoHost } from '@/lib/sistema';

export const dynamic = 'force-dynamic';

type Atualizacao = {
  message?: { chat: { id: number; type: string }; from?: { first_name?: string }; text?: string };
  callback_query?: {
    id: string; data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Webhook do bot da agenda (supabase/agenda/02-telegram.sql). O Telegram chama
 * aqui a cada mensagem enviada ao bot e a cada toque num botão.
 *
 * Sem sessão: a prova é a senha que o Telegram manda no cabeçalho, registrada
 * por `node scripts/chaves-da-agenda.js telegram`. Responde sempre 200 depois
 * de conferida — com erro, o Telegram repete a mesma atualização por horas.
 *
 *   "/start <código>"  liga a conversa ao usuário que pediu em Ajustes.
 *   "c:<item>"         botão Concluir; "a:<item>" botão Adiar 15 min.
 */
export async function POST(requisicao: Request) {
  if (sistemaDoHost(requisicao.headers.get('host')) !== 'agenda' && process.env.NODE_ENV === 'production') {
    return new Response(null, { status: 404 });
  }
  const segredo = segredoDaAgenda();
  const token = tokenDoTelegram();
  if (!segredo || !token) return new Response(null, { status: 503 });
  const senha = requisicao.headers.get('x-telegram-bot-api-secret-token') ?? '';
  if (!iguais(senha, await seloDoWebhook(segredo))) return new Response(null, { status: 401 });

  const a = await requisicao.json().catch(() => ({})) as Atualizacao;
  const db = dbSemSessao();

  try {
    if (a.callback_query) {
      const q = a.callback_query;
      const [acao, item] = (q.data ?? '').split(':');
      const chat = q.message?.chat.id;
      let aviso = 'Este lembrete já foi resolvido.';
      if ((acao === 'c' || acao === 'a') && item && UUID.test(item) && chat) {
        const { data: titulo } = await db.rpc('agenda_telegram_acao', {
          p_segredo: segredo, p_chat: chat, p_item: item, p_acao: acao === 'c' ? 'concluir' : 'adiar',
        });
        if (titulo) {
          aviso = acao === 'c' ? 'Concluído.' : 'Adiado: aviso de novo em 15 minutos.';
          await chamarTelegram(token, 'editMessageReplyMarkup', {
            chat_id: chat, message_id: q.message!.message_id,
            reply_markup: { inline_keyboard: [[{ text: acao === 'c' ? '✓ Concluído' : 'Adiado 15 min', callback_data: 'x' }]] },
          });
        }
      }
      await chamarTelegram(token, 'answerCallbackQuery', { callback_query_id: q.id, text: aviso });
      return new Response(null, { status: 200 });
    }

    const m = a.message;
    if (!m || m.chat.type !== 'private') return new Response(null, { status: 200 });
    const responder = (texto: string) => chamarTelegram(token, 'sendMessage', {
      chat_id: m.chat.id, text: texto, parse_mode: 'HTML', link_preview_options: { is_disabled: true },
    });

    const codigo = /^\/start\s+([0-9a-f]{32})$/.exec(m.text?.trim() ?? '')?.[1];
    if (codigo) {
      const { data: nome } = await db.rpc('agenda_telegram_vincular', {
        p_segredo: segredo, p_codigo: codigo, p_chat: m.chat.id, p_nome: m.from?.first_name ?? null,
      });
      await responder(nome
        ? `Pronto, ${escaparHtml(String(nome).split(' ')[0])}! Os lembretes da Agenda da Gestão vão chegar aqui.`
        : 'Este código venceu ou já foi usado. Em Ajustes, na Agenda, toque de novo em <b>Conectar Telegram</b>.');
      return new Response(null, { status: 200 });
    }

    await responder('Eu só entrego os avisos da Agenda da Gestão. Para criar ou mudar lembretes, use a agenda:\n'
      + `${ENDERECO_AGENDA}/agenda`);
  } catch (erro) {
    console.warn('agenda: falha no webhook do telegram', String(erro));
  }
  return new Response(null, { status: 200 });
}
