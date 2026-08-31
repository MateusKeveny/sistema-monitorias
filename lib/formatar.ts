/** Formatações de exibição, todas em pt-BR. */

export const nota = (v: number | null | undefined) =>
  v == null ? '—' : (v * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 0, maximumFractionDigits: 1,
  }) + '%';

export const percentual = nota;

export const data = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const [a, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${a}`;
};

/** 31/08/2026 às 14:07 — usado no histórico de alterações. */
export const dataHora = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
    + ` às ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

export const mesExtenso = (iso: string) => {
  const [a, m] = iso.slice(0, 10).split('-');
  return `${MESES[Number(m) - 1]} de ${a}`;
};

export const mesCurto = (iso: string) => {
  const [a, m] = iso.slice(0, 10).split('-');
  return `${m}/${a}`;
};

export const duracao = (segundos: number | null | undefined) => {
  if (segundos == null || segundos <= 0) return '—';
  const h = Math.floor(segundos / 3600);
  const m = Math.floor((segundos % 3600) / 60);
  const s = segundos % 60;
  return h > 0
    ? `${h}h ${String(m).padStart(2, '0')}min`
    : `${m}min ${String(s).padStart(2, '0')}s`;
};

/** Faixa de desempenho usada nas cores do sistema inteiro. */
export function faixa(v: number | null | undefined): 'otimo' | 'bom' | 'atencao' | 'critico' | 'vazio' {
  if (v == null) return 'vazio';
  if (v >= 0.95) return 'otimo';
  if (v >= 0.85) return 'bom';
  if (v >= 0.70) return 'atencao';
  return 'critico';
}

export const CORES_FAIXA: Record<string, string> = {
  otimo: 'bg-emerald-100 text-emerald-800 ring-emerald-600/20',
  bom: 'bg-sky-100 text-sky-800 ring-sky-600/20',
  atencao: 'bg-amber-100 text-amber-900 ring-amber-600/20',
  critico: 'bg-rose-100 text-rose-800 ring-rose-600/20',
  vazio: 'bg-slate-100 text-slate-600 ring-slate-500/20',
};

/**
 * Ciclo de metrificação da IGreen: o mês vai do dia 26 ao dia 25.
 * As mesmas regras existem no banco (mes_de_competencia / semana_do_ciclo);
 * aqui elas servem só para mostrar o resultado no formulário antes de salvar.
 */

/** Semana do ciclo: 1ª 26–02 | 2ª 03–10 | 3ª 11–18 | 4ª 19–25 */
export function semanaDoCiclo(iso: string): number {
  const dia = Number(iso.slice(8, 10));
  if (dia >= 26 || dia <= 2) return 1;
  if (dia <= 10) return 2;
  if (dia <= 18) return 3;
  return 4;
}

/** Mês de competência: dia >= 26 já pertence ao mês seguinte. */
export function mesDeCompetencia(iso: string): string {
  let ano = Number(iso.slice(0, 4));
  let mes = Number(iso.slice(5, 7));
  if (Number(iso.slice(8, 10)) >= 26) {
    mes += 1;
    if (mes === 13) { mes = 1; ano += 1; }
  }
  return `${ano}-${String(mes).padStart(2, '0')}-01`;
}
