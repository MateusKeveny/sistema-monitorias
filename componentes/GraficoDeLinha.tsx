import { useId } from 'react';

/**
 * Uma série em linha — as quatro semanas do ciclo (1.15.0) ou os meses do
 * Comparativo (1.17.0) —, com a referência tracejada.
 *
 * Substitui as colunas nos detalhes: a linha mostra a tendência — melhorou,
 * piorou — de uma vez, que é o que quem acompanha quer saber. Cada ponto tem
 * a cor da escala única do painel (verde bom, âmbar atenção, rosa ruim). A
 * linha se desenha uma vez ao aparecer (desenhar-linha, em globals.css); quem
 * desativa animações vê pronta.
 *
 * Com `comparacao` (1.41.0), o mês anterior aparece atrás, semana a semana:
 * linha cinza fina e uma legenda pequena em cima. Só para comparar — a cor e
 * os valores continuam sendo os do mês da tela.
 *
 * Visual 3.0: a linha é curva (sem passar do valor real entre dois pontos), a
 * área tem um degradê leve, a grade é de linhas finas e, ao passar o mouse em
 * qualquer ponto da coluna, aparece a caixinha com o valor (e o do mês
 * anterior, quando há). Com muitos pontos (os meses), só o último leva o
 * valor escrito; o resto fica na caixinha.
 *
 * SVG montado no servidor, sem biblioteca de gráfico no navegador: a caixinha
 * aparece só com CSS (.grafico-ponto, em globals.css).
 */
export type PontoDaLinha = { valor: number; tom?: 'bom' | 'atencao' | 'ruim' } | null;

const COR = { bom: 'var(--color-marca-600)', atencao: 'var(--color-amber-500)', ruim: 'var(--color-rose-500)' };

/** Até quantos pontos todos levam o valor escrito. */
const ROTULAR_TODOS = 6;

type XY = { x: number; y: number };

/**
 * Curva monótona (Fritsch–Carlson): suave, mas sem ondular acima ou abaixo
 * dos pontos — a curva nunca inventa um valor que não existe.
 */
function curva(p: XY[]): string {
  if (p.length < 2) return '';
  const n = p.length;
  const d = p.slice(0, -1).map((a, i) => (p[i + 1].y - a.y) / (p[i + 1].x - a.x));
  const m = p.map((_, i) => {
    if (i === 0) return d[0];
    if (i === n - 1) return d[n - 2];
    return d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  });
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

/** Passo "redondo" da escala (1, 2, 2,5 ou 5 vezes uma potência de 10). */
function passoRedondo(bruto: number): number {
  const p = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

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
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const L = largura, A = largura > 900 ? 300 : 250, esq = 64, dir = 28, topo = 44, base = 34;
  const chao = A - base;
  const valores = [
    ...pontos.filter((p): p is NonNullable<PontoDaLinha> => p != null).map((p) => p.valor),
    ...(comparacao?.pontos ?? []).filter((v): v is number => v != null),
  ];
  const teto = max ?? Math.max(1, ...valores, referencia?.valor ?? 0) * 1.15;
  const passo = (L - esq - dir) / Math.max(1, pontos.length - 1);
  const x = (i: number) => (pontos.length === 1 ? L / 2 : esq + i * passo);
  const y = (v: number) => topo + (1 - Math.max(0, Math.min(1, (v - min) / (teto - min)))) * (chao - topo);
  const rotuloDe = (i: number) => rotulos?.[i] ?? `${i + 1}ª semana`;

  // A linha liga só os pontos com dado; ponto vazio fica como marca no eixo.
  const comDado = pontos.map((p, i) => (p ? { ...p, i } : null)).filter((p): p is NonNullable<typeof p> => p != null);
  const trilha = curva(comDado.map((p) => ({ x: x(p.i), y: y(p.valor) })));
  const area = comDado.length > 1
    ? `${trilha} L${x(comDado.at(-1)!.i).toFixed(1)},${chao} L${x(comDado[0].i).toFixed(1)},${chao} Z` : '';

  // O mês anterior: só os pontos com dado, ligados na ordem.
  const antes = (comparacao?.pontos ?? []).map((v, i) => (v != null ? { v, i } : null))
    .filter((p): p is { v: number; i: number } => p != null);
  const trilhaAntes = curva(antes.map((p) => ({ x: x(p.i), y: y(p.v) })));

  // Grade: linhas finas em valores redondos, com o número à esquerda.
  const passoDaGrade = passoRedondo((teto - min) / 3);
  const grade: number[] = [];
  for (let v = Math.ceil(min / passoDaGrade - 1e-9) * passoDaGrade; v <= teto + 1e-9; v += passoDaGrade) {
    grade.push(Math.round(v / passoDaGrade) * passoDaGrade + 0); // + 0: nada de "-0" no pé da escala
  }
  const rotularTodos = pontos.length <= ROTULAR_TODOS;
  const ultimo = comDado.at(-1)?.i;

  /** A etiqueta colorida do último ponto: largura e posição. */
  const etiquetaDoUltimo = (i: number, valor: number) => {
    const lg = formatar(valor).length * 8 + 18;
    return { x: Math.max(esq, Math.min(L - dir - lg, x(i) - lg / 2)), y: y(valor) - 40, lg };
  };

  // A etiqueta da referência procura um lugar livre: à direita ou à esquerda,
  // acima ou abaixo da linha — sem cobrir ponto, valor nem a etiqueta do último.
  type Caixa = { x1: number; y1: number; x2: number; y2: number };
  const ocupado: Caixa[] = [];
  for (const p of comDado) {
    const px = x(p.i), py = y(p.valor);
    ocupado.push({ x1: px - 12, y1: py - 12, x2: px + 12, y2: py + 12 });
    if (p.i === ultimo) {
      const e = etiquetaDoUltimo(p.i, p.valor);
      ocupado.push({ x1: e.x - 4, y1: e.y - 4, x2: e.x + e.lg + 4, y2: e.y + 28 });
    } else if (rotularTodos) {
      const lg = formatar(p.valor).length * 7.5;
      ocupado.push({ x1: px - lg / 2 - 4, y1: py - 30, x2: px + lg / 2 + 4, y2: py - 6 });
    }
  }
  for (const p of antes) ocupado.push({ x1: x(p.i) - 7, y1: y(p.v) - 7, x2: x(p.i) + 7, y2: y(p.v) + 7 });
  const lugarDaReferencia = referencia && (() => {
    const ry = y(referencia.valor);
    const larg = referencia.rotulo.length * 6.6 + 16;
    const opcoes = [
      { x: L - dir - larg, y: ry - 22 }, { x: L - dir - larg, y: ry + 4 },
      { x: esq + 4, y: ry - 22 }, { x: esq + 4, y: ry + 4 },
      ...comDado.slice(0, -1).map((p, n) => ({ x: (x(p.i) + x(comDado[n + 1].i)) / 2 - larg / 2, y: ry - 22 })),
      ...comDado.slice(0, -1).map((p, n) => ({ x: (x(p.i) + x(comDado[n + 1].i)) / 2 - larg / 2, y: ry + 4 })),
    ];
    const livre = opcoes.find((o) => !ocupado.some((c) =>
      o.x < c.x2 && o.x + larg > c.x1 && o.y < c.y2 && o.y + 18 > c.y1));
    return { ...(livre ?? opcoes[0]), ry, larg };
  })();

  return (
    <>
    {comparacao && antes.length > 0 && (
      <p className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-4 rounded-full border-t-[2.5px] border-marca-600" />{comparacao.rotuloAtual}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-4 rounded-full border-t-2 border-slate-400 opacity-50" />{comparacao.rotulo}
        </span>
      </p>
    )}
    <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-label={rotulos ? 'Evolução por mês' : 'Evolução por semana'}
         className="grafico block h-auto w-full overflow-visible tabular-nums">
      <defs>
        <linearGradient id={`area${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--color-marca-600)" stopOpacity={0.26} />
          <stop offset="100%" stopColor="var(--color-marca-600)" stopOpacity={0} />
        </linearGradient>
      </defs>

      <line x1={esq} x2={L - dir} y1={chao} y2={chao} stroke="var(--color-slate-300)" strokeWidth={1} />
      {grade.map((v) => (
        <g key={v}>
          {Math.abs(y(v) - chao) > 1 && (
            <line x1={esq} x2={L - dir} y1={y(v)} y2={y(v)} stroke="var(--color-slate-200)" strokeWidth={1} />
          )}
          <text x={esq - 12} y={y(v) + 4} textAnchor="end" fontSize={11.5} fill="var(--color-slate-400)">{formatar(v)}</text>
        </g>
      ))}

      {area && <path d={area} fill={`url(#area${id})`} />}
      {antes.length > 1 && (
        <path d={trilhaAntes} fill="none" stroke="var(--color-slate-400)" strokeWidth={1.75}
              strokeLinejoin="round" strokeLinecap="round" opacity={0.45} />
      )}
      {antes.map((p) => (
        <circle key={`a${p.i}`} cx={x(p.i)} cy={y(p.v)} r={2.75} fill="var(--color-slate-400)" opacity={0.6}
                stroke="var(--color-superficie)" strokeWidth={2} />
      ))}

      {referencia && lugarDaReferencia && (
        <>
          <line x1={esq} x2={L - dir} y1={lugarDaReferencia.ry} y2={lugarDaReferencia.ry}
                stroke="var(--color-slate-400)" strokeDasharray="1 4" strokeWidth={1.5} strokeLinecap="round" />
          <rect x={lugarDaReferencia.x} y={lugarDaReferencia.y} width={lugarDaReferencia.larg} height={18} rx={9}
                fill="var(--color-superficie)" stroke="var(--color-slate-200)" />
          <text x={lugarDaReferencia.x + lugarDaReferencia.larg / 2} y={lugarDaReferencia.y + 13} textAnchor="middle"
                fontSize={11.5} fontWeight={500} fill="var(--color-slate-500)">{referencia.rotulo}</text>
        </>
      )}

      {comDado.length > 1 && (
        <path className="desenhar-linha" d={trilha} fill="none" stroke="var(--color-marca-600)" strokeWidth={3}
              strokeLinejoin="round" strokeLinecap="round" pathLength={1} />
      )}

      {pontos.map((p, i) => (
        <g key={i}>
          {p ? (
            <>
              {i === ultimo && (
                <circle className="grafico-pulso" cx={x(i)} cy={y(p.valor)} r={11} fill={COR[p.tom ?? 'bom']} opacity={0.2} />
              )}
              <circle cx={x(i)} cy={y(p.valor)} r={i === ultimo ? 6.5 : 5} fill={COR[p.tom ?? 'bom']}
                      stroke="var(--color-superficie)" strokeWidth={2.5} />
              {i === ultimo ? (() => {
                const t = formatar(p.valor);
                const { x: ex, y: ey, lg } = etiquetaDoUltimo(i, p.valor);
                return (
                  <>
                    <rect x={ex} y={ey} width={lg} height={24} rx={12} fill={COR[p.tom ?? 'bom']} />
                    <text x={ex + lg / 2} y={ey + 16.5} textAnchor="middle" fontSize={13} fontWeight={700}
                          fill="#fff">{t}</text>
                  </>
                );
              })() : rotularTodos && (
                <text x={x(i)} y={y(p.valor) - 14} textAnchor="middle" fontSize={13} fontWeight={600}
                      fill="var(--color-slate-700)">{formatar(p.valor)}</text>
              )}
            </>
          ) : (
            <text x={x(i)} y={chao - 8} textAnchor="middle" fontSize={12} fill="var(--color-slate-400)">sem dado</text>
          )}
          <text x={x(i)} y={A - 9} textAnchor="middle" fontSize={12} fill="var(--color-slate-500)"
                fontWeight={rotulos && i === pontos.length - 1 ? 700 : 400}>{rotuloDe(i)}</text>
        </g>
      ))}

      {/* Por último, para ficar por cima: a coluna de cada ponto, que mostra
          a guia vertical e a caixinha ao passar o mouse. */}
      {pontos.map((p, i) => {
        const anterior = comparacao?.pontos[i];
        const linhas: { t: string; forte?: boolean; cor?: string }[] = [
          { t: rotuloDe(i) },
          { t: p ? formatar(p.valor) : 'sem dado', forte: true, cor: p ? COR[p.tom ?? 'bom'] : undefined },
          ...(comparacao && anterior != null ? [{ t: `${comparacao.rotulo}: ${formatar(anterior)}` }] : []),
        ];
        const larg = Math.max(...linhas.map((l) => l.t.length * (l.forte ? 8.4 : 6.8))) + 28;
        const alt = 14 + linhas.length * 18;
        const cx = x(i);
        const alvo = p ? y(p.valor) : chao;
        const bx = Math.max(2, Math.min(L - larg - 2, cx - larg / 2));
        const by = alvo - alt - 16 >= 0 ? alvo - alt - 16 : alvo + 16;
        const meia = pontos.length === 1 ? (L - esq - dir) / 2 : passo / 2;
        return (
          <g key={`h${i}`} className="grafico-ponto">
            <rect x={cx - meia} y={0} width={meia * 2} height={A} fill="transparent" />
            <line className="grafico-guia" x1={cx} x2={cx} y1={topo - 8} y2={chao}
                  stroke="var(--color-slate-300)" strokeWidth={1} />
            {p && (
              <circle className="grafico-guia" cx={cx} cy={alvo} r={8} fill={COR[p.tom ?? 'bom']} opacity={0.18} />
            )}
            <g className="grafico-dica">
              <rect x={bx} y={by} width={larg} height={alt} rx={10}
                    fill="var(--color-superficie)" stroke="var(--color-slate-200)" />
              {linhas.map((l, n) => (
                <text key={n} x={bx + 14} y={by + 22 + n * 18} fontSize={l.forte ? 14 : 12}
                      fontWeight={l.forte ? 700 : 400} fill={l.forte ? 'var(--color-slate-900)' : 'var(--color-slate-500)'}>
                  {l.cor && <tspan fill={l.cor}>● </tspan>}{l.t}
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
