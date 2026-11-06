'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import { dataHora } from '@/lib/formatar';

export type PendenciaDaCeo = {
  fechamento_id: string;
  pessoa: string;
  situacao: 'recusado' | 'respondido';
  /** Recusada: o motivo da CEO. Respondida: a resposta do gestor. */
  texto: string | null;
  /** Respondida: o motivo da recusa que foi respondida. */
  recusa?: string | null;
  em: string;
};

/**
 * Pendências com a CEO (4.0.0), no topo do Congelado: as recusas que esperam a
 * resposta do gestor e as respostas que esperam a CEO decidir de novo.
 *
 * Responder aqui manda só o texto (os números não mudam). Para corrigir os
 * pontos, a Correção da linha também vale como resposta; e reabrir e fechar de
 * novo manda a cota refeita.
 */
export default function PendenciasDaCeo({ itens }: { itens: PendenciaDaCeo[] }) {
  const router = useRouter();
  const [respondendo, setRespondendo] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const recusadas = itens.filter((i) => i.situacao === 'recusado');
  const respondidas = itens.filter((i) => i.situacao === 'respondido');

  async function responder(id: string) {
    if (!texto.trim()) { setErro('Escreva a resposta para a CEO.'); return; }
    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().rpc('responder_recusa', { p_fechamento: id, p_resposta: texto.trim() });
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    setRespondendo(null); setTexto('');
    router.refresh();
  }

  return (
    <div className="mb-4 space-y-3 rounded-xl bg-amber-50/70 px-4 py-3 ring-1 ring-amber-600/20 dark:bg-amber-500/10">
      <p className="text-sm font-semibold text-slate-800">Pendências com a CEO</p>
      {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}

      {recusadas.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
            {recusadas.length} recusada{recusadas.length > 1 ? 's' : ''}, aguardando a sua resposta
          </p>
          <ul className="mt-1 divide-y divide-amber-600/10 text-sm">
            {recusadas.map((r) => (
              <li key={r.fechamento_id} className="py-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <b className="text-slate-800">{r.pessoa}</b>
                  <span className="flex-1 text-slate-600">Motivo: {r.texto ?? '—'}</span>
                  <span className="text-[11px] text-slate-500">{dataHora(r.em)}</span>
                  {respondendo !== r.fechamento_id && (
                    <button type="button" onClick={() => { setRespondendo(r.fechamento_id); setTexto(''); setErro(null); }}
                            className="rounded-full bg-marca-600 px-3 py-1 text-xs font-semibold text-white hover:bg-marca-700">
                      Responder
                    </button>
                  )}
                </div>
                {respondendo === r.fechamento_id && (
                  <div className="mt-2 flex max-w-2xl gap-2">
                    <input autoFocus value={texto} onChange={(e) => { setTexto(e.target.value); setErro(null); }}
                           placeholder="A resposta para a CEO (os pontos não mudam; para corrigir, use a Correção da linha)"
                           className="w-full rounded-md border border-slate-300 bg-superficie px-2 py-1 text-sm outline-none focus:border-marca-600"
                           onKeyDown={(e) => { if (e.key === 'Enter') responder(r.fechamento_id); }} />
                    <button type="button" disabled={ocupado} onClick={() => responder(r.fechamento_id)}
                            className="rounded-full bg-marca-600 px-3 py-1 text-xs font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
                      {ocupado ? 'Enviando…' : 'Enviar'}
                    </button>
                    <button type="button" onClick={() => { setRespondendo(null); setTexto(''); setErro(null); }}
                            className="text-xs text-slate-500 hover:underline">Cancelar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {respondidas.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-sky-700 dark:text-sky-300">
            {respondidas.length} respondida{respondidas.length > 1 ? 's' : ''}, aguardando a CEO
          </p>
          <ul className="mt-1 divide-y divide-amber-600/10 text-sm">
            {respondidas.map((r) => (
              <li key={r.fechamento_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <b className="text-slate-800">{r.pessoa}</b>
                <span className="flex-1 text-slate-600">
                  {r.recusa ? <>Recusa: {r.recusa} · </> : null}Sua resposta: {r.texto ?? '—'}
                </span>
                <span className="text-[11px] text-slate-500">{dataHora(r.em)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
