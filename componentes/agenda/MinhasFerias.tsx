'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteDaAgenda } from '@/lib/agenda/db-cliente';
import { ddmm, duracao, sobreposicoes, type PeriodoDeFerias } from '@/lib/ferias';

type Minha = { id: string; inicio: string; fim: string; observacao: string | null };

/**
 * As suas férias, no banco da agenda (supabase/agenda/04-minhas-ferias.sql).
 * Ao preencher, já mostra quem da equipe está fora no mesmo período.
 */
export default function MinhasFerias({ minhas, equipe, hoje }: { minhas: Minha[]; equipe: PeriodoDeFerias[]; hoje: string }) {
  const router = useRouter();
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [obs, setObs] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const valido = inicio && fim && fim >= inicio;
  const junto = valido
    ? sobreposicoes([...equipe, { id: 'nova', pessoa: 'você', inicio, fim, minha: true }], '0000-01-01')
        .filter((s) => s.a.id === 'nova' || s.b.id === 'nova')
        .map((s) => ({ outro: s.a.id === 'nova' ? s.b : s.a, inicio: s.inicio, fim: s.fim }))
    : [];

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!valido) { setErro('Preencha a saída e o último dia.'); return; }
    if (duracao({ inicio, fim }) > 60) { setErro('Período maior que 60 dias: confira as datas.'); return; }
    setOcupado(true); setErro(null);
    const { error } = await criarClienteDaAgenda().from('minhas_ferias').insert({ inicio, fim, observacao: obs.trim() || null });
    setOcupado(false);
    if (error) { setErro(`Não foi possível salvar: ${error.message}`); return; }
    setInicio(''); setFim(''); setObs('');
    router.refresh();
  }

  async function excluir(m: Minha) {
    if (!confirm(`Excluir as suas férias de ${ddmm(m.inicio)} a ${ddmm(m.fim)}?`)) return;
    const { error } = await criarClienteDaAgenda().from('minhas_ferias').delete().eq('id', m.id);
    if (error) alert(error.message);
    router.refresh();
  }

  const campo = 'w-full rounded-lg border border-slate-300 bg-superficie px-3 py-2 text-sm text-slate-900';
  const futuras = minhas.filter((m) => m.fim >= hoje);

  return (
    <div className="space-y-4">
      {futuras.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {futuras.map((m) => (
            <li key={m.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-sky-500" />
              <span className="flex-1 tabular-nums text-slate-700">
                {ddmm(m.inicio)} a {ddmm(m.fim)} · {duracao(m)} dias
                {m.inicio <= hoje && <span className="ml-2 text-xs font-medium text-marca-700 dark:text-marca-400">agora</span>}
                {m.observacao && <span className="block text-xs text-slate-500">{m.observacao}</span>}
              </span>
              <button onClick={() => excluir(m)} className="rounded px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50">Excluir</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={salvar} className="grid gap-3 sm:grid-cols-[1fr_1fr_2fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Saída</span>
          <input type="date" className={campo} value={inicio} onChange={(e) => setInicio(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Último dia</span>
          <input type="date" className={campo} value={fim} min={inicio || undefined} onChange={(e) => setFim(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Observação <span className="font-normal text-slate-400">(opcional)</span></span>
          <input className={campo} maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} />
        </label>
        <button type="submit" disabled={ocupado}
                className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-60">
          {ocupado ? 'Salvando…' : 'Adicionar'}
        </button>
      </form>
      {junto.length > 0 && (
        <div role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-300">
          <p className="font-semibold">Gente da equipe fora no mesmo período</p>
          <ul className="mt-1">{junto.map((j) => <li key={j.outro.id}>{j.outro.pessoa}: {ddmm(j.inicio)} a {ddmm(j.fim)}</li>)}</ul>
        </div>
      )}
      {erro && <p role="alert" className="text-sm text-rose-700">{erro}</p>}
    </div>
  );
}
