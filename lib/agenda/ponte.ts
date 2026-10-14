import { createClient } from '@supabase/supabase-js';
import type { Pendencia } from '@/lib/agenda/tipos';

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
