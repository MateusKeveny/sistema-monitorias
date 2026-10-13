'use client';

import { useEffect } from 'react';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

/**
 * Mantém a sessão renovada pelo navegador enquanto o painel está aberto
 * (1.39.2). O cliente do Supabase no navegador troca o passe antes de vencer,
 * direto com o Supabase, e grava o novo no cookie — o servidor só lê. Assim o
 * middleware quase nunca precisa mandar para /auth/renovar.
 */
export default function ManterSessao() {
  useEffect(() => {
    const auth = criarClienteNavegador().auth;
    auth.startAutoRefresh();
    return () => { auth.stopAutoRefresh(); };
  }, []);
  return null;
}
