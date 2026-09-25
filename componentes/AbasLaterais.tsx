'use client';

import { useState, type ReactNode } from 'react';

/**
 * Menu lateral de temas, com um painel por vez.
 *
 * A Configuração empilhava cargos, métricas e pessoas numa página só, e a
 * pessoa rolava a tela inteira para achar um campo. Todos os painéis vêm
 * prontos do servidor; a aba só mostra um e esconde os outros — trocar de
 * tema não recarrega nada.
 */
export default function AbasLaterais({
  abas,
}: {
  abas: { chave: string; rotulo: string; descricao?: string; painel: ReactNode }[];
}) {
  const [atual, setAtual] = useState(abas[0]?.chave);

  return (
    <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
      <nav aria-label="Temas da configuração"
           className="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
        {abas.map((a) => (
          <button
            key={a.chave} type="button" aria-current={atual === a.chave}
            onClick={() => setAtual(a.chave)}
            className={`shrink-0 rounded-lg px-3 py-2 text-left text-sm transition lg:shrink ${
              atual === a.chave
                ? 'bg-marca-50 font-semibold text-marca-700 ring-1 ring-inset ring-marca-600/30 dark:text-marca-400'
                : 'text-slate-600 hover:bg-slate-50'}`}
          >
            {a.rotulo}
            {a.descricao && (
              <span className="mt-0.5 hidden text-xs font-normal text-slate-500 lg:block">
                {a.descricao}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="min-w-0">
        {abas.map((a) => (
          <div key={a.chave} hidden={atual !== a.chave} className="space-y-6">
            {a.painel}
          </div>
        ))}
      </div>
    </div>
  );
}
