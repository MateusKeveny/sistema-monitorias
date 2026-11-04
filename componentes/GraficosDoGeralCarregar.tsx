'use client';

import dynamic from 'next/dynamic';

/** Só no navegador, como o GraficoEvolucao: o Recharts escolhe a paleta pelo tema. */
const GraficosDoGeral = dynamic(() => import('@/componentes/GraficosDoGeral'), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-lg bg-slate-100" />,
});

export default GraficosDoGeral;
