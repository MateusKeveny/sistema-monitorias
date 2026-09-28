/**
 * Esqueleto das telas do Performance (1.15.0), no mesmo desenho delas: o
 * título sobre a arte de fundo e uma superfície só, com seções. Aparece na
 * hora do clique, enquanto o servidor calcula — a cota leva mais de um
 * segundo, e sem isso a tela anterior ficava congelada.
 */
const Barra = ({ className = '' }: { className?: string }) => (
  <div className={`animate-pulse rounded bg-slate-200 motion-reduce:animate-none ${className}`} />
);

export default function Carregando() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Carregando">
      <div className="space-y-2">
        <div className="h-8 w-72 animate-pulse rounded bg-white/15 motion-reduce:animate-none" />
        <div className="h-4 w-56 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
      </div>

      <div className="divide-y divide-slate-200 rounded-2xl bg-superficie shadow-sm">
        <section className="space-y-3 px-7 py-6">
          <Barra className="h-4 w-40" />
          <Barra className="h-9 w-full" />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-4" style={{ opacity: 1 - i * 0.1 }}>
              <Barra className="h-3 w-32" />
              <Barra className="h-2 flex-1" />
              <Barra className="h-3 w-16" />
            </div>
          ))}
        </section>
        <section className="grid gap-8 px-7 py-6 lg:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="space-y-3">
              <Barra className="h-3 w-24" />
              <Barra className="h-7 w-20" />
              <div className="flex h-24 items-end gap-2">
                {[60, 40, 80, 70].map((h, j) => (
                  <div key={j} className="flex-1 animate-pulse rounded-t bg-slate-200 motion-reduce:animate-none"
                       style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
