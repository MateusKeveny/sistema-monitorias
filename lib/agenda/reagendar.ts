import { interpretar } from '@/lib/agenda/interprete';
import { horaLocal, instante, rotuloDoDia, somarDias, partesLocais } from '@/lib/agenda/tempo';

/**
 * Reagendar pelo Telegram (supabase/agenda/07): ler o pedido, achar o
 * lembrete pelo nome e transformar "amanhã 10h" na nova data — com o mesmo
 * intérprete da entrada rápida da agenda. Puro, para testar sem o bot.
 */

/** Um item em aberto de quem conversa (agenda_telegram_itens). */
export type ItemDoBot = {
  id: string;
  titulo: string;
  lembrar_em: string | null;
  dia_inteiro: boolean;
  hora_fim: string | null;
  regra: string | null;
};

export type NovaData = { quando: string; diaInteiro: boolean; horaFim: string | null; rotulo: string };

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** "/reagendar reunião diretoria para sexta 15h" → termo e quando. Sem "para", só o termo. */
export function lerComando(texto: string): { termo: string; quando: string | null } | null {
  const m = /^\/?reagendar(?:@\w+)?\s*(.*)$/i.exec(texto.trim());
  if (!m) return null;
  const resto = m[1].trim();
  const i = semAcento(resto).lastIndexOf(' para ');
  return i < 0 ? { termo: resto, quando: null } : { termo: resto.slice(0, i).trim(), quando: resto.slice(i + 6).trim() };
}

// Palavras que aparecem no pedido mas não no nome do lembrete ("o evento de
// ontem"): ficam de fora da busca. Sem elas o termo não casava com nada.
const SOLTAS = new Set(['o', 'a', 'os', 'as', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'que',
  'ontem', 'anteontem', 'hoje', 'evento', 'eventos', 'lembrete', 'lembretes', 'compromisso', 'item',
  'marcado', 'marcada', 'passado', 'passada', 'atrasado', 'atrasada']);

/** Itens cujo título tem todas as palavras do termo (sem acento), o mais parecido primeiro. */
export function acharItens(itens: ItemDoBot[], termo: string): ItemDoBot[] {
  const todas = semAcento(termo).split(/\s+/).filter((p) => p.length > 1);
  const uteis = todas.filter((p) => !SOLTAS.has(p));
  const palavras = uteis.length ? uteis : todas;
  if (!palavras.length) return [];
  const t = semAcento(termo).trim();
  return itens
    .filter((i) => palavras.every((p) => semAcento(i.titulo).includes(p)))
    .sort((a, b) => Number(semAcento(b.titulo).includes(t)) - Number(semAcento(a.titulo).includes(t))
      || a.titulo.length - b.titulo.length);
}

/**
 * Pedido sem "para" ("/reagendar escola de líderes amanhã 14h"): o começo que
 * casa com algum lembrete é o nome, e o resto, a data — desde que o resto seja
 * uma data que o intérprete entenda. Tenta do nome mais longo para o mais curto.
 */
export function separarPedido(itens: ItemDoBot[], texto: string, agora: { dia: string; hora: string }):
  { termo: string; quando: string | null; achados: ItemDoBot[] } {
  const palavras = texto.trim().split(/\s+/);
  // Primeiro, nome + data ("escola de líderes hoje" = "escola de líderes" para
  // "hoje" — "hoje" sozinho também casaria, por ser palavra solta).
  for (let k = palavras.length - 1; k >= 1; k--) {
    const termo = palavras.slice(0, k).join(' ');
    const quando = palavras.slice(k).join(' ');
    const achados = acharItens(itens, termo);
    if (!achados.length) continue;
    const lido = interpretar(quando, agora);
    if (lido.dia || lido.hora) return { termo, quando, achados };
  }
  // Só o nome: o bot pergunta para quando.
  const achados = acharItens(itens, texto);
  return { termo: texto, quando: null, achados };
}

/** "sexta, 06/11 às 15:00", "amanhã das 14:00 às 15:00", "segunda, 09/11 (dia inteiro)". */
export function rotuloDaData(dia: string, hora: string | null, horaFim: string | null, hoje: string): string {
  const d = rotuloDoDia(dia, hoje).replace(/^Hoje$/, 'hoje').replace(/^Amanhã$/, 'amanhã');
  if (!hora) return `${d} (dia inteiro)`;
  return horaFim ? `${d} das ${hora} às ${horaFim}` : `${d} às ${hora}`;
}

/**
 * A nova data a partir da frase. Sem hora na frase, quem tinha hora mantém a
 * mesma ("amanhã" para a reunião das 14h = amanhã às 14h); com duração
 * (14h–16h) e só o novo começo, o fim anda junto. Null = não entendi.
 */
export function novaData(frase: string, item: ItemDoBot, agora: { dia: string; hora: string }): NovaData | null {
  const lido = interpretar(frase, agora);
  if (!lido.dia && !lido.hora) return null;
  const horaAntes = item.lembrar_em && !item.dia_inteiro ? horaLocal(item.lembrar_em) : null;
  let hora = lido.hora ?? horaAntes;
  let dia = lido.dia ?? agora.dia;
  // Só a hora, e ela já passou hoje: o intérprete já joga para amanhã.
  if (!lido.dia && lido.hora && lido.hora <= agora.hora) dia = somarDias(agora.dia, 1);

  let horaFim = lido.horaFim;
  if (!horaFim && hora && item.hora_fim && horaAntes) {
    const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
    const dur = minutos(item.hora_fim.slice(0, 5)) - minutos(horaAntes);
    const fim = minutos(hora) + dur;
    if (dur > 0 && fim < 24 * 60) horaFim = `${String(Math.floor(fim / 60)).padStart(2, '0')}:${String(fim % 60).padStart(2, '0')}`;
  }
  if (!hora) horaFim = null;
  hora = hora ?? null;
  return {
    quando: new Date(instante(dia, hora)).toISOString(),
    diaInteiro: !hora,
    horaFim,
    rotulo: rotuloDaData(dia, hora, horaFim, agora.dia),
  };
}

/** Agora, no Brasil, no formato do intérprete. */
export const agoraNoBrasil = () => {
  const p = partesLocais(new Date());
  return { dia: p.dia, hora: p.hora };
};
