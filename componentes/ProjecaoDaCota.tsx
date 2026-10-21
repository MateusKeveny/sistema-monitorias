'use client';

import { useEffect, useState } from 'react';
import Link from '@/componentes/Link';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mesRotulo } from '@/lib/formatar';
import { CENARIO_VAZIO, simular, type Resultado } from '@/lib/simulacao';
import { carregarBaseDoMes } from '@/lib/base-do-mes';

const pts = (v: number) => Math.round(v).toLocaleString('pt-BR');

type Situacao = 'na' | 'deve' | 'risco' | 'longe';
const situacao = (r: Resultado): Situacao | null => {
  const meta = r.metaSimulada;
  if (meta == null) return null;
  return r.hoje >= meta ? 'na' : r.projecao >= meta ? 'deve' : r.projecao >= meta * 0.9 ? 'risco' : 'longe';
};
const COR: Record<Situacao, { barra: string; texto: string; etiqueta: string; nome: string }> = {
  na: { barra: 'bg-marca-600', texto: 'text-marca-700 dark:text-marca-400', etiqueta: 'bg-marca-600/15 text-marca-700 dark:text-marca-400', nome: 'na meta' },
  deve: { barra: 'bg-marca-600', texto: 'text-marca-700 dark:text-marca-400', etiqueta: 'bg-marca-600/15 text-marca-700 dark:text-marca-400', nome: 'deve bater' },
  risco: { barra: 'bg-amber-500', texto: 'text-amber-700 dark:text-amber-300', etiqueta: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', nome: 'em risco' },
  longe: { barra: 'bg-rose-500', texto: 'text-rose-700 dark:text-rose-400', etiqueta: 'bg-rose-500/15 text-rose-700 dark:text-rose-400', nome: 'abaixo' },
};

/** Barra: cheia até o que já fez, clara até onde chega no ritmo, traço na meta. */
function Barra({ r, escala, situ, grossa = false }: { r: Resultado; escala: number; situ: Situacao; grossa?: boolean }) {
  const p = (v: number) => `${Math.max(0, Math.min(1, v / escala)) * 100}%`;
  return (
    <div className={`relative rounded-full bg-slate-100 ${grossa ? 'h-3.5' : 'h-2.5'}`}>
      <div className={`absolute inset-y-0 left-0 rounded-full ${COR[situ].barra}`} style={{ width: p(r.hoje) }} />
      {r.projecao > r.hoje && (
        <div className={`absolute inset-y-0 rounded-r-full opacity-30 ${COR[situ].barra}`}
             style={{ left: p(r.hoje), width: `calc(${p(r.projecao)} - ${p(r.hoje)})` }} />
      )}
      {r.metaSimulada != null && (
        <div className="absolute -inset-y-1 w-0.5 rounded bg-slate-500" style={{ left: p(r.metaSimulada) }} title={`meta ${pts(r.metaSimulada)}`} />
      )}
    </div>
  );
}

/**
 * Projeção do mês aberto (2.1.0): a mesma conta da Simulação, sem cenário —
 * a média das semanas com volume lançado vale para as que faltam; o que é do
 * mês entra como está.
 *
 * Calculada no navegador (como a Simulação): no servidor, ler o extrato
 * inteiro e refazer a conta esbarraria no limite de processamento do Worker.
 *
 * `equipe`: o quadro do gestor — ordenado por onde cada um fecha. `pessoa`: o
 * "seu ritmo" do atendente (a RLS já devolve só as linhas dele).
 */
export default function ProjecaoDaCota({ competencia, fonte, modo, pessoaId, ocultarCargos = [] }: {
  competencia: string;
  fonte: { extrato: string; mensal: string };
  modo: 'equipe' | 'pessoa';
  /** No modo pessoa: de quem é o ritmo. */
  pessoaId?: string;
  /** Cargos fora do quadro da equipe (ex.: Gestor). */
  ocultarCargos?: string[];
}) {
  const [dados, setDados] = useState<{ r: Resultado[]; semanas: number; pesoAtendimento: number | null } | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const base = await carregarBaseDoMes(criarClienteNavegador(), competencia, fonte, pessoaId);
      const pesoAtendimento = base.linhas.find((l) => l.regra === 'huggy_atendimento')?.peso ?? null;
      if (vivo) setDados({ r: simular(base, CENARIO_VAZIO), semanas: base.semanasLancadas!.length, pesoAtendimento });
    })().catch(() => { if (vivo) setFalhou(true); });
    return () => { vivo = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competencia, fonte.extrato, fonte.mensal, pessoaId]);

  if (falhou) return modo === 'equipe' ? <p className="text-sm text-slate-500">Não consegui calcular a projeção agora.</p> : null;
  if (!dados) {
    return <div className={`animate-pulse rounded-[20px] bg-superficie shadow-sm ${modo === 'equipe' ? 'h-64' : 'h-36'}`} />;
  }

  const { semanas } = dados;
  const projetando = semanas > 0 && semanas < 4;
  // Simulação sem cenário tem que reproduzir o resultado de hoje (conferência).
  const naoBate = dados.r.filter((r) => Math.abs(r.simulado - r.hoje) > 1);

  if (modo === 'pessoa') {
    const r = dados.r[0];
    if (!r || r.metaSimulada == null || !projetando) return null;
    const situ = situacao(r)!;
    const faltam = 4 - semanas;
    const ritmo = (r.projecao - r.hoje) / faltam;
    const precisa = (r.metaSimulada - r.hoje) / faltam;
    return (
      <section className="rounded-[20px] bg-superficie px-5 py-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Seu ritmo em {mesRotulo(competencia).toLowerCase()}</h2>
        <p className="text-xs text-slate-500">{semanas} de 4 semanas lançadas · a projeção estende a média das suas semanas até o fim do ciclo</p>
        <div className="mt-3 grid items-center gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <div className="flex items-baseline gap-4">
              <div><p className="text-xs text-slate-500">Hoje</p><p className="text-4xl font-bold tabular-nums text-slate-900">{pts(r.hoje)}</p></div>
              <span className="text-2xl text-slate-400">→</span>
              <div><p className="text-xs text-slate-500">No ritmo atual</p><p className={`text-4xl font-bold tabular-nums ${COR[situ].texto}`}>{pts(r.projecao)}</p></div>
            </div>
            <div className="mt-4"><Barra r={r} escala={Math.max(r.metaSimulada * 1.4, r.projecao * 1.05)} situ={situ} grossa /></div>
            <p className="mt-1.5 text-xs text-slate-500">Meta de {pts(r.metaSimulada)} pts</p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {r.hoje >= r.metaSimulada ? <><b>Meta batida.</b> Tudo o que vier a mais soma.</>
              : r.projecao >= r.metaSimulada ? <><b>No ritmo atual você bate a meta</b>, com {pts(r.projecao - r.metaSimulada)} pts de sobra.</>
                : <>
                  <b>Faltariam {pts(r.metaSimulada - r.projecao)} pts</b> no ritmo atual.<br />
                  Para bater a meta, {faltam === 1 ? 'a última semana precisa' : `cada uma das ${faltam} semanas que faltam precisa`} render
                  {' '}<b>{pts(precisa)} pts</b> — hoje seu ritmo é {pts(ritmo)} por semana.
                  {dados.pesoAtendimento ? (
                    <span className="mt-1 block text-xs text-slate-500">
                      Cada atendimento Expansão vale {dados.pesoAtendimento} pts: são cerca de {pts((r.metaSimulada - r.projecao) / dados.pesoAtendimento)} atendimentos a mais.
                    </span>
                  ) : null}
                </>}
          </div>
        </div>
      </section>
    );
  }

  const lista = dados.r.filter((r) => !(r.cargo && ocultarCargos.includes(r.cargo)) && r.metaSimulada != null)
    .sort((a, b) => b.projecao - a.projecao);
  const escala = Math.max(...lista.map((r) => Math.max(r.projecao, r.metaSimulada! * 1.3)), 1);
  const conta = (s: Situacao[]) => lista.filter((r) => s.includes(situacao(r)!)).length;

  return (
    <div>
      <div className="mb-3 grid gap-2.5 sm:grid-cols-3">
        {[
          ['Na meta hoje', `${conta(['na'])} de ${lista.length}`, 'com a pontuação atual', 'text-slate-900'],
          ['Devem bater', `${lista.filter((r) => r.projecao >= r.metaSimulada!).length} de ${lista.length}`,
            projetando ? 'no ritmo atual' : 'mês completo', 'text-marca-700 dark:text-marca-400'],
          ['Em risco', String(conta(['risco'])), 'chegam a 90% da meta ou mais', 'text-amber-700 dark:text-amber-300'],
        ].map(([r, v, d, c]) => (
          <div key={r} className="rounded-xl bg-slate-50 px-4 py-2.5">
            <p className="text-xs text-slate-500">{r}</p>
            <p className={`text-xl font-semibold tabular-nums ${c}`}>{v}</p>
            <p className="text-[11.5px] text-slate-500">{d}</p>
          </div>
        ))}
      </div>
      <p className="mb-1 flex flex-wrap gap-4 text-xs text-slate-500">
        <span><i className="mr-1.5 inline-block h-2 w-5 rounded-full bg-marca-600 align-middle" />feito</span>
        <span><i className="mr-1.5 inline-block h-2 w-5 rounded-full bg-marca-600 opacity-30 align-middle" />até o fim do ciclo, no ritmo</span>
        <span><i className="mr-1.5 inline-block h-3 w-0.5 rounded bg-slate-500 align-middle" />meta</span>
        <span>· {projetando ? `${semanas} de 4 semanas lançadas` : 'mês completo'}</span>
      </p>
      <ul>
        {lista.map((r) => {
          const situ = situacao(r)!;
          return (
            <li key={r.pessoa_id}>
              <Link href={`/cota/extrato?pessoa=${r.pessoa_id}&mes=${competencia.slice(0, 7)}`}
                    className="grid grid-cols-[minmax(10rem,13rem)_1fr_auto_5.5rem] items-center gap-3.5 border-t border-slate-100 px-0.5 py-2.5 hover:bg-slate-50">
                <span className="truncate text-sm"><b className="font-semibold text-slate-800">{r.pessoa.split(' ').slice(0, 2).join(' ')}</b>
                  <span className="ml-1.5 text-xs text-slate-400">{r.cargo?.replace('Atendente ', '')}</span></span>
                <Barra r={r} escala={escala} situ={situ} />
                <span className="whitespace-nowrap text-right text-sm tabular-nums">
                  <b className="text-slate-800">{pts(r.hoje)}</b>
                  {projetando && <span className={`ml-1.5 font-semibold ${COR[situ].texto}`}>→ {pts(r.projecao)}</span>}
                </span>
                <span><span className={`rounded-full px-2 py-px text-[11px] font-semibold ${COR[situ].etiqueta}`}>{COR[situ].nome}</span></span>
              </Link>
            </li>
          );
        })}
      </ul>
      {naoBate.length > 0 && (
        <p className="mt-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
          Conferência: a projeção não reproduz o resultado de hoje de {naoBate.map((r) => r.pessoa.split(' ')[0]).join(', ')} — veja em Conferência do cálculo.
        </p>
      )}
    </div>
  );
}
