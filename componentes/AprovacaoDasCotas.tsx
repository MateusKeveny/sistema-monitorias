'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/componentes/Link';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import { dataHora } from '@/lib/formatar';
import { aguarda } from '@/lib/aprovacao';

export type PessoaParaAprovar = {
  fechamento_id: string;
  nome: string;
  cargo: string | null;
  pontos: number;
  situacao_meta: 'atingida' | 'proxima' | 'abaixo' | null;
  /** respondido: o gestor respondeu à recusa (texto em `motivo`); volta a aguardar a CEO. */
  decisao: 'aprovado' | 'recusado' | 'respondido' | null;
  motivo: string | null;
  /** O motivo da recusa que o gestor respondeu. */
  recusa?: string | null;
  decidido_em: string | null;
  recusas_anteriores: number;
  /** Pontos fechados dos 2 meses anteriores, do mais antigo (null = sem fechamento). */
  anteriores?: (number | null)[];
  /** Os fechamentos desses meses, para abrir o extrato de cada um. */
  anteriores_ids?: (string | null)[];
};


const pontos = (v: number) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

const META = {
  atingida: ['Atingida', 'bg-marca-50 text-marca-800 ring-marca-600/20 dark:bg-marca-500/15 dark:text-marca-300'],
  proxima: ['Próxima', 'bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300'],
  abaixo: ['Abaixo', 'bg-rose-50 text-rose-800 ring-rose-600/20 dark:bg-rose-500/15 dark:text-rose-300'],
} as const;

const botao = 'rounded-full px-3 py-1 text-xs font-semibold ring-1 disabled:opacity-40';

/**
 * A lista da diretoria (4.0.0): cada pessoa do fechamento com os pontos, a
 * situação em relação à meta (sem mostrar a meta) e Aprovar / Recusar. A
 * recusa pede o motivo, que vai ao gestor. A recusa pode ser mudada depois
 * (vale a última); a aprovação é final (trava no banco, migração 98). Clicar no nome abre o extrato congelado.
 */
export default function AprovacaoDasCotas({ pessoas, mes, podeDecidir, mesesAnteriores = [], rotuloDoMes, caminho = '/cota/aprovacao' }: {
  pessoas: PessoaParaAprovar[];
  /** YYYY-MM, para os links do extrato. */
  mes: string;
  /** Só a diretoria decide; o administrador vê sem os botões. */
  podeDecidir: boolean;
  /** Nomes dos 2 meses anteriores (colunas em cinza com os pontos de cada um). */
  mesesAnteriores?: string[];
  /** Nome do mês em análise, para o cabeçalho "Pontos em …". */
  rotuloDoMes?: string;
  /** A aba do submenu (Aguardando ou Aprovadas): os links do extrato ficam nela. */
  caminho?: string;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [recusando, setRecusando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [alterando, setAlterando] = useState<string | null>(null);

  const pendentes = pessoas.filter(aguarda);

  async function decidir(ids: string[], situacao: 'aprovado' | 'recusado', texto?: string) {
    if (situacao === 'recusado' && !texto?.trim()) { setErro('Escreva o motivo para recusar.'); return; }
    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().rpc('decidir_cota', {
      p_fechamentos: ids, p_situacao: situacao, p_motivo: texto?.trim() || null,
    });
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    setRecusando(null); setMotivo(''); setAlterando(null);
    // Fica no mês em análise: sem ?mes= no endereço, a tela abriria no próximo
    // mês com pendência assim que este terminasse.
    const q = new URLSearchParams(window.location.search);
    if (!q.get('mes')) { q.set('mes', mes); router.replace(`${window.location.pathname}?${q}`, { scroll: false }); }
    router.refresh();
  }

  return (
    <div>
      {podeDecidir && pendentes.length > 1 && (
        <div className="mb-2 flex justify-end">
          <button type="button" disabled={ocupado}
                  onClick={() => confirm(`Aprovar as ${pendentes.length} pessoas que ainda aguardam?

Aprovada, a cota fica finalizada: sem correção, reabertura nem troca de decisão.`)
                    && decidir(pendentes.map((p) => p.fechamento_id), 'aprovado')}
                  className={`${botao} bg-marca-600 text-white ring-marca-600 hover:bg-marca-700`}>
            Aprovar os {pendentes.length} pendentes
          </button>
        </div>
      )}
      {erro && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}

      <div className="-mx-6 overflow-x-auto sm:-mx-7">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-slate-500">
              <th className="py-2.5 pl-6 pr-3 text-left font-medium sm:pl-7">Colaborador</th>
              <th className="px-3 py-2.5 text-left font-medium">Cargo</th>
              {mesesAnteriores.map((m) => <th key={m} className="px-3 py-2.5 text-right font-medium">{m}</th>)}
              <th className="px-3 py-2.5 text-right font-medium">Pontos{rotuloDoMes && mesesAnteriores.length ? ` em ${rotuloDoMes}` : ''}</th>
              <th className="px-3 py-2.5 text-center font-medium">Situação</th>
              <th className="py-2.5 pl-3 pr-6 text-right font-medium sm:pr-7">Aprovação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pessoas.map((p) => {
              const [rotuloMeta, corMeta] = p.situacao_meta ? META[p.situacao_meta] : ['—', 'text-slate-400 ring-transparent'];
              const mostraBotoes = podeDecidir && (aguarda(p) || alterando === p.fechamento_id);
              return (
                <tr key={p.fechamento_id} className="align-top">
                  <td className="py-3 pl-6 pr-3 sm:pl-7">
                    <Link href={`${caminho}?mes=${mes}&f=${p.fechamento_id}`}
                          className="font-semibold text-marca-700 hover:underline dark:text-marca-400">{p.nome}</Link>
                    {p.recusas_anteriores > 0 && (
                      <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">refeito após recusa</span>
                    )}
                    {p.decisao === 'recusado' && p.motivo && alterando !== p.fechamento_id && (
                      <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">Motivo: {p.motivo}</p>
                    )}
                    {p.decisao === 'respondido' && (
                      <div className="mt-1 space-y-0.5 text-xs">
                        {p.recusa && <p className="text-rose-700 dark:text-rose-300">Sua recusa: {p.recusa}</p>}
                        <p className="text-sky-700 dark:text-sky-300">↩ Resposta do gestor: {p.motivo}</p>
                      </div>
                    )}
                    {recusando === p.fechamento_id && (
                      <div className="mt-2 flex max-w-xl gap-2">
                        <input autoFocus value={motivo} onChange={(e) => { setMotivo(e.target.value); setErro(null); }}
                               placeholder="O que precisa ser revisto"
                               className="w-full rounded-md border border-slate-300 bg-superficie px-2 py-1 text-sm outline-none focus:border-marca-600"
                               onKeyDown={(e) => { if (e.key === 'Enter') decidir([p.fechamento_id], 'recusado', motivo); }} />
                        <button type="button" disabled={ocupado} onClick={() => decidir([p.fechamento_id], 'recusado', motivo)}
                                className={`${botao} bg-rose-600 text-white ring-rose-600 hover:bg-rose-700`}>Recusar</button>
                        <button type="button" onClick={() => { setRecusando(null); setMotivo(''); setErro(null); }}
                                className="text-xs text-slate-500 hover:underline">Cancelar</button>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3 text-slate-600">{p.cargo ?? '—'}</td>
                  {mesesAnteriores.map((m, i) => {
                    const v = p.anteriores?.[i];
                    const id = p.anteriores_ids?.[i];
                    return (
                      <td key={m} className="px-3 py-3 text-right text-slate-400">
                        {v == null ? '—' : id
                          ? <Link href={`${caminho}?mes=${mes}&f=${id}`} title={`Extrato de ${m}`} className="hover:text-marca-700 hover:underline dark:hover:text-marca-400">{pontos(v)}</Link>
                          : pontos(v)}
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-right font-semibold text-slate-900">
                    {pontos(p.pontos)} <span className="text-xs font-normal text-slate-500">pts</span>
                    {(() => {
                      // Subiu ou caiu em relação ao mês anterior (mais de 2%).
                      const ult = p.anteriores?.[p.anteriores.length - 1];
                      if (ult == null || !mesesAnteriores.length) return null;
                      if (p.pontos > ult * 1.02) return <span className="ml-1 text-marca-700 dark:text-marca-300" title="Subiu em relação ao mês anterior">▲</span>;
                      if (p.pontos < ult * 0.98) return <span className="ml-1 text-rose-700 dark:text-rose-300" title="Caiu em relação ao mês anterior">▼</span>;
                      return null;
                    })()}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${corMeta}`}>{rotuloMeta}</span>
                  </td>
                  <td className="py-3 pl-3 pr-6 text-right sm:pr-7">
                    {mostraBotoes ? (
                      <span className="inline-flex gap-2">
                        <button type="button" disabled={ocupado}
                                onClick={() => confirm(`Aprovar a cota de ${p.nome}?

Aprovada, a cota fica finalizada: sem correção, reabertura nem troca de decisão.`)
                                  && decidir([p.fechamento_id], 'aprovado')}
                                className={`${botao} text-marca-700 ring-marca-600/40 hover:bg-marca-50 dark:text-marca-300 dark:hover:bg-marca-500/10`}>Aprovar</button>
                        <button type="button" disabled={ocupado} onClick={() => { setRecusando(p.fechamento_id); setMotivo(''); setErro(null); }}
                                className={`${botao} text-rose-700 ring-rose-600/40 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10`}>Recusar</button>
                        {alterando === p.fechamento_id && (
                          <button type="button" onClick={() => setAlterando(null)} className="text-xs text-slate-500 hover:underline">Cancelar</button>
                        )}
                      </span>
                    ) : p.decisao === 'respondido' ? (
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">↩ Respondida · aguardando</span>
                    ) : p.decisao ? (
                      <span className="inline-flex flex-col items-end">
                        <span className={`text-xs font-semibold ${p.decisao === 'aprovado' ? 'text-marca-700 dark:text-marca-300' : 'text-rose-700 dark:text-rose-300'}`}>
                          {p.decisao === 'aprovado' ? '✓ Aprovado' : '✕ Recusado'}
                        </span>
                        <span className="text-[11px] text-slate-500">{dataHora(p.decidido_em)}</span>
                        {p.decisao === 'aprovado' && <span className="text-[11px] text-slate-500">🔒 Finalizada</span>}
                        {podeDecidir && p.decisao === 'recusado' && (
                          <button type="button" onClick={() => setAlterando(p.fechamento_id)}
                                  className="text-[11px] text-slate-500 hover:underline">alterar</button>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">Aguardando</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
