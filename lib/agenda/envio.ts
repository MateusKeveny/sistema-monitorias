import { createClient } from '@supabase/supabase-js';
import type { ChavesVapid } from '@/lib/agenda/webpush';

/**
 * Configuração do envio, lida do Worker `painel-agenda`:
 *   VAPID_PUBLICA  — variável (wrangler.jsonc); vai também para o navegador
 *   VAPID_PRIVADA  — segredo (`wrangler secret put VAPID_PRIVADA --env agenda`)
 *   AGENDA_SEGREDO — segredo; o mesmo valor fica em `agenda_config` no banco da agenda
 *   PONTE_SEGREDO  — segredo; o mesmo valor fica em `agenda_ponte` no banco dos painéis
 *
 * Localmente, as três vêm do `.env.local` (`npm run agenda:chaves`).
 */
export function chavesVapid(): ChavesVapid | null {
  const publica = process.env.VAPID_PUBLICA;
  const privada = process.env.VAPID_PRIVADA;
  if (!publica || !privada) return null;
  // Contato exigido pela norma: o endereço do próprio site, sem e-mail pessoal.
  return { publica, privada, contato: 'https://painel-agenda.expansao.workers.dev' };
}

export const segredoDaAgenda = () => {
  const s = process.env.AGENDA_SEGREDO;
  return s && s.length >= 32 ? s : null;
};

/** Banco da agenda sem sessão: as funções chamadas daqui conferem o segredo. */
export const dbSemSessao = () => createClient(
  process.env.NEXT_PUBLIC_AGENDA_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_AGENDA_SUPABASE_ANON_KEY!,
  { auth: { persistSession: false } },
);
