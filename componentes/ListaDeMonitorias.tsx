'use client';

import { useState } from 'react';
import Link from '@/componentes/Link';
import { codigoMonitoria, data as formatarData, nota as formatarNota } from '@/lib/formatar';

export type MonitoriaDaLista = {
  id: string; codigo: number; protocolo: string; data_atendimento: string; semana_mes: number;
  nota_final: number; zerado: boolean; motivo_zeramento: string | null; parecer: string | null;
  canal: string | null; monitor: string | null;
  reprovados: { criterio: string; observacao: string | null }[];
};

type Filtro = 'todas' | 'melhorar' | 'critica';

// Mesma escala do painel: 85% é o piso para a monitoria pontuar.
const TOM = {
  bom: { borda: 'border-l-marca-600', nota: 'text-marca-700 dark:text-marca-400', fundo: 'bg-slate-50' },
  atencao: { borda: 'border-l-amber-500', nota: 'text-amber-700', fundo: 'bg-slate-50' },
  ruim: { borda: 'border-l-rose-600', nota: 'text-rose-700', fundo: 'bg-slate-50' },
  critica: { borda: 'border-l-rose-600', nota: 'text-rose-700', fundo: 'bg-rose-50' },
};
const tomDe = (m: MonitoriaDaLista) =>
  m.zerado ? TOM.critica : m.nota_final >= 0.85 ? TOM.bom : m.nota_final >= 0.70 ? TOM.atencao : TOM.ruim;

/**
 * As monitorias de um mês, uma por bloco (2.5.0): a nota em destaque à
 * esquerda, o que melhorar em quadros separados e o parecer à parte. Antes
 * era uma lista corrida em que uma monitoria emendava na outra — e a zerada
 * por falha crítica aparecia como "Todos os critérios atendidos", porque o
 * motivo do zeramento não é um critério reprovado.
 */
export default function ListaDeMonitorias({ monitorias, comLink = false }: {
  monitorias: MonitoriaDaLista[];
  /** No site de Monitorias o código abre a monitoria (editar, excluir, reportar ficam lá). */
  comLink?: boolean;
}) {
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const aMelhorar = monitorias.filter((m) => m.zerado || m.reprovados.length > 0);
  const criticas = monitorias.filter((m) => m.zerado);
  const visiveis = filtro === 'melhorar' ? aMelhorar : filtro === 'critica' ? criticas : monitorias;

  const botao = (f: Filtro, rotulo: string, qtd: number) => (
    <button type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)}
            className={`rounded-full border px-3 py-0.5 text-[12.5px] ${filtro === f
              ? 'border-slate-300 bg-slate-100 font-semibold text-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
      {rotulo}<span className="ml-1 font-semibold text-slate-500">{qtd}</span>
    </button>
  );

  return (
    <div>
      {aMelhorar.length > 0 && (
        <div className="-mt-1 mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar monitorias">
          {botao('todas', 'Todas', monitorias.length)}
          {botao('melhorar', 'Com algo a melhorar', aMelhorar.length)}
          {criticas.length > 0 && botao('critica', 'Falha crítica', criticas.length)}
        </div>
      )}
      <ul className="grid gap-2.5">
        {visiveis.map((m) => {
          const tom = tomDe(m);
          return (
            <li key={m.id} className={`grid grid-cols-[5.5rem_1fr] gap-4 rounded-xl border border-l-4 border-slate-200 px-4 py-3.5 ${tom.borda} ${tom.fundo}`}>
              <div className="pt-0.5 text-center">
                <b className={`block text-2xl font-bold tracking-tight tabular-nums ${tom.nota}`}>{formatarNota(Number(m.nota_final))}</b>
                <span className={`text-[11px] ${m.zerado ? 'font-semibold text-rose-700' : 'text-slate-500'}`}>
                  {m.zerado ? 'falha crítica' : 'nota'}
                </span>
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                  <span className="font-semibold tabular-nums text-slate-900">{formatarData(m.data_atendimento)} · {m.semana_mes}ª semana</span>
                  {m.canal && <span className="rounded-full bg-slate-100 px-2 py-px text-xs text-slate-700">{m.canal}</span>}
                  {comLink ? (
                    <Link href={`/monitorias/${m.id}`} className="ml-auto text-xs font-semibold tabular-nums text-marca-700 hover:underline dark:text-marca-400">
                      {codigoMonitoria(m.codigo)} · abrir ›
                    </Link>
                  ) : <span className="ml-auto text-xs tabular-nums text-slate-400">{codigoMonitoria(m.codigo)}</span>}
                </div>
                <p className="text-[12.5px] text-slate-500">
                  Protocolo <span className="tabular-nums text-slate-600">{m.protocolo}</span>
                  {m.monitor && <> · monitorado por {m.monitor}</>}
                </p>

                {m.zerado ? (
                  <div className="mt-2.5">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Por que zerou</p>
                    <p className="rounded-lg border border-rose-600/60 bg-superficie px-3 py-2 text-sm text-slate-700">
                      <b className="font-bold text-rose-700">Falha crítica</b>
                      {m.motivo_zeramento && <> — {m.motivo_zeramento}</>}
                    </p>
                  </div>
                ) : null}

                {m.reprovados.length > 0 ? (
                  <div className="mt-2.5">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">A melhorar</p>
                    <ul className="grid gap-1.5">
                      {m.reprovados.map((f) => (
                        <li key={f.criterio} className="grid grid-cols-[1.1rem_1fr] gap-x-1.5 rounded-lg border border-slate-200 bg-superficie px-2.5 py-1.5 text-sm">
                          <span className="font-bold text-rose-700">✕</span>
                          <span className="font-semibold text-slate-900">{f.criterio}</span>
                          {f.observacao && <span className="col-start-2 text-[13.5px] text-slate-600">{f.observacao}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : !m.zerado && (
                  <p className="mt-2.5 text-sm font-medium text-marca-700 dark:text-marca-400">✓ Todos os critérios atendidos</p>
                )}

                {m.parecer && (
                  <div className="mt-2.5 border-l-2 border-slate-300 pl-2.5 text-[13px] text-slate-600">
                    <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Parecer</span>
                    {m.parecer}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
