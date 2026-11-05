/**
 * Cores do Dashboard iGreen (paleta do gestor, 05/11/2026): as séries dos
 * gráficos, na ordem da paleta. Uma série nova pega a próxima cor.
 */
export const SERIES = [
  '#10B981', // 1 · verde principal
  '#06B6D4', // 2 · ciano
  '#F59E0B', // 3 · âmbar
  '#EF4444', // 4 · vermelho
  '#8B5CF6', // 5 · roxo
  '#EC4899', // 6 · rosa
  '#14B8A6', // 7 · teal
  '#F97316', // 8 · laranja
  '#6366F1', // 9 · índigo
  '#84CC16', // 10 · lime
] as const;

/** Cor das métricas, igual em todos os gráficos e réguas. */
export const COR_DA_METRICA = {
  expansao: SERIES[0],
  csat: SERIES[1],
  monitoria: SERIES[2],
  notas: SERIES[4],
  extra: SERIES[5],
  diretores: SERIES[6],
  chamados: '#94A3B8',
} as const;
