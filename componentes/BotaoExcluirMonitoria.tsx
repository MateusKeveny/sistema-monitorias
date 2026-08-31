'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

/**
 * Exclusão de monitoria.
 *
 * Gestor apaga na hora. Qualidade abre uma solicitação, que fica pendente até
 * um gestor decidir — enquanto isso a monitoria continua valendo normalmente
 * nos relatórios. Quem manda nisso é o banco, não esta tela: a mesma função
 * decide o caminho pelo papel de quem chamou, então mexer no navegador não
 * transforma solicitação em exclusão.
 */
export default function BotaoExcluirMonitoria({
  monitoriaId, protocolo, operador, ehGestor,
}: {
  monitoriaId: string;
  protocolo: string;
  operador: string;
  ehGestor: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [solicitada, setSolicitada] = useState(false);

  async function confirmar() {
    if (!motivo.trim()) return setErro('Informe o motivo.');

    setEnviando(true);
    setErro(null);

    const db = criarClienteNavegador();
    const { data, error } = await db.rpc('excluir_monitoria', {
      p_id: monitoriaId,
      p_motivo: motivo.trim(),
    });

    if (error) {
      setErro(error.message);
      setEnviando(false);
      return;
    }

    if (data === 'solicitada') {
      setSolicitada(true);
      setEnviando(false);
      router.refresh();
      return;
    }

    router.push('/monitorias');
    router.refresh();
  }

  if (solicitada) {
    return (
      <p className="w-full rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900
                    ring-1 ring-amber-600/20">
        <strong>Solicitação enviada.</strong> A monitoria continua valendo até um gestor
        aprovar a exclusão.
      </p>
    );
  }

  const rotulo = ehGestor ? 'Excluir monitoria' : 'Solicitar exclusão';

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="rounded-lg border border-rose-300 bg-superficie px-3 py-1.5 text-sm
                   font-medium text-rose-700 hover:bg-rose-50"
      >
        {rotulo}
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl bg-rose-50 p-4 ring-1 ring-rose-600/20">
      <p className="text-sm font-semibold text-rose-900">
        {ehGestor ? 'Excluir' : 'Solicitar exclusão d'}a monitoria {protocolo}, de {operador}?
      </p>
      <p className="mt-1 text-sm text-rose-800">
        {ehGestor
          ? 'A avaliação e o histórico de alterações dela são apagados e não voltam. '
            + 'Fica registrado o que foi excluído, por quem e por quê.'
          : 'A monitoria continua valendo até um gestor aprovar. O motivo abaixo é o que '
            + 'ele vai ler para decidir.'}
      </p>

      <label className="mt-3 block">
        <span className="mb-1 block text-xs font-medium text-rose-900">Motivo</span>
        <input
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          disabled={enviando}
          autoFocus
          placeholder="Ex.: lançada em duplicidade, no operador errado"
          className="w-full rounded-lg border border-rose-300 bg-superficie px-3 py-2 text-sm
                     outline-none focus:border-rose-500"
        />
      </label>

      {erro && <p className="mt-2 text-sm font-medium text-rose-900">{erro}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={confirmar}
          disabled={enviando || !motivo.trim()}
          className="rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white
                     hover:bg-rose-700 disabled:opacity-50"
        >
          {enviando
            ? 'Enviando…'
            : ehGestor ? 'Confirmar exclusão' : 'Enviar solicitação'}
        </button>
        <button
          type="button"
          onClick={() => { setAberto(false); setMotivo(''); setErro(null); }}
          disabled={enviando}
          className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                     font-medium text-slate-700 hover:bg-slate-50"
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
