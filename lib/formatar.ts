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

export const ordinal = (n: number) => `${n}ª`;

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

/** Mês corrente no formato aceito pelas consultas (primeiro dia do mês). */
export function mesAtual(): string {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Calcula em qual semana do mês uma data cai (1 a 5). */
export function semanaDoMes(iso: string): number {
  const dia = Number(iso.slice(8, 10));
  return Math.min(5, Math.ceil(dia / 7));
}
