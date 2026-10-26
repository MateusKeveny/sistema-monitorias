'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

/**
 * Faixa da cópia de teste (painel-performance-teste): o gestor escolhe um
 * atendente e vê o Início dele, para acompanhar uma mudança antes de ir ao
 * site oficial. Não existe no site oficial (só com COPIA_DE_TESTE=1).
 */
export default function VerComoAtendente({ atual }: { atual?: string }) {
  const router = useRouter();
  const [pessoas, setPessoas] = useState<{ id: string; nome: string }[]>([]);

  useEffect(() => {
    criarClienteNavegador().from('pessoas').select('id, nome').eq('avaliado', true).eq('ativo', true).order('nome')
      .then(({ data }) => setPessoas((data ?? []) as { id: string; nome: string }[]));
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/50 bg-amber-500/10 px-4 py-2.5 text-sm text-sobre-fundo">
      <b className="text-amber-300">Cópia de teste</b>
      <span className="text-sobre-fundo-suave">— mesmo banco do site oficial: o que for gravado aqui vale lá.</span>
      <label className="ml-auto flex items-center gap-2">
        Ver como
        <select value={atual ?? ''} onChange={(e) => router.push(e.target.value ? `/cota?ver_como=${e.target.value}` : '/cota')}
                className="rounded-md border border-slate-300 bg-superficie px-2 py-1 text-sm text-slate-900">
          <option value="">Gestor (eu)</option>
          {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </label>
    </div>
  );
}
