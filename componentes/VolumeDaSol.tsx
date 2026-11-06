'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Quadro } from '@/componentes/ui';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import { dataHora, diaMes, percentual, periodoDaSemana } from '@/lib/formatar';

export type LinhaDaSol = {
  semana: number; total: number | null; resolvidos_ia: number | null;
  salvo_por_nome: string | null; salvo_em: string | null;
};

const SEMANAS = [1, 2, 3, 4];
const numero = (t: string) => (t.trim() === '' ? null : Number(t.replace(/\D/g, '')));

/**
 * Atendimento da Sol (3.9.0, migração 99): por fila e semana, o número geral
 * de atendimentos e quantos a Sol (a IA) resolveu. Só informação — não pontua.
 * Serve para qualquer fila de qualquer setor (grava pelo número da fila).
 */
export default function VolumeDaSol({ canalId, nomeFila, competencia, linhas }: {
  canalId: number; nomeFila: string; competencia: string; linhas: LinhaDaSol[];
}) {
  const router = useRouter();
  const inicial = Object.fromEntries(SEMANAS.map((s) => {
    const l = linhas.find((x) => x.semana === s);
    return [s, { total: l?.total != null ? String(l.total) : '', sol: l?.resolvidos_ia != null ? String(l.resolvidos_ia) : '' }];
  })) as Record<number, { total: string; sol: string }>;
  const [valores, setValores] = useState(inicial);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const mudou = SEMANAS.filter((s) => valores[s].total !== inicial[s].total || valores[s].sol !== inicial[s].sol);

  async function salvar() {
    for (const s of mudou) {
      const t = numero(valores[s].total), v = numero(valores[s].sol);
      if (t != null && v != null && v > t) { setAviso({ ok: false, texto: `${s}ª semana: a Sol não pode ter resolvido mais que o número geral.` }); return; }
    }
    setOcupado(true); setAviso(null);
    const db = criarClienteNavegador();
    for (const s of mudou) {
      const total = numero(valores[s].total), resolvidos_ia = numero(valores[s].sol);
      const { error } = total == null && resolvidos_ia == null
        ? await db.from('volume_ia').delete().eq('canal_id', canalId).eq('mes_competencia', competencia).eq('semana', s)
        : await db.from('volume_ia').upsert({ canal_id: canalId, mes_competencia: competencia, semana: s, total, resolvidos_ia },
            { onConflict: 'canal_id,mes_competencia,semana' });
      if (error) { setOcupado(false); setAviso({ ok: false, texto: await mensagemDoErro(error) }); return; }
    }
    setOcupado(false);
    setAviso({ ok: true, texto: 'Salvo.' });
    router.refresh();
  }

  const soma = (k: 'total' | 'sol') => SEMANAS.reduce((t, s) => t + (numero(valores[s][k]) ?? 0), 0);
  const totalMes = soma('total'), solMes = soma('sol');
  const entrada = 'w-28 rounded-md border border-slate-300 bg-superficie px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-marca-600';

  return (
    <Quadro titulo={`Atendimento da Sol · ${nomeFila}`}
            subtitulo="Por semana: o número geral de atendimentos da fila e quantos a Sol resolveu. Só informação: não entra na pontuação.">
      <div className="-mx-6 overflow-x-auto sm:-mx-7">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-slate-500">
              <th className="py-2.5 pl-6 pr-3 text-left font-medium sm:pl-7">Semana</th>
              <th className="px-3 py-2.5 text-right font-medium">Número geral</th>
              <th className="px-3 py-2.5 text-right font-medium">Resolvidos pela Sol</th>
              <th className="px-3 py-2.5 text-right font-medium">% da Sol</th>
              <th className="py-2.5 pl-3 pr-6 text-left font-medium sm:pr-7">Última alteração</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {SEMANAS.map((s) => {
              const [de, ate] = periodoDaSemana(competencia, s);
              const t = numero(valores[s].total), v = numero(valores[s].sol);
              const l = linhas.find((x) => x.semana === s);
              return (
                <tr key={s}>
                  <td className="py-2 pl-6 pr-3 text-slate-700 sm:pl-7">{s}ª semana <span className="text-xs text-slate-400">· {diaMes(de)} a {diaMes(ate)}</span></td>
                  <td className="px-3 py-2 text-right">
                    <input inputMode="numeric" value={valores[s].total} disabled={ocupado} aria-label={`Número geral da ${s}ª semana`}
                           onChange={(e) => { setValores({ ...valores, [s]: { ...valores[s], total: e.target.value } }); setAviso(null); }} className={entrada} />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input inputMode="numeric" value={valores[s].sol} disabled={ocupado} aria-label={`Resolvidos pela Sol na ${s}ª semana`}
                           onChange={(e) => { setValores({ ...valores, [s]: { ...valores[s], sol: e.target.value } }); setAviso(null); }} className={entrada} />
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{t && v != null ? percentual(v / t) : '—'}</td>
                  <td className="py-2 pl-3 pr-6 text-xs text-slate-500 sm:pr-7">{l?.salvo_em ? `${l.salvo_por_nome ?? '—'} · ${dataHora(l.salvo_em)}` : '—'}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-200 font-semibold text-slate-900">
              <td className="py-2 pl-6 pr-3 sm:pl-7">No mês</td>
              <td className="px-3 py-2 text-right">{totalMes ? totalMes.toLocaleString('pt-BR') : '—'}</td>
              <td className="px-3 py-2 text-right">{solMes ? solMes.toLocaleString('pt-BR') : '—'}</td>
              <td className="px-3 py-2 text-right">{totalMes ? percentual(solMes / totalMes) : '—'}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
        {aviso && <span className={`text-sm ${aviso.ok ? 'text-marca-700 dark:text-marca-400' : 'text-rose-700 dark:text-rose-300'}`}>{aviso.texto}</span>}
        <button type="button" onClick={salvar} disabled={ocupado || mudou.length === 0}
                className="rounded-full bg-marca-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
          {ocupado ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </Quadro>
  );
}
