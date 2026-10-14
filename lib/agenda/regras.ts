import { diaDaSemana, nomeCurtoDoDia, nomeDoDia, somarDias, ultimoDiaDoMes } from '@/lib/agenda/tempo';

/**
 * Repetição dos itens — o mesmo formato e a mesma conta de
 * `agenda_regra_casa` e `agenda_proxima` (migração 59). O banco calcula a
 * próxima ocorrência ao concluir; aqui a conta serve para a primeira, para a
 * prévia do que foi digitado e para projetar as ocorrências em "Próximos".
 *
 *   diaria · dias_uteis · semanal:1,3 (1 = segunda) · mensal:5 ·
 *   mensal:ultimo · mensal:ultimo_util
 */
export type Regra = string;

export const REGRA_VALIDA =
  /^(diaria|dias_uteis|semanal:[1-7](,[1-7])*|mensal:([1-9]|[12][0-9]|3[01]|ultimo|ultimo_util))$/;

export function regraCasa(regra: Regra, dia: string): boolean {
  const [tipo, arg] = regra.split(':');
  const dow = diaDaSemana(dia);
  if (tipo === 'diaria') return true;
  if (tipo === 'dias_uteis') return dow <= 5;
  if (tipo === 'semanal') return arg.split(',').map(Number).includes(dow);
  if (tipo === 'mensal') {
    const fim = ultimoDiaDoMes(dia);
    if (arg === 'ultimo') return dia === fim;
    if (arg === 'ultimo_util') {
      const dowFim = diaDaSemana(fim);
      return dia === somarDias(fim, dowFim === 6 ? -1 : dowFim === 7 ? -2 : 0);
    }
    return Number(dia.slice(8, 10)) === Math.min(Number(arg), Number(fim.slice(8, 10)));
  }
  return false;
}

/** Primeiro dia a partir de `desde` (inclusive) que casa com a regra. */
export function proximoDia(regra: Regra, desde: string): string | null {
  let dia = desde;
  for (let i = 0; i < 400; i++) {
    if (regraCasa(regra, dia)) return dia;
    dia = somarDias(dia, 1);
  }
  return null;
}

/** As ocorrências entre dois dias (inclusive), para projetar a agenda. */
export function ocorrencias(regra: Regra, de: string, ate: string, limite = 60): string[] {
  const dias: string[] = [];
  for (let dia = de; dia <= ate && dias.length < limite; dia = somarDias(dia, 1)) {
    if (regraCasa(regra, dia)) dias.push(dia);
  }
  return dias;
}

/** "Toda segunda e quarta", "Todo dia 5", "Dias úteis"… */
export function descreverRegra(regra: Regra | null | undefined): string | null {
  if (!regra) return null;
  const [tipo, arg] = regra.split(':');
  if (tipo === 'diaria') return 'Todo dia';
  if (tipo === 'dias_uteis') return 'Dias úteis';
  if (tipo === 'semanal') {
    const dias = arg.split(',').map(Number).sort();
    if (dias.length === 5 && dias.every((d, i) => d === i + 1)) return 'Dias úteis';
    if (dias.length === 1) return `Toda ${nomeDoDia(dias[0])}`.replace(/Toda (sábado|domingo)/, 'Todo $1');
    return `Toda semana: ${dias.map(nomeCurtoDoDia).join(', ')}`;
  }
  if (tipo === 'mensal') {
    if (arg === 'ultimo') return 'Último dia do mês';
    if (arg === 'ultimo_util') return 'Último dia útil do mês';
    return `Todo dia ${arg}`;
  }
  return null;
}
