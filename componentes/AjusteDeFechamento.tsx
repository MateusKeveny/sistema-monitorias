'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

const num = (v: number) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/**
 * Correção de um fechamento já congelado.
 *
 * Erro acontece depois de fechar, e sem caminho de correção a saída seria
 * mexer no banco por fora, sem rastro. Aqui o motivo é obrigatório e o banco
 * guarda valor anterior, valor novo, autor e data.
 */
export default function AjusteDeFechamento({
  fechamentoId, pessoa, resultado, meta,
}: {
  fechamentoId: string;
  pessoa: string;
  resultado: number;
  meta: number | null;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [campo, setCampo] = useState<'resultado' | 'meta'>('resultado');
  const [valor, setValor] = useState(String(resultado));
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function trocarCampo(c: 'resultado' | 'meta') {
    setCampo(c);
    setValor(String(c === 'resultado' ? resultado : meta ?? ''));
  }

  async function ajustar() {
    const n = Number(valor);
    if (!Number.isFinite(n)) { setErro('Valor inválido.'); return; }
    if (!motivo.trim()) { setErro('Escreva o motivo do ajuste.'); return; }

    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().rpc('ajustar_fechamento', {
      p_fechamento: fechamentoId, p_campo: campo, p_valor: n, p_motivo: motivo.trim(),
    });
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setAberto(false); setMotivo('');
    router.refresh();
  }

  async function reabrir() {
    if (!motivo.trim()) { setErro('Escreva o motivo da reabertura.'); return; }
    if (!confirm(`Reabrir o fechamento de ${pessoa}?\n\n`
      + `O valor entregue (${num(resultado)} pts) sai do congelamento e fica só no histórico. `
      + 'Fechar de novo grava o extrato como estiver naquele momento.')) return;

    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().rpc('reabrir_fechamento', {
      p_fechamento: fechamentoId, p_motivo: motivo.trim(),
    });
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setAberto(false); setMotivo('');
    router.refresh();
  }

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)}
              className="text-xs text-slate-500 hover:text-marca-700 hover:underline dark:hover:text-marca-400">
        corrigir
      </button>
    );
  }

  const entrada = `rounded-md border border-slate-300 px-2 py-1 text-sm outline-none
                   focus:border-marca-600 disabled:bg-slate-50`;

  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="mb-1 block text-[11px] font-medium text-slate-600">Campo</span>
          <select value={campo} disabled={ocupado} className={entrada}
                  onChange={(e) => trocarCampo(e.target.value as 'resultado' | 'meta')}>
            <option value="resultado">Pontos</option>
            <option value="meta">Meta</option>
          </select>
        </label>
        <label>
          <span className="mb-1 block text-[11px] font-medium text-slate-600">Novo valor</span>
          <input type="number" step="any" value={valor} disabled={ocupado}
                 onChange={(e) => setValor(e.target.value)} className={`${entrada} w-28 text-right tabular-nums`} />
        </label>
        <label className="min-w-48 flex-1">
          <span className="mb-1 block text-[11px] font-medium text-slate-600">Motivo (obrigatório)</span>
          <input value={motivo} disabled={ocupado} onChange={(e) => setMotivo(e.target.value)}
                 placeholder="Ex.: volume da 3ª semana digitado errado"
                 className={`${entrada} w-full`} />
        </label>
      </div>

      {erro && <p className="text-xs text-rose-700">{erro}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={ajustar} disabled={ocupado}
                className="rounded-lg bg-marca-600 px-3 py-1.5 text-xs font-semibold text-white
                           hover:bg-marca-700 disabled:opacity-40">
          {ocupado ? 'Salvando…' : 'Salvar ajuste'}
        </button>
        <button type="button" onClick={reabrir} disabled={ocupado}
                className="text-xs font-medium text-amber-700 hover:underline disabled:opacity-40">
          reabrir fechamento
        </button>
        <button type="button" onClick={() => { setAberto(false); setErro(null); }} disabled={ocupado}
                className="text-xs text-slate-500 hover:underline">
          cancelar
        </button>
      </div>
    </div>
  );
}
