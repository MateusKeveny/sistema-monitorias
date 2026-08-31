/**
 * Blocos cinza que ocupam o lugar do conteúdo enquanto o servidor responde.
 *
 * Sem eles o App Router mantém a página anterior congelada até os dados
 * chegarem, e o clique parece não ter surtido efeito. Com eles a troca de
 * página é imediata: o layout aparece na hora e só o miolo preenche depois.
 */

const Barra = ({ className = '', style }: { className?: string; style?: React.CSSProperties }) => (
  <div className={`animate-pulse rounded bg-slate-200 ${className}`} style={style} />
);

export function EsqueletoTitulo() {
  return (
    <div className="space-y-2">
      <Barra className="h-6 w-56" />
      <Barra className="h-4 w-36" />
    </div>
  );
}

export function EsqueletoIndicadores({ quantidade = 4 }: { quantidade?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: quantidade }, (_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
          <Barra className="h-3 w-24" />
          <Barra className="mt-2 h-7 w-20" />
          <Barra className="mt-2 h-3 w-28" />
        </div>
      ))}
    </div>
  );
}

export function EsqueletoTabela({ linhas = 8, colunas = 5 }: { linhas?: number; colunas?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3">
        {Array.from({ length: colunas }, (_, i) => (
          <Barra key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: linhas }, (_, i) => (
        <div key={i} className="flex gap-4 border-b border-slate-100 px-4 py-3">
          {Array.from({ length: colunas }, (_, j) => (
            <Barra key={j} className="h-3 flex-1" style={{ opacity: 1 - i * 0.07 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EsqueletoCartao({ altura = 'h-64' }: { altura?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${altura}`}>
      <Barra className="h-3 w-40" />
      <Barra className="mt-4 h-[calc(100%-2rem)] w-full" />
    </div>
  );
}
