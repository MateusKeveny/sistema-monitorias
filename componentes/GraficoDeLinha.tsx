/**
 * As quatro semanas do ciclo em linha (1.15.0), com a referência tracejada.
 *
 * Substitui as colunas nos detalhes: a linha mostra a tendência — melhorou,
 * piorou — de uma vez, que é o que quem acompanha quer saber. Cada ponto tem
 * a cor da escala única do painel (verde bom, âmbar atenção, rosa ruim) e o
 * valor escrito em cima. A linha se desenha uma vez ao aparecer (desenhar-linha,
 * em globals.css); quem desativa animações vê pronta.
 *
 * SVG montado no servidor, sem biblioteca de gráfico no navegador.
 */
export type PontoDaLinha = { valor: number; tom?: 'bom' | 'atencao' | 'ruim' } | null;

const COR = { bom: 'var(--color-marca-600)', atencao: 'var(--color-amber-500)', ruim: 'var(--color-rose-500)' };

export default function GraficoDeLinha({
  pontos, formatar, referencia, min = 0, max,
}: {
  pontos: PontoDaLinha[];
  formatar: (v: number) => string;
  /** Linha tracejada: a meta (C-SAT) ou a média (volume, TME). */
  referencia?: { valor: number; rotulo: string };
  /** Piso da escala. O C-SAT começa em 75%: do zero, 82% e 88% ficariam iguais. */
  min?: number;
  max?: number;
}) {
  const L = 640, A = 220, esq = 18, dir = 18, topo = 36, base = 30;
  const valores = pontos.filter((p): p is NonNullable<PontoDaLinha> => p != null).map((p) => p.valor);
  const teto = max ?? Math.max(1, ...valores, referencia?.valor ?? 0) * 1.15;
  const x = (i: number) => esq + (i * (L - esq - dir)) / Math.max(1, pontos.length - 1);
  const y = (v: number) => topo + (1 - Math.max(0, Math.min(1, (v - min) / (teto - min)))) * (A - topo - base);

  // A linha liga só as semanas com dado; semana vazia fica como marca no eixo.
  const comDado = pontos.map((p, i) => (p ? { ...p, i } : null)).filter((p): p is NonNullable<typeof p> => p != null);
  const trilha = comDado.map((p, n) => `${n ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ');
  const area = comDado.length > 1
    ? `${trilha} L${x(comDado.at(-1)!.i)},${A - base} L${x(comDado[0].i)},${A - base} Z` : '';

  return (
    <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-label="Evolução por semana"
         className="block h-auto w-full overflow-visible tabular-nums">
      {area && <path d={area} fill="var(--color-marca-600)" opacity={0.08} />}
      {referencia && (
        <>
          <line x1={esq} x2={L - dir} y1={y(referencia.valor)} y2={y(referencia.valor)}
                stroke="var(--color-slate-400)" strokeDasharray="5 5" strokeWidth={1.2} />
          <text x={L - dir} y={y(referencia.valor) - 6} textAnchor="end" fontSize={12}
                fill="var(--color-slate-500)">{referencia.rotulo}</text>
        </>
      )}
      {comDado.length > 1 && (
        <path className="desenhar-linha" d={trilha} fill="none" stroke="var(--color-marca-600)" strokeWidth={2.5}
              strokeLinejoin="round" strokeLinecap="round" pathLength={1} />
      )}
      {pontos.map((p, i) => (
        <g key={i}>
          {p ? (
            <>
              <circle cx={x(i)} cy={y(p.valor)} r={6} fill="var(--color-superficie)"
                      stroke={COR[p.tom ?? 'bom']} strokeWidth={3} />
              <text x={x(i)} y={y(p.valor) - 13} textAnchor="middle" fontSize={13} fontWeight={600}
                    fill="var(--color-slate-800)">{formatar(p.valor)}</text>
            </>
          ) : (
            <text x={x(i)} y={A - base - 6} textAnchor="middle" fontSize={12} fill="var(--color-slate-400)">sem dado</text>
          )}
          <text x={x(i)} y={A - 8} textAnchor="middle" fontSize={12} fill="var(--color-slate-500)">{i + 1}ª semana</text>
        </g>
      ))}
    </svg>
  );
}
