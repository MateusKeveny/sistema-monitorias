'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Quadro } from '@/componentes/ui';
import { mesDeCompetencia, mesRotulo } from '@/lib/formatar';

export type NotaGuardada = {
  nome_no_arquivo: string;
  nome_normalizado: string;
  data: string;
  nota: number;
  origem_arquivo: string | null;
  importado_em: string;
};

type Resultado = { quantidade: number; meses: string[]; fechados: string[] };

/**
 * Notas guardadas (1.34.0): avaliações de atendentes que o relatório trouxe
 * com um nome que nenhuma ficha reconhece (migração 45). Não contam na cota
 * até serem atribuídas. Gravar o nome como Nome no Hub, na ficha ou aqui, faz
 * elas entrarem sozinhas.
 */
export default function NotasGuardadas({
  notas, pessoas,
}: {
  notas: NotaGuardada[];
  pessoas: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [escolha, setEscolha] = useState<Record<string, { pessoa: string; gravar: boolean }>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Um grupo por nome (sem acento/maiúscula), com a grafia mais comum.
  const grupos = [...notas.reduce((m, n) => {
    const g = m.get(n.nome_normalizado) ?? { nome: n.nome_no_arquivo, notas: [0, 0, 0, 0, 0], meses: new Set<string>(), arquivos: new Set<string>(), total: 0 };
    g.notas[n.nota - 1]++; g.total++; g.meses.add(mesDeCompetencia(n.data));
    if (n.origem_arquivo) g.arquivos.add(n.origem_arquivo);
    return m.set(n.nome_normalizado, g);
  }, new Map<string, { nome: string; notas: number[]; meses: Set<string>; arquivos: Set<string>; total: number }>())]
    .sort((a, b) => b[1].total - a[1].total);

  const descrever = (r: Resultado) =>
    `${r.quantidade} nota${r.quantidade > 1 ? 's' : ''} entr${r.quantidade > 1 ? 'aram' : 'ou'} na cota (${r.meses.map((m) => mesRotulo(m)).join(', ')}).`
    + (r.fechados.length ? ` ${r.fechados.map((m) => mesRotulo(m)).join(', ')} já ${r.fechados.length > 1 ? 'estão fechados' : 'está fechado'}: o fechamento não muda sozinho.` : '');

  async function atribuir(chave: string, nome: string) {
    const e = escolha[chave];
    if (!e?.pessoa) return;
    setOcupado(chave); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    const { data, error } = e.gravar
      ? await db.rpc('salvar_nome_hub', { p_pessoa: e.pessoa, p_nome: nome, p_extra: true })
      : await db.rpc('atribuir_guardadas', { p_nome: nome, p_pessoa: e.pessoa });
    setOcupado(null);
    if (error) { setErro(error.message); return; }
    setAviso(`"${nome}" → ${pessoas.find((p) => p.id === e.pessoa)?.nome}: ${descrever(data as Resultado)}`);
    router.refresh();
  }

  async function descartar(nome: string, total: number) {
    if (!confirm(`Descartar as ${total} nota(s) guardada(s) de "${nome}"? Elas não entram na cota, e o descarte fica registrado.`)) return;
    setOcupado(nome); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().rpc('descartar_guardadas', { p_nome: nome });
    setOcupado(null);
    if (error) { setErro(error.message); return; }
    setAviso(`Notas de "${nome}" descartadas.`);
    router.refresh();
  }

  return (
    <Quadro titulo="Notas guardadas sem atendente">
      <p className="mb-3 text-sm text-slate-600">
        Vieram nos relatórios com um nome que nenhuma ficha tem como Nome no Hub. Não contam na cota até serem atribuídas.
      </p>
      {aviso && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}
      {erro && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}

      {grupos.length === 0 ? (
        <p className="py-6 text-center text-sm text-slate-500">Nenhuma nota guardada. Todas as avaliações importadas têm atendente reconhecido.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {grupos.map(([chave, g]) => {
            const e = escolha[chave] ?? { pessoa: '', gravar: true };
            return (
              <li key={chave} className="grid gap-2 py-3.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <b className="font-semibold text-slate-800">&quot;{g.nome}&quot;</b>
                  <span className="text-slate-500">{g.total} nota{g.total > 1 ? 's' : ''} · {[...g.meses].sort().map((m) => mesRotulo(m)).join(', ')}</span>
                  <span className="flex gap-1 text-xs tabular-nums">
                    {g.notas.map((q, i) => <span key={i} className="rounded-md bg-slate-100 px-1.5 text-slate-600">{i + 1}: {q}</span>)}
                  </span>
                </div>
                <p className="text-xs text-slate-500">De {[...g.arquivos].join(', ') || 'relatório sem nome'}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <select value={e.pessoa} disabled={!!ocupado}
                          onChange={(ev) => setEscolha((s) => ({ ...s, [chave]: { ...e, pessoa: ev.target.value } }))}
                          className="rounded-lg border border-slate-300 bg-superficie px-2.5 py-1.5 text-sm">
                    <option value="">Atribuir a…</option>
                    {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                  <label className="flex items-center gap-1.5 text-xs text-slate-600">
                    <input type="checkbox" checked={e.gravar} disabled={!!ocupado}
                           onChange={(ev) => setEscolha((s) => ({ ...s, [chave]: { ...e, gravar: ev.target.checked } }))} />
                    Gravar &quot;{g.nome}&quot; como mais um Nome no Hub da pessoa
                  </label>
                  <button type="button" disabled={!!ocupado || !e.pessoa} onClick={() => atribuir(chave, g.nome)}
                          className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
                    {ocupado === chave ? 'Atribuindo…' : `Atribuir ${g.total} nota${g.total > 1 ? 's' : ''}`}
                  </button>
                  <button type="button" disabled={!!ocupado} onClick={() => descartar(g.nome, g.total)}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                    Descartar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Quadro>
  );
}
