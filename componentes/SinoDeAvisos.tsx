'use client';

import { useEffect, useRef, useState } from 'react';
import Link from '@/componentes/Link';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { dataHora } from '@/lib/formatar';

type Aviso = { id: number; titulo: string; texto: string | null; link: string | null; criado_em: string; lido_em: string | null };

/**
 * O sino (2.3.0, migração 74): avisos da pessoa no próprio painel — semana
 * lançada e valor do mês. Lido no navegador ao abrir a tela; abrir a lista
 * marca tudo como lido.
 */
export default function SinoDeAvisos() {
  const [avisos, setAvisos] = useState<Aviso[] | null>(null);
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    criarClienteNavegador().from('avisos_da_pessoa').select('id, titulo, texto, link, criado_em, lido_em')
      .order('criado_em', { ascending: false }).limit(20)
      .then(({ data }) => setAvisos((data ?? []) as Aviso[]));
  }, []);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (caixa.current && !caixa.current.contains(e.target as Node)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const novos = (avisos ?? []).filter((a) => !a.lido_em).length;

  function abrir() {
    const vai = !aberto;
    setAberto(vai);
    if (vai && novos) {
      criarClienteNavegador().rpc('marcar_avisos_lidos').then(({ error }) => {
        if (!error) setAvisos((l) => (l ?? []).map((a) => ({ ...a, lido_em: a.lido_em ?? 'agora' })));
      });
    }
  }

  return (
    <div ref={caixa} className="relative">
      <button type="button" onClick={abrir} aria-label={novos ? `Avisos: ${novos} novo(s)` : 'Avisos'} aria-expanded={aberto}
              className="relative grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800">
        <svg viewBox="0 0 20 20" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 8a5 5 0 0 1 10 0c0 4 1.5 5.5 2 6H3c.5-.5 2-2 2-6Z" /><path d="M8.5 17a1.6 1.6 0 0 0 3 0" />
        </svg>
        {novos > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {novos}
          </span>
        )}
      </button>
      {aberto && (
        // Fixo, ao lado do menu: dentro do menu lateral a lista seria cortada.
        <div className="fixed left-[15.5rem] top-4 z-50 w-[22rem] rounded-2xl border border-slate-200 bg-superficie p-2 shadow-xl">
          <p className="px-2 py-1.5 text-sm font-semibold text-slate-900">Avisos</p>
          {!avisos?.length ? (
            <p className="px-2 pb-3 text-sm text-slate-500">Nada por aqui ainda. Quando a semana for lançada ou o valor do mês sair, aparece aqui.</p>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto">
              {avisos.map((a) => {
                const conteudo = (
                  <>
                    <span className="flex items-start gap-2">
                      {!a.lido_em || a.lido_em === 'agora'
                        ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-marca-600" /> : <span className="w-2 shrink-0" />}
                      <span>
                        <b className="block text-sm font-semibold text-slate-900">{a.titulo}</b>
                        {a.texto && <span className="block text-[13px] text-slate-600">{a.texto}</span>}
                        <span className="block text-[11px] text-slate-400">{dataHora(a.criado_em)}</span>
                      </span>
                    </span>
                  </>
                );
                return (
                  <li key={a.id} className="border-t border-slate-100 first:border-t-0">
                    {a.link
                      ? <Link href={a.link} onClick={() => setAberto(false)} className="block rounded-xl px-2 py-2 hover:bg-slate-50">{conteudo}</Link>
                      : <div className="px-2 py-2">{conteudo}</div>}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
