'use client';

import { useEffect, useState } from 'react';

type Tema = 'claro' | 'escuro';

/** Mesma chave usada pelo script inline do layout, que aplica o tema antes da pintura. */
export const CHAVE_TEMA = 'monitorias:tema';

export default function BotaoTema() {
  // Começa em null para não renderizar o ícone errado antes de saber o tema:
  // no servidor não existe localStorage, e chutar causaria um pisca na troca.
  const [tema, setTema] = useState<Tema | null>(null);

  useEffect(() => {
    setTema(document.documentElement.classList.contains('dark') ? 'escuro' : 'claro');
  }, []);

  function alternar() {
    const novo: Tema = tema === 'escuro' ? 'claro' : 'escuro';
    document.documentElement.classList.toggle('dark', novo === 'escuro');
    try {
      localStorage.setItem(CHAVE_TEMA, novo);
    } catch {
      // Navegador com armazenamento bloqueado: o tema vale só nesta navegação.
    }
    setTema(novo);
  }

  const escuro = tema === 'escuro';

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={escuro ? 'Mudar para o modo claro' : 'Mudar para o modo escuro'}
      title={escuro ? 'Modo claro' : 'Modo escuro'}
      className="rounded-lg border border-slate-300 p-1.5 text-slate-600
                 hover:bg-slate-50 hover:text-slate-900"
    >
      {/* Sem tema definido ainda, o botão fica com o espaço reservado e sem ícone. */}
      <span className="block h-4 w-4">
        {tema === null ? null : escuro ? (
          // Sol
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" className="h-4 w-4">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2
                     M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
          </svg>
        ) : (
          // Lua
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
          </svg>
        )}
      </span>
    </button>
  );
}
