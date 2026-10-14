'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteDaAgenda } from '@/lib/agenda/db-cliente';

/** Volta uma conclusão: o lembrete reaparece na agenda (agenda_desfazer). */
export default function BotaoDesfazer({ id }: { id: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  async function desfazer() {
    setOcupado(true);
    const { error } = await criarClienteDaAgenda().rpc('agenda_desfazer', { p_concluido: id });
    setOcupado(false);
    if (error) alert(`Não foi possível desfazer: ${error.message}`);
    router.refresh();
  }

  return (
    <button onClick={desfazer} disabled={ocupado}
            className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50">
      {ocupado ? '…' : 'Desfazer'}
    </button>
  );
}
