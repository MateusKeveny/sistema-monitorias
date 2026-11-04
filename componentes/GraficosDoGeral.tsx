'use client';

import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { useTemaEscuro } from '@/lib/useTema';

export type PontoDoGeral = {
  mes: string;
  atendimentos: number | null;
  avaliacoes: number | null;
  /** Em %, 0–100 (o Recharts não formata razão). */
  taxa: number | null;
  csat: number | null;
  monitoria: number | null;
};

/** As paletas do EvolucaoMensal, com as cores das séries daqui. */
const PALETAS = {
  claro: {
    grade: '#e2e8f0', eixo: '#64748b', eixoSecundario: '#94a3b8',
    atendimentos: '#cbd5e1', avaliacoes: '#6ee7b7', taxa: '#d97706', csat: '#059669', monitoria: '#6366f1',
    caixaFundo: '#ffffff', caixaBorda: '#e2e8f0', caixaTexto: '#0f172a',
  },
  escuro: {
    grade: '#2f3233', eixo: '#8f9394', eixoSecundario: '#6d7172',
    atendimentos: '#414445', avaliacoes: '#047857', taxa: '#fbbf24', csat: '#34d399', monitoria: '#a5b4fc',
    caixaFundo: '#17191a', caixaBorda: '#2f3233', caixaTexto: '#f6f8f8',
  },
} as const;

const num = (v: unknown) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 });

/**
 * Os dois gráficos da aba Geral do Comparativo (3.7.0): atendimentos ×
 * avaliações (barras) com a taxa de avaliação (linha), e C-SAT × nota de
 * monitoria. Recharts, como a evolução das Monitorias: só no navegador.
 */
export default function GraficosDoGeral({ dados, tipo }: { dados: PontoDoGeral[]; tipo: 'volume' | 'qualidade' }) {
  const cores = useTemaEscuro() ? PALETAS.escuro : PALETAS.claro;
  const caixa = {
    contentStyle: { fontSize: 12, borderRadius: 8, backgroundColor: cores.caixaFundo, border: `1px solid ${cores.caixaBorda}`, color: cores.caixaTexto },
    labelStyle: { color: cores.caixaTexto }, itemStyle: { color: cores.caixaTexto },
    cursor: { fill: cores.grade, fillOpacity: 0.3 },
  };
  const eixoX = <XAxis dataKey="mes" tick={{ fontSize: 12, fill: cores.eixo }} tickLine={false} axisLine={false} />;

  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        {tipo === 'volume' ? (
          <ComposedChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: 4 }}>
            <CartesianGrid stroke={cores.grade} vertical={false} />
            {eixoX}
            <YAxis yAxisId="qtd" allowDecimals={false} tick={{ fontSize: 12, fill: cores.eixo }} tickLine={false} axisLine={false}
                   tickFormatter={(v) => Number(v).toLocaleString('pt-BR')} />
            <YAxis yAxisId="taxa" orientation="right" domain={[0, 100]} unit="%"
                   tick={{ fontSize: 12, fill: cores.eixoSecundario }} tickLine={false} axisLine={false} />
            <Tooltip {...caixa} formatter={(v, nome) => [nome === 'Taxa de avaliação' ? `${num(v)}%` : num(v), String(nome)]} />
            <Legend wrapperStyle={{ fontSize: 12, color: cores.eixo }} />
            <Bar yAxisId="qtd" dataKey="atendimentos" name="Atendimentos" fill={cores.atendimentos} radius={[4, 4, 0, 0]} />
            <Bar yAxisId="qtd" dataKey="avaliacoes" name="Avaliações" fill={cores.avaliacoes} radius={[4, 4, 0, 0]} />
            <Line yAxisId="taxa" type="monotone" dataKey="taxa" name="Taxa de avaliação" connectNulls
                  stroke={cores.taxa} strokeWidth={2.5} dot={{ r: 3, fill: cores.taxa }} />
          </ComposedChart>
        ) : (
          <ComposedChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <CartesianGrid stroke={cores.grade} vertical={false} />
            {eixoX}
            <YAxis domain={[60, 100]} unit="%" tick={{ fontSize: 12, fill: cores.eixo }} tickLine={false} axisLine={false} />
            <Tooltip {...caixa} formatter={(v, nome) => [`${num(v)}%`, String(nome)]} />
            <Legend wrapperStyle={{ fontSize: 12, color: cores.eixo }} />
            <Line type="monotone" dataKey="csat" name="C-SAT" connectNulls
                  stroke={cores.csat} strokeWidth={2.5} dot={{ r: 3, fill: cores.csat }} />
            <Line type="monotone" dataKey="monitoria" name="Nota de monitoria" connectNulls
                  stroke={cores.monitoria} strokeWidth={2.5} dot={{ r: 3, fill: cores.monitoria }} />
          </ComposedChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
