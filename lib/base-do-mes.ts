import type { SupabaseClient } from '@supabase/supabase-js';
import type { Base, LinhaDoExtrato } from '@/lib/simulacao';

const CAMPOS = 'pessoa_id, semana, origem, regra, rotulo, grupo, ordem, cargo_id, cargo, quantidade, peso, cota';

/**
 * O extrato do mês e o resultado de cada um, prontos para a conta da
 * simulação sem cenário (projeção do mês e conferência do cálculo, 2.1.0).
 * Lido no navegador: as faixas, pesos e volumes por pessoa só fazem falta
 * quando há cenário, e ficam vazios aqui.
 */
export async function carregarBaseDoMes(
  db: SupabaseClient, competencia: string, fonte: { extrato: string; mensal: string }, pessoaId?: string,
): Promise<Base> {
  const linhas: LinhaDoExtrato[] = [];
  for (let de = 0; ; de += 1000) {
    let q = db.from(fonte.extrato).select(CAMPOS).eq('mes_competencia', competencia);
    if (pessoaId) q = q.eq('pessoa_id', pessoaId);
    const { data, error } = await q.order('pessoa_id').order('semana', { nullsFirst: false })
      .order('ordem').order('regra').range(de, de + 999);
    if (error) throw error;
    linhas.push(...((data ?? []) as LinhaDoExtrato[]));
    if ((data ?? []).length < 1000) break;
  }
  let mensal = db.from(fonte.mensal).select('pessoa_id, pessoa, cargo, resultado, meta, compoe_media').eq('mes_competencia', competencia);
  if (pessoaId) mensal = mensal.eq('pessoa_id', pessoaId);
  const [m, refs, tme] = await Promise.all([
    mensal,
    db.from('cargos_referencia').select('cargo_id, referencia_id'),
    // As semanas lançadas pela equipe (agregado, legível por todos).
    db.from('vw_tme_equipe').select('semana').eq('mes_competencia', competencia),
  ]);
  if (m.error || refs.error) throw m.error ?? refs.error;
  const n = (v: unknown) => Number(v);
  return {
    linhas: linhas.map((l) => ({ ...l, quantidade: n(l.quantidade), peso: n(l.peso), cota: n(l.cota) })),
    pessoas: ((m.data ?? []) as Base['pessoas']).map((p) => ({ ...p, resultado: n(p.resultado), meta: p.meta == null ? null : n(p.meta) })),
    faixas: [], pesos: [], tme: [], tmeDesligado: [], volume: [], csat: [],
    referencias: (refs.data ?? []) as Base['referencias'],
    semanasLancadas: [...new Set(((tme.data ?? []) as { semana: number }[]).map((t) => t.semana))],
  };
}
