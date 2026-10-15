'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { ddmm, duracao, sobreposicoes, somar, type PeriodoDeFerias } from '@/lib/ferias';

type Pessoa = { id: string; nome: string };
export type FeriasCadastrada = PeriodoDeFerias & { pessoa_id: string; observacao: string | null };

// Saída e quantidade de dias; o último dia sai da conta (fimDe).
type Rascunho = { id?: string; pessoa_id: string; inicio: string; dias: number; situacao: 'planejada' | 'aprovada'; observacao: string };
const vazio: Rascunho = { pessoa_id: '', inicio: '', dias: 30, situacao: 'aprovada', observacao: '' };
const fimDe = (r: Rascunho) => (r.inicio && r.dias > 0 ? somar(r.inicio, r.dias - 1) : '');
const ATALHOS = [5, 10, 15, 20, 30];

/**
 * Cadastro das férias da equipe (61-ferias.sql), só gestor: a pessoa, a
 * saída e quantos dias. Enquanto se preenche, a tela já diz se outra pessoa
 * está fora no mesmo período. Planejada se aprova direto da lista.
 */
export default function GestaoDeFerias({ pessoas, ferias, hoje }: {
  pessoas: Pessoa[];
  ferias: FeriasCadastrada[];
  hoje: string;
}) {
  const router = useRouter();
  const [r, setR] = useState<Rascunho>(vazio);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [verPassadas, setVerPassadas] = useState(false);

  const nome = (id: string) => pessoas.find((p) => p.id === id)?.nome ?? '';
  const fim = fimDe(r);
  const valido = !!(r.pessoa_id && r.inicio && r.dias >= 1 && r.dias <= 60);

  // Quem mais está fora no período que está sendo preenchido.
  const conflitos = useMemo(() => {
    if (!valido) return [];
    const novo: PeriodoDeFerias = { id: 'novo', pessoa: nome(r.pessoa_id), inicio: r.inicio, fim };
    return sobreposicoes([...ferias.filter((f) => f.id !== r.id), novo], '0000-01-01')
      .filter((s) => s.a.id === 'novo' || s.b.id === 'novo')
      .map((s) => ({ outro: s.a.id === 'novo' ? s.b : s.a, inicio: s.inicio, fim: s.fim }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, ferias, valido]);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!valido) { setErro('Escolha a pessoa, a saída e de 1 a 60 dias.'); return; }
    setOcupado(true); setErro(null);
    const linha = { pessoa_id: r.pessoa_id, inicio: r.inicio, fim, situacao: r.situacao, observacao: r.observacao.trim() || null };
    const db = criarClienteNavegador();
    const { error } = r.id ? await db.from('ferias').update(linha).eq('id', r.id) : await db.from('ferias').insert(linha);
    setOcupado(false);
    if (error) { setErro(`Não foi possível salvar: ${error.message}`); return; }
    setR(vazio);
    router.refresh();
  }

  // Planejada → aprovada, direto da lista.
  async function aprovar(f: FeriasCadastrada) {
    const { error } = await criarClienteNavegador().from('ferias').update({ situacao: 'aprovada' }).eq('id', f.id);
    if (error) { alert(error.message); return; }
    router.refresh();
  }

  async function excluir(f: FeriasCadastrada) {
    if (!confirm(`Excluir as férias de ${f.pessoa} (${ddmm(f.inicio)} a ${ddmm(f.fim)})?`)) return;
    const { error } = await criarClienteNavegador().from('ferias').delete().eq('id', f.id);
    if (error) { alert(error.message); return; }
    if (r.id === f.id) setR(vazio);
    router.refresh();
  }

  const lista = ferias.filter((f) => verPassadas || f.fim >= hoje).sort((a, b) => a.inicio.localeCompare(b.inicio));
  const campo = 'w-full rounded-lg border border-slate-300 bg-superficie px-3 py-2 text-sm text-slate-900';
  const rotulo = 'mb-1 block text-xs font-medium text-slate-600';

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
      <form onSubmit={salvar} className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-800">{r.id ? 'Editar férias' : 'Cadastrar férias'}</h3>
        <div>
          <label className={rotulo} htmlFor="pessoa">Pessoa</label>
          <select id="pessoa" className={campo} value={r.pessoa_id} onChange={(e) => setR({ ...r, pessoa_id: e.target.value })}>
            <option value="">Escolha…</option>
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-[1fr_6rem] gap-3">
          <div>
            <label className={rotulo} htmlFor="inicio">Saída (1º dia)</label>
            <input id="inicio" type="date" className={campo} value={r.inicio} onChange={(e) => setR({ ...r, inicio: e.target.value })} />
          </div>
          <div>
            <label className={rotulo} htmlFor="dias">Dias</label>
            <input id="dias" type="number" min={1} max={60} className={campo} value={r.dias || ''}
                   onChange={(e) => setR({ ...r, dias: Math.min(60, Math.max(0, Number(e.target.value) || 0)) })} />
          </div>
        </div>
        <div className="-mt-1 flex flex-wrap gap-1.5">
          {ATALHOS.map((n) => (
            <button key={n} type="button" onClick={() => setR({ ...r, dias: n })} aria-pressed={r.dias === n}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${r.dias === n
                      ? 'bg-marca-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {n} dias
            </button>
          ))}
        </div>
        {fim && <p className="text-xs text-slate-500">Até {ddmm(fim)} · volta em {ddmm(somar(fim, 1))}</p>}
        <div>
          <label className={rotulo} htmlFor="situacao">Situação</label>
          <select id="situacao" className={campo} value={r.situacao}
                  onChange={(e) => setR({ ...r, situacao: e.target.value as Rascunho['situacao'] })}>
            <option value="aprovada">Aprovada</option>
            <option value="planejada">Planejada (ainda não aprovada)</option>
          </select>
        </div>
        <div>
          <label className={rotulo} htmlFor="obs">Observação <span className="font-normal text-slate-400">(opcional)</span></label>
          <input id="obs" className={campo} maxLength={500} value={r.observacao} onChange={(e) => setR({ ...r, observacao: e.target.value })} />
        </div>

        {conflitos.length > 0 && (
          <div role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-300">
            <p className="font-semibold">Outra pessoa fora no mesmo período</p>
            <ul className="mt-1 space-y-0.5">
              {conflitos.map((c) => (
                <li key={c.outro.id}>{c.outro.pessoa}: {ddmm(c.inicio)} a {ddmm(c.fim)}{c.outro.situacao === 'planejada' ? ' (planejada)' : ''}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs">Dá para salvar assim mesmo; o aviso também vai para a agenda.</p>
          </div>
        )}
        {erro && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{erro}</p>}

        <div className="flex gap-2">
          <button type="submit" disabled={ocupado}
                  className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-60">
            {ocupado ? 'Salvando…' : r.id ? 'Salvar alterações' : 'Cadastrar'}
          </button>
          {r.id && (
            <button type="button" onClick={() => setR(vazio)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancelar</button>
          )}
        </div>
      </form>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-800">Cadastradas</h3>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" checked={verPassadas} onChange={(e) => setVerPassadas(e.target.checked)} /> mostrar as que já passaram
          </label>
        </div>
        {!lista.length ? <p className="py-6 text-center text-sm text-slate-500">Nenhuma férias cadastrada.</p> : (
          <ul className="divide-y divide-slate-100">
            {lista.map((f) => {
              const agora = f.inicio <= hoje && f.fim >= hoje;
              return (
                <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="min-w-40 flex-1 font-medium text-slate-800">{f.pessoa}</span>
                  <span className="tabular-nums text-slate-600">{ddmm(f.inicio)} a {ddmm(f.fim)} · {duracao(f)} dias</span>
                  {agora && <span className="rounded bg-marca-50 px-1.5 py-px text-xs font-medium text-marca-700 dark:text-marca-400">de férias agora</span>}
                  {f.situacao === 'planejada' && <span className="rounded bg-amber-100 px-1.5 py-px text-xs font-medium text-amber-800">planejada</span>}
                  {f.observacao && <span className="w-full text-xs text-slate-500">{f.observacao}</span>}
                  <span className="ml-auto flex gap-1">
                    {f.situacao === 'planejada' && (
                      <button onClick={() => aprovar(f)}
                              className="rounded px-2 py-1 text-xs font-semibold text-marca-700 hover:bg-marca-50 dark:text-marca-400">Aprovar</button>
                    )}
                    <button onClick={() => setR({ id: f.id, pessoa_id: f.pessoa_id, inicio: f.inicio, dias: duracao(f),
                                                   situacao: f.situacao ?? 'aprovada', observacao: f.observacao ?? '' })}
                            className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100">Editar</button>
                    <button onClick={() => excluir(f)} className="rounded px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50">Excluir</button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
