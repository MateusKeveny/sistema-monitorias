'use client';

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

type Canal = 'huggy' | 'diretores';
const CANAIS = [['huggy', 'Expansão'], ['diretores', 'Diretores-Expansão']] as const;

/**
 * Troca o canal exibido sem ir ao servidor.
 *
 * O conteúdo dos dois canais já vem pronto na página; o botão só mostra um e
 * esconde o outro. Antes cada clique recarregava a tela inteira — inclusive a
 * pontuação de cota, que leva mais de um segundo para calcular —, e cliques
 * seguidos cancelavam uns aos outros.
 *
 * Desde a 1.15.0 as abas são sublinhadas, com um traço que desliza até a
 * escolhida (só `transform` e largura, sem recalcular a página).
 */
export default function AlternadorCanal({
  inicial, paineis, extras, compacto = false,
}: {
  inicial: Canal;
  paineis: Record<Canal, ReactNode>;
  /** Complemento ao lado do nome do canal (ex.: quantidade de avaliações). */
  extras?: Partial<Record<Canal, ReactNode>>;
  /** Abas menores, para uso dentro de um quadro. */
  compacto?: boolean;
}) {
  const [canal, setCanal] = useState<Canal>(inicial);
  const botoes = useRef<Partial<Record<Canal, HTMLButtonElement | null>>>({});
  const [traco, setTraco] = useState<{ x: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const medir = () => {
      const b = botoes.current[canal];
      if (b) setTraco({ x: b.offsetLeft, w: b.offsetWidth });
    };
    medir();
    addEventListener('resize', medir);
    return () => removeEventListener('resize', medir);
  }, [canal]);

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
      <div className={`relative flex border-b border-slate-200 ${compacto ? 'gap-4' : 'gap-6'}`}
           role="tablist" aria-label="Canal">
        {CANAIS.map(([chave, rotulo]) => (
          <button
            key={chave} type="button" role="tab" aria-selected={canal === chave}
            ref={(el) => { botoes.current[chave] = el; }}
            onClick={() => escolher(chave)}
            className={`font-medium transition-colors ${compacto ? 'pb-1.5 text-xs' : 'pb-2.5 text-sm'} ${
              canal === chave ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {rotulo}
            {extras?.[chave] != null && <span className="ml-1.5 tabular-nums text-slate-400">{extras[chave]}</span>}
          </button>
        ))}
        {traco && (
          <span aria-hidden
                className="absolute -bottom-px left-0 h-0.5 rounded-full bg-marca-600 transition-[transform,width]
                           duration-300 ease-out motion-reduce:transition-none"
                style={{ width: traco.w, transform: `translateX(${traco.x}px)` }} />
        )}
      </div>
      <div hidden={canal !== 'huggy'}>{paineis.huggy}</div>
      <div hidden={canal !== 'diretores'}>{paineis.diretores}</div>
    </div>
  );
}
