'use client';

import { useState, type ReactNode } from 'react';

/**
 * Abas dentro de um quadro (3.9.0), no mesmo desenho das abas de canal: cada
 * aba já vem pronta do servidor, e a troca só mostra uma e esconde as outras
 * (sem ir ao servidor). Usada onde precisa de "Geral" além dos canais, sem
 * mexer no seletor de canal compartilhado do Início.
 */
export default function AbasLocais({ abas, rotulo }: { abas: { chave: string; rotulo: string; conteudo: ReactNode }[]; rotulo: string }) {
  const [atual, setAtual] = useState(abas[0]?.chave);
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={rotulo} className="inline-flex gap-1 rounded-full bg-slate-100 p-1">
        {abas.map((a) => (
          <button key={a.chave} type="button" role="tab" aria-selected={atual === a.chave} onClick={() => setAtual(a.chave)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    atual === a.chave ? 'bg-superficie text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>
            {a.rotulo}
          </button>
        ))}
      </div>
      {abas.map((a) => (
        <div key={a.chave} hidden={atual !== a.chave} className={atual === a.chave ? 'contents' : undefined}>{a.conteudo}</div>
      ))}
    </div>
  );
}
