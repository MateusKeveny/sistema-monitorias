'use client';

import {
  ResponsiveContainer, ComposedChart, Bar, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';

type Ponto = { mes: string; nota: number; monitorias: number; zeradas: number };

export default function EvolucaoMensal({ dados }: { dados: Ponto[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <ComposedChart data={dados} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="mes" tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false} />
          <YAxis
            yAxisId="nota" domain={[0, 100]} unit="%"
            tick={{ fontSize: 12, fill: '#64748b' }} tickLine={false} axisLine={false}
          />
          <YAxis
            yAxisId="qtd" orientation="right" allowDecimals={false}
            tick={{ fontSize: 12, fill: '#94a3b8' }} tickLine={false} axisLine={false}
          />
          <Tooltip
            formatter={(valor, nome) =>
              [nome === 'Nota média' ? `${valor}%` : String(valor), String(nome)]}
            contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="qtd" dataKey="monitorias" name="Monitorias" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
          <Bar yAxisId="qtd" dataKey="zeradas" name="Zeradas" fill="#fda4af" radius={[4, 4, 0, 0]} />
          <Line
            yAxisId="nota" type="monotone" dataKey="nota" name="Nota média"
            stroke="#059669" strokeWidth={2.5} dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
