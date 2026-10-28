import type { SupabaseClient } from '@supabase/supabase-js';
import { hojeNoBrasil, mesDeCompetencia } from '@/lib/formatar';

/**
 * Quem está, neste mês, num setor com as monitorias desligadas (etapa 4,
 * migração 88). Essas pessoas não aparecem no Monitorias: a monitoria delas
 * não pontua, e a qualidade não deve vê-las como pendência.
 *
 * Com todos os setores ligados (o caso de hoje), devolve vazio sem filtrar nada.
 */
export async function foraDasMonitorias(db: SupabaseClient): Promise<Set<string>> {
  const { data: setores } = await db.from('setores').select('id, monitorias');
  const desligados = new Set(((setores ?? []) as { id: number; monitorias: boolean | null }[])
    .filter((s) => s.monitorias === false).map((s) => s.id));
  if (!desligados.size) return new Set();

  const { data: historico } = await db.from('setores_da_pessoa').select('pessoa_id, desde, setor_id');
  const competencia = mesDeCompetencia(hojeNoBrasil());
  const atual = new Map<string, { desde: string; setor_id: number }>();
  const primeiro = new Map<string, { desde: string; setor_id: number }>();
  for (const h of (historico ?? []) as { pessoa_id: string; desde: string; setor_id: number }[]) {
    if (h.desde <= competencia && (!atual.has(h.pessoa_id) || atual.get(h.pessoa_id)!.desde < h.desde)) atual.set(h.pessoa_id, h);
    if (!primeiro.has(h.pessoa_id) || primeiro.get(h.pessoa_id)!.desde > h.desde) primeiro.set(h.pessoa_id, h);
  }
  const fora = new Set<string>();
  for (const [id, h] of primeiro) {
    if (desligados.has((atual.get(id) ?? h).setor_id)) fora.add(id);
  }
  return fora;
}
