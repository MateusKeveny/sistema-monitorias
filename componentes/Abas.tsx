'use client';

import { useState, type ReactNode } from 'react';

/**
 * Abas numa faixa própria (Comparativo, 1.17.0): a escolhida em verde claro.
 *
 * O conteúdo de todas já vem pronto do servidor; o clique só mostra uma e
 * esconde as outras, sem nova consulta. `inicial` vem da URL, para o atalho
 * "histórico ›" da tela inicial abrir direto na categoria certa.
 */
export default function Abas({ itens, inicial }: {
  itens: { chave: string; rotulo: string; conteudo: ReactNode }[];
  inicial?: string;
}) {
  const [aberta, setAberta] = useState(itens.some((i) => i.chave === inicial) ? inicial! : itens[0]?.chave);

  function escolher(chave: string) {
    setAberta(chave);
    // Mantém a categoria na URL para recarregar ou compartilhar, sem navegar.
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('cat', chave);
      window.history.replaceState(null, '', url);
    } catch { /* URL é só conveniência */ }
  }

  return (
    <div className="space-y-4">
      <div role="tablist" className="inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-slate-200 bg-superficie p-1 shadow-sm">
        {itens.map((i) => (
          <button key={i.chave} type="button" role="tab" aria-selected={i.chave === aberta}
                  onClick={() => escolher(i.chave)}
                  className={`whitespace-nowrap rounded-full px-4 py-1.5 text-sm transition-colors ${
                    i.chave === aberta ? 'bg-marca-600 font-semibold text-white' : 'font-medium text-slate-600 hover:text-slate-900'}`}>
            {i.rotulo}
          </button>
        ))}
      </div>
      {itens.map((i) => (
        <div key={i.chave} role="tabpanel" hidden={i.chave !== aberta} className={i.chave === aberta ? 'surgir' : undefined}>
          {i.conteudo}
        </div>
      ))}
    </div>
  );
}
