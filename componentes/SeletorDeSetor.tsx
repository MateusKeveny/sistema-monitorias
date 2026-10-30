'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/**
 * O setor da tela, no topo do menu (3.0, aprovado em 30/10/2026): escolhido
 * uma vez, vale para todas as telas por setor — no lugar das abas de setor
 * que cada tela tinha. Só aparece para quem vê dois ou mais setores.
 */
export default function SeletorDeSetor({ setores, atual }: {
  setores: { id: number; nome: string }[];
  atual: number;
}) {
  const router = useRouter();
  const caminho = usePathname();
  const busca = useSearchParams();
  if (setores.length < 2) return null;

  function escolher(id: string) {
    document.cookie = `setor=${id}; path=/; max-age=31536000; samesite=lax`;
    // Um ?setor= no endereço (vindo de um aviso, por exemplo) venceria o
    // seletor: sai, para a tela obedecer à escolha.
    const q = new URLSearchParams(busca.toString());
    q.delete('setor');
    router.replace(q.size ? `${caminho}?${q}` : caminho);
    router.refresh();
  }

  return (
    <label className="mx-1 mb-4 block">
      <span className="mb-1 block px-1.5 text-xs text-slate-500">Setor</span>
      <select value={atual} onChange={(e) => escolher(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-superficie px-3 py-2 text-sm font-semibold text-slate-800
                         outline-none focus:border-marca-600">
        {setores.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
      </select>
    </label>
  );
}
