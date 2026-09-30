'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

export type Reporte = {
  id: number;
  pessoa_id: string;
  sistema: 'performance' | 'monitorias';
  tela: string | null;
  versao: string | null;
  navegador: string | null;
  descricao: string;
  esperado: string | null;
  print_path: string | null;
  situacao: 'novo' | 'analise' | 'resolvido';
  resposta: string | null;
  respondido_por: string | null;
  respondido_em: string | null;
  criado_em: string;
  /** Endereço temporário do print, assinado no servidor. */
  print_url?: string | null;
};

const ROTULO = { novo: 'Novo', analise: 'Em análise', resolvido: 'Resolvido' } as const;
const COR = {
  novo: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  analise: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  resolvido: 'bg-marca-600/15 text-marca-700 dark:text-marca-400',
} as const;
const SITE = {
  performance: 'https://painel-performance.expansao.workers.dev',
  monitorias: 'https://painel-monitorias.expansao.workers.dev',
} as const;

const nomeCurto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');
const quando = (iso: string) => new Date(iso)
  .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).replace(',', '');
const resumo = (t: string) => { const s = t.replace(/\s+/g, ' ').trim(); return s.length > 70 ? `${s.slice(0, 70)}…` : s; };
const botaoSecundario = `rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm font-medium
                         text-slate-700 hover:bg-slate-50 disabled:opacity-40`;

/**
 * Reports de problemas (1.33.0). O gestor vê todos, responde e muda a
 * situação; quem reportou vê só os próprios, com a resposta (RLS, migração 44).
 */
export default function PainelReportes({
  reportes, nomes, ehGestor, inicial,
}: {
  reportes: Reporte[];
  nomes: Record<string, string>;
  ehGestor: boolean;
  /** ?id= do cartão do Teams: abre direto nele. */
  inicial?: number;
}) {
  const router = useRouter();
  const [filtro, setFiltro] = useState<'abertos' | 'resolvidos' | 'todos'>('abertos');
  const [sel, setSel] = useState<number | null>(inicial ?? null);
  const [resposta, setResposta] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const abertos = reportes.filter((r) => r.situacao !== 'resolvido').length;
  const lista = useMemo(() => reportes.filter((r) => filtro === 'todos'
    || (filtro === 'abertos' ? r.situacao !== 'resolvido' : r.situacao === 'resolvido')), [reportes, filtro]);
  const atual = reportes.find((r) => r.id === (sel ?? lista[0]?.id));

  async function atualizar(campos: Partial<Pick<Reporte, 'resposta' | 'situacao'>>) {
    if (!atual) return;
    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().from('reportes').update(campos).eq('id', atual.id);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setResposta('');
    router.refresh();
  }

  const Detalhe = ({ r }: { r: Reporte }) => (
    <div className="grid gap-2">
      <p className="whitespace-pre-line text-sm text-slate-700">{r.descricao}</p>
      {r.esperado && <p className="text-sm text-slate-500"><b className="font-semibold">Esperava:</b> {r.esperado}</p>}
      {r.print_url && (
        <a href={r.print_url} target="_blank" rel="noreferrer" className="block w-fit">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={r.print_url} alt={`Print do report #${r.id}`}
               className="max-h-72 rounded-xl object-contain ring-1 ring-slate-200 hover:ring-marca-600/50" />
        </a>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <dt className="font-semibold">Tela</dt>
        <dd className="truncate">
          {r.tela ?? '—'}
          {ehGestor && r.tela && <a href={SITE[r.sistema] + r.tela} target="_blank" rel="noreferrer"
                                    className="ml-2 text-marca-700 hover:underline dark:text-marca-400">abrir</a>}
        </dd>
        <dt className="font-semibold">Versão</dt><dd>{r.versao ?? '—'}</dd>
        <dt className="font-semibold">Navegador</dt><dd>{r.navegador ?? '—'}</dd>
      </dl>
      {r.resposta && (
        <p className="rounded-r-xl border-l-4 border-marca-600 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <b className="font-semibold">{nomeCurto(nomes[r.respondido_por ?? ''] ?? 'Gestão')}:</b> {r.resposta}
          {r.respondido_em && <small className="ml-2 text-xs text-slate-500">{quando(r.respondido_em)}</small>}
        </p>
      )}
    </div>
  );

  const Filtros = (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {([['abertos', `Abertos${abertos ? ` · ${abertos}` : ''}`], ['resolvidos', 'Resolvidos'], ['todos', 'Todos']] as const).map(([k, rot]) => (
        <button key={k} type="button" aria-pressed={filtro === k} onClick={() => { setFiltro(k); setSel(null); }}
                className={`rounded-full border px-3 py-0.5 text-xs ${filtro === k
                  ? 'border-marca-600 bg-marca-600/10 text-marca-700 dark:text-marca-400'
                  : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>{rot}</button>
      ))}
    </div>
  );

  if (!ehGestor) {
    return (
      <section className="max-w-4xl rounded-[18px] bg-superficie px-6 py-5 shadow-sm">
        {Filtros}
        {lista.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            {reportes.length ? 'Nada neste filtro.' : 'Você ainda não reportou nenhum problema. O botão "Reportar problema" fica no menu.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {lista.map((r) => (
              <li key={r.id} className="grid gap-2 py-4">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <b className="font-semibold text-slate-800">#{r.id} · {resumo(r.descricao)}</b>
                  <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold ${COR[r.situacao]}`}>{ROTULO[r.situacao]}</span>
                </div>
                <p className="text-xs text-slate-500">{quando(r.criado_em)}{r.print_path ? ' · com print' : ''}</p>
                <Detalhe r={r} />
              </li>
            ))}
          </ul>
        )}
      </section>
    );
  }

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <section className="rounded-[18px] bg-superficie px-4 py-4 shadow-sm">
        {Filtros}
        {lista.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">{reportes.length ? 'Nada neste filtro.' : 'Nenhum report ainda.'}</p>
        ) : (
          <ul className="grid gap-0.5">
            {lista.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => { setSel(r.id); setResposta(''); setErro(null); }}
                        className={`w-full rounded-lg px-3 py-2.5 text-left ${atual?.id === r.id ? 'bg-marca-600/10' : 'hover:bg-slate-50'}`}>
                  <span className="flex items-center gap-2 text-sm">
                    <b className="min-w-0 truncate font-semibold text-slate-800">#{r.id} · {resumo(r.descricao)}</b>
                    <span className={`ml-auto shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold ${COR[r.situacao]}`}>{ROTULO[r.situacao]}</span>
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {nomeCurto(nomes[r.pessoa_id] ?? '—')} · {r.sistema === 'monitorias' ? 'Monitorias' : 'Performance'} · {quando(r.criado_em)}{r.print_path ? ' · 📎' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {atual && (
        <section className="rounded-[18px] bg-superficie px-6 py-5 shadow-sm">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-800">#{atual.id} · {resumo(atual.descricao)}</h2>
              <p className="text-sm text-slate-500">{nomes[atual.pessoa_id] ?? '—'} · {quando(atual.criado_em)}</p>
            </div>
            <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${COR[atual.situacao]}`}>{ROTULO[atual.situacao]}</span>
          </div>
          <Detalhe r={atual} />
          <div className="mt-4 grid gap-2">
            <label className="text-xs font-medium text-slate-600">
              Resposta para {nomeCurto(nomes[atual.pessoa_id] ?? 'a pessoa')}
              <textarea value={resposta} onChange={(e) => setResposta(e.target.value)} disabled={ocupado} rows={3}
                        placeholder="O que foi feito ou o que ela precisa fazer"
                        className="mt-1 w-full resize-y rounded-xl border border-slate-300 bg-superficie px-3 py-2 text-sm outline-none focus:border-marca-600" />
            </label>
            {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              {atual.situacao === 'novo' && (
                <button type="button" className={botaoSecundario} disabled={ocupado} onClick={() => atualizar({ situacao: 'analise' })}>
                  Marcar em análise
                </button>
              )}
              {atual.situacao === 'resolvido' && (
                <button type="button" className={botaoSecundario} disabled={ocupado} onClick={() => atualizar({ situacao: 'analise' })}>
                  Reabrir
                </button>
              )}
              <button type="button" className={botaoSecundario} disabled={ocupado || !resposta.trim()}
                      onClick={() => atualizar({ resposta: resposta.trim(), situacao: atual.situacao === 'novo' ? 'analise' : atual.situacao })}>
                Responder
              </button>
              <button type="button" disabled={ocupado || (!resposta.trim() && atual.situacao === 'resolvido')}
                      onClick={() => atualizar({ ...(resposta.trim() ? { resposta: resposta.trim() } : {}), situacao: 'resolvido' })}
                      className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
                {resposta.trim() ? 'Responder e resolver' : 'Resolver'}
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
