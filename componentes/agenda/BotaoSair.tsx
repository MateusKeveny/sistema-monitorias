'use client';

import { useRouter } from 'next/navigation';
import { criarClienteDaAgenda } from '@/lib/agenda/db-cliente';

/** Sair, nos Ajustes e no menu lateral. */
export default function BotaoSair() {
  const router = useRouter();
  async function sair() {
    await criarClienteDaAgenda().auth.signOut();
    router.push('/agenda/entrar');
    router.refresh();
  }
  return (
    <button onClick={sair}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
      Sair
    </button>
  );
}
