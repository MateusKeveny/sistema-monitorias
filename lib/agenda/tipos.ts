/** Tipos da agenda (migração 59). */

export type Categoria = 'monitorias' | 'cota' | 'equipe' | 'reuniao' | 'pessoal' | 'geral';

export const CATEGORIAS: { valor: Categoria; rotulo: string; cor: string }[] = [
  { valor: 'monitorias', rotulo: 'Monitorias', cor: 'bg-sky-100 text-sky-800' },
  { valor: 'cota', rotulo: 'Cota', cor: 'bg-marca-100 text-marca-700 dark:text-marca-400' },
  { valor: 'equipe', rotulo: 'Equipe', cor: 'bg-amber-100 text-amber-800' },
  { valor: 'reuniao', rotulo: 'Reunião', cor: 'bg-slate-200 text-slate-800' },
  { valor: 'pessoal', rotulo: 'Pessoal', cor: 'bg-rose-100 text-rose-800' },
  { valor: 'geral', rotulo: 'Geral', cor: 'bg-slate-100 text-slate-600' },
];
// Só cores que o tema escuro redefine (globals.css): sky, amber, rose, slate e a marca.

export const categoria = (c: Categoria) => CATEGORIAS.find((x) => x.valor === c) ?? CATEGORIAS[5];

/** 1 = alta · 2 = normal · 3 = baixa. */
export type Prioridade = 1 | 2 | 3;
export const PRIORIDADES: { valor: Prioridade; rotulo: string }[] = [
  { valor: 1, rotulo: 'Alta' },
  { valor: 2, rotulo: 'Normal' },
  { valor: 3, rotulo: 'Baixa' },
];

export type ItemAgenda = {
  id: string;
  titulo: string;
  observacao: string | null;
  categoria: Categoria;
  prioridade: Prioridade;
  vence_em: string | null;
  lembrar_em: string | null;
  dia_inteiro: boolean;
  regra: string | null;
  concluido_em: string | null;
};

export const COLUNAS_ITEM =
  'id, titulo, observacao, categoria, prioridade, vence_em, lembrar_em, dia_inteiro, regra, concluido_em';

/** Uma pendência calculada pelo banco (pendencias_do_gestor). */
export type Pendencia = {
  chave: string;
  texto: string;
  acao: string;
  /** Caminho no site de Performance. */
  href: string;
  grave: boolean;
  quantidade: number;
};

export type Concluido = {
  id: string;
  item_id: string | null;
  titulo: string;
  categoria: Categoria;
  vence_em: string | null;
  concluido_em: string;
};

export type Preferencias = {
  resumo_ativo: boolean;
  resumo_hora: string;
  resumo_fim_semana: boolean;
  pendencias: boolean;
};

export const PREFERENCIAS_PADRAO: Preferencias = {
  resumo_ativo: true, resumo_hora: '08:00', resumo_fim_semana: false, pendencias: true,
};
