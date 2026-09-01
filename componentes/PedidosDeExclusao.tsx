import { Cartao } from '@/componentes/ui';
import { dataHora } from '@/lib/formatar';

export type PedidoDeExclusao = {
  id: string;
  motivo: string;
  status: 'pendente' | 'aprovada' | 'recusada';
  solicitada_por_nome: string | null;
  solicitada_em: string;
  decidida_por_nome: string | null;
  decidida_em: string | null;
  observacao_decisao: string | null;
};

const APARENCIA = {
  pendente: { rotulo: 'Aguardando decisão', cor: 'bg-amber-50 ring-amber-600/20 text-amber-900' },
  recusada: { rotulo: 'Recusada', cor: 'bg-slate-50 ring-slate-500/20 text-slate-700' },
  aprovada: { rotulo: 'Aprovada', cor: 'bg-rose-50 ring-rose-600/20 text-rose-900' },
} as const;

/**
 * Pedidos de exclusão feitos para esta monitoria.
 *
 * Uma recusa some da fila do gestor assim que é decidida, e sem isto não
 * sobrava nada na tela dizendo que alguém tentou excluir a avaliação e por que
 * o pedido não foi adiante — informação que importa justamente quando a nota
 * de alguém é questionada.
 */
export default function PedidosDeExclusao({ pedidos }: { pedidos: PedidoDeExclusao[] }) {
  if (pedidos.length === 0) return null;

  return (
    <Cartao titulo={`Pedidos de exclusão (${pedidos.length})`}>
      <ul className="space-y-3">
        {pedidos.map((p) => {
          const aparencia = APARENCIA[p.status];
          return (
            <li key={p.id} className={`rounded-lg px-4 py-3 text-sm ring-1 ${aparencia.cor}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-semibold">{aparencia.rotulo}</span>
                <span className="text-xs opacity-80">
                  pedido por {p.solicitada_por_nome ?? '—'} · {dataHora(p.solicitada_em)}
                </span>
              </div>

              <p className="mt-1">
                <span className="opacity-70">Motivo:</span> {p.motivo}
              </p>

              {p.decidida_em && (
                <p className="mt-1 text-xs opacity-80">
                  {p.status === 'recusada' ? 'Recusado' : 'Aprovado'} por{' '}
                  {p.decidida_por_nome ?? '—'} · {dataHora(p.decidida_em)}
                  {p.observacao_decisao && <> · {p.observacao_decisao}</>}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </Cartao>
  );
}
