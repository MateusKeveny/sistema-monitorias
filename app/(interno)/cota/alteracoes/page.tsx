import HistoricoDePesos from '@/componentes/HistoricoDePesos';
import { carregarRegrasDoSetor } from '../configuracao/regras-do-setor';

export const dynamic = 'force-dynamic';

/**
 * Histórico de alterações (4.4.0, antes uma aba da Configuração): pesos,
 * meta, multiplicador da média e métricas ligadas ou desligadas, com quem,
 * quando e o motivo. É dos setores todos, então não tem o passo do setor.
 */
export default async function HistoricoDeAlteracoes() {
  const d = await carregarRegrasDoSetor();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Histórico de alterações</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">O que mudou nas regras da cota, por quem, quando e por quê.</p>
      </div>
      <HistoricoDePesos alteracoes={d.alteracoes} />
    </div>
  );
}
