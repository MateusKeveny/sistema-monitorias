'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Registra o service worker da agenda (public/agenda-sw.js) e recarrega a
 * lista quando um botão da notificação concluir ou adiar algo.
 *
 * Volta também a recarregar ao reabrir o app: no celular a tela fica parada
 * em segundo plano e, ao voltar, mostraria o dia de horas atrás.
 */
export default function RegistrarServiceWorker() {
  const router = useRouter();

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/agenda-sw.js').catch(() => {});

    const aoReceber = (e: MessageEvent) => { if (e.data?.agenda === 'atualizar') router.refresh(); };
    navigator.serviceWorker.addEventListener('message', aoReceber);

    let escondidoEm = 0;
    const aoMudar = () => {
      if (document.hidden) escondidoEm = Date.now();
      else if (escondidoEm && Date.now() - escondidoEm > 60_000) router.refresh();
    };
    document.addEventListener('visibilitychange', aoMudar);

    return () => {
      navigator.serviceWorker.removeEventListener('message', aoReceber);
      document.removeEventListener('visibilitychange', aoMudar);
    };
  }, [router]);

  return null;
}
