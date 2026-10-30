'use client';

import { useEffect, useState } from 'react';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mesRotulo, percentual } from '@/lib/formatar';
import { CENARIO_VAZIO, simular, type Resultado } from '@/lib/simulacao';
import { carregarBaseDoMes } from '@/lib/base-do-mes';

/**
 * "Para bater a meta" (3.0, aprovado em 30/10/2026): no Início do atendente,
 * no lugar do "Seu ritmo". Três partes:
 *
 *   1. Situação — hoje, onde fecha no ritmo atual, a meta e quanto falta (a
 *      mesma conta da Simulação: a média das semanas lançadas vale para as
 *      que faltam).
 *   2. O que mudou entre as duas últimas semanas lançadas — atendimentos por
 *      dia de escala, C-SAT e o TME da pessoa (quando a fila avalia por pessoa).
 *   3. Caminhos — cada um, sozinho, com o que rende; e um combinado. Os pesos
 *      são os do cargo da pessoa; o "por dia" conta só os dias da escala dela
 *      até o fim do ciclo, sem as férias.
 *
 * Nada é gravado. O aviso no sino, quando o ritmo fica abaixo da meta, é do
 * banco (avisar_ritmo, migração 93).
 */
export type DadosDoQuadro = {
  /** A fila em que a pessoa mais atende. */
  fila: string;
  semanas: { semana: number; finalizados: number | null; dias: number; csat: number | null; tme: number | null }[];
  /** Pontos de cada atendimento finalizado na fila. */
  pesoAtendimento: number;
  /** Faixa de C-SAT: o peso da faixa em que está e o da de cima. */
  csat: { pesoAtual: number; pesoTopo: number; rotuloTopo: string } | null;
  /** Faixa de TME da própria pessoa (só quando a fila avalia por pessoa). */
  tme: { pesoAtual: number; pesoMelhor: number; rotuloMelhor: string } | null;
  monitoria: { media: number | null; piso: number; peso: number } | null;
  /** Dias de escala até o fim do ciclo, sem férias. */
  diasRestantes: number;
  fimDoCiclo: string;
};

const pts = (v: number) => Math.round(v).toLocaleString('pt-BR');
const minutos = (s: number) => `${Math.round(s / 60)} min`;

export default function ParaBaterAMeta({ competencia, fonte, pessoaId, dados }: {
  competencia: string;
  fonte: { extrato: string; mensal: string };
  pessoaId: string;
  dados: DadosDoQuadro;
}) {
  const [r, setR] = useState<{ res: Resultado; lancadas: number } | null>(null);
  const [falhou, setFalhou] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const base = await carregarBaseDoMes(criarClienteNavegador(), competencia, fonte, pessoaId);
      const res = simular(base, CENARIO_VAZIO)[0];
      if (vivo && res) setR({ res, lancadas: base.semanasLancadas!.length });
    })().catch(() => { if (vivo) setFalhou(true); });
    return () => { vivo = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competencia, fonte.extrato, fonte.mensal, pessoaId]);

  if (falhou) return null;
  if (!r) return <div className="h-40 animate-pulse rounded-[20px] bg-superficie shadow-sm" />;
  const { res, lancadas } = r;
  const meta = res.metaSimulada;
  if (meta == null || lancadas === 0) return null;

  const mes = mesRotulo(competencia).split(' ')[0].toLowerCase();
  const falta = meta - res.projecao;
  const situ = res.hoje >= meta ? 'batida' : res.projecao >= meta ? 'deve' : res.projecao >= meta * 0.9 ? 'risco' : 'abaixo';
  const SELO = {
    batida: ['meta batida', 'bg-emerald-500/10 text-marca-700 dark:text-marca-400'],
    deve: ['deve bater', 'bg-emerald-500/10 text-marca-700 dark:text-marca-400'],
    risco: ['em risco', 'bg-amber-500/10 text-amber-700 dark:text-amber-300'],
    abaixo: ['abaixo', 'bg-rose-500/10 text-rose-700 dark:text-rose-300'],
  } as const;

  // ------------------------------------------------------------ tendência
  const comDado = dados.semanas.filter((s) => s.finalizados != null && s.semana <= lancadas);
  const [a, b] = comDado.slice(-2);
  const porDia = (s: { finalizados: number | null; dias: number }) => (s.dias ? (s.finalizados ?? 0) / s.dias : null);
  const tendencias: { rotulo: string; antes: string; depois: string; caiu: boolean }[] = [];
  if (a && b) {
    const pa = porDia(a), pb = porDia(b);
    if (pa != null && pb != null && pa > 0 && Math.abs(pb - pa) / pa >= 0.05) {
      tendencias.push({ rotulo: 'Atendimentos por dia', antes: pts(pa), depois: pts(pb), caiu: pb < pa });
    }
    if (a.csat != null && b.csat != null && Math.abs(b.csat - a.csat) >= 0.02) {
      tendencias.push({ rotulo: 'C-SAT da semana', antes: percentual(a.csat), depois: percentual(b.csat), caiu: b.csat < a.csat });
    }
    if (dados.tme && a.tme != null && b.tme != null && Math.abs(b.tme - a.tme) >= 60) {
      tendencias.push({ rotulo: 'Seu TME', antes: minutos(a.tme), depois: minutos(b.tme), caiu: b.tme > a.tme });
    }
  }

  // -------------------------------------------------------------- caminhos
  const faltam = Math.max(0, 4 - lancadas);
  const finalizadosPorSemana = comDado.length ? comDado.reduce((x, s) => x + (s.finalizados ?? 0), 0) / comDado.length : 0;
  const valorAtual = dados.pesoAtendimento + (dados.csat?.pesoAtual ?? 0) + (dados.tme?.pesoAtual ?? 0);
  const dias = Math.max(1, dados.diasRestantes);
  const diasLancados = comDado.reduce((x, s) => x + s.dias, 0);
  const mediaPorDia = diasLancados ? comDado.reduce((x, s) => x + (s.finalizados ?? 0), 0) / diasLancados : null;
  const aMaisPorDia = (pontos: number, valor: number) => (valor > 0 ? Math.ceil(pontos / valor / dias) : null);

  const ganhoCsat = dados.csat && dados.csat.pesoTopo > dados.csat.pesoAtual
    ? faltam * finalizadosPorSemana * (dados.csat.pesoTopo - dados.csat.pesoAtual) : 0;
  const ganhoTme = dados.tme && dados.tme.pesoMelhor > dados.tme.pesoAtual
    ? faltam * finalizadosPorSemana * (dados.tme.pesoMelhor - dados.tme.pesoAtual) : 0;
  const ganhoMon = dados.monitoria && dados.monitoria.media != null && dados.monitoria.media < dados.monitoria.piso
    ? faltam * dados.monitoria.peso * dados.monitoria.piso : 0;

  type Caminho = { icone: string; titulo: string; texto: string };
  const caminhos: Caminho[] = [];
  const extraDia = aMaisPorDia(falta, valorAtual);
  if (extraDia != null && falta > 0) {
    caminhos.push({ icone: 'M10 4v12M4 10h12', titulo: `${extraDia} atendimento${extraDia > 1 ? 's' : ''} a mais por dia`,
      texto: mediaPorDia != null ? `de ${pts(mediaPorDia)} para ${pts(mediaPorDia + extraDia)} por dia, até ${dados.fimDoCiclo}` : `até ${dados.fimDoCiclo}` });
  }
  const cobre = (g: number) => (g >= falta ? 'cobre o que falta' : `+${pts(g)} pts`);
  if (ganhoCsat > 0) caminhos.push({ icone: 'm10 3 2.1 4.4 4.9.6-3.6 3.3.9 4.8L10 13.8 5.7 16.1l.9-4.8L3 8l4.9-.6Z',
    titulo: `C-SAT ${dados.csat!.rotuloTopo}`, texto: `nas ${faltam} semana${faltam > 1 ? 's' : ''} que faltam: ${cobre(ganhoCsat)}` });
  if (ganhoTme > 0) caminhos.push({ icone: 'M10 6v4l2.5 1.5M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z',
    titulo: `TME ${dados.tme!.rotuloMelhor}`, texto: `na faixa de cima: ${cobre(ganhoTme)}` });
  if (ganhoMon > 0) caminhos.push({ icone: 'M7.5 11l2 2 3.5-4M5 3.5h10v14H5z',
    titulo: `Monitoria a partir de ${percentual(dados.monitoria!.piso)}`, texto: `nas semanas que faltam: ${cobre(ganhoMon)}` });

  // Combinado: o que está mais perto (faixas e monitoria) e o resto em atendimentos.
  const partes = [ganhoCsat > 0 && `C-SAT ${dados.csat!.rotuloTopo}`, ganhoTme > 0 && `TME ${dados.tme!.rotuloMelhor}`,
    ganhoMon > 0 && 'monitoria acima do piso'].filter(Boolean) as string[];
  let combinado: string | null = null;
  if (partes.length && falta > 0) {
    const resto = falta - (ganhoCsat + ganhoTme + ganhoMon);
    const valorNovo = dados.pesoAtendimento + (ganhoCsat > 0 ? dados.csat!.pesoTopo : dados.csat?.pesoAtual ?? 0)
      + (ganhoTme > 0 ? dados.tme!.pesoMelhor : dados.tme?.pesoAtual ?? 0);
    const n = resto > 0 ? aMaisPorDia(resto, valorNovo) : 0;
    combinado = `${partes.join(' e ')}${n ? ` e ${n} atendimento${n > 1 ? 's' : ''} a mais por dia` : ' já bastam'}`;
  }

  return (
    <section className="rounded-[20px] bg-superficie px-6 py-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Para bater a meta em {mes}</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SELO[situ][1]}`}>{SELO[situ][0]}</span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        {lancadas} de 4 semanas lançadas · {dados.diasRestantes} dia{dados.diasRestantes === 1 ? '' : 's'} de atendimento até {dados.fimDoCiclo}
      </p>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Hoje', `${pts(res.hoje)} pts`, 'text-slate-900'],
          ['No ritmo atual', `${pts(res.projecao)} pts`, situ === 'risco' ? 'text-amber-700 dark:text-amber-300' : situ === 'abaixo' ? 'text-rose-700 dark:text-rose-300' : 'text-marca-700 dark:text-marca-400'],
          ['Meta', `${pts(meta)} pts`, 'text-slate-900'],
          [falta > 0 ? 'Faltam' : 'De sobra', `${pts(Math.abs(falta))} pts`, 'text-slate-900'],
        ].map(([rot, val, cor]) => (
          <div key={rot} className="rounded-xl bg-slate-50 px-4 py-2.5">
            <p className="text-xs text-slate-500">{rot}</p>
            <p className={`text-xl font-semibold tabular-nums ${cor}`}>{val}</p>
          </div>
        ))}
      </div>

      {situ === 'batida' ? (
        <p className="mt-3 text-sm text-slate-600"><b className="text-slate-900">Meta batida.</b> Tudo o que vier a mais soma.</p>
      ) : (
        <>
          {tendencias.length > 0 && (
            <>
              <p className="mt-4 text-xs font-semibold text-slate-500">O que mudou entre as semanas {a.semana}ª e {b.semana}ª</p>
              <div className="mt-1.5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {tendencias.map((t) => (
                  <div key={t.rotulo} className="rounded-xl px-4 py-2.5 text-sm ring-1 ring-slate-200">
                    <p className="text-xs text-slate-500">{t.rotulo}</p>
                    <p className="font-semibold tabular-nums text-slate-900">
                      {t.antes} → {t.depois}
                      <span className={`ml-1.5 text-xs ${t.caiu ? 'text-rose-700 dark:text-rose-300' : 'text-marca-700 dark:text-marca-400'}`}>{t.caiu ? '▼' : '▲'}</span>
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}

          {situ === 'deve' ? (
            <p className="mt-3 text-sm text-slate-600">
              <b className="text-slate-900">No ritmo atual você bate a meta</b>, com {pts(-falta)} pts de sobra. É só manter.
            </p>
          ) : caminhos.length > 0 && (
            <>
              <p className="mt-4 text-xs font-semibold text-slate-500">Caminhos para chegar lá</p>
              <div className="mt-1.5 grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
                {caminhos.map((c) => (
                  <div key={c.titulo} className="rounded-xl px-4 py-3 text-sm ring-1 ring-slate-200">
                    <svg aria-hidden viewBox="0 0 20 20" className="h-[18px] w-[18px] text-marca-600" fill="none" stroke="currentColor"
                         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={c.icone} /></svg>
                    <p className="mt-1 font-semibold text-slate-900">{c.titulo}</p>
                    <p className="text-xs text-slate-500">{c.texto}</p>
                  </div>
                ))}
                {combinado && (
                  <div className="rounded-xl px-4 py-3 text-sm ring-2 ring-marca-600/50">
                    <svg aria-hidden viewBox="0 0 20 20" className="h-[18px] w-[18px] text-marca-600" fill="none" stroke="currentColor"
                         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 16c3 0 3-12 6-12s3 12 6 12" /></svg>
                    <p className="mt-1 font-semibold text-slate-900">Combinado</p>
                    <p className="text-xs text-slate-500">{combinado}</p>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">
                Cada caminho, sozinho, com os pesos do seu cargo. O &ldquo;por dia&rdquo; conta os dias da sua escala até {dados.fimDoCiclo}, sem as férias.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}
