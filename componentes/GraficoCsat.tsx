import { percentual } from '@/lib/formatar';

export type PontoCsat = {
  semana: number;
  /** C-SAT da pessoa na semana; nulo quando não houve avaliação. */
  pessoa: number | null;
  /** C-SAT da equipe na semana. */
  equipe: number | null;
};

const L = 420;
const A = 190;
const M = { esq: 40, dir: 12, topo: 14, base: 28 };

/**
 * C-SAT das 4 semanas do ciclo em linha, com a meta e a média da equipe como
 * referência. SVG puro, renderizado no servidor: nenhuma biblioteca de
 * gráfico chega ao navegador por causa de quatro pontos.
 */
export default function GraficoCsat({
  pontos, meta, rotulo = 'Você',
}: {
  pontos: PontoCsat[];
  meta: number;
  /** Nome da linha principal na legenda. */
  rotulo?: string;
}) {
  const temEquipe = pontos.some((p) => p.equipe != null);
  const valores = pontos.flatMap((p) => [p.pessoa, p.equipe]).filter((v): v is number => v != null);
  // Escala a partir de um pouco abaixo do menor valor, para diferenças de
  // poucos pontos não virarem uma linha reta colada no topo.
  const minimo = Math.max(0, Math.floor((Math.min(meta, ...valores) - 0.05) * 20) / 20);
  const y = (v: number) => M.topo + (1 - (v - minimo) / (1 - minimo)) * (A - M.topo - M.base);
  const x = (semana: number) => M.esq + ((semana - 1) / 3) * (L - M.esq - M.dir);

  const linha = (campo: 'pessoa' | 'equipe') => pontos
    .filter((p) => p[campo] != null)
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.semana)},${y(p[campo]!)}`)
    .join(' ');

  const marcas = [minimo, (minimo + 1) / 2, 1];

  return (
    <div>
      <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img"
           aria-label="C-SAT por semana, com meta e média da equipe">
        {marcas.map((v) => (
          <g key={v}>
            <line x1={M.esq} x2={L - M.dir} y1={y(v)} y2={y(v)} className="stroke-slate-200" strokeWidth={1} />
            <text x={M.esq - 6} y={y(v) + 4} textAnchor="end" className="fill-slate-400 text-[10px]">
              {Math.round(v * 100)}%
            </text>
          </g>
        ))}

        {/* Meta: opaca e tracejada, só referência. */}
        <line x1={M.esq} x2={L - M.dir} y1={y(meta)} y2={y(meta)}
              className="stroke-emerald-500" strokeOpacity={0.45} strokeWidth={1.5} strokeDasharray="6 4" />

        {/* Equipe */}
        <path d={linha('equipe')} fill="none" className="stroke-slate-400" strokeOpacity={0.7}
              strokeWidth={1.5} strokeDasharray="2 3" />
        {pontos.filter((p) => p.equipe != null).map((p) => (
          <circle key={`e${p.semana}`} cx={x(p.semana)} cy={y(p.equipe!)} r={3} className="fill-slate-400" fillOpacity={0.7} />
        ))}

        {/* Pessoa */}
        <path d={linha('pessoa')} fill="none" className="stroke-marca-600" strokeWidth={2.5} strokeLinejoin="round" />
        {pontos.filter((p) => p.pessoa != null).map((p) => (
          <g key={`p${p.semana}`}>
            <circle cx={x(p.semana)} cy={y(p.pessoa!)} r={5} className="fill-marca-600 stroke-white" strokeWidth={2} />
            <text x={x(p.semana)} y={y(p.pessoa!) - 10} textAnchor="middle"
                  className="fill-slate-700 text-[11px] font-semibold">
              {percentual(p.pessoa)}
            </text>
          </g>
        ))}

        {pontos.map((p) => (
          <text key={`s${p.semana}`} x={x(p.semana)} y={A - 8} textAnchor="middle" className="fill-slate-500 text-[11px]">
            {p.semana}ª sem.
          </text>
        ))}
      </svg>

      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 bg-marca-600" /> {rotulo}
        </span>
        {temEquipe && (
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-dotted border-slate-400" /> Média da equipe
        </span>
        )}
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t-2 border-dashed border-emerald-500/50" /> Meta {percentual(meta)}
        </span>
      </div>
    </div>
  );
}
