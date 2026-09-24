'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao } from '@/componentes/ui';
import type { AlteracaoDeValor, ValorDaCota as Valor } from '@/lib/tipos';

const entrada = `rounded-md border border-slate-300 px-2 py-1 text-sm outline-none
                 focus:border-marca-600 disabled:bg-slate-50`;
const botaoPrimario = `rounded-lg bg-marca-600 px-3 py-1.5 text-xs font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-40`;

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR');
const reais = (v: number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 4 });

/**
 * Valor por ponto da competência.
 *
 * O número vem de fora — outra área define e costuma chegar até o dia 10 do
 * mês seguinte. Por isso ele não é calculado aqui, é digitado: o painel guarda,
 * aplica e mostra a conta.
 *
 * Corrigir um valor já definido exige motivo e fica no histórico, pelo mesmo
 * motivo do ajuste de fechamento: número que vira pagamento não muda calado.
 */
export default function ValorDaCota({
  competencia, valor, alteracoes,
}: {
  competencia: string;
  valor: Valor | null;
  alteracoes: AlteracaoDeValor[];
}) {
  const router = useRouter();
  const [porPonto, setPorPonto] = useState(valor ? String(valor.valor_por_ponto) : '');
  const [percentual, setPercentual] = useState(
    String(Math.round((valor?.percentual_bonus ?? 0.1) * 10000) / 100));
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const numero = (t: string) => Number(t.trim().replace(',', '.'));
  const mudou = !valor
    || numero(porPonto) !== Number(valor.valor_por_ponto)
    || numero(percentual) / 100 !== Number(valor.percentual_bonus);

  async function salvar() {
    const v = numero(porPonto);
    const p = numero(percentual);
    if (!porPonto.trim() || !Number.isFinite(v) || v < 0) {
      setErro('Informe o valor por ponto.'); return;
    }
    if (!Number.isFinite(p) || p < 0) { setErro('Percentual do bônus inválido.'); return; }
    if (valor && !motivo.trim()) {
      setErro('Alterar um valor já definido exige motivo.'); return;
    }

    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    const { error } = await db.rpc('definir_valor_da_cota', {
      p_mes: competencia,
      p_valor: v,
      p_percentual: p / 100,
      p_motivo: motivo.trim() || null,
    });
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setMotivo('');
    setAviso(valor ? 'Valor corrigido e registrado no histórico.' : 'Valor definido.');
    router.refresh();
  }

  return (
    <Cartao titulo="Valor por ponto">
      {erro && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800
                      ring-1 ring-rose-600/20">{erro}</p>
      )}
      {aviso && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800
                      ring-1 ring-emerald-600/20">{aviso}</p>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Valor por ponto (R$)</span>
          <input
            value={porPonto} disabled={ocupado} inputMode="decimal" placeholder="0,00"
            className={`${entrada} w-32 text-right tabular-nums`}
            onChange={(e) => setPorPonto(e.target.value)}
          />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Bônus de equipe (%)</span>
          <input
            value={percentual} disabled={ocupado} inputMode="decimal"
            className={`${entrada} w-24 text-right tabular-nums`}
            onChange={(e) => setPercentual(e.target.value)}
          />
        </label>
        {valor && (
          <label className="min-w-56 flex-1">
            <span className="mb-1 block text-xs font-medium text-slate-600">
              Motivo da correção
            </span>
            <input
              value={motivo} disabled={ocupado} className={`${entrada} w-full`}
              placeholder="Obrigatório para alterar"
              onChange={(e) => setMotivo(e.target.value)}
            />
          </label>
        )}
        <button type="button" onClick={salvar} disabled={ocupado || !mudou}
                className={`${botaoPrimario} mb-0.5`}>
          {ocupado ? 'Salvando…' : valor ? 'Corrigir valor' : 'Definir valor'}
        </button>
      </div>

      {valor && (
        <p className="mt-3 text-xs text-slate-500">
          {reais(Number(valor.valor_por_ponto))} por ponto · bônus de{' '}
          {Math.round(Number(valor.percentual_bonus) * 10000) / 100}% ·
          definido por {valor.definido_por_nome ?? 'sistema'} em {dataHora(valor.definido_em)}
          {valor.atualizado_em ? ` · corrigido em ${dataHora(valor.atualizado_em)}` : ''}
        </p>
      )}

      {alteracoes.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Correções
          </p>
          <ul className="flex flex-col gap-1.5 text-xs text-slate-600">
            {alteracoes.map((a) => (
              <li key={a.id}>
                {reais(Number(a.valor_antes ?? 0))} → {reais(Number(a.valor_depois ?? 0))}
                {' · '}{a.motivo}
                {' · '}{a.alterado_por_nome ?? 'sistema'}, {dataHora(a.alterado_em)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Cartao>
  );
}
