import type { Galho } from '@/lib/galhos';

/**
 * Os pontos do mês em árvore (4.14.0): galho → fila → o que somou e o que
 * tirou. Usada no Início do atendente e no Extrato. Cada galho abre e fecha
 * (<details>), aberto de início; sem estado no navegador.
 */
export type ItemDePonto = { chave: string; origem: string | null; rotulo: string; detalhe?: string; cota: number };

const num = (v: number, casas = 1) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas });
const sinal = (v: number) => `${v < 0 ? '−' : '+'}${num(Math.abs(v))}`;
const tom = (v: number) => v < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-marca-700 dark:text-marca-400';

export default function ArvoreDePontos({ galhos, colunas = false }: { galhos: Galho<ItemDePonto>[]; colunas?: boolean }) {
  return (
    <div className={colunas ? 'grid items-start gap-x-10 gap-y-4 lg:grid-cols-2' : 'space-y-3'}>
      {galhos.map((g) => (
        <details key={g.nome} open className="group rounded-xl ring-1 ring-slate-200 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex cursor-pointer select-none items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-slate-50">
            <span className="flex items-center gap-2 font-semibold text-slate-800">
              <svg viewBox="0 0 20 20" aria-hidden className="h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90">
                <path d="M7 5l6 5-6 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {g.nome}
            </span>
            <span className={`text-sm font-semibold tabular-nums ${tom(g.cota)}`}>{sinal(g.cota)}</span>
          </summary>
          <div className="space-y-2.5 px-3 pb-3 pt-1">
            {g.filas.map((f) => {
              const itens = [...f.itens].sort((a, b) => b.cota - a.cota);
              return (
                <div key={f.apelido || 'geral'}>
                  {!g.simples && (
                    <p className="mb-1 flex items-baseline justify-between gap-3 border-l-2 border-slate-200 pl-2 text-xs font-semibold text-slate-500">
                      <span>{f.nome}</span>
                      <span className="tabular-nums">{sinal(f.cota)}</span>
                    </p>
                  )}
                  <ul className={`space-y-1.5 text-sm ${g.simples ? '' : 'pl-2.5'}`}>
                    {itens.map((i) => (
                      <li key={i.chave} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-slate-700">
                          {i.rotulo}{i.detalhe && <span className="ml-1.5 text-xs text-slate-400">{i.detalhe}</span>}
                        </span>
                        <span className={`font-semibold tabular-nums ${tom(i.cota)}`}>{sinal(i.cota)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}
