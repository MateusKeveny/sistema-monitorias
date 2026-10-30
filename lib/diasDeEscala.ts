/**
 * Dias de atendimento de uma pessoa num período (quadro "Para bater a meta",
 * 3.0): os dias da escala dela (migração 93; sem escala, segunda a sexta),
 * menos os dias de férias. Datas em 'AAAA-MM-DD', as duas pontas incluídas.
 */
export type Periodo = { inicio: string; fim: string };

const ESCALA_PADRAO = [1, 2, 3, 4, 5];

export function diasDeEscala(de: string, ate: string, escala: number[] | null | undefined, ferias: Periodo[] = []): number {
  if (de > ate) return 0;
  const dias = escala?.length ? escala : ESCALA_PADRAO;
  let n = 0;
  for (let d = new Date(`${de}T12:00:00Z`); ; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (iso > ate) break;
    // getUTCDay: 0 = domingo … 6 = sábado; a escala usa 1 = segunda … 7 = domingo.
    const semana = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
    if (dias.includes(semana) && !ferias.some((f) => iso >= f.inicio && iso <= f.fim)) n++;
  }
  return n;
}
