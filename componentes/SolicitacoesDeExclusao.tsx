'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao } from '@/componentes/ui';
import { data as formatarData, dataHora, nota } from '@/lib/formatar';

export type Solicitacao = {
  id: string;
  motivo: string;
  solicitada_por_nome: string | null;
  solicitada_em: string;
  monitoria: {
    id: string;
    protocolo: string;
    data_atendimento: string;
    operador: string;
    nota_final: number;
  } | null;
};

/**
 * Fila de exclusões aguardando decisão do gestor.
 *
 * Aparece só quando há algo pendente: quadro vazio ocupando espaço todo dia
 * treina a pessoa a ignorar o lugar onde a decisão aparece.
 */
export default function SolicitacoesDeExclusao({ pendentes }: { pendentes: Solicitacao[] }) {
  const router = useRouter();
  const [ocupada, setOcupada] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recusando, setRecusando] = useState<string | null>(null);
  const [observacao, setObservacao] = useState('');

  async function aprovar(id: string) {
    setOcupada(id); setErro(null);
    const { error } = await criarClienteNavegador().rpc('aprovar_exclusao', { p_solicitacao: id });
    setOcupada(null);
    if (error) return setErro(error.message);
    router.refresh();
  }

  async function recusar(id: string) {
    setOcupada(id); setErro(null);
    const { error } = await criarClienteNavegador().rpc('recusar_exclusao', {
      p_solicitacao: id, p_observacao: observacao,
    });
    setOcupada(null);
    if (error) return setErro(error.message);
    setRecusando(null); setObservacao('');
    router.refresh();
  }

  if (pendentes.length === 0) return null;

  return (
    <Cartao
      titulo={`Exclusões aguardando sua decisão (${pendentes.length})`}
      className="ring-1 ring-amber-500/40"
    >
      {erro && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                      ring-1 ring-rose-600/20">{erro}</p>
      )}

      <ul className="divide-y divide-slate-100">
        {pendentes.map((s) => (
          <li key={s.id} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm font-medium text-slate-900">
                {s.monitoria
                  ? <>Monitoria {s.monitoria.protocolo} · {s.monitoria.operador}</>
                  : 'Monitoria já removida'}
              </p>
              {s.monitoria && (
                <p className="text-xs text-slate-500">
                  {formatarData(s.monitoria.data_atendimento)} · nota{' '}
                  {nota(Number(s.monitoria.nota_final))}
                </p>
              )}
            </div>

            <p className="mt-1 text-sm text-slate-700">
              <span className="text-slate-500">Motivo:</span> {s.motivo}
            </p>
            <p className="text-xs text-slate-500">
              pedido por {s.solicitada_por_nome ?? '—'} · {dataHora(s.solicitada_em)}
            </p>

            {recusando === s.id ? (
              <div className="mt-3">
                <input
                  value={observacao}
                  onChange={(e) => setObservacao(e.target.value)}
                  placeholder="Por que não vai excluir (opcional)"
                  autoFocus
                  className="w-full rounded-lg border border-slate-300 bg-superficie px-3 py-2
                             text-sm outline-none focus:border-marca-600"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => recusar(s.id)} disabled={ocupada === s.id}
                    className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-semibold
                               text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    Confirmar recusa
                  </button>
                  <button
                    onClick={() => { setRecusando(null); setObservacao(''); }}
                    className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5
                               text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Voltar
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => aprovar(s.id)} disabled={ocupada === s.id}
                  className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white
                             hover:bg-rose-700 disabled:opacity-50"
                >
                  {ocupada === s.id ? 'Excluindo…' : 'Aprovar e excluir'}
                </button>
                <button
                  onClick={() => setRecusando(s.id)} disabled={ocupada === s.id}
                  className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5
                             text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Recusar
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs leading-relaxed text-slate-500">
        Aprovar apaga a monitoria e o histórico dela. Fica registrado o que foi excluído,
        quem pediu, quem aprovou e por quê — em <strong>Monitorias excluídas</strong>.
      </p>
    </Cartao>
  );
}
