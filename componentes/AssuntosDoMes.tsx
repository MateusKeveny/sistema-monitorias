'use client';

import { useState } from 'react';
import { Quadro, Vazio } from '@/componentes/ui';
import { percentual } from '@/lib/formatar';

export type AssuntoDoMes = { canal_id: number; assunto: string; avaliacoes: number; positivas: number };

const inteiro = (v: number) => Math.round(v).toLocaleString('pt-BR');
const TOP = 10;

/**
 * Assuntos mais tratados (3.9.0, migração 99): a tabulação de cada avaliação
 * do C-SAT, somada no mês. A tabulação só vem nos atendimentos avaliados; o
 * volume estimado aplica a fatia do assunto (nas avaliações da fila) aos
 * finalizados da equipe na fila. Geral = a soma das filas. Vale para
 * qualquer setor: as abas são as filas dele (por número), não nomes fixos.
 */
export default function AssuntosDoMes({ linhas, finalizados, filas, mes }: {
  linhas: AssuntoDoMes[];
  /** Finalizados da equipe no mês, por fila (número da fila). */
  finalizados: Record<number, number>;
  /** As filas do setor escolhido. */
  filas: { id: number; nome: string }[];
  /** Ex.: "outubro". */
  mes: string;
}) {
  const [aba, setAba] = useState<string>('geral');
  const [todos, setTodos] = useState(false);

  // Avaliações por fila, para a fatia de cada assunto dentro dela.
  const totalNaFila = new Map<number, number>();
  for (const l of linhas) totalNaFila.set(l.canal_id, (totalNaFila.get(l.canal_id) ?? 0) + Number(l.avaliacoes));
  const estimado = (l: AssuntoDoMes) => {
    const t = totalNaFila.get(l.canal_id) ?? 0;
    const f = finalizados[l.canal_id];
    return t && f ? (Number(l.avaliacoes) / t) * f : null;
  };

  // Na aba: as linhas da fila, ou todas somadas por assunto (Geral).
  const daAba = new Map<string, { assunto: string; avaliacoes: number; positivas: number; estimado: number | null }>();
  for (const l of linhas) {
    if (aba !== 'geral' && String(l.canal_id) !== aba) continue;
    const ja = daAba.get(l.assunto) ?? { assunto: l.assunto, avaliacoes: 0, positivas: 0, estimado: 0 };
    ja.avaliacoes += Number(l.avaliacoes); ja.positivas += Number(l.positivas);
    const e = estimado(l);
    ja.estimado = e == null || ja.estimado == null ? null : ja.estimado + e;
    daAba.set(l.assunto, ja);
  }
  const ordenados = [...daAba.values()].sort((a, b) => b.avaliacoes - a.avaliacoes || a.assunto.localeCompare(b.assunto));
  const totalAba = ordenados.reduce((t, l) => t + l.avaliacoes, 0);
  const mostrados = todos ? ordenados : ordenados.slice(0, TOP);
  const maior = ordenados[0]?.avaliacoes ?? 1;
  const abas: [string, string][] = [['geral', 'Geral'], ...filas.filter((f) => totalNaFila.has(f.id)).map((f) => [String(f.id), f.nome] as [string, string])];

  return (
    <Quadro titulo="Assuntos mais tratados"
            subtitulo={`A tabulação de cada avaliação do C-SAT em ${mes}. Volume estimado: a fatia do assunto nas avaliações aplicada aos finalizados da equipe.`}
            acao={
              <div role="tablist" aria-label="Fila" className="inline-flex gap-1 rounded-full bg-slate-100 p-1">
                {abas.map(([chave, rotulo]) => (
                  <button key={chave} type="button" role="tab" aria-selected={aba === chave} onClick={() => setAba(chave)}
                          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                            aba === chave ? 'bg-superficie text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>
                    {rotulo}
                  </button>
                ))}
              </div>
            }>
      {ordenados.length === 0 ? <Vazio>Nenhuma avaliação com tabulação neste mês.</Vazio> : (
        <>
          <div className="-mx-6 overflow-x-auto sm:-mx-7">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="w-10 py-2.5 pl-6 pr-2 text-left font-medium sm:pl-7">#</th>
                  <th className="px-3 py-2.5 text-left font-medium">Assunto (tabulação)</th>
                  <th className="px-3 py-2.5 text-right font-medium">Avaliações</th>
                  <th className="px-3 py-2.5 text-right font-medium">% do total</th>
                  <th className="px-3 py-2.5 text-right font-medium">Volume estimado</th>
                  <th className="py-2.5 pl-3 pr-6 text-right font-medium sm:pr-7">C-SAT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {mostrados.map((l, i) => {
                  const csat = l.avaliacoes ? l.positivas / l.avaliacoes : null;
                  return (
                    <tr key={l.assunto}>
                      <td className={`py-2 pl-6 pr-2 font-semibold sm:pl-7 ${i < 3 ? 'text-marca-700 dark:text-marca-400' : 'text-slate-400'}`}>{i + 1}º</td>
                      <td className="px-3 py-2">
                        <span className="block text-slate-800">{l.assunto}</span>
                        <span className="mt-1 block h-1.5 max-w-xs overflow-hidden rounded-full bg-slate-100">
                          <span className="block h-full rounded-full bg-marca-600" style={{ width: `${(l.avaliacoes / maior) * 100}%` }} />
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">{inteiro(l.avaliacoes)}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{percentual(totalAba ? l.avaliacoes / totalAba : null)}</td>
                      <td className="px-3 py-2 text-right text-slate-600">{l.estimado == null ? '—' : `≈ ${inteiro(l.estimado)}`}</td>
                      <td className={`py-2 pl-3 pr-6 text-right font-medium sm:pr-7 ${csat == null ? 'text-slate-400'
                        : csat >= 0.9 ? 'text-marca-700 dark:text-marca-400' : csat >= 0.85 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}`}>
                        {percentual(csat)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span>{inteiro(totalAba)} avaliações em {inteiro(ordenados.length)} assuntos.</span>
            {ordenados.length > TOP && (
              <button type="button" onClick={() => setTodos(!todos)} className="font-medium text-marca-700 hover:underline dark:text-marca-400">
                {todos ? `Ver só o Top ${TOP}` : `Ver todos os ${inteiro(ordenados.length)}`}
              </button>
            )}
          </div>
        </>
      )}
    </Quadro>
  );
}
