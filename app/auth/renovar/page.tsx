'use client';

import { useEffect, useState } from 'react';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { destinoInterno } from '@/lib/destino';

/**
 * Renova a sessão no navegador e volta para onde a pessoa ia (1.39.2).
 *
 * O middleware manda para cá quem chega com o passe vencido ou quase. A troca
 * do passe acontece aqui, direto entre o navegador e o Supabase — sem passar
 * pelo Worker, onde o erro 1102 podia cortar a resposta e perder o passe novo.
 * O destino só vale dentro do próprio site (lib/destino.ts).
 */
export default function RenovarSessao() {
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    const proximo = destinoInterno(new URLSearchParams(window.location.search).get('proximo'));
    (async () => {
      try {
        // getSession renova sozinho quando o passe venceu.
        const { data, error } = await criarClienteNavegador().auth.getSession();
        if (error || !data.session) {
          window.location.replace(`/login?proximo=${encodeURIComponent(proximo)}`);
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
      {falhou ? (
        <p>
          Não deu para renovar a sua sessão agora.{' '}
          <a href="/login" className="font-semibold text-sobre-fundo underline">Entrar de novo</a>
        </p>
      ) : (
        <p>Renovando a sua sessão…</p>
      )}
    </main>
  );
}
