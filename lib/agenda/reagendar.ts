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

/** Itens cujo título tem todas as palavras do termo (sem acento), o mais parecido primeiro. */
export function acharItens(itens: ItemDoBot[], termo: string): ItemDoBot[] {
  const palavras = semAcento(termo).split(/\s+/).filter((p) => p.length > 1);
  if (!palavras.length) return [];
  const t = semAcento(termo).trim();
  return itens
    .filter((i) => palavras.every((p) => semAcento(i.titulo).includes(p)))
    .sort((a, b) => Number(semAcento(b.titulo).includes(t)) - Number(semAcento(a.titulo).includes(t))
      || a.titulo.length - b.titulo.length);
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
