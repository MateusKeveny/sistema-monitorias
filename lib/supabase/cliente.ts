'use client';

import { createBrowserClient } from '@supabase/ssr';

/** Cliente Supabase para uso dentro de componentes do navegador. */
export function criarClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
