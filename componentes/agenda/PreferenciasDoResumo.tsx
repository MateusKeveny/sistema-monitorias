'use client';

import { useState } from 'react';
import { criarClienteDaAgenda } from '@/lib/agenda/db-cliente';
import type { Preferencias } from '@/lib/agenda/tipos';

/** O resumo do dia: liga/desliga, a hora, fins de semana e as pendências do sistema. */
export default function PreferenciasDoResumo({ inicial, gestor, usuarioId }: { inicial: Preferencias; gestor: boolean; usuarioId: string }) {
  const [p, setP] = useState<Preferencias>(inicial);
  const [situacao, setSituacao] = useState<string | null>(null);

  async function mudar(novo: Partial<Preferencias>) {
    const proximo = { ...p, ...novo };
    setP(proximo);
    setSituacao('Salvando…');
    const { error } = await criarClienteDaAgenda().from('agenda_preferencias').upsert({ usuario_id: usuarioId, ...proximo });
    setSituacao(error ? `Não salvou: ${error.message}` : 'Salvo');
    if (!error) setTimeout(() => setSituacao(null), 1500);
  }

  const linha = 'flex items-center justify-between gap-4 py-3';

  return (
    <div className="divide-y divide-slate-100">
      <label className={linha}>
        <span>
          <span className="block text-sm font-medium text-slate-800">Resumo do dia</span>
          <span className="block text-xs text-slate-500">Uma notificação com o que vence hoje, o atrasado e as pendências</span>
        </span>
        <Chave ligada={p.resumo_ativo} aoMudar={(v) => mudar({ resumo_ativo: v })} />
      </label>
      {p.resumo_ativo && (
        <>
          <label className={linha}>
            <span className="text-sm text-slate-700">Horário</span>
            <input type="time" value={p.resumo_hora.slice(0, 5)} step={300}
                   onChange={(e) => e.target.value && mudar({ resumo_hora: e.target.value })}
                   className="rounded-lg border border-slate-300 bg-superficie px-2 py-1 text-sm text-slate-900" />
          </label>
          <label className={linha}>
            <span className="text-sm text-slate-700">Também sábado e domingo</span>
            <Chave ligada={p.resumo_fim_semana} aoMudar={(v) => mudar({ resumo_fim_semana: v })} />
          </label>
        </>
      )}
      {gestor && (
        <label className={linha}>
          <span>
            <span className="block text-sm font-medium text-slate-800">Pendências do Performance</span>
            <span className="block text-xs text-slate-500">Semanas sem volume, fechamento, diário, reports e chamados no plano do dia</span>
          </span>
          <Chave ligada={p.pendencias} aoMudar={(v) => mudar({ pendencias: v })} />
        </label>
      )}
      {situacao && <p className="pt-2 text-xs text-slate-500">{situacao}</p>}
    </div>
  );
}

function Chave({ ligada, aoMudar }: { ligada: boolean; aoMudar: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={ligada} onClick={() => aoMudar(!ligada)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${ligada ? 'bg-marca-600' : 'bg-slate-300'}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${ligada ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}
