'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

/**
 * Atualização automática (4.0.0, migração 98): a cada `segundos`, e só com a
 * aba na tela, pergunta ao banco a "marca" do que importa (fechamentos,
 * aprovações, correções, avisos não lidos — marca_de_mudancas). A página só
 * se atualiza quando a marca muda.
 *
 * A pergunta vai direto ao banco, sem passar pelo servidor da Cloudflare (o
 * limite de processamento do plano gratuito, erro 1102): só a atualização da
 * página, quando algo mudou, passa por lá. Quem está digitando não é
 * interrompido: a atualização espera a próxima rodada.
 */
export default function AtualizacaoAutomatica({ segundos = 30 }: { segundos?: number }) {
  const router = useRouter();

  useEffect(() => {
    const db = criarClienteNavegador();
    let ultima: string | null | undefined;
    let parado = false;

    const digitando = () => {
      const a = document.activeElement as HTMLElement | null;
      return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
    };

    const conferir = async () => {
      if (document.visibilityState !== 'visible') return;
      const { data, error } = await db.rpc('marca_de_mudancas');
      if (parado || error || typeof data !== 'string') return;
      if (ultima !== undefined && data !== ultima) {
        // Digitando: não guarda a marca nova, para atualizar na próxima rodada.
        if (digitando()) return;
        router.refresh();
      }
      ultima = data;
    };

    conferir();
    const intervalo = setInterval(conferir, segundos * 1000);
    const aoVoltar = () => { if (document.visibilityState === 'visible') conferir(); };
    document.addEventListener('visibilitychange', aoVoltar);
    return () => { parado = true; clearInterval(intervalo); document.removeEventListener('visibilitychange', aoVoltar); };
  }, [router, segundos]);

  return null;
}
