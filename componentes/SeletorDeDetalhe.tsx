'use client';

import { useState, type ReactNode } from 'react';

export type Destaque = {
  chave: string;
  /** O bloco da faixa, montado no servidor. */
  bloco: ReactNode;
  /** O que abre abaixo da faixa quando o bloco é escolhido. */
  detalhe: ReactNode;
  /** Tom do bloco: âmbar quando o próprio bloco é um alerta (Na meta com gente abaixo). */
  tom?: 'normal' | 'atencao';
};

/**
 * A faixa de destaques como abas da tela (1.15.0).
 *
 * Cada bloco — Na meta, C-SAT, Volume, TME, Monitoria — abre o próprio
 * detalhe logo abaixo da faixa, sem rolar: na versão anterior o detalhe ficava
 * no fim da página. O escolhido ganha borda verde e uma seta apontando para o
 * detalhe. Tudo já vem pronto do servidor; o clique só mostra um e esconde os
 * outros.
 */
export default function SeletorDeDetalhe({
  destaques,
  inicial = destaques[0]?.chave ?? null,
  alternar = false,
  rotulo = 'Destaques do mês',
  grade = 'sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5',
}: {
  destaques: Destaque[];
  /** O que começa aberto; `null` começa com tudo fechado (semanas do extrato). */
  inicial?: string | null;
  /** Clicar de novo no aberto fecha o detalhe. */
  alternar?: boolean;
  rotulo?: string;
  grade?: string;
}) {
  const [aberto, setAberto] = useState<string | null>(inicial);

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label={rotulo}
           className={`grid gap-3 ${grade}`}>
        {destaques.map((d) => {
          const ativo = d.chave === aberto;
          return (
            <button key={d.chave} type="button" role="tab" aria-selected={ativo}
                    aria-controls={`detalhe-${d.chave}`}
                    onClick={() => setAberto(alternar && ativo ? null : d.chave)}
                    className={`relative rounded-2xl border-2 px-5 py-4 text-left shadow-sm transition-colors ${
                      d.tom === 'atencao' ? 'bg-amber-50' : 'bg-superficie'} ${
                      ativo ? 'border-marca-600' : 'border-transparent hover:border-slate-200'}`}>
              {d.bloco}
              {ativo && (
                <span aria-hidden className={`absolute -bottom-[9px] left-1/2 h-3.5 w-3.5 -translate-x-1/2 rotate-45
                                  border-b-2 border-r-2 border-marca-600 ${d.tom === 'atencao' ? 'bg-amber-50' : 'bg-superficie'}`} />
              )}
            </button>
          );
        })}
      </div>

      {destaques.map((d) => (
        <div key={d.chave} id={`detalhe-${d.chave}`} role="tabpanel" hidden={d.chave !== aberto}
             className={d.chave === aberto ? 'surgir' : undefined}>
          {d.detalhe}
        </div>
      ))}
    </div>
  );
}
