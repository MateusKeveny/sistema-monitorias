import MetricasPorFila from '@/componentes/MetricasPorFila';
import ReguasDeFaixa from '@/componentes/ReguasDeFaixa';
import SlaDosChamados from '@/componentes/SlaDosChamados';
import PainelRegras from '@/componentes/PainelRegras';
import type { FilaReal, RegraReal } from '@/lib/metricasPorFila';
import { carregarRegrasDoSetor, TopoDasRegras } from '../configuracao/regras-do-setor';

export const dynamic = 'force-dynamic';

/**
 * Métricas e faixas (4.4.0): o que antes ficava em três abas da Configuração
 * ("Métricas por fila", "Faixas e nomes das métricas" e o SLA) numa tela só,
 * de cima para baixo: o que cada fila mede, os cortes das faixas, o SLA dos
 * chamados e o nome de cada métrica.
 */
export default async function MetricasEFaixas({ searchParams }: { searchParams: Promise<{ setor?: string }> }) {
  const { setor } = await searchParams;
  const d = await carregarRegrasDoSetor(setor);
  const nomeBase = (d.base?.nome ?? '').replace(/^Atendente\s+/, '');
  return (
    <div className="space-y-6">
      <TopoDasRegras dados={d} caminho="/cota/metricas-e-faixas" titulo="Métricas e faixas"
                     subtitulo="O que cada fila mede, os cortes de cada faixa, o SLA dos chamados e o nome de cada métrica. Mudar recalcula os meses em aberto." />
      {/* 4.2.0 (migração 103): o que cada fila mede e as faixas de TME, TMA e C-SAT. */}
      <MetricasPorFila key={`metricas-${d.setorId}`} setorId={d.setorId} setorNome={d.setorNome}
                       filas={d.filasDoSetor as unknown as FilaReal[]}
                       regras={d.todasAsRegras as unknown as RegraReal[]} />
      <ReguasDeFaixa regras={d.listaRegras} pesosBase={d.pesosBase} filasPorGrupo={d.filasPorGrupo} nomeBase={nomeBase}
                     tmePorPessoa={Object.fromEntries(d.filasDoSetor.filter((c) => c.grupo_tme)
                       .map((c) => [c.grupo_tme!, c.tme_por_pessoa_desde ?? null]))} />
      {/* 4.3.0 (migração 104): o SLA dos chamados em faixas. Os pesos mostrados são os do cargo que recebe o SLA. */}
      <SlaDosChamados key={`sla-${d.setorId}`} regras={d.listaRegras} pesosBase={d.pesosDoSla}
                      nomeBase={(d.cargoDoSla?.nome ?? '').replace(/^Atendente\s+/, '')} />
      <PainelRegras regras={d.listaRegras} setorId={d.setorId} />
    </div>
  );
}
