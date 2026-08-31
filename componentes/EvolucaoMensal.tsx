'use client';

import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { useTemaEscuro } from '@/lib/useTema';

type Ponto = { mes: string; nota: number; monitorias: number; zeradas: number };

/**
 * O gráfico é SVG desenhado pelo Recharts, que recebe cor como valor em
 * JavaScript — não alcança a paleta CSS que veste o resto da interface. Por
 * isso as duas paletas ficam aqui, escolhidas pelo tema em uso.
 */
const PALETAS = {
  claro: {
    grade: '#e2e8f0',
    eixo: '#64748b',
    eixoSecundario: '#94a3b8',
    barra: '#cbd5e1',
    zeradas: '#fda4af',
    linha: '#059669',
    caixaFundo: '#ffffff',
    caixaBorda: '#e2e8f0',
    caixaTexto: '#0f172a',
  },
  escuro: {
    grade: '#2f3233',
    eixo: '#8f9394',
    eixoSecundario: '#6d7172',
    barra: '#414445',
    zeradas: '#9f1239',
    linha: '#34d399',
    caixaFundo: '#17191a',
    caixaBorda: '#2f3233',
    caixaTexto: '#f6f8f8',
  },
} as const;

export default function EvolucaoMensal({ dados }: { dados: Ponto[] }) {
  const cores = useTemaEscuro() ? PALETAS.escuro : PALETAS.claro;

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <ComposedChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke={cores.grade} vertical={false} />
          <XAxis
            dataKey="mes" tick={{ fontSize: 12, fill: cores.eixo }}
            tickLine={false} axisLine={false}
          />
          <YAxis
            yAxisId="nota" domain={[0, 100]} unit="%"
            tick={{ fontSize: 12, fill: cores.eixo }} tickLine={false} axisLine={false}
          />
          <YAxis
            yAxisId="qtd" orientation="right" allowDecimals={false}
            tick={{ fontSize: 12, fill: cores.eixoSecundario }} tickLine={false} axisLine={false}
          />
          <Tooltip
            formatter={(valor, nome) =>
              [nome === 'Nota média' ? `${valor}%` : String(valor), String(nome)]}
            cursor={{ fill: cores.grade, fillOpacity: 0.3 }}
            contentStyle={{
              fontSize: 12,
              borderRadius: 8,
              backgroundColor: cores.caixaFundo,
              border: `1px solid ${cores.caixaBorda}`,
              color: cores.caixaTexto,
            }}
            labelStyle={{ color: cores.caixaTexto }}
            itemStyle={{ color: cores.caixaTexto }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: cores.eixo }} />
          <Bar yAxisId="qtd" dataKey="monitorias" name="Monitorias"
            fill={cores.barra} radius={[4, 4, 0, 0]} />
          <Bar yAxisId="qtd" dataKey="zeradas" name="Zeradas"
            fill={cores.zeradas} radius={[4, 4, 0, 0]} />
          <Line
            yAxisId="nota" type="monotone" dataKey="nota" name="Nota média"
            stroke={cores.linha} strokeWidth={2.5} dot={{ r: 3, fill: cores.linha }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
