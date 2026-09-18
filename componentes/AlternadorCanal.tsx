'use client';

import { useState, type ReactNode } from 'react';

type Canal = 'huggy' | 'diretores';

/**
 * Troca o canal exibido sem ir ao servidor.
 *
 * O conteúdo dos dois canais já vem pronto na página; o botão só mostra um e
 * esconde o outro. Antes cada clique recarregava a tela inteira — inclusive a
 * pontuação de cota, que leva mais de um segundo para calcular —, e cliques
 * seguidos cancelavam uns aos outros.
 */
export default function AlternadorCanal({
  inicial, paineis, extras, compacto = false,
}: {
  inicial: Canal;
  paineis: Record<Canal, ReactNode>;
  /** Complemento ao lado do nome do canal (ex.: quantidade de avaliações). */
  extras?: Partial<Record<Canal, ReactNode>>;
  /** Botões menores, para uso dentro de um quadro. */
  compacto?: boolean;
}) {
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

  return (
    <div className={compacto ? 'space-y-3' : 'space-y-6'}>
      <div className={`inline-flex rounded-lg bg-slate-100 ${compacto ? 'p-0.5' : 'p-1'}`} role="tablist" aria-label="Canal">
        {([['huggy', 'Expansão'], ['diretores', 'Diretores-Expansão']] as const).map(([chave, rotulo]) => (
          <button
            key={chave} type="button" role="tab" aria-selected={canal === chave}
            onClick={() => escolher(chave)}
            className={`rounded-md font-medium transition ${compacto ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm'} ${
              canal === chave ? 'bg-superficie text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {rotulo}
            {extras?.[chave] != null && <span className="ml-1.5 tabular-nums text-slate-400">{extras[chave]}</span>}
          </button>
        ))}
      </div>
      <div hidden={canal !== 'huggy'}>{paineis.huggy}</div>
      <div hidden={canal !== 'diretores'}>{paineis.diretores}</div>
    </div>
  );
}
