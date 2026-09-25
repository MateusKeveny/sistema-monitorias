'use client';

import { useState, type ReactNode } from 'react';

/**
 * Duas visões do mesmo quadro, trocadas sem ir ao servidor.
 *
 * As duas já vêm prontas da página; o botão só mostra uma e esconde a outra.
 * Mesmo princípio do AlternadorCanal: recarregar a tela inicial custa mais de
 * um segundo por causa do cálculo da cota.
 */
export default function AlternadorDeVisao({
  rotulos, paineis, inicial = 0,
}: {
  rotulos: [string, string];
  paineis: [ReactNode, ReactNode];
  inicial?: 0 | 1;
}) {
  const [visao, setVisao] = useState<0 | 1>(inicial);

  return (
    <div className="space-y-3">
      <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="tablist">
        {rotulos.map((rotulo, i) => (
          <button
            key={rotulo} type="button" role="tab" aria-selected={visao === i}
            onClick={() => setVisao(i as 0 | 1)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
              visao === i ? 'bg-superficie text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {rotulo}
          </button>
        ))}
      </div>
      <div hidden={visao !== 0}>{paineis[0]}</div>
      <div hidden={visao !== 1}>{paineis[1]}</div>
    </div>
  );
}
