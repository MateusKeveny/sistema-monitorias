'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Cliente do banco da AGENDA no navegador — outro projeto Supabase, não o
 * dos painéis (supabase/agenda/). A URL e a chave pública entram no build
 * (.env.local); são públicas por natureza e o acesso é decidido pela RLS.
 */
export function criarClienteDaAgenda() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_AGENDA_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_AGENDA_SUPABASE_ANON_KEY!,
  );
}
