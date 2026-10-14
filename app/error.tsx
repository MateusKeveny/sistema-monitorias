'use client';

import { startTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Tela mostrada quando algo falha no servidor. Sem ela o Next exibe a própria
 * página de erro, em inglês e sem caminho de volta.
 */
export default function Erro({ reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  // "Tentar de novo" busca os dados de novo no servidor (1.41.1). Só o
  // `reset()` redesenhava a página com o mesmo erro: numa falha do banco ou
  // num 1102, o botão não fazia nada.
  const tentarDeNovo = () => startTransition(() => { router.refresh(); reset(); });
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md rounded-2xl border border-slate-200 bg-superficie p-8 text-center shadow-xl">
        <h1 className="text-xl font-semibold text-slate-900">Algo deu errado</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          Não conseguimos carregar esta página. Se o problema continuar, use o
          botão Reportar problema, no menu, contando o que você estava fazendo.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={tentarDeNovo}
            className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white
                       hover:bg-marca-700"
          >
            Tentar de novo
          </button>
          <a
            href="/"
            className="rounded-lg border border-slate-300 bg-superficie px-4 py-2 text-sm
                       font-medium text-slate-700 hover:bg-slate-50"
          >
            Ir para o painel
          </a>
        </div>
      </div>
    </main>
  );
}
