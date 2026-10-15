'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

/**
 * Férias tiradas antes do sistema (migração 64). "Período tirado fora do
 * sistema" abre um campo para dizer quantos dias foram tirados — sugere o que
 * falta no período —, e eles somam em `ferias_dias_fora`, abatendo os
 * períodos mais antigos sem precisar das datas. "Desfazer" zera.
 */
export default function PeriodoForaDoSistema({ pessoaId, nome, diasFora, saldo, mostrarBotao }: {
  pessoaId: string;
  nome: string;
  diasFora: number;
  /** Dias que faltam no período mostrado: a sugestão do campo. */
  saldo: number;
  /** Só faz sentido em período já completo com dias sobrando. */
  mostrarBotao: boolean;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [dias, setDias] = useState(saldo > 0 ? saldo : 30);

  async function gravar(valor: number) {
    setOcupado(true);
    const { error } = await criarClienteNavegador().from('pessoas').update({ ferias_dias_fora: valor }).eq('id', pessoaId);
    setOcupado(false);
    if (error) { alert(`Não foi possível salvar: ${error.message}`); return; }
    setAberto(false);
    router.refresh();
  }

  return (
    <span className="mt-0.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-xs font-normal">
      {diasFora > 0 && !aberto && (
        <span className="text-slate-500">
          inclui {diasFora} dias fora do sistema ·{' '}
          <button disabled={ocupado} onClick={() => confirm(`Zerar os dias tirados fora do sistema de ${nome}?`) && gravar(0)}
                  className="underline-offset-2 hover:underline">desfazer</button>
        </span>
      )}
      {mostrarBotao && !aberto && (
        <button disabled={ocupado} onClick={() => setAberto(true)}
                title="As férias desse período foram tiradas antes de existir o cadastro"
                className="rounded border border-slate-300 px-1.5 py-px font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50">
          Período tirado fora do sistema
        </button>
      )}
      {aberto && (
        <form onSubmit={(e) => { e.preventDefault(); if (dias >= 1) gravar(diasFora + dias); }}
              className="flex items-center gap-1.5 text-slate-600">
          <label htmlFor={`fora-${pessoaId}`}>Dias tirados</label>
          <input id={`fora-${pessoaId}`} type="number" min={1} max={60} autoFocus value={dias || ''}
                 onChange={(e) => setDias(Math.min(60, Math.max(0, Number(e.target.value) || 0)))}
                 className="w-14 rounded border border-slate-300 bg-superficie px-1.5 py-0.5 text-right text-slate-900" />
          <button type="submit" disabled={ocupado || dias < 1}
                  className="rounded bg-marca-600 px-2 py-0.5 font-semibold text-white hover:bg-marca-700 disabled:opacity-50">
            {ocupado ? '…' : 'Salvar'}
          </button>
          <button type="button" onClick={() => setAberto(false)} className="rounded px-1.5 py-0.5 hover:bg-slate-100">Cancelar</button>
        </form>
      )}
    </span>
  );
}
