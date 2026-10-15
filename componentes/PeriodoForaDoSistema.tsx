'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

/**
 * Férias tiradas antes do sistema (migração 64): "Período tirado fora do
 * sistema" soma 30 dias em `ferias_dias_fora`, que abatem os períodos mais
 * antigos — sem precisar lembrar as datas. "Desfazer" zera.
 */
export default function PeriodoForaDoSistema({ pessoaId, nome, diasFora, mostrarBotao }: {
  pessoaId: string;
  nome: string;
  diasFora: number;
  /** Só faz sentido em período já completo com dias sobrando. */
  mostrarBotao: boolean;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);

  async function gravar(valor: number) {
    setOcupado(true);
    const { error } = await criarClienteNavegador().from('pessoas').update({ ferias_dias_fora: valor }).eq('id', pessoaId);
    setOcupado(false);
    if (error) { alert(`Não foi possível salvar: ${error.message}`); return; }
    router.refresh();
  }

  return (
    <span className="mt-0.5 flex flex-wrap justify-end gap-x-2 text-xs font-normal">
      {diasFora > 0 && (
        <span className="text-slate-500">
          inclui {diasFora} dias fora do sistema ·{' '}
          <button disabled={ocupado} onClick={() => confirm(`Zerar os dias tirados fora do sistema de ${nome}?`) && gravar(0)}
                  className="underline-offset-2 hover:underline">desfazer</button>
        </span>
      )}
      {mostrarBotao && (
        <button disabled={ocupado} onClick={() => gravar(diasFora + 30)}
                title="Credita 30 dias: as férias desse período foram tiradas antes de existir o cadastro"
                className="rounded border border-slate-300 px-1.5 py-px font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          {ocupado ? '…' : 'Período tirado fora do sistema'}
        </button>
      )}
    </span>
  );
}
