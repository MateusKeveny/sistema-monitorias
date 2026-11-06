'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mensagemDoErro } from '@/lib/erro-amigavel';

/**
 * Só na cópia da apresentação (Worker painel-apresentacao, APRESENTACAO=1) e
 * só para a gestão (gestor e administrador): repõe todos os dados do painel como no ponto de
 * partida (resetar_apresentacao, que só existe no banco dessa cópia —
 * banco-local\nuvem-preparar.sql). No site oficial este botão não aparece.
 */
export default function VoltarApresentacaoAoInicio() {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  async function voltar() {
    if (!confirm('Voltar a apresentação ao início?\n\nTudo o que foi feito nesta cópia (fechamentos, aprovações, importações, setores criados) volta ao ponto de partida. As contas de login continuam as mesmas.')) return;
    setOcupado(true); setAviso(null);
    const { error } = await criarClienteNavegador().rpc('resetar_apresentacao');
    setOcupado(false);
    if (error) { setAviso(await mensagemDoErro(error)); return; }
    setAviso('Pronto: de volta ao início.');
    router.refresh();
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={voltar} disabled={ocupado}
              className="w-full rounded-lg border border-amber-500/50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50 dark:text-amber-300">
        {ocupado ? 'Voltando ao início…' : '↺ Voltar a apresentação ao início'}
      </button>
      {aviso && <p className="mt-1 text-[11px] text-slate-500">{aviso}</p>}
    </div>
  );
}
