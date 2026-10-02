'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import type { Subcategoria } from '@/lib/diario';

const entrada = `min-w-0 flex-1 rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm outline-none
                 focus:border-marca-600 disabled:opacity-50`;
const botaoSecundario = `rounded-lg border border-slate-300 bg-superficie px-2.5 py-1.5 text-sm font-medium
                         text-slate-700 hover:bg-slate-50 disabled:opacity-40`;

/**
 * Subcategorias de problema operacional (1.35.0, migração 46). O gestor inclui,
 * renomeia, reordena e desativa. Desativada sai do formulário do diário, mas
 * continua aparecendo nos registros antigos — por isso não há excluir.
 */
export default function SubcategoriasDiario({ subcategorias, usos }: {
  subcategorias: Subcategoria[];
  /** Quantos registros usam cada subcategoria. */
  usos: Record<number, number>;
}) {
  const router = useRouter();
  const [nomes, setNomes] = useState<Record<number, string>>(Object.fromEntries(subcategorias.map((s) => [s.id, s.nome])));
  const [nova, setNova] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const lista = [...subcategorias].sort((a, b) => a.ordem - b.ordem || a.id - b.id);

  async function executar(acao: () => PromiseLike<{ error: { message: string } | null }>) {
    setOcupado(true); setErro(null);
    const { error } = await acao();
    setOcupado(false);
    if (error) { setErro(/duplicate|unique/i.test(error.message) ? 'Já existe uma subcategoria com esse nome.' : error.message); return false; }
    router.refresh();
    return true;
  }
  const db = () => criarClienteNavegador().from('diario_subcategorias');

  // Troca a ordem com a vizinha; as ordens são renumeradas 1, 2, 3… na hora.
  async function mover(i: number, para: number) {
    const nova = [...lista];
    [nova[i], nova[para]] = [nova[para], nova[i]];
    setOcupado(true); setErro(null);
    for (const [n, s] of nova.entries()) {
      if (s.ordem === n + 1) continue;
      const { error } = await db().update({ ordem: n + 1 }).eq('id', s.id);
      if (error) { setErro(error.message); break; }
    }
    setOcupado(false);
    router.refresh();
  }

  return (
    <section className="max-w-3xl rounded-[18px] bg-superficie px-6 py-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-800">Subcategorias de problema operacional</h2>
      <p className="mb-4 text-sm text-slate-500">
        A gestão escolhe uma delas ao registrar um problema operacional no diário. Desativar tira do formulário, mas os
        registros antigos continuam mostrando o nome.
      </p>

      <ul className="divide-y divide-slate-100">
        {lista.map((s, i) => (
          <li key={s.id} className={`flex flex-wrap items-center gap-2 py-2.5 ${s.ativo ? '' : 'opacity-60'}`}>
            <span className="flex flex-col">
              <button type="button" aria-label={`Subir ${s.nome}`} disabled={ocupado || i === 0} onClick={() => mover(i, i - 1)}
                      className="px-1 text-xs text-slate-500 hover:text-slate-900 disabled:opacity-30">▲</button>
              <button type="button" aria-label={`Descer ${s.nome}`} disabled={ocupado || i === lista.length - 1} onClick={() => mover(i, i + 1)}
                      className="px-1 text-xs text-slate-500 hover:text-slate-900 disabled:opacity-30">▼</button>
            </span>
            <input value={nomes[s.id] ?? s.nome} disabled={ocupado} className={entrada} aria-label={`Nome de ${s.nome}`}
                   onChange={(e) => setNomes((n) => ({ ...n, [s.id]: e.target.value }))} />
            {(nomes[s.id] ?? s.nome).trim() !== s.nome && (
              <button type="button" disabled={ocupado || !(nomes[s.id] ?? s.nome).trim()} className={botaoSecundario}
                      onClick={() => executar(() => db().update({ nome: nomes[s.id].trim() }).eq('id', s.id))}>Salvar nome</button>
            )}
            <span className="w-24 text-right text-xs tabular-nums text-slate-500">{usos[s.id] ?? 0} registro{(usos[s.id] ?? 0) === 1 ? '' : 's'}</span>
            <button type="button" disabled={ocupado} className={botaoSecundario}
                    onClick={() => executar(() => db().update({ ativo: !s.ativo }).eq('id', s.id))}>
              {s.ativo ? 'Desativar' : 'Reativar'}
            </button>
          </li>
        ))}
      </ul>

      <form className="mt-3 flex gap-2" onSubmit={async (e) => {
        e.preventDefault();
        if (!nova.trim()) return;
        const ok = await executar(() => db().insert({ nome: nova.trim(), ordem: lista.length + 1 }));
        if (ok) setNova('');
      }}>
        <input value={nova} disabled={ocupado} onChange={(e) => setNova(e.target.value)} placeholder="Nova subcategoria" className={entrada} />
        <button type="submit" disabled={ocupado || !nova.trim()}
                className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
          Incluir
        </button>
      </form>
      {erro && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
    </section>
  );
}
