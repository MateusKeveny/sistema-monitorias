'use client';

import { useEffect, useState } from 'react';
import { criarClienteDaAgenda } from '@/lib/agenda/db-cliente';
import { destinoInterno } from '@/lib/destino';

/**
 * Renova a sessão da agenda no navegador e volta para onde se ia — o mesmo
 * desenho do /auth/renovar dos painéis (1.39.2), no banco da agenda.
 */
export default function RenovarDaAgenda() {
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    const pedido = destinoInterno(new URLSearchParams(window.location.search).get('proximo'), '/agenda');
    const proximo = pedido.startsWith('/agenda') ? pedido : '/agenda';
    (async () => {
      try {
        const { data, error } = await criarClienteDaAgenda().auth.getSession();
        if (error || !data.session) {
          window.location.replace(`/agenda/entrar?proximo=${encodeURIComponent(proximo)}`);
          return;
        }
        window.location.replace(proximo);
      } catch {
        setFalhou(true);
      }
    })();
  }, []);

  return (
    <main className="grid min-h-screen place-items-center px-6 text-center text-sm text-sobre-fundo-suave">
      {falhou
        ? <p>Não deu para renovar a sua sessão agora. <a href="/agenda/entrar" className="font-semibold text-sobre-fundo underline">Entrar de novo</a></p>
        : <p>Renovando a sua sessão…</p>}
    </main>
  );
}
