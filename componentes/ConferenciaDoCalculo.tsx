'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { dataHora, mesRotulo } from '@/lib/formatar';
import { carregarBaseDoMes } from '@/lib/base-do-mes';
import { CENARIO_VAZIO, simular } from '@/lib/simulacao';
import { mensagemDoErro } from '@/lib/erro-amigavel';

export type Verificacao = { chave: string; titulo: string; ok: boolean; detalhe: string | null; itens: string[] };
export type Rodada = { rodada_em: string; por: string; falhas: number; resultado: Verificacao[] };

/**
 * Conferência do cálculo (2.1.0, migração 72). As três verificações do banco
 * rodam todo dia às 06:00 e quando o gestor pede; a quarta — a simulação sem
 * cenário reproduz o resultado de hoje — roda aqui, no navegador, porque a
 * simulação é calculada no navegador.
 */
export default function ConferenciaDoCalculo({ ultima, competencia, fonte }: {
  ultima: Rodada | null;
  competencia: string;
  fonte: { extrato: string; mensal: string };
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [simulacao, setSimulacao] = useState<Verificacao | null>(null);

  useEffect(() => {
    carregarBaseDoMes(criarClienteNavegador(), competencia, fonte).then((base) => {
      const r = simular(base, CENARIO_VAZIO);
      const diferentes = r.filter((x) => Math.abs(x.simulado - x.hoje) > 1);
      setSimulacao({
        chave: 'simulacao', titulo: 'Simulação sem cenário = resultado de hoje', ok: diferentes.length === 0,
        detalhe: `${mesRotulo(competencia).toLowerCase()}: ${r.length} pessoa(s), ${r.reduce((a, x) => a + x.hoje, 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} pts`,
        itens: diferentes.map((x) => `${x.pessoa}: hoje ${Math.round(x.hoje)}, simulação ${Math.round(x.simulado)}`),
      });
    }).catch(() => setSimulacao({ chave: 'simulacao', titulo: 'Simulação sem cenário = resultado de hoje', ok: false,
      detalhe: null, itens: ['Não consegui carregar o extrato do mês para conferir.'] }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [competencia, fonte.extrato, fonte.mensal]);

  async function conferirAgora() {
    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().rpc('registrar_conferencia');
    setOcupado(false);
    if (error) {
      setErro(/timeout|canceling statement/i.test(error.message)
        ? 'A conferência demorou mais que o limite de uma tela. A das 06:00 roda sem esse limite; tente de novo mais tarde.'
        : await mensagemDoErro(error));
      return;
    }
    router.refresh();
  }

  const lista = [...(ultima?.resultado ?? []), ...(simulacao ? [simulacao] : [])];
  const falhas = lista.filter((v) => !v.ok).length;

  return (
    <div className="space-y-4">
      <div className={`flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-sm ${falhas
        ? 'bg-rose-500/15 text-slate-800' : 'bg-marca-600/12 text-slate-800'}`}>
        <span className={`grid h-7 w-7 place-items-center rounded-full font-bold ${falhas ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300' : 'bg-marca-600/20 text-marca-700 dark:text-marca-400'}`}>
          {falhas ? '!' : '✓'}
        </span>
        <span>
          {ultima ? <>
            <b>{falhas ? `${falhas} divergência${falhas > 1 ? 's' : ''}` : 'Cálculo conferido'}</b>
            {' '}· última conferência {dataHora(ultima.rodada_em)}{ultima.por !== 'sistema' ? `, por ${ultima.por.split(' ')[0]}` : ' (automática)'}
          </> : <b>Ainda não houve conferência.</b>}
        </span>
        <button type="button" onClick={conferirAgora} disabled={ocupado}
                className="ml-auto rounded-lg bg-marca-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
          {ocupado ? 'Conferindo…' : 'Conferir agora'}
        </button>
      </div>
      {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}

      <section className="rounded-[20px] bg-superficie px-5 py-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Verificações</h2>
        <p className="text-xs text-slate-500">
          De setembro/2026 em diante, o primeiro mês calculado pelo sistema. Rodam sozinhas todo dia às 06:00. Nada é
          corrigido sozinho: divergência aparece aqui e na sua tela inicial até ser resolvida.
        </p>
        <ul className="mt-2">
          {lista.map((v) => (
            <li key={v.chave} className="grid grid-cols-[1.75rem_1fr_auto] items-start gap-3 border-t border-slate-100 py-3">
              <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${v.ok
                ? 'bg-marca-600/15 text-marca-700 dark:text-marca-400' : 'bg-rose-500/15 text-rose-700 dark:text-rose-400'}`}>
                {v.ok ? '✓' : '!'}
              </span>
              <span>
                <b className="text-sm font-semibold text-slate-900">{v.titulo}</b>
                {v.detalhe && <span className="block text-xs text-slate-500">{v.detalhe}</span>}
                {!v.ok && v.itens.length > 0 && (
                  <ul className="mt-1 list-disc pl-4 text-xs text-rose-800 dark:text-rose-300">
                    {v.itens.slice(0, 20).map((i) => <li key={i}>{i}</li>)}
                    {v.itens.length > 20 && <li>e mais {v.itens.length - 20}</li>}
                  </ul>
                )}
              </span>
              <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${v.ok
                ? 'bg-marca-600/15 text-marca-700 dark:text-marca-400' : 'bg-rose-500/15 text-rose-700 dark:text-rose-400'}`}>
                {v.ok ? 'ok' : 'divergência'}
              </span>
            </li>
          ))}
          {!simulacao && <li className="border-t border-slate-100 py-3 text-sm text-slate-500">Conferindo a simulação…</li>}
        </ul>
      </section>
    </div>
  );
}
