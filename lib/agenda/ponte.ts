import { createClient } from '@supabase/supabase-js';
import type { Pendencia } from '@/lib/agenda/tipos';
import type { PeriodoDeFerias, PrazoDeFerias } from '@/lib/ferias';

/**
 * A ponte com o banco dos painéis: só leitura, só pendências, só no servidor.
 *
 * Chama `pendencias_para_agenda` (supabase/59-ponte-da-agenda.sql) com o
 * PONTE_SEGREDO do Worker. Nada da agenda vai para lá; de lá vêm só textos e
 * contagens. Sem segredo configurado, ou com o banco fora, a agenda segue
 * funcionando sem as pendências — por isso o erro vira lista vazia.
 */
export async function pendenciasDoPerformance(): Promise<{ lista: Pendencia[]; ok: boolean }> {
  const segredo = process.env.PONTE_SEGREDO;
  if (!segredo) return { lista: [], ok: false };
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } });
    const { data, error } = await db.rpc('pendencias_para_agenda', { p_segredo: segredo });
    if (error) {
      console.warn('agenda: ponte falhou', error.message);
      return { lista: [], ok: false };
    }
    return { lista: (data ?? []) as Pendencia[], ok: true };
  } catch (e) {
    console.warn('agenda: ponte falhou', String(e));
    return { lista: [], ok: false };
  }
}

export type FeriasDaEquipe = { ferias: PeriodoDeFerias[]; prazos: PrazoDeFerias[]; semEntrada: number; ok: boolean };

/**
 * Férias da equipe (61-ferias.sql), pela mesma ponte: nome, datas e prazo.
 * Lidas na hora de montar a tela ou o resumo; a agenda não guarda nada.
 */
export async function feriasDoPerformance(): Promise<FeriasDaEquipe> {
  const vazio = { ferias: [], prazos: [], semEntrada: 0, ok: false };
  const segredo = process.env.PONTE_SEGREDO;
  if (!segredo) return vazio;
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } });
    const { data, error } = await db.rpc('ferias_para_agenda', { p_segredo: segredo });
    if (error || !data) {
      if (error) console.warn('agenda: ponte de férias falhou', error.message);
      return vazio;
    }
    const d = data as { ferias: PeriodoDeFerias[]; prazos: PrazoDeFerias[]; sem_entrada: number };
    return { ferias: d.ferias ?? [], prazos: d.prazos ?? [], semEntrada: d.sem_entrada ?? 0, ok: true };
  } catch (e) {
    console.warn('agenda: ponte de férias falhou', String(e));
    return vazio;
  }
}
