/**
 * Uma série em linha — as quatro semanas do ciclo (1.15.0) ou os meses do
 * Comparativo (1.17.0) —, com a referência tracejada.
 *
 * Substitui as colunas nos detalhes: a linha mostra a tendência — melhorou,
 * piorou — de uma vez, que é o que quem acompanha quer saber. Cada ponto tem
 * a cor da escala única do painel (verde bom, âmbar atenção, rosa ruim) e o
 * valor escrito em cima. A linha se desenha uma vez ao aparecer (desenhar-linha,
 * em globals.css); quem desativa animações vê pronta.
 *
 * Com `comparacao` (1.41.0), o mês anterior aparece atrás, semana a semana:
 * linha cinza fina, sem valores escritos (o número aparece ao passar o
 * mouse), e uma legenda pequena em cima. Só para comparar — a cor e os
 * valores continuam sendo os do mês da tela.
 *
 * SVG montado no servidor, sem biblioteca de gráfico no navegador.
 */
export type PontoDaLinha = { valor: number; tom?: 'bom' | 'atencao' | 'ruim' } | null;

const COR = { bom: 'var(--color-marca-600)', atencao: 'var(--color-amber-500)', ruim: 'var(--color-rose-500)' };

export default function GraficoDeLinha({
  pontos, formatar, referencia, min = 0, max, rotulos, largura = 640, comparacao,
}: {
  pontos: PontoDaLinha[];
  /** O mês anterior, semana a semana, para comparar; os rótulos são os nomes dos meses na legenda. */
  comparacao?: { pontos: (number | null)[]; rotulo: string; rotuloAtual: string };
  formatar: (v: number) => string;
  /** Linha tracejada: a meta (C-SAT) ou a média (volume, TME). */
  referencia?: { valor: number; rotulo: string };
  /** Piso da escala. O C-SAT começa em 75%: do zero, 82% e 88% ficariam iguais. */
  min?: number;
  max?: number;
  /** Rótulo de cada ponto no eixo; sem ele, "1ª semana", "2ª semana"... */
  rotulos?: string[];
  /** Largura do desenho: mais pontos pedem mais espaço entre eles. */
  largura?: number;
}) {
  const L = largura, A = 220, esq = 18, dir = 18, topo = 36, base = 30;
  const valores = [
    ...pontos.filter((p): p is NonNullable<PontoDaLinha> => p != null).map((p) => p.valor),
    ...(comparacao?.pontos ?? []).filter((v): v is number => v != null),
  ];
  const teto = max ?? Math.max(1, ...valores, referencia?.valor ?? 0) * 1.15;
  const x = (i: number) => esq + (i * (L - esq - dir)) / Math.max(1, pontos.length - 1);
  const y = (v: number) => topo + (1 - Math.max(0, Math.min(1, (v - min) / (teto - min)))) * (A - topo - base);

  // A linha liga só as semanas com dado; semana vazia fica como marca no eixo.
  const comDado = pontos.map((p, i) => (p ? { ...p, i } : null)).filter((p): p is NonNullable<typeof p> => p != null);
  const trilha = comDado.map((p, n) => `${n ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.valor).toFixed(1)}`).join(' ');
  const area = comDado.length > 1
    ? `${trilha} L${x(comDado.at(-1)!.i)},${A - base} L${x(comDado[0].i)},${A - base} Z` : '';

  // O mês anterior: só as semanas com dado, ligadas na ordem.
  const antes = (comparacao?.pontos ?? []).map((v, i) => (v != null ? { v, i } : null))
    .filter((p): p is { v: number; i: number } => p != null);
  const trilhaAntes = antes.map((p, n) => `${n ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');

  return (
    <>
    {comparacao && antes.length > 0 && (
      <p className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-4 border-t-[2.5px] border-marca-600" />{comparacao.rotuloAtual}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-4 border-t-2 border-slate-400" />{comparacao.rotulo}
        </span>
      </p>
    )}
    <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-label={rotulos ? 'Evolução por mês' : 'Evolução por semana'}
         className="block h-auto w-full overflow-visible tabular-nums">
      {area && <path d={area} fill="var(--color-marca-600)" opacity={0.08} />}
      {antes.length > 1 && (
        <path d={trilhaAntes} fill="none" stroke="var(--color-slate-400)" strokeWidth={2}
              strokeLinejoin="round" strokeLinecap="round" opacity={0.75} />
      )}
      {antes.map((p) => (
        <circle key={`a${p.i}`} cx={x(p.i)} cy={y(p.v)} r={3.5} fill="var(--color-superficie)"
                stroke="var(--color-slate-400)" strokeWidth={2}>
          <title>{`${comparacao!.rotulo}, ${p.i + 1}ª semana: ${formatar(p.v)}`}</title>
        </circle>
      ))}
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
          <text x={x(i)} y={A - 8} textAnchor="middle" fontSize={12} fill="var(--color-slate-500)"
                fontWeight={rotulos && i === pontos.length - 1 ? 700 : 400}>{rotulos?.[i] ?? `${i + 1}ª semana`}</text>
        </g>
      ))}
    </svg>
    </>
  );
}
