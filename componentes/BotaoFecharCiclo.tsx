'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mesRotulo } from '@/lib/formatar';

/**
 * Congela a competência. O banco é quem decide: `fechar_ciclo` confere o papel
 * e nunca sobrescreve fechamento existente — número já entregue não se refaz.
 */
export default function BotaoFecharCiclo({
  competencia, pessoas, avisos,
}: {
  competencia: string;
  /** Quantas pessoas entram no fechamento. */
  pessoas: number;
  /** Pendências que valem confirmar antes de congelar. */
  avisos: string[];
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function fechar() {
    if (!confirm(`Fechar ${mesRotulo(competencia)} com ${pessoas} pessoa(s)?\n\n`
      + 'O resultado e o extrato ficam congelados como estão agora. '
      + 'Mudanças posteriores em pesos, volume ou lançamentos não alteram o que foi fechado, '
      + 'e não existe caminho para desfazer.')) return;

    setOcupado(true); setErro(null); setAviso(null);
    const { data, error } = await criarClienteNavegador().rpc('fechar_ciclo', { p_mes: competencia });
    setOcupado(false);

    if (error) { setErro(error.message); return; }
    setAviso(`${data} pessoa(s) fechadas em ${mesRotulo(competencia)}.`);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {avisos.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/20">
          <p className="font-semibold">Confira antes de fechar</p>
          <ul className="mt-1 list-disc pl-5">
            {avisos.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}
      {erro && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>
      )}
      {aviso && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>
      )}

      <button
        type="button" onClick={fechar} disabled={ocupado || pessoas === 0}
        className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white
                   hover:bg-marca-700 disabled:opacity-40"
      >
        {ocupado ? 'Fechando…' : `Fechar ${mesRotulo(competencia)}`}
      </button>
    </div>
  );
}
