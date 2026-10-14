/**
 * Datas da agenda, sempre no horário de Brasília.
 *
 * O Brasil não tem horário de verão desde 2019, então o fuso é fixo em -03:00
 * — a mesma premissa do agendamento das 8h (migração 40). Assim um instante
 * vira dia e hora locais com conta simples, igual no servidor (que roda em
 * UTC) e no navegador (que pode estar em qualquer fuso).
 */
const FUSO_MS = -3 * 60 * 60 * 1000;

/** Dia ('2026-10-14') e hora ('09:30') locais de um instante. */
export function partesLocais(instante: Date | string): { dia: string; hora: string } {
  const d = new Date(new Date(instante).getTime() + FUSO_MS).toISOString();
  return { dia: d.slice(0, 10), hora: d.slice(11, 16) };
}

export const diaLocal = (instante: Date | string) => partesLocais(instante).dia;
export const horaLocal = (instante: Date | string) => partesLocais(instante).hora;

/** Dia e hora locais → instante ISO com o fuso. Sem hora, meia-noite. */
export const instante = (dia: string, hora?: string | null) => `${dia}T${hora ?? '00:00'}:00-03:00`;

/** Hoje, no Brasil. */
export const hoje = () => diaLocal(new Date());

/** Soma dias a uma data 'AAAA-MM-DD'. */
export function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Dia da semana ISO: 1 = segunda … 7 = domingo. */
export function diaDaSemana(dia: string): number {
  const d = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export const ultimoDiaDoMes = (dia: string) => {
  const [a, m] = dia.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
};

/** Dias entre duas datas (b − a). */
export const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);

const SEMANA = ['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const SEMANA_CURTA = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro'];

export const nomeDoDia = (n: number) => SEMANA[n - 1];
export const nomeCurtoDoDia = (n: number) => SEMANA_CURTA[n - 1];

/** "Hoje", "Amanhã", "Ontem", "sexta, 17/10" ou "sexta, 17/10/2027". */
export function rotuloDoDia(dia: string, base = hoje()): string {
  const dif = diasEntre(base, dia);
  if (dif === 0) return 'Hoje';
  if (dif === 1) return 'Amanhã';
  if (dif === -1) return 'Ontem';
  const ano = dia.slice(0, 4) !== base.slice(0, 4) ? `/${dia.slice(0, 4)}` : '';
  return `${nomeDoDia(diaDaSemana(dia))}, ${dia.slice(8, 10)}/${dia.slice(5, 7)}${ano}`;
}

/** "quarta-feira, 14 de outubro". */
export function dataPorExtenso(dia: string): string {
  const n = diaDaSemana(dia);
  const semana = n <= 5 ? `${nomeDoDia(n)}-feira` : nomeDoDia(n);
  return `${semana}, ${Number(dia.slice(8, 10))} de ${MESES[Number(dia.slice(5, 7)) - 1]}`;
}

export const nomeDoMes = (dia: string) => MESES[Number(dia.slice(5, 7)) - 1];
