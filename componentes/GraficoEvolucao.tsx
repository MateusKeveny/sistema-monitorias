'use client';

import dynamic from 'next/dynamic';

/**
 * Carrega o gráfico só no navegador.
 *
 * O Recharts desenha o SVG ponto a ponto, e é de longe a parte mais cara de
 * renderizar do Painel. O servidor pagava esse custo à toa: o gráfico escolhe a
 * paleta pelo tema, que só existe no navegador, então o desenho vindo do
 * servidor era descartado e refeito no primeiro quadro — sempre.
 *
 * Deixar isso de fora do servidor tira o peso da página que é a porta de
 * entrada do sistema. Enquanto o gráfico chega, fica um retângulo da mesma
 * altura, para o conteúdo abaixo não pular de lugar.
 */
const GraficoEvolucao = dynamic(() => import('@/componentes/EvolucaoMensal'), {
  ssr: false,
  loading: () => <div className="h-64 w-full animate-pulse rounded-lg bg-slate-100" />,
});

export default GraficoEvolucao;
