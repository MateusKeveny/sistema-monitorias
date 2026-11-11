import MatrizDePesos from '@/componentes/MatrizDePesos';
import MetasPorLista from '@/componentes/MetasPorLista';
import RegrasPorFila from '@/componentes/RegrasPorFila';
import { contextoDasMetas } from '@/lib/metasPorLista';
import type { Canal } from '@/lib/setores';
import { carregarRegrasDoSetor, TopoDasRegras } from '../configuracao/regras-do-setor';

export const dynamic = 'force-dynamic';

/**
 * Pesos por cargo (4.4.0, antes a 1ª aba da Configuração): a tabela da
 * planilha — métrica na linha, cargo na coluna —, a planilha de metas para
 * baixar e subir, e logo abaixo as regras que mudam de fila para fila
 * (finalizado e TME), que também são peso.
 */
export default async function PesosPorCargo({ searchParams }: { searchParams: Promise<{ setor?: string }> }) {
  const { setor } = await searchParams;
  const d = await carregarRegrasDoSetor(setor);
  return (
    <div className="space-y-6">
      <TopoDasRegras dados={d} caminho="/cota/metas" titulo="Pesos por cargo"
                     subtitulo="Quanto cada métrica vale em cada cargo e a meta de pontos. Mudar recalcula os meses em aberto; os fechados guardam o valor da época." />
      {/* A matriz numa planilha (4.0.0): baixar, editar no Excel, subir com conferência. */}
      <MetasPorLista key={`lista-${d.setorId}`} setorId={d.setorId} setorNome={d.setorNome}
                     ctx={contextoDasMetas(d.listaCargos, d.listaRegras, d.listaPesos, {
                       setorId: d.setorId,
                       // As filas ativas do setor: de onde saem as métricas automáticas criadas pela lista.
                       filas: d.filasDoSetor.map((c) => ({
                         grupo_tme: c.grupo_tme ?? null, grupo_csat: c.grupo_csat ?? null,
                         grupo_nota: c.grupo_nota ?? null, regra_finalizado: c.regra_finalizado ?? null,
                         // 4.2.0: TMA e a fila, para a métrica "· Fila" valer só nela.
                         grupo_tma: c.grupo_tma ?? null, id: c.id, apelido: c.apelido ?? undefined, nome: c.nome,
                       })),
                     })} />
      <MatrizDePesos setorId={d.setorId} cargos={d.listaCargos} regras={d.listaRegras} pesos={d.listaPesos}
                     referencias={d.referencias} pessoasPorCargo={d.pessoasPorCargo} />
      <RegrasPorFila setores={d.listaSetores.filter((s) => s.id === d.setorId)} filas={d.todasAsFilas as Canal[]}
                     regras={d.listaRegras} pesos={d.listaPesos} cargos={d.listaCargos} />
    </div>
  );
}
