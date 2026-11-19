'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

/** O apelido da fila ('huggy', 'diretores', 'fila_15'…), como o banco grava. */
export type Canal = string;
/** `nivel` 1 = fila dentro de um galho; `detalhe` = "3 filas" (4.14.0). */
export type CanalDaTela = { chave: Canal; rotulo: string; nivel?: 0 | 1; detalhe?: string; principal?: boolean };

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
  // 4.14.0: mais de três opções viram um seletor (a fileira de abas ficava enorme).
  if (canais.length > 3) return <SeletorDeCanal naSuperficie={naSuperficie} />;
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

/**
 * Seletor de fila (4.14.0): um botão com a escolhida e, ao clicar, a lista em
 * árvore — "Todas as filas", cada galho e as filas dele recuadas.
 */
function SeletorDeCanal({ naSuperficie }: { naSuperficie: boolean }) {
  const { canal, escolher, canais } = useContext(Contexto);
  const [aberto, setAberto] = useState(false);
  // Galhos com as filas à mostra: de início, só o da fila escolhida.
  const [galhosAbertos, setGalhosAbertos] = useState<Set<string>>(new Set());
  const caixa = useRef<HTMLDivElement>(null);
  const atual = canais.find((c) => c.chave === canal) ?? canais[0];
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) setAberto(false); };
    const tecla = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    document.addEventListener('mousedown', fora);
    document.addEventListener('keydown', tecla);
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', tecla); };
  }, [aberto]);
  // A lista em blocos: o resumo de todas no topo; cada galho com as filas
  // dele embaixo, ligadas por um fio; as filas sem galho num bloco "Filas".
  type Bloco = { titulo?: string; cabeca?: CanalDaTela; filas: CanalDaTela[] };
  const blocos: Bloco[] = [];
  const soltas: CanalDaTela[] = [];
  for (const c of canais) {
    if (c.chave === 'todas') { blocos.push({ cabeca: c, filas: [] }); continue; }
    if (c.nivel === 1) { blocos[blocos.length - 1]?.filas.push(c); continue; }
    if (c.chave.startsWith('galho:') || c.principal) { blocos.push({ cabeca: c, filas: [] }); continue; }
    soltas.push(c);
  }
  if (soltas.length) blocos.push({ titulo: blocos.length > 1 ? 'Outras filas' : 'Filas', filas: soltas });

  const Opcao = ({ c, recuada = false, destaque = false }: { c: CanalDaTela; recuada?: boolean; destaque?: boolean }) => {
    const escolhida = c.chave === canal;
    return (
      <button type="button" role="option" aria-selected={escolhida}
              onClick={() => { escolher(c.chave); setAberto(false); }}
              className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                escolhida ? 'bg-marca-600/10 text-marca-700 dark:text-marca-400' : 'text-slate-700 hover:bg-slate-100'} ${
                recuada ? '' : 'font-medium'}`}>
        <span className="min-w-0 flex-1">
          <span className={`block truncate ${destaque ? 'font-semibold' : ''}`}>{c.rotulo}</span>
          {c.detalhe && <span className="block text-[11px] font-normal text-slate-500">
            {c.chave === 'todas' ? `Resumo geral · ${c.detalhe}` : `Resumo de ${c.detalhe}`}
          </span>}
        </span>
        {escolhida && (
          <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4 shrink-0">
            <path d="M5 10.5l3.2 3.2L15 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
    );
  };

  return (
    <div ref={caixa} className="relative inline-block">
      <button type="button" aria-haspopup="listbox" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}
              className={`group inline-flex items-center gap-2.5 rounded-xl px-3.5 py-2 text-sm transition-colors ${
                naSuperficie ? 'bg-slate-100 text-slate-800 hover:bg-slate-200' : 'bg-pilula text-sobre-fundo hover:brightness-110'}`}>
        {/* Ícone de camadas: a tela pode estar mostrando várias filas juntas. */}
        <svg viewBox="0 0 20 20" aria-hidden className="h-4 w-4 opacity-70">
          <path d="M10 3l7 3.5-7 3.5-7-3.5L10 3zM3 10l7 3.5 7-3.5M3 13.5L10 17l7-3.5" fill="none" stroke="currentColor"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="font-semibold">{atual?.rotulo}</span>
        {/* Galho escolhido: "Expansão · 3 filas", para não confundir com a fila Expansão. */}
        {atual?.detalhe && atual.chave !== 'todas' && <span className="text-xs opacity-70">{atual.detalhe}</span>}
        <svg viewBox="0 0 20 20" aria-hidden className={`h-3.5 w-3.5 opacity-70 transition-transform ${aberto ? 'rotate-180' : ''}`}>
          <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {aberto && (
        <div role="listbox" aria-label="Fila"
             className="absolute right-0 z-30 mt-2 max-h-[70vh] w-72 max-w-[calc(100vw-2rem)] overflow-auto rounded-2xl bg-superficie p-2 shadow-xl ring-1 ring-slate-200">
          {blocos.map((b, i) => {
            // Galho: o nome escolhe o resumo das filas dele; a setinha mostra as filas.
            const ehGalho = !!b.cabeca && b.filas.length > 0;
            // Principal (galho de várias filas ou de uma só, como o iGreen Mob).
            const ehPrincipal = !!b.cabeca && b.cabeca.chave !== 'todas';
            const anteriorPrincipal = i > 0 && !!blocos[i - 1].cabeca && blocos[i - 1].cabeca!.chave !== 'todas';
            const chaveGalho = b.cabeca?.chave ?? '';
            const mostraFilas = !ehGalho || galhosAbertos.has(chaveGalho) || b.filas.some((f) => f.chave === canal);
            return (
              <div key={b.cabeca?.chave ?? b.titulo} className={i > 0 && !(ehPrincipal && anteriorPrincipal)
                ? 'mt-2 border-t border-slate-100 pt-2' : undefined}>
                {ehPrincipal && !anteriorPrincipal && <p className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">Principais</p>}
                {b.titulo && <p className="px-2.5 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-slate-400">{b.titulo}</p>}
                {b.cabeca && (ehGalho ? (
                  <div className="flex items-center gap-1">
                    <div className="min-w-0 flex-1"><Opcao c={b.cabeca} destaque /></div>
                    <button type="button" aria-label={mostraFilas ? `Esconder as filas de ${b.cabeca.rotulo}` : `Ver as filas de ${b.cabeca.rotulo}`}
                            aria-expanded={mostraFilas}
                            onClick={() => setGalhosAbertos((s) => {
                              const n = new Set(s);
                              if (mostraFilas) n.delete(chaveGalho); else n.add(chaveGalho);
                              return n;
                            })}
                            className="shrink-0 rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
                      <svg viewBox="0 0 20 20" aria-hidden className={`h-4 w-4 transition-transform ${mostraFilas ? 'rotate-180' : ''}`}>
                        <path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </div>
                ) : <Opcao c={b.cabeca} destaque />)}
                {b.filas.length > 0 && mostraFilas && (
                  <div className={b.cabeca ? 'ml-4 mt-0.5 border-l border-slate-200 pl-1.5' : undefined}>
                    {b.filas.map((c) => <Opcao key={c.chave} c={c} recuada={!!b.cabeca} />)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
