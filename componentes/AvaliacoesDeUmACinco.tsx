'use client';

import { useState } from 'react';
import { Painel, Secao, Vazio } from '@/componentes/ui';
import { data as formatarData } from '@/lib/formatar';

export type AvaliacaoDoAtendente = { data: string; protocolo: string; nota: number; tabulacao: string | null };

/** Cor de cada nota, da 5 (verde) à 1 (rosa). */
const COR: Record<number, string> = {
  5: 'bg-emerald-500', 4: 'bg-emerald-300', 3: 'bg-amber-400', 2: 'bg-orange-400', 1: 'bg-rose-500',
};
/** Selo da nota na lista (visual 3.0): fundo suave e o número na cor da nota. */
const SELO: Record<number, string> = {
  5: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  4: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  3: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  2: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
  1: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
};
/** O C-SAT na escala do painel: verde a partir de 90%, âmbar de 85%, rosa abaixo. */
const tomDoCsat = (v: number) => v >= 0.9 ? 'bg-emerald-500/10 text-marca-700 dark:text-marca-400'
  : v >= 0.85 ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-rose-500/10 text-rose-700 dark:text-rose-300';

/**
 * As avaliações do atendente de 1 a 5 (2.10.0), do relatório do Hub — as
 * mesmas do cálculo do C-SAT (positivas = 4 e 5). Abaixo, as notas 1 a 3 em
 * lista, com o protocolo para copiar e revisar o atendimento.
 */
export default function AvaliacoesDeUmACinco({ avaliacoes, rotulo }: {
  avaliacoes: AvaliacaoDoAtendente[]; rotulo: string;
}) {
  const [todas, setTodas] = useState(false);
  const [copiado, setCopiado] = useState<string | null>(null);

  const total = avaliacoes.length;
  const porNota = [5, 4, 3, 2, 1].map((n) => ({ n, q: avaliacoes.filter((a) => a.nota === n).length }));
  const positivas = porNota[0].q + porNota[1].q;
  const baixas = avaliacoes.filter((a) => a.nota <= 3);
  const lista = (todas ? avaliacoes : baixas).slice().sort((a, b) => a.nota - b.nota || b.data.localeCompare(a.data));
  const pct = (q: number) => `${Math.round((q / total) * 100)}%`;

  async function copiar(protocolo: string) {
    let ok = false;
    try {
      await navigator.clipboard.writeText(protocolo);
      ok = true;
    } catch {
      // Sem permissão da área de transferência: o jeito antigo, por seleção.
      const campo = document.createElement('textarea');
      campo.value = protocolo;
      campo.style.position = 'fixed'; campo.style.opacity = '0';
      document.body.appendChild(campo);
      campo.select();
      ok = document.execCommand('copy');
      campo.remove();
    }
    if (!ok) return;
    setCopiado(protocolo);
    setTimeout(() => setCopiado((c) => (c === protocolo ? null : c)), 1800);
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[1fr_1.2fr]">
      <Painel>
        <Secao titulo={`Suas avaliações de 1 a 5 · ${rotulo}`} subtitulo="Do relatório do Hub, as mesmas que entram no cálculo do C-SAT.">
          {!total ? <Vazio>Sem avaliações nesta fila no mês.</Vazio> : (
            <>
              {/* O C-SAT do mês em destaque e a proporção das notas numa barra só. */}
              <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-500">C-SAT no mês</p>
                  <p className="mt-1">
                    <span className={`inline-flex rounded-full px-3.5 py-1 text-[1.65rem] font-bold leading-tight tracking-tight tabular-nums ${tomDoCsat(positivas / total)}`}>
                      {pct(positivas)}
                    </span>
                  </p>
                </div>
                <p className="text-sm text-slate-500"><b className="text-slate-900">{positivas}</b> de <b className="text-slate-900">{total}</b> positivas</p>
              </div>
              <div className="mb-5 flex h-3 gap-[2px] overflow-hidden rounded-full" aria-hidden>
                {porNota.filter(({ q }) => q > 0).map(({ n, q }) => (
                  <span key={n} title={`Nota ${n}: ${q}`} className={`barra-semana crescer-x origin-left ${COR[n]}`}
                        style={{ width: `${(q / total) * 100}%` }} />
                ))}
              </div>
              <ul className="space-y-2.5">
                {porNota.map(({ n, q }) => (
                  <li key={n} className="grid grid-cols-[3rem_1fr_6rem] items-center gap-3 text-sm">
                    <span className="font-bold text-slate-800">{n} ★</span>
                    <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <span className={`barra-semana crescer-x block h-full origin-left rounded-full ${COR[n]}`} style={{ width: `${(q / total) * 100}%` }} />
                    </span>
                    <span className="text-right tabular-nums text-slate-600"><b className="text-slate-900">{q}</b> · {pct(q)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 pt-2.5 text-sm text-slate-600">
                <span><b className="text-slate-900">{total}</b> avaliações</span>
                <span className="text-marca-700 dark:text-marca-400">positivas (4 e 5): <b>{positivas}</b> · {pct(positivas)}</span>
                <span className="text-rose-700">abaixo de 4: <b>{baixas.length}</b></span>
              </p>
            </>
          )}
        </Secao>
      </Painel>
      <Painel>
        <Secao titulo={todas ? 'Todas as avaliações' : 'As avaliações abaixo de 4'}
               subtitulo="O ícone ao lado do protocolo copia, para você revisar o atendimento."
               acao={total > 0 ? (
                 <span className="inline-flex overflow-hidden rounded-full border border-slate-200 text-xs">
                   <button type="button" onClick={() => setTodas(false)} aria-pressed={!todas}
                           className={`px-2.5 py-0.5 ${!todas ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600'}`}>1 a 3 ({baixas.length})</button>
                   <button type="button" onClick={() => setTodas(true)} aria-pressed={todas}
                           className={`px-2.5 py-0.5 ${todas ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600'}`}>Todas ({total})</button>
                 </span>
               ) : undefined}>
          {!lista.length ? (
            <Vazio>{total ? 'Nenhuma avaliação abaixo de 4 no mês.' : 'Sem avaliações nesta fila no mês.'}</Vazio>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {lista.map((a) => (
                <li key={`${a.data}|${a.protocolo}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-sm transition-colors hover:bg-slate-50">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${SELO[a.nota]}`}>{a.nota}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 font-medium tabular-nums text-slate-900">
                      {a.protocolo}
                      {/* Discreto (pedido do gestor): só o ícone, ao lado do protocolo. */}
                      <button type="button" onClick={() => copiar(a.protocolo)}
                              title={copiado === a.protocolo ? 'Copiado' : 'Copiar protocolo'}
                              aria-label={copiado === a.protocolo ? 'Protocolo copiado' : `Copiar protocolo ${a.protocolo}`}
                              className={`grid h-6 w-6 place-items-center rounded-md transition ${copiado === a.protocolo
                                ? 'text-marca-700 dark:text-marca-400' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}>
                        {copiado === a.protocolo ? (
                          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5 8 14l8-8" /></svg>
                        ) : (
                          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><rect x="7" y="7" width="9" height="10" rx="2" /><path d="M13 7V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1" /></svg>
                        )}
                      </button>
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {formatarData(a.data)}{a.tabulacao ? ` · ${a.tabulacao}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Secao>
      </Painel>
    </div>
  );
}
