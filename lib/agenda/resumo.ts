import type { Pendencia } from '@/lib/agenda/tipos';

/** Um item do resumo do dia (agenda_itens_do_resumo, supabase/agenda/06). */
export type ItemDoResumo = {
  titulo: string;
  dia: string;
  hora: string | null;
  hora_fim: string | null;
  dia_inteiro: boolean;
  atrasado: boolean;
  prioridade: number;
  regra: string | null;
};

const LIMITE = 15;
const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

/** Até LIMITE linhas por bloco, e "+N" no fim, para a mensagem não virar um muro. */
function bloco(titulo: string, linhas: string[]): string[] {
  if (!linhas.length) return [];
  const extra = linhas.length - LIMITE;
  return [titulo, ...linhas.slice(0, LIMITE).map((l) => `• ${l}`), ...(extra > 0 ? [`  … e mais ${extra}`] : []), ''];
}

/**
 * O resumo do dia por extenso, para o Telegram: o que está agendado hoje (com
 * horário, ou "dia inteiro"), o que está atrasado, as pendências do sistema e
 * os avisos de férias. A notificação do celular segue com as contagens — ela
 * mostra poucas linhas.
 */
export function textoDoResumo({ itens, pendencias, ferias }: {
  itens: ItemDoResumo[];
  pendencias: Pendencia[];
  ferias: string[];
}): string {
  const alta = (i: ItemDoResumo) => (i.prioridade === 1 ? '❗ ' : '');
  const repete = (i: ItemDoResumo) => (i.regra ? ' ↻' : '');
  const hoje = itens.filter((i) => !i.atrasado);
  const atrasados = itens.filter((i) => i.atrasado);

  const linhas = [
    ...bloco('📅 Hoje', hoje.map((i) => (i.hora
      ? `${i.hora}${i.hora_fim && i.hora_fim > i.hora ? `–${i.hora_fim}` : ''} ${alta(i)}${i.titulo}${repete(i)}`
      : `${alta(i)}${i.titulo} (dia inteiro)${repete(i)}`))),
    ...bloco('⏰ Atrasados', atrasados.map((i) => `${alta(i)}${i.titulo} (desde ${ddmm(i.dia)}${i.hora ? ` ${i.hora}` : ''})`)),
    ...bloco('📌 Do sistema', pendencias.map((p) => p.texto)),
    ...bloco('🏖 Férias', ferias),
  ];
  while (linhas.length && linhas[linhas.length - 1] === '') linhas.pop();
  return linhas.length ? linhas.join('\n') : 'Nada marcado para hoje. Bom trabalho!';
}
