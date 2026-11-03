'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import { mesRotulo } from '@/lib/formatar';

export type GalhoDoSetor = {
  id: number;
  nome: string;
  monitorias: boolean;
  gestao: string[];
  qualidade: string[];
  filas: { nome: string; tmePorPessoa: boolean }[];
  atendentes: { id: string; nome: string; cargo: string | null }[];
  /** Os cargos do setor: quem chega de outro setor escolhe um deles. */
  cargos: { id: number; nome: string }[];
};

type Mudanca = { pessoa: { id: string; nome: string }; de: number; para: string; desde: string; cargo: string };

/**
 * A operação como organograma (3.2.0): a raiz, os setores e, em cada setor,
 * gestão, qualidade, filas e atendentes, ligados por linhas. O administrador
 * move atendentes entre setores a partir de um mês (o histórico anterior fica
 * no setor antigo).
 */
export default function ArvoreDeSetores({
  galhos, administrador, administradores, mesAtual,
}: {
  galhos: GalhoDoSetor[];
  administrador: boolean;
  administradores: string[];
  mesAtual: string;
}) {
  const router = useRouter();
  const [abertos, setAbertos] = useState<Set<number>>(new Set(galhos.length === 1 ? [galhos[0].id] : []));
  const [mudanca, setMudanca] = useState<Mudanca | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const alternar = (id: number) => setAbertos((a) => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function mover() {
    if (!mudanca) return;
    const destino = galhos.find((g) => String(g.id) === mudanca.para);
    if (!destino) return;
    setOcupado(true); setErro(null);
    const db = criarClienteNavegador();
    const desde = `${mudanca.desde}-01`;
    const { error } = await db.from('setores_da_pessoa')
      .upsert({ pessoa_id: mudanca.pessoa.id, desde, setor_id: destino.id }, { onConflict: 'pessoa_id,desde' });
    const { error: e2 } = !error && mudanca.cargo
      ? await db.from('cargos_da_pessoa').upsert({ pessoa_id: mudanca.pessoa.id, desde, cargo_id: Number(mudanca.cargo) },
                                                 { onConflict: 'pessoa_id,desde' })
      : { error: null };
    setOcupado(false);
    if (error || e2) { setErro(await mensagemDoErro((error ?? e2)!)); return; }
    setAviso(`${mudanca.pessoa.nome} passa para ${destino.nome} a partir de ${mesRotulo(desde)}. Os meses anteriores continuam no setor antigo.`);
    setMudanca(null);
    router.refresh();
  }

  const caixa = 'inline-block min-w-36 rounded-2xl border bg-superficie px-4 py-2.5 text-left shadow-sm';
  const titulo = 'block text-[11px] font-semibold uppercase tracking-wider text-slate-400';

  return (
    <div className="space-y-4">
      {/* Linhas do organograma: cada nó liga ao pai por uma linha vertical e
          os irmãos por uma horizontal. */}
      <style>{`
        .arvore ul { display: flex; justify-content: center; padding-top: 22px; position: relative; margin: 0; }
        .arvore li { list-style: none; position: relative; padding: 22px 6px 0; text-align: center; }
        .arvore li::before, .arvore li::after { content: ''; position: absolute; top: 0; right: 50%; width: 50%; height: 22px;
          border-top: 2px solid var(--linha); }
        .arvore li::after { right: auto; left: 50%; border-left: 2px solid var(--linha); }
        .arvore li:only-child::before, .arvore li:only-child::after { display: none; }
        .arvore li:only-child { padding-top: 0; }
        .arvore li:first-child::before, .arvore li:last-child::after { border: 0 none; }
        .arvore li:last-child::before { border-right: 2px solid var(--linha); border-radius: 0 8px 0 0; }
        .arvore li:first-child::after { border-radius: 8px 0 0 0; }
        .arvore ul ul::before { content: ''; position: absolute; top: 0; left: 50%; height: 22px; border-left: 2px solid var(--linha); }
        .arvore > ul { padding-top: 0; }
      `}</style>

      {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

      <div className="overflow-x-auto rounded-[20px] bg-slate-50/60 p-6">
        <div className="arvore min-w-max [--linha:var(--color-slate-300)]">
          <ul>
            <li>
              <span className={`${caixa} border-marca-600/50`}>
                <span className={titulo}>Operação</span>
                <b className="block text-base text-slate-900">{galhos.length} {galhos.length === 1 ? 'setor' : 'setores'}</b>
                {administradores.length > 0 && (
                  <span className="block text-xs text-slate-500">Administrador: {administradores.join(', ')}</span>
                )}
              </span>
              <ul>
                {galhos.map((g) => {
                  const aberto = abertos.has(g.id);
                  const total = g.gestao.length + g.qualidade.length + g.atendentes.length;
                  return (
                    <li key={g.id}>
                      <button type="button" onClick={() => alternar(g.id)} aria-expanded={aberto}
                              className={`${caixa} ${aberto ? 'border-marca-600' : 'border-slate-200 hover:border-slate-300'}`}>
                        <span className={titulo}>Setor {aberto ? '▾' : '▸'}</span>
                        <b className="block text-base text-slate-900">{g.nome}</b>
                        <span className="block text-xs text-slate-500">
                          {total} pessoas · {g.filas.length} {g.filas.length === 1 ? 'fila' : 'filas'}{g.monitorias ? ' · monitorias' : ''}
                        </span>
                      </button>
                      {aberto && (
                        <ul>
                          <li>
                            <span className={`${caixa} border-slate-200`}>
                              <span className={titulo}>Gestão</span>
                              {g.gestao.length ? g.gestao.map((n) => <span key={n} className="block text-sm text-slate-800">{n}</span>)
                                : <span className="block text-sm text-amber-700">sem gestor</span>}
                            </span>
                          </li>
                          <li>
                            <span className={`${caixa} border-slate-200`}>
                              <span className={titulo}>Qualidade</span>
                              {g.qualidade.length ? g.qualidade.map((n) => <span key={n} className="block text-sm text-slate-800">{n}</span>)
                                : <span className="block text-sm text-slate-400">—</span>}
                            </span>
                          </li>
                          <li>
                            <span className={`${caixa} border-slate-200`}>
                              <span className={titulo}>Filas</span>
                              {g.filas.length ? g.filas.map((f) => (
                                <span key={f.nome} className="block text-sm text-slate-800">
                                  {f.nome}{f.tmePorPessoa && <span className="ml-1 text-xs text-slate-400">· TME por pessoa</span>}
                                </span>
                              )) : <span className="block text-sm text-slate-400">—</span>}
                            </span>
                          </li>
                          <li>
                            <span className={`${caixa} border-slate-200`}>
                              <span className={titulo}>Atendentes · {g.atendentes.length}</span>
                              {g.atendentes.map((a) => (
                                <span key={a.id} className="flex items-baseline justify-between gap-3 text-sm text-slate-800">
                                  <span>{a.nome}{a.cargo && <span className="ml-1 text-xs text-slate-400">{a.cargo.replace(/^Atendente\s+/, '')}</span>}</span>
                                  {administrador && galhos.length > 1 && (
                                    <button type="button" disabled={ocupado}
                                            onClick={() => { setErro(null); setAviso(null); setMudanca({
                                              pessoa: { id: a.id, nome: a.nome }, de: g.id,
                                              para: String(galhos.find((x) => x.id !== g.id)!.id), desde: mesAtual.slice(0, 7), cargo: '' }); }}
                                            className="text-xs text-marca-700 hover:underline dark:text-marca-400">mover</button>
                                  )}
                                </span>
                              ))}
                              {!g.atendentes.length && <span className="block text-sm text-slate-400">—</span>}
                            </span>
                          </li>
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          </ul>
        </div>
      </div>

      {mudanca && (() => {
        const destino = galhos.find((x) => String(x.id) === mudanca.para);
        return (
          <div className="rounded-[20px] border border-marca-600/40 bg-superficie p-5 shadow-sm">
            <h2 className="font-semibold text-slate-900">Mover {mudanca.pessoa.nome} para outro setor</h2>
            <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
              <label className="flex flex-col gap-1 text-slate-600">Para o setor
                <select value={mudanca.para} disabled={ocupado} onChange={(e) => setMudanca({ ...mudanca, para: e.target.value, cargo: '' })}
                        className="rounded-lg border border-slate-300 bg-superficie px-2 py-1.5">
                  {galhos.filter((x) => x.id !== mudanca.de).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-slate-600">A partir de
                <input type="month" value={mudanca.desde} min={mesAtual.slice(0, 7)} disabled={ocupado}
                       onChange={(e) => setMudanca({ ...mudanca, desde: e.target.value })}
                       className="rounded-lg border border-slate-300 bg-superficie px-2 py-1.5" />
              </label>
              <label className="flex flex-col gap-1 text-slate-600">Cargo no setor novo
                <select value={mudanca.cargo} disabled={ocupado} onChange={(e) => setMudanca({ ...mudanca, cargo: e.target.value })}
                        className="rounded-lg border border-slate-300 bg-superficie px-2 py-1.5">
                  <option value="">Escolha…</option>
                  {destino?.cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </label>
              <button type="button" onClick={mover} disabled={ocupado || !mudanca.cargo || !mudanca.desde}
                      className="rounded-lg bg-marca-600 px-4 py-1.5 font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
                {ocupado ? 'Movendo…' : 'Mover'}
              </button>
              <button type="button" onClick={() => setMudanca(null)} className="text-xs text-slate-500 hover:underline">cancelar</button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Cada setor tem os próprios cargos: escolha o do setor novo. Os meses antes da mudança continuam no setor antigo,
              com o cargo de lá; mês já fechado não muda.
            </p>
          </div>
        );
      })()}
    </div>
  );
}
