'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

export type Canal = 'huggy' | 'diretores';

const CANAIS = [['huggy', 'Expansão'], ['diretores', 'Diretores-Expansão']] as const;
const Contexto = createContext<[Canal, (c: Canal) => void]>(['huggy', () => {}]);

/**
 * O canal escolhido, compartilhado pela tela inteira (1.15.0).
 *
 * Na disposição com menu lateral, as abas ficam no topo e o que depende do
 * canal está espalhado: a faixa de destaques, o C-SAT por atendente e o
 * detalhe semana a semana. Cada pedaço usa `NoCanal`; o conteúdo dos dois
 * canais já vem pronto do servidor e a troca só mostra um e esconde o outro —
 * sem ir ao servidor, para não recalcular a cota a cada clique.
 */
export function ProvedorDeCanal({ inicial, children }: { inicial: Canal; children: ReactNode }) {
  const [canal, setCanal] = useState<Canal>(inicial);
  function escolher(c: Canal) {
    setCanal(c);
    // Mantém o canal na URL para recarregar ou compartilhar, sem navegar.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('canal', c);
      window.history.replaceState(null, '', url);
    } catch { /* URL é só conveniência */ }
  }
  return <Contexto.Provider value={[canal, escolher]}>{children}</Contexto.Provider>;
}

/** Abas de canal sobre a arte de fundo: pílula translúcida, a escolhida em superfície. */
export function AbasDeCanal() {
  const [canal, escolher] = useContext(Contexto);
  return (
    <div role="tablist" aria-label="Canal" className="inline-flex gap-1 rounded-full bg-black/25 p-1">
      {CANAIS.map(([chave, rotulo]) => (
        <button key={chave} type="button" role="tab" aria-selected={canal === chave}
                onClick={() => escolher(chave)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  canal === chave ? 'bg-superficie text-slate-900 shadow-sm' : 'text-sobre-fundo-suave hover:text-sobre-fundo'}`}>
          {rotulo}
        </button>
      ))}
    </div>
  );
}

/**
 * Mostra o conteúdo só no canal indicado. Elemento escondido não anima; ao
 * aparecer, as barras (crescer-y/x) crescem de novo — é o movimento da troca.
 */
export function NoCanal({ canal, children }: { canal: Canal; children: ReactNode }) {
  const [atual] = useContext(Contexto);
  // `contents` só quando visível: assim o invólucro não quebra grades, e o
  // escondido não depende de qual das duas regras de display vence.
  return <div hidden={atual !== canal} className={atual === canal ? 'contents' : undefined}>{children}</div>;
}
