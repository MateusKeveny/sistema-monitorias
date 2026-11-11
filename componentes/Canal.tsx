'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

/** O apelido da fila ('huggy', 'diretores', 'fila_15'…), como o banco grava. */
export type Canal = string;
export type CanalDaTela = { chave: Canal; rotulo: string };

/** As filas da Expansão: o padrão de quem ainda não passa as filas do setor. */
const PADRAO: CanalDaTela[] = [{ chave: 'huggy', rotulo: 'Expansão' }, { chave: 'diretores', rotulo: 'Diretores e acima' }];

const Contexto = createContext<{ canal: Canal; escolher: (c: Canal) => void; canais: CanalDaTela[] }>(
  { canal: 'huggy', escolher: () => {}, canais: PADRAO });

/**
 * O canal escolhido, compartilhado pela tela inteira (1.15.0).
 *
 * Na disposição com menu lateral, as abas ficam no topo e o que depende do
 * canal está espalhado: a faixa de destaques, o C-SAT por atendente e o
 * detalhe semana a semana. Cada pedaço usa `NoCanal`; o conteúdo de cada
 * canal já vem pronto e a troca só mostra um e esconde os outros — sem ir ao
 * servidor, para não recalcular a cota a cada clique.
 *
 * Desde a 4.4.0 as filas vêm do setor (`canais`): o Telecom tem quatro, a
 * Expansão duas. Sem `canais`, as da Expansão.
 */
export function ProvedorDeCanal({ inicial, canais = PADRAO, children }: {
  inicial?: Canal; canais?: CanalDaTela[]; children: ReactNode;
}) {
  const primeira = canais.some((c) => c.chave === inicial) ? inicial! : canais[0]?.chave ?? 'huggy';
  const [canal, setCanal] = useState<Canal>(primeira);
  function escolher(c: Canal) {
    setCanal(c);
    // Mantém o canal na URL para recarregar ou compartilhar, sem navegar.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('canal', c);
      window.history.replaceState(null, '', url);
    } catch { /* URL é só conveniência */ }
  }
  return <Contexto.Provider value={{ canal, escolher, canais }}>{children}</Contexto.Provider>;
}

/** As filas que a tela está mostrando (para quem monta o conteúdo de cada uma). */
export function useCanais() {
  return useContext(Contexto).canais;
}

/**
 * Abas de canal. Sobre a arte de fundo (padrão): pílula translúcida, a
 * escolhida em superfície. Dentro de uma superfície (`naSuperficie`): pílula
 * cinza, porque o texto claro da outra sumiria no tema claro.
 * Com uma fila só, não há o que escolher: as abas não aparecem.
 */
export function AbasDeCanal({ naSuperficie = false }: { naSuperficie?: boolean }) {
  const { canal, escolher, canais } = useContext(Contexto);
  if (canais.length < 2) return null;
  return (
    <div role="tablist" aria-label="Fila"
         className={`inline-flex max-w-full flex-wrap gap-1 rounded-full p-1 ${naSuperficie ? 'bg-slate-100' : 'bg-pilula'}`}>
      {canais.map(({ chave, rotulo }) => (
        <button key={chave} type="button" role="tab" aria-selected={canal === chave}
                onClick={() => escolher(chave)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  canal === chave ? 'bg-superficie text-slate-900 shadow-sm'
                    : naSuperficie ? 'text-slate-500 hover:text-slate-900' : 'text-sobre-fundo-suave hover:text-sobre-fundo'}`}>
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
  const { canal: atual } = useContext(Contexto);
  // `contents` só quando visível: assim o invólucro não quebra grades, e o
  // escondido não depende de qual das duas regras de display vence.
  return <div hidden={atual !== canal} className={atual === canal ? 'contents' : undefined}>{children}</div>;
}
