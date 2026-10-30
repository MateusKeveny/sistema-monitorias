import { dbSemSessao, segredoDaAgenda } from '@/lib/agenda/envio';
import { ENDERECO_AGENDA, chamarTelegram, escaparHtml, seloDoWebhook, tokenDoTelegram } from '@/lib/agenda/telegram';
import { acharItens, agoraNoBrasil, lerComando, novaData, separarPedido, type ItemDoBot } from '@/lib/agenda/reagendar';
import { iguais } from '@/lib/agenda/webpush';
import { sistemaDoHost } from '@/lib/sistema';

export const dynamic = 'force-dynamic';

type Mensagem = {
  message_id: number;
  chat: { id: number; type: string };
  from?: { first_name?: string };
  text?: string;
  entities?: { type: string; url?: string }[];
  reply_markup?: { inline_keyboard?: { callback_data?: string }[][] };
  reply_to_message?: Mensagem;
};
type Atualizacao = {
  message?: Mensagem;
  callback_query?: { id: string; data?: string; message?: { message_id: number; chat: { id: number } } };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXEMPLOS = 'amanhã 10h · sexta das 14h às 15h · 05/11 9h';

const AJUDA = 'Eu entrego os avisos da Agenda da Gestão e reagendo lembretes:\n'
  + '• toque em <b>🗓 Reagendar</b> num aviso, ou <b>responda</b> o aviso com a nova data;\n'
  + '• ou escreva <code>/reagendar reunião diretoria para sexta 15h</code>.\n\n'
  + `Para criar ou mudar o resto, use a agenda: ${ENDERECO_AGENDA}/agenda`;

/** O lembrete de que uma mensagem do bot trata: pelo botão (c:/a:/r:<id>) ou pelo link escondido do pedido. */
function itemDaMensagem(m?: Mensagem): string | null {
  if (!m) return null;
  for (const linha of m.reply_markup?.inline_keyboard ?? []) {
    for (const b of linha) {
      const id = b.callback_data?.split(':')[1];
      if (id && UUID.test(id)) return id;
    }
  }
  for (const e of m.entities ?? []) {
    const id = e.url && /#item-([0-9a-f-]{36})$/.exec(e.url)?.[1];
    if (id && UUID.test(id)) return id;
  }
  return null;
}

/**
 * Webhook do bot da agenda (supabase/agenda/02-telegram.sql e 07). O Telegram
 * chama aqui a cada mensagem enviada ao bot e a cada toque num botão.
 *
 * Sem sessão: a prova é a senha que o Telegram manda no cabeçalho, registrada
 * por `node scripts/chaves-da-agenda.js telegram`. Responde sempre 200 depois
 * de conferida — com erro, o Telegram repete a mesma atualização por horas.
 *
 *   "/start <código>" ou o código sozinho   liga a conversa ao usuário que pediu em Ajustes.
 *   "c:<item>" Concluir · "a:<item>" Adiar 15 min · "r:<item>" Reagendar (pergunta para quando).
 *   Resposta a um aviso ou ao "Para quando?"  reagenda aquele lembrete.
 *   "/reagendar <nome> para <quando>"        acha pelo nome; com vários, botões "e:<item>".
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

  const enviar = (chat: number, texto: string, extra: object = {}) => chamarTelegram(token, 'sendMessage', {
    chat_id: chat, text: texto, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra,
  });
  const itensDe = async (chat: number) =>
    ((await db.rpc('agenda_telegram_itens', { p_segredo: segredo, p_chat: chat })).data ?? []) as ItemDoBot[];

  /** "Para quando?" com o lembrete num link escondido — a resposta volta com ele. */
  const perguntar = (chat: number, item: ItemDoBot) => enviar(chat,
    `🗓 Reagendar <a href="${ENDERECO_AGENDA}/agenda#item-${item.id}">${escaparHtml(item.titulo)}</a>\n`
    + `Para quando? Responda esta mensagem. Ex.: ${EXEMPLOS}`,
    { reply_markup: { force_reply: true, input_field_placeholder: 'amanhã 10h' } });

  /** Lê a frase e grava. Devolve a resposta para o usuário. */
  const reagendar = async (chat: number, item: ItemDoBot, frase: string) => {
    // No recorrente o fim é da série: a ocorrência movida fica só com o novo início.
    const nova = novaData(frase, item.regra ? { ...item, hora_fim: null } : item, agoraNoBrasil());
    if (!nova) return `Não entendi a data em "${escaparHtml(frase)}". Tente assim: ${EXEMPLOS}`;
    const { data: titulo, error } = await db.rpc('agenda_telegram_reagendar', {
      p_segredo: segredo, p_chat: chat, p_item: item.id,
      p_quando: nova.quando, p_dia_inteiro: nova.diaInteiro, p_hora_fim: nova.horaFim,
    });
    if (error || !titulo) return 'Este lembrete já foi concluído ou excluído.';
    return `✅ Reagendado: <b>${escaparHtml(String(titulo))}</b> → ${nova.rotulo}`
      + (item.regra ? '\n(Só esta vez — a repetição segue igual.)' : '');
  };

  try {
    if (a.callback_query) {
      const q = a.callback_query;
      const [acao, item, quando] = (q.data ?? '').split(':');
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
      } else if ((acao === 'r' || acao === 'e') && item && UUID.test(item) && chat) {
        const alvo = (await itensDe(chat)).find((i) => i.id === item);
        if (alvo && acao === 'r') {
          aviso = 'Para quando?';
          await perguntar(chat, alvo);
        } else if (alvo && acao === 'e' && quando) {
          // Escolhido entre vários no /reagendar: a frase vai codificada no botão.
          aviso = 'Pronto.';
          await enviar(chat, await reagendar(chat, alvo, decodeURIComponent(quando)));
        }
      }
      await chamarTelegram(token, 'answerCallbackQuery', { callback_query_id: q.id, text: aviso });
      return new Response(null, { status: 200 });
    }

    const m = a.message;
    if (!m || m.chat.type !== 'private') return new Response(null, { status: 200 });
    const texto = m.text?.trim() ?? '';
    const responder = (t: string, extra: object = {}) => enviar(m.chat.id, t, extra);

    // "/start <código>" vem do link; o código sozinho, de quem copiou dos
    // Ajustes — o Telegram não manda o código quando a conversa já existe.
    const codigo = /^(?:\/start\s+)?([0-9a-f]{32})$/i.exec(texto)?.[1]?.toLowerCase();
    if (codigo) {
      const { data: nome } = await db.rpc('agenda_telegram_vincular', {
        p_segredo: segredo, p_codigo: codigo, p_chat: m.chat.id, p_nome: m.from?.first_name ?? null,
      });
      await responder(nome
        ? `Pronto, ${escaparHtml(String(nome).split(' ')[0])}! Os lembretes da Agenda da Gestão vão chegar aqui.`
        : 'Este código venceu ou já foi usado. Em Ajustes, na Agenda, toque de novo em <b>Conectar Telegram</b>.');
      return new Response(null, { status: 200 });
    }

    // Resposta a um aviso (ou ao "Para quando?"): reagenda aquele lembrete.
    const respondido = itemDaMensagem(m.reply_to_message);
    if (respondido && texto && !texto.startsWith('/')) {
      const alvo = (await itensDe(m.chat.id)).find((i) => i.id === respondido);
      await responder(alvo ? await reagendar(m.chat.id, alvo, texto) : 'Este lembrete já foi concluído ou excluído.');
      return new Response(null, { status: 200 });
    }

    // "/reagendar <nome> para <quando>".
    const pedido = lerComando(texto);
    if (pedido) {
      if (!pedido.termo) {
        await responder(`Diga qual e para quando: <code>/reagendar reunião diretoria para sexta 15h</code>`);
        return new Response(null, { status: 200 });
      }
      const itens = await itensDe(m.chat.id);
      let achados = acharItens(itens, pedido.termo);
      // Sem "para" ("/reagendar escola de líderes amanhã 14h"): separa o nome da data.
      if (!pedido.quando) {
        const separado = separarPedido(itens, pedido.termo, agoraNoBrasil());
        if (separado.achados.length) {
          achados = separado.achados;
          pedido.termo = separado.termo;
          pedido.quando = separado.quando;
        }
      }
      if (!achados.length) {
        const abertos = itens.slice(0, 8).map((i) => `• ${escaparHtml(i.titulo)}`).join('\n');
        await responder(`Não achei lembrete em aberto com "${escaparHtml(pedido.termo)}".`
          + (abertos ? `\n\nEm aberto agora:\n${abertos}` : '')
          + '\n\nEx.: <code>/reagendar escola de líderes para amanhã 14h</code>');
      } else if (achados.length === 1 && pedido.quando) {
        await responder(await reagendar(m.chat.id, achados[0], pedido.quando));
      } else if (achados.length === 1) {
        await perguntar(m.chat.id, achados[0]);
      } else {
        // Vários: um botão por lembrete. Com a data no pedido, ela vai no
        // botão (cabe até ~20 letras); sem, o toque pergunta para quando.
        const quando = pedido.quando ? encodeURIComponent(pedido.quando) : '';
        const cabe = quando && `e:${achados[0].id}:${quando}`.length <= 64;
        await responder(`Achei ${achados.length} lembretes com "${escaparHtml(pedido.termo)}". Qual?`, {
          reply_markup: {
            inline_keyboard: achados.slice(0, 8).map((i) => [{
              text: i.titulo.slice(0, 60),
              callback_data: cabe ? `e:${i.id}:${quando}` : `r:${i.id}`,
            }]),
          },
        });
      }
      return new Response(null, { status: 200 });
    }

    await responder(AJUDA);
  } catch (erro) {
    console.warn('agenda: falha no webhook do telegram', String(erro));
  }
  return new Response(null, { status: 200 });
}
