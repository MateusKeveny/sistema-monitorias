'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Quadro, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { dataHora, tempoUtil } from '@/lib/formatar';

export type ChamadoAtrasado = {
  protocolo: number;
  titulo: string | null;
  responsavel: string | null;
  aberto_em: string;
  concluido_em: string;
  tempo_util: number;
  tempo_interno: number | null;
  tempo_ti: number | null;
  motivo_atraso: string | null;
  observacao: string | null;
  justificativa: string | null;
  justificado_por_nome: string | null;
  justificado_em: string | null;
  decisao: 'manter' | 'retirar' | null;
  decidido_por_nome: string | null;
  decidido_em: string | null;
};

/** A barra vai até 5 dias úteis; o traço marca o fim do prazo (3,0). */
const ESCALA = 5;
const LIMITE = 3;

/** Onde o tempo do chamado ficou: com o Analista (até o ClickUp) ou com o TI. */
export function BarraDoTempo({ total, interno, ti }: { total: number; interno: number | null; ti: number | null }) {
  // Sem ClickUp, o tempo todo é do Analista.
  const doAnalista = interno ?? (ti == null ? total : 0);
  const doTi = ti ?? 0;
  const pct = (v: number) => `${Math.min(100, (v / ESCALA) * 100)}%`;
  return (
    <span className="relative flex h-2.5 w-52 overflow-hidden rounded-full bg-slate-100">
      <span className="h-full bg-marca-600" style={{ width: pct(doAnalista) }} />
      <span className="h-full bg-indigo-500" style={{ width: pct(doTi) }} />
      <span aria-hidden className="absolute -inset-y-1 w-0.5 bg-slate-500" style={{ left: pct(LIMITE) }} />
    </span>
  );
}

export function LegendaDoTempo() {
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-marca-600" />Analista (abertura → ClickUp)</span>
      <span className="flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-indigo-500" />TI (ClickUp → conclusão)</span>
    </span>
  );
}

/**
 * Fila de atrasos (migração 53): chamados resolvidos fora do prazo de 2 dias
 * úteis completos. A gestão decide se o desconto vale; enquanto não decide, o
 * chamado não soma nem desconta.
 */
export default function FilaDeAtrasos({ pendentes, decididos }: {
  pendentes: ChamadoAtrasado[];
  decididos: ChamadoAtrasado[];
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function decidir(protocolo: number, decisao: 'manter' | 'retirar') {
    setEnviando(protocolo); setErro(null);
    const { error } = await criarClienteNavegador()
      .rpc('decidir_atraso_chamado', { p_protocolo: protocolo, p_decisao: decisao });
    setEnviando(null);
    if (error) { setErro(error.message); return; }
    router.refresh();
  }

  const Linha = ({ c }: { c: ChamadoAtrasado }) => (
    <tr className="align-top">
      <Td>
        <span className="font-semibold text-slate-900">{c.protocolo}</span>
        {c.titulo && <span className="text-slate-700"> · {c.titulo}</span>}
        <span className="block text-xs text-slate-500">
          aberto {dataHora(c.aberto_em)} · concluído {dataHora(c.concluido_em)}
        </span>
      </Td>
      <Td className="whitespace-nowrap tabular-nums">{tempoUtil(c.tempo_util)}</Td>
      <Td>
        <BarraDoTempo total={c.tempo_util} interno={c.tempo_interno} ti={c.tempo_ti} />
        <span className="mt-1 block text-xs tabular-nums text-slate-500">
          Analista {tempoUtil(c.tempo_interno ?? (c.tempo_ti == null ? c.tempo_util : 0))}
          {c.tempo_ti != null && ` · TI ${tempoUtil(c.tempo_ti)}`}
        </span>
      </Td>
      <Td className="max-w-[20rem] space-y-1.5 text-xs text-slate-600">
        {c.justificativa && (
          <span className="block rounded-md bg-amber-500/10 px-2 py-1 text-slate-800">
            <b className="font-semibold">Justificativa</b>{c.justificado_por_nome && ` de ${c.justificado_por_nome.split(' ')[0]}`}: {c.justificativa}
            <span className="block text-[11px] text-slate-500">{dataHora(c.justificado_em)}</span>
          </span>
        )}
        {c.motivo_atraso || c.observacao
          ? <span className="block">ELO: {c.motivo_atraso}{c.motivo_atraso && c.observacao && ' · '}{c.observacao}</span>
          : !c.justificativa && <span className="text-slate-400">sem motivo nem justificativa</span>}
      </Td>
      <Td className="text-right">
        {c.decisao ? (
          <span className="text-xs text-slate-600">
            {c.decisao === 'manter' ? 'Desconto mantido' : 'Desconto retirado'}
            <span className="block text-slate-400">{c.decidido_por_nome} · {dataHora(c.decidido_em)}</span>
          </span>
        ) : (
          <span className="inline-flex gap-2">
            <button disabled={enviando != null} onClick={() => decidir(c.protocolo, 'retirar')}
                    className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-xs font-medium
                               text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              Retirar o desconto
            </button>
            <button disabled={enviando != null} onClick={() => decidir(c.protocolo, 'manter')}
                    className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-xs font-medium
                               text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              Manter o desconto
            </button>
          </span>
        )}
      </Td>
    </tr>
  );

  const Cabecalho = () => (
    <thead>
      <tr><Th>Chamado</Th><Th>Tempo total</Th><Th>Onde ficou o tempo</Th><Th>Justificativa e motivo</Th><Th className="text-right">Decisão</Th></tr>
    </thead>
  );

  return (
    <Quadro titulo={`Fila de atrasos · ${pendentes.length} esperando decisão`}
            subtitulo="Resolvidos depois de 2 dias úteis completos. A gestão decide se o desconto do prazo vale; enquanto não decide, o chamado não soma nem desconta."
            acao={<LegendaDoTempo />}>
      {erro && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {pendentes.length === 0 ? (
        <Vazio>Nenhum atraso esperando decisão.</Vazio>
      ) : (
        <Tabela noQuadro><Cabecalho /><tbody>{pendentes.map((c) => <Linha key={c.protocolo} c={c} />)}</tbody></Tabela>
      )}
      {decididos.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-slate-600">Já decididos neste ciclo · {decididos.length}</summary>
          <div className="mt-2">
            <Tabela noQuadro><Cabecalho /><tbody>{decididos.map((c) => <Linha key={c.protocolo} c={c} />)}</tbody></Tabela>
          </div>
        </details>
      )}
    </Quadro>
  );
}
