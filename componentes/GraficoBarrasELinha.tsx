import { useId } from 'react';

/**
 * Gráfico de várias séries no visual 3.0 (3.7.0, aba Geral do Comparativo):
 * barras lado a lado e/ou linhas, cada série com a sua cor e legenda.
 *
 * Mesmo desenho do GraficoDeLinha: grade fina, cantos arredondados, a linha
 * curva que se desenha ao aparecer, a etiqueta colorida no último ponto e a
 * caixinha com todos os valores ao passar o mouse (.grafico-ponto, em
 * globals.css). SVG feito no servidor, sem biblioteca no navegador.
 */
export type SerieDoGrafico = {
  nome: string;
  valores: (number | null)[];
  /** Cor em CSS (variável do tema ou hexadecimal). */
  cor: string;
  /** Linha no eixo da direita (com `formatarDir`). */
  direita?: boolean;
};

type XY = { x: number; y: number };

/** A mesma curva monótona do GraficoDeLinha: suave, sem inventar valor. */
function curva(p: XY[]): string {
  if (p.length < 2) return '';
  const n = p.length;
  const d = p.slice(0, -1).map((a, i) => (p[i + 1].y - a.y) / (p[i + 1].x - a.x));
  const m = p.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) { const t = 3 / Math.sqrt(h); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  const f = (v: number) => v.toFixed(1);
  let s = `M${f(p[0].x)},${f(p[0].y)}`;
  for (let i = 0; i < n - 1; i++) {
    const dx = (p[i + 1].x - p[i].x) / 3;
    s += ` C${f(p[i].x + dx)},${f(p[i].y + m[i] * dx)} ${f(p[i + 1].x - dx)},${f(p[i + 1].y - m[i + 1] * dx)} ${f(p[i + 1].x)},${f(p[i + 1].y)}`;
  }
  return s;
}

function passoRedondo(bruto: number): number {
  const p = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Escala de um eixo: piso, teto e as linhas da grade em valores redondos. */
function escala(valores: number[], min?: number, max?: number) {
  const piso = min ?? 0;
  const teto = max ?? Math.max(piso + 1e-6, ...valores) * 1.15;
  const passo = passoRedondo((teto - piso) / 3);
  const grade: number[] = [];
  for (let v = Math.ceil(piso / passo - 1e-9) * passo; v <= teto + 1e-9; v += passo) grade.push(Math.round(v / passo) * passo + 0);
  return { piso, teto, grade };
}

export default function GraficoBarrasELinha({
  rotulos, barras = [], linhas = [], formatar, formatarDir, min, max, minDir, maxDir, referencia, largura = 1400,
}: {
  rotulos: string[];
  barras?: SerieDoGrafico[];
  linhas?: SerieDoGrafico[];
  formatar: (v: number) => string;
  formatarDir?: (v: number) => string;
  min?: number; max?: number; minDir?: number; maxDir?: number;
  /** Linha tracejada no eixo da esquerda: a meta. */
  referencia?: { valor: number; rotulo: string };
  largura?: number;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const temDireita = linhas.some((l) => l.direita);
  const L = largura, A = largura > 900 ? 320 : 270, esq = 64, dir = temDireita ? 60 : 28, topo = 48, base = 34;
  const chao = A - base;
  const n = rotulos.length;
  const coluna = (L - esq - dir) / Math.max(1, n);
  const cx = (i: number) => esq + coluna * (i + 0.5);
  const fmtDe = (s: SerieDoGrafico) => (s.direita && formatarDir ? formatarDir : formatar);

  const vals = (l: SerieDoGrafico[]) => l.flatMap((s) => s.valores.filter((v): v is number => v != null));
  const E = escala([...vals(barras), ...vals(linhas.filter((l) => !l.direita)), ...(referencia ? [referencia.valor] : [])], min, max);
  const D = escala(vals(linhas.filter((l) => l.direita)), minDir, maxDir);
  const y = (v: number, direita?: boolean) => {
    const s = direita ? D : E;
    return topo + (1 - Math.max(0, Math.min(1, (v - s.piso) / (s.teto - s.piso)))) * (chao - topo);
  };

  const larguraBarra = Math.min(46, (coluna * 0.62) / Math.max(1, barras.length));
  const vao = 6;
  const rotularTodos = n <= 6;

  /** Barra com o topo arredondado e a base reta. */
  const barra = (x: number, v: number, cor: string, k: number) => {
    const y0 = y(v), h = chao - y0, r = Math.min(6, h / 2, larguraBarra / 2);
    if (h <= 0) return null;
    return <path key={k} d={`M${x},${chao} V${y0 + r} Q${x},${y0} ${x + r},${y0} H${x + larguraBarra - r} Q${x + larguraBarra},${y0} ${x + larguraBarra},${y0 + r} V${chao} Z`}
                 fill={cor} opacity={0.9} />;
  };

  // Com duas linhas, os valores de uma ficam em cima do ponto e os da outra
  // embaixo: a de valor maior em cima, para não cruzar os rótulos.
  const mediaDe = (s: SerieDoGrafico) => { const v = s.valores.filter((x): x is number => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
  const emCima = new Set(linhas.length === 2
    ? [mediaDe(linhas[0]) >= mediaDe(linhas[1]) ? 0 : 1] : linhas.map((_, k) => k));

  return (
    <>
      <p className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        {barras.map((s) => (
          <span key={s.nome} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.cor }} />{s.nome}
          </span>
        ))}
        {linhas.map((s) => (
          <span key={s.nome} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block w-4 rounded-full border-t-[2.5px]" style={{ borderColor: s.cor }} />
            {s.nome}{s.direita && barras.length ? ' (eixo da direita)' : ''}
          </span>
        ))}
      </p>
      <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-label={`${[...barras, ...linhas].map((s) => s.nome).join(', ')} por mês`}
           className="grafico block h-auto w-full overflow-visible tabular-nums">
        <defs>
          {linhas.map((s, k) => (
            <linearGradient key={k} id={`a${id}${k}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={s.cor} stopOpacity={linhas.length === 1 ? 0.22 : 0.12} />
              <stop offset="100%" stopColor={s.cor} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        <line x1={esq} x2={L - dir} y1={chao} y2={chao} stroke="var(--color-slate-300)" strokeWidth={1} />
        {E.grade.map((v) => (
          <g key={v}>
            {Math.abs(y(v) - chao) > 1 && <line x1={esq} x2={L - dir} y1={y(v)} y2={y(v)} stroke="var(--color-slate-200)" strokeWidth={1} />}
            <text x={esq - 12} y={y(v) + 4} textAnchor="end" fontSize={11.5} fill="var(--color-slate-400)">{formatar(v)}</text>
          </g>
        ))}
        {temDireita && D.grade.map((v) => (
          <text key={`d${v}`} x={L - dir + 12} y={y(v, true) + 4} fontSize={11.5} fill="var(--color-slate-400)">{(formatarDir ?? formatar)(v)}</text>
        ))}

        {referencia && (
          <>
            <line x1={esq} x2={L - dir} y1={y(referencia.valor)} y2={y(referencia.valor)}
                  stroke="var(--color-slate-400)" strokeDasharray="1 4" strokeWidth={1.5} strokeLinecap="round" />
            <rect x={esq + 4} y={y(referencia.valor) - 22} width={referencia.rotulo.length * 6.6 + 16} height={18} rx={9}
                  fill="var(--color-superficie)" stroke="var(--color-slate-200)" />
            <text x={esq + 4 + (referencia.rotulo.length * 6.6 + 16) / 2} y={y(referencia.valor) - 9} textAnchor="middle"
                  fontSize={11.5} fontWeight={500} fill="var(--color-slate-500)">{referencia.rotulo}</text>
          </>
        )}

        {rotulos.map((r, i) => {
          const x0 = cx(i) - (barras.length * larguraBarra + (barras.length - 1) * vao) / 2;
          return (
            <g key={r}>
              {barras.map((s, k) => (s.valores[i] != null ? barra(x0 + k * (larguraBarra + vao), s.valores[i]!, s.cor, k) : null))}
              <text x={cx(i)} y={A - 9} textAnchor="middle" fontSize={12} fill="var(--color-slate-500)"
                    fontWeight={i === n - 1 ? 700 : 400}>{r}</text>
            </g>
          );
        })}

        {linhas.map((s, k) => {
          const pts = s.valores.map((v, i) => (v != null ? { v, i } : null)).filter((p): p is { v: number; i: number } => p != null);
          const trilha = curva(pts.map((p) => ({ x: cx(p.i), y: y(p.v, s.direita) })));
          const area = !barras.length && pts.length > 1
            ? `${trilha} L${cx(pts.at(-1)!.i).toFixed(1)},${chao} L${cx(pts[0].i).toFixed(1)},${chao} Z` : '';
          const ultimo = pts.at(-1)?.i;
          const fmt = fmtDe(s);
          const cima = emCima.has(k);
          return (
            <g key={s.nome}>
              {area && <path d={area} fill={`url(#a${id}${k})`} />}
              {pts.length > 1 && (
                <path className="desenhar-linha" d={trilha} fill="none" stroke={s.cor} strokeWidth={3}
                      strokeLinejoin="round" strokeLinecap="round" pathLength={1} />
              )}
              {pts.map((p) => {
                const py = y(p.v, s.direita);
                return (
                  <g key={p.i}>
                    {p.i === ultimo && <circle className="grafico-pulso" cx={cx(p.i)} cy={py} r={11} fill={s.cor} opacity={0.2} />}
                    <circle cx={cx(p.i)} cy={py} r={p.i === ultimo ? 6.5 : 5} fill={s.cor} stroke="var(--color-superficie)" strokeWidth={2.5} />
                    {p.i === ultimo ? (() => {
                      const t = fmt(p.v), lg = t.length * 8 + 18;
                      const ex = Math.max(esq, Math.min(L - dir - lg, cx(p.i) - lg / 2));
                      const ey = cima ? py - 40 : py + 16;
                      return (
                        <>
                          <rect x={ex} y={ey} width={lg} height={24} rx={12} fill={s.cor} />
                          <text x={ex + lg / 2} y={ey + 16.5} textAnchor="middle" fontSize={13} fontWeight={700} fill="#fff">{t}</text>
                        </>
                      );
                    })() : rotularTodos && (
                      <text x={cx(p.i)} y={cima ? py - 14 : py + 26} textAnchor="middle" fontSize={13} fontWeight={600}
                            fill="var(--color-slate-700)">{fmt(p.v)}</text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}

        {/* A coluna de cada mês: realce e a caixinha com todas as séries. */}
        {rotulos.map((r, i) => {
          const itens = [...barras, ...linhas].map((s) => ({
            t: `${s.nome}: ${s.valores[i] != null ? fmtDe(s)(s.valores[i]!) : '—'}`, cor: s.cor,
          }));
          const larg = Math.max(r.length * 7, ...itens.map((l) => l.t.length * 7.4)) + 36;
          const alt = 32 + itens.length * 19;
          const bx = cx(i) + coluna * 0.32 + larg > L ? cx(i) - coluna * 0.32 - larg : cx(i) + coluna * 0.32;
          return (
            <g key={`h${i}`} className="grafico-ponto">
              <rect x={cx(i) - coluna / 2} y={0} width={coluna} height={A} fill="transparent" />
              <rect className="grafico-guia" x={cx(i) - coluna / 2 + 4} y={topo - 10} width={coluna - 8} height={chao - topo + 10}
                    rx={10} fill="var(--color-slate-400)" opacity={0.08} />
              <g className="grafico-dica">
                <rect x={Math.max(2, bx)} y={topo} width={larg} height={alt} rx={10} fill="var(--color-superficie)" stroke="var(--color-slate-200)" />
                <text x={Math.max(2, bx) + 14} y={topo + 22} fontSize={12} fill="var(--color-slate-500)">{r}</text>
                {itens.map((l, k) => (
                  <text key={k} x={Math.max(2, bx) + 14} y={topo + 42 + k * 19} fontSize={13} fontWeight={600} fill="var(--color-slate-900)">
                    <tspan fill={l.cor}>● </tspan>{l.t}
                  </text>
                ))}
              </g>
            </g>
          );
        })}
      </svg>
    </>
  );
}
