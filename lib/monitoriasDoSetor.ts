import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * As monitorias de cada setor (Monitorias 6.0, migração 89): quantas cada
 * pessoa recebe por semana e a partir de qual média a monitoria pontua (o
 * faixa_min da régua de monitoria do setor). A Conexão Expansão: 4 e 85%.
 */
export type MonitoriasDoSetor = { porSemana: number; piso: number };

/** O de sempre — banco sem a migração 89, ou setor sem régua. */
export const MONITORIAS_PADRAO: MonitoriasDoSetor = { porSemana: 4, piso: 0.85 };

export async function monitoriasPorSetor(db: SupabaseClient): Promise<Map<number, MonitoriasDoSetor>> {
  const { data: setores } = await db.from('setores').select('*');
  const lista = (setores ?? []) as { id: number; monitorias_por_semana?: number | null; regra_monitoria?: string | null }[];
  const chaves = lista.map((s) => s.regra_monitoria).filter((c): c is string => !!c);
  const { data: regras } = chaves.length
    ? await db.from('regras').select('chave, faixa_min').in('chave', chaves)
    : { data: [] };
  const piso = new Map(((regras ?? []) as { chave: string; faixa_min: number | null }[])
    .map((r) => [r.chave, r.faixa_min == null ? null : Number(r.faixa_min)]));
  return new Map(lista.map((s) => [s.id, {
    porSemana: s.monitorias_por_semana ?? MONITORIAS_PADRAO.porSemana,
    piso: (s.regra_monitoria ? piso.get(s.regra_monitoria) : null) ?? MONITORIAS_PADRAO.piso,
  }]));
}

/** "85%" — o piso como aparece nos textos. */
export const textoDoPiso = (piso: number) =>
  `${(piso * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/**
 * O setor de cada pessoa num mês: o registro mais recente até o mês, ou o
 * primeiro dela (como setor_na_competencia no banco). Sem registro: setor 1.
 */
export async function setorDasPessoas(db: SupabaseClient, competencia: string): Promise<Map<string, number>> {
  const { data: historico } = await db.from('setores_da_pessoa').select('pessoa_id, desde, setor_id');
  const atual = new Map<string, { desde: string; setor_id: number }>();
  const primeiro = new Map<string, { desde: string; setor_id: number }>();
  for (const h of (historico ?? []) as { pessoa_id: string; desde: string; setor_id: number }[]) {
    if (h.desde <= competencia && (!atual.has(h.pessoa_id) || atual.get(h.pessoa_id)!.desde < h.desde)) atual.set(h.pessoa_id, h);
    if (!primeiro.has(h.pessoa_id) || primeiro.get(h.pessoa_id)!.desde > h.desde) primeiro.set(h.pessoa_id, h);
  }
  return new Map([...primeiro].map(([id, h]) => [id, (atual.get(id) ?? h).setor_id]));
}

/**
 * O setor de uma tela do Monitorias (6.0): o pedido no endereço, se tiver
 * monitorias, ou o primeiro. `setores` alimenta as abas (que só aparecem com
 * dois ou mais).
 */
export async function setorDaTela(db: SupabaseClient, pedido?: string) {
  const { data } = await db.from('setores').select('id, nome, monitorias').eq('ativo', true).order('ordem');
  const setores = ((data ?? []) as { id: number; nome: string; monitorias: boolean | null }[])
    .filter((s) => s.monitorias !== false);
  const setorId = setores.find((s) => String(s.id) === pedido)?.id ?? setores[0]?.id ?? 1;
  return { setores, setorId };
}
