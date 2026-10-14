'use client';

import { useEffect } from 'react';
import { criarClienteDaAgenda } from '@/lib/agenda/db-cliente';

/** Renova a sessão da agenda pelo navegador enquanto ela está aberta (ver ManterSessao). */
export default function ManterSessaoDaAgenda() {
  useEffect(() => {
    const auth = criarClienteDaAgenda().auth;
    auth.startAutoRefresh();
    return () => { auth.stopAutoRefresh(); };
  }, []);
  return null;
}
