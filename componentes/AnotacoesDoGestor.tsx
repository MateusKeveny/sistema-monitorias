'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import type { AnotacaoGestor } from '@/lib/diario';

const entrada = `w-full rounded-xl border border-slate-300 bg-superficie px-3 py-2 text-sm outline-none
                 focus:border-marca-600 disabled:opacity-50`;
const rotulo = 'mb-1 block text-xs font-medium text-slate-600';
const botaoSecundario = `rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm font-medium
                         text-slate-700 hover:bg-slate-50 disabled:opacity-40`;
const nomeCurto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');
const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/**
 * Anotações do gestor (1.32.0): só quem tem papel gestor vê (RLS da migração
 * 43). "Sobre" liga a anotação a uma pessoa, e ela aparece também na ficha
 * dela em Atendentes. Cada gestor edita e apaga só as próprias.
 */
export default function AnotacoesDoGestor({
  anotacoes, nomes, pessoas, pessoaId, hoje,
}: {
  anotacoes: AnotacaoGestor[];
  nomes: Record<string, string>;
  /** Quem pode ser o "Sobre": a equipe ativa. */
  pessoas: { id: string; nome: string }[];
  pessoaId: string;
  hoje: string;
}) {
  const router = useRouter();
  const vazio = { data: hoje, sobre: '', assunto: '', texto: '' };
  const [f, setF] = useState(vazio);
  const [editando, setEditando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState('');

  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const lista = useMemo(() => anotacoes.filter((a) => !termo
    || [a.assunto, a.texto, nomes[a.sobre_pessoa_id ?? ''] ?? '', nomes[a.autor_id] ?? '']
      .some((t) => t.toLocaleLowerCase('pt-BR').includes(termo))), [anotacoes, termo, nomes]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!f.assunto.trim() || !f.texto.trim()) { setErro('Preencha o assunto e a anotação.'); return; }
    if (f.data > hoje) { setErro('O dia não pode ser depois de hoje.'); return; }
    setOcupado(true); setErro(null); setAviso(null);
    const campos = { data: f.data || hoje, sobre_pessoa_id: f.sobre || null, assunto: f.assunto.trim(), texto: f.texto.trim(),
                     atualizado_em: new Date().toISOString() };
    const db = criarClienteNavegador();
    const { error } = editando
      ? await db.from('diario_anotacoes').update(campos).eq('id', editando)
      : await db.from('diario_anotacoes').insert(campos);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setAviso(editando ? 'Anotação atualizada.' : 'Anotação salva.');
    setF(vazio); setEditando(null);
    router.refresh();
  }

  async function excluir(a: AnotacaoGestor) {
    if (!confirm(`Excluir a anotação "${a.assunto}"? Não dá para desfazer.`)) return;
    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().from('diario_anotacoes').delete().eq('id', a.id);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    router.refresh();
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      <section className="rounded-[18px] bg-superficie px-6 py-5 shadow-sm">
        <h2 className="text-base font-semibold text-slate-800">{editando ? 'Editar anotação' : 'Nova anotação'}</h2>
        <p className="mb-3 text-sm text-slate-500">Só quem tem papel de gestor vê.</p>
        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">🔒 Nem o Pleno nem os atendentes veem as anotações.</p>
        <form onSubmit={salvar} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className={rotulo}>Dia</span>
              <input type="date" value={f.data} max={hoje} disabled={ocupado} className={entrada}
                     onChange={(e) => setF((s) => ({ ...s, data: e.target.value }))} /></label>
            <label><span className={rotulo}>Sobre (opcional)</span>
              <select value={f.sobre} disabled={ocupado} className={entrada}
                      onChange={(e) => setF((s) => ({ ...s, sobre: e.target.value }))}>
                <option value="">Ninguém específico</option>
                {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select></label>
          </div>
          <label><span className={rotulo}>Assunto *</span>
            <input value={f.assunto} disabled={ocupado} className={entrada} placeholder="Em poucas palavras"
                   onChange={(e) => setF((s) => ({ ...s, assunto: e.target.value }))} /></label>
          <label><span className={rotulo}>Anotação *</span>
            <textarea value={f.texto} disabled={ocupado} rows={5} className={`${entrada} resize-y leading-relaxed`}
                      onChange={(e) => setF((s) => ({ ...s, texto: e.target.value }))} /></label>
          {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
          {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}
          <div className="flex justify-end gap-2">
            {editando && <button type="button" className={botaoSecundario} onClick={() => { setEditando(null); setF(vazio); }}>Cancelar</button>}
            <button type="submit" disabled={ocupado || !f.assunto.trim() || !f.texto.trim()}
                    className="rounded-xl bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
              {ocupado ? 'Salvando…' : editando ? 'Salvar alterações' : 'Salvar anotação'}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-[18px] bg-superficie px-6 py-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-800">Anotações</h2>
            <p className="text-sm text-slate-500">Da mais recente à mais antiga.</p>
          </div>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar assunto, texto ou pessoa…"
                 className="w-64 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm outline-none focus:border-marca-600" />
        </div>
        {lista.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">{anotacoes.length ? 'Nada encontrado.' : 'Nenhuma anotação ainda.'}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lista.map((a) => (
              <li key={a.id} className="grid gap-1 py-3.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <b className="font-semibold text-slate-800">{a.assunto}</b>
                  {a.sobre_pessoa_id && (
                    <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-semibold text-violet-700 dark:text-violet-300">
                      Sobre {nomes[a.sobre_pessoa_id] ?? '—'}
                    </span>
                  )}
                </div>
                <p className="whitespace-pre-line text-sm text-slate-700">{a.texto}</p>
                <p className="text-xs text-slate-500">{nomeCurto(nomes[a.autor_id] ?? '—')} · {dataBR(a.data)}</p>
                {a.autor_id === pessoaId && (
                  <div className="mt-1 flex gap-2">
                    <button type="button" className={botaoSecundario} disabled={ocupado}
                            onClick={() => { setEditando(a.id); setF({ data: a.data, sobre: a.sobre_pessoa_id ?? '', assunto: a.assunto, texto: a.texto });
                                             window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Editar</button>
                    <button type="button" className={botaoSecundario} disabled={ocupado} onClick={() => excluir(a)}>Excluir</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
