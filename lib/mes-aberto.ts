import { cache } from 'react';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { hojeNoBrasil, mesDeCompetencia } from '@/lib/formatar';

/**
 * Mês aberto para monitorias (Monitorias 4.12.0, migração 30).
 *
 * É o mês seguinte ao último fechamento da cota: enquanto setembro não for
 * fechado no Performance, o painel de Monitorias fica em setembro e outubro
 * não aparece nem aceita monitoria. A trava de verdade está no banco
 * (`conferir_mes_aberto_da_monitoria`); aqui é só o que as telas mostram.
 *
 * Sem a função no banco (migração ainda não rodada), vale o mês do
 * calendário — o comportamento de antes.
 */
export const mesAbertoDasMonitorias = cache(async (): Promise<string> => {
  const db = await criarClienteServidor();
  const { data, error } = await db.rpc('mes_aberto_das_monitorias');
  if (error || !data) return mesDeCompetencia(hojeNoBrasil());
  return String(data).slice(0, 10);
});

/** Tira da lista os meses depois do aberto: eles só aparecem quando forem liberados. */
export const ateOMesAberto = (meses: string[], aberto: string) => meses.filter((m) => m <= aberto);

/** '2026-09-01' → último dia que ainda pertence ao mês aberto ('2026-09-25'). */
export const ultimoDiaDoMesAberto = (aberto: string) => `${aberto.slice(0, 8)}25`;
