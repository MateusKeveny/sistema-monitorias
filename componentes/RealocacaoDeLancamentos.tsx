'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Quadro } from '@/componentes/ui';
import { diaMes, duracao, mesRotulo, periodoDaSemana } from '@/lib/formatar';
import { mensagemDoErro } from '@/lib/erro-amigavel';

type PessoaSimples = { id: string; nome: string };

/** Chama a função do banco que passa o registro para outra pessoa (migração 71). */
async function mover(tipo: 'volume' | 'lancamento', id: number, pessoa: string) {
  return criarClienteNavegador().rpc(tipo === 'volume' ? 'mover_volume' : 'mover_lancamento', { p_id: id, p_pessoa: pessoa });
}

/**
 * "⇄ mover" (1.55 → 2.0.0): passa um volume da semana ou um lançamento manual
 * para outra pessoa sem apagar e digitar de novo. Volume que encontra outro
 * na mesma semana e canal soma (os tempos pela média ponderada).
 */
export function MoverPara({ tipo, id, de, pessoas, recarregar = false }: {
  tipo: 'volume' | 'lancamento';
  id: number;
  /** Quem tem o registro hoje (fica fora da lista). */
  de: string;
  pessoas: PessoaSimples[];
  /** Volume: recarrega a página inteira, porque o rascunho da semana guarda os números antigos. */
  recarregar?: boolean;
}) {
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [para, setPara] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    if (!para) return;
    setOcupado(true); setErro(null);
    const { error } = await mover(tipo, id, para);
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    setAberto(false);
    if (recarregar) window.location.reload(); else router.refresh();
  }

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)} title="Passar para outra pessoa"
              className="text-xs text-slate-500 hover:text-marca-700 hover:underline">⇄ mover</button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <select value={para} onChange={(e) => setPara(e.target.value)} disabled={ocupado} aria-label="Passar para"
              className="rounded-md border border-slate-300 bg-superficie px-1.5 py-0.5 text-xs text-slate-800">
        <option value="">Passar para…</option>
        {pessoas.filter((p) => p.id !== de).map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
      </select>
      <button type="button" onClick={confirmar} disabled={ocupado || !para}
              className="rounded-md bg-marca-600 px-2 py-0.5 text-xs font-semibold text-white disabled:opacity-40">
        {ocupado ? '…' : 'Mover'}
      </button>
      <button type="button" onClick={() => { setAberto(false); setErro(null); }} disabled={ocupado}
              className="text-xs text-slate-500 hover:underline">cancelar</button>
      {erro && <span className="text-xs text-rose-700">{erro}</span>}
    </span>
  );
}

export type Pendente = {
  tipo: 'volume' | 'lancamento'; id: number; pessoa_id: string; pessoa: string; mes_competencia: string;
  semana: number | null; canal: string; regra: string | null; rotulo: string | null; quantidade: number;
  tme_seg: number | null; motivo: string;
};

/**
 * Pendentes de realocação (migração 71): volume e lançamentos do mês aberto de
 * quem está sem cargo ou em cargo sem cota. Não pontuam para ninguém até o
 * gestor passar para outra pessoa, manter sem cota (fica como volume da
 * equipe) ou apagar — como as notas guardadas.
 */
export default function LancamentosPendentes({ pendentes, pessoas }: { pendentes: Pendente[]; pessoas: PessoaSimples[] }) {
  const router = useRouter();
  const [para, setPara] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  if (!pendentes.length) return null;
  const chave = (p: Pendente) => `${p.tipo}-${p.id}`;

  async function agir(p: Pendente, acao: 'passar' | 'manter' | 'apagar') {
    if (acao === 'apagar' && !window.confirm(`Apagar este ${p.tipo === 'volume' ? 'volume' : 'lançamento'} de ${p.pessoa}?`)) return;
    setOcupado(chave(p)); setErro(null);
    const { error } = acao === 'passar'
      ? await mover(p.tipo, p.id, para[chave(p)])
      : await criarClienteNavegador().rpc('resolver_pendente', { p_tipo: p.tipo, p_id: p.id, p_acao: acao });
    setOcupado(null);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    if (p.tipo === 'volume') window.location.reload(); else router.refresh();
  }

  return (
    <Quadro titulo={`Pendentes de realocação · ${pendentes.length}`}
            subtitulo="Volume e lançamentos do mês aberto de quem está sem cargo ou em cargo sem cota. Não pontuam para ninguém até você decidir.">
      {erro && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500">
              {['Pessoa', 'Por quê', 'O quê', 'Semana', 'Quantidade', 'Decidir'].map((h) => (
                <th key={h} className="whitespace-nowrap border-b border-slate-200 px-2 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pendentes.map((p) => {
              const k = chave(p);
              const [de, ate] = p.semana ? periodoDaSemana(p.mes_competencia, p.semana) : [null, null];
              return (
                <tr key={k} className="border-b border-slate-100">
                  <td className="whitespace-nowrap px-2 py-2 font-medium text-slate-800">{p.pessoa}</td>
                  <td className="px-2 py-2">
                    <span className="rounded-full bg-amber-500/15 px-2 py-px text-xs text-amber-700 dark:text-amber-300">{p.motivo}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-slate-700">
                    {p.tipo === 'volume' ? 'Volume' : 'Lançamento'} · {p.canal === 'diretores' ? 'Diretores' : 'Expansão'}
                    <span className="block text-xs text-slate-500">{mesRotulo(p.mes_competencia)}</span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-slate-700">
                    {p.semana ? `${p.semana}ª · ${diaMes(de!)} a ${diaMes(ate!)}` : 'mês inteiro'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-700">
                    {p.tipo === 'volume'
                      ? <>{Number(p.quantidade).toLocaleString('pt-BR')} finalizados{p.tme_seg ? ` · TME ${duracao(p.tme_seg)}` : ''}</>
                      : <>{p.rotulo ?? p.regra} · {Number(p.quantidade).toLocaleString('pt-BR')}</>}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2">
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      <select value={para[k] ?? ''} disabled={ocupado === k} aria-label={`Passar o registro de ${p.pessoa} para`}
                              onChange={(e) => setPara((s) => ({ ...s, [k]: e.target.value }))}
                              className="rounded-md border border-slate-300 bg-superficie px-1.5 py-1 text-xs text-slate-800">
                        <option value="">Passar para…</option>
                        {pessoas.filter((x) => x.id !== p.pessoa_id).map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                      </select>
                      <button type="button" disabled={ocupado === k || !para[k]} onClick={() => agir(p, 'passar')}
                              className="rounded-md bg-marca-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40">Passar</button>
                      <button type="button" disabled={ocupado === k} onClick={() => agir(p, 'manter')}
                              title="Fica como volume da equipe, sem pontuar, e sai da lista"
                              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">Manter sem cota</button>
                      <button type="button" disabled={ocupado === k} onClick={() => agir(p, 'apagar')}
                              className="px-1.5 py-1 text-xs text-slate-500 hover:text-rose-700 hover:underline">Apagar</button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        <b>Passar</b>: vai para a pessoa escolhida (volume na mesma semana e fila soma). <b>Manter sem cota</b>: continua
        como volume da equipe (aparece no Comparativo), sem pontuar, e sai da lista. Tudo fica registrado.
      </p>
    </Quadro>
  );
}
