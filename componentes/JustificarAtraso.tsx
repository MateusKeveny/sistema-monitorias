'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

/**
 * Justificativa de um chamado fora do prazo, escrita por quem o tratou
 * (migração 53). Vai para a fila da gestão na hora, sem esperar a próxima
 * importação do ELO; pode ser reescrita até a gestão decidir.
 */
export default function JustificarAtraso({ protocolo, atual }: { protocolo: number; atual: string | null }) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState(atual ?? '');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    setEnviando(true); setErro(null);
    const { error } = await criarClienteNavegador()
      .rpc('justificar_atraso_chamado', { p_protocolo: protocolo, p_texto: texto });
    setEnviando(false);
    if (error) { setErro(error.message); return; }
    setAberto(false);
    router.refresh();
  }

  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)}
              className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-xs font-medium
                         text-slate-700 hover:bg-slate-50">
        {atual ? 'Reescrever a justificativa' : 'Justificar o atraso'}
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} autoFocus
                placeholder="Por que o chamado passou de 2 dias úteis?"
                className="w-full rounded-lg border border-slate-300 bg-superficie px-3 py-2 text-sm" />
      {erro && <p className="text-xs text-rose-700">{erro}</p>}
      <div className="flex gap-2">
        <button disabled={enviando || texto.trim().length < 5} onClick={enviar}
                className="rounded-lg bg-marca-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
          Enviar para a gestão
        </button>
        <button onClick={() => { setAberto(false); setTexto(atual ?? ''); }}
                className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
          Cancelar
        </button>
      </div>
    </div>
  );
}
