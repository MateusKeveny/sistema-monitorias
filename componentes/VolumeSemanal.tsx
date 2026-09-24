'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Cartao, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import type { Pessoa } from '@/lib/tipos';

export type LinhaVolume = {
  pessoa_id: string;
  semana: number;
  finalizados: number;
  tma_seg: number | null;
  tme_seg: number | null;
};

/** Segundos → "H:MM:SS". As horas passam de 24 sem virar dia. */
function paraTempo(seg: number | null): string {
  if (seg == null) return '';
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = seg % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** "H:MM:SS" ou "MM:SS" → segundos. Vazio → null; inválido → NaN. */
function paraSegundos(texto: string): number | null {
  const t = texto.trim();
  if (!t) return null;
  const partes = t.split(':').map(Number);
  if (partes.length < 2 || partes.length > 3 || partes.some((p) => !Number.isInteger(p) || p < 0)) return NaN;
  const [h, m, s] = partes.length === 3 ? partes : [0, ...partes];
  if (m > 59 || s > 59) return NaN;
  return h * 3600 + m * 60 + s;
}

type Rascunho = Record<string, { finalizados: string; tma: string; tme: string }>;

const entrada = `w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums
                 outline-none focus:border-marca-600 disabled:bg-slate-50`;

/**
 * Volume da semana, digitado pelo gestor: uma linha por pessoa, a semana
 * inteira de uma vez. É daqui que saem os pontos por atendimento, a faixa de
 * TME da equipe e a base do C-SAT de Expansão.
 */
export default function VolumeSemanal({
  competencia, canal, pessoas, volumes,
}: {
  competencia: string;
  /** 'huggy' = Expansão · 'diretores' = Diretores-Expansão. */
  canal: 'huggy' | 'diretores';
  /** Só quem pontua por atendimento no cargo vigente. */
  pessoas: Pessoa[];
  volumes: LinhaVolume[];
}) {
  const router = useRouter();
  const [semana, setSemana] = useState(1);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const inicial = (s: number): Rascunho => Object.fromEntries(pessoas.map((p) => {
    const v = volumes.find((x) => x.pessoa_id === p.id && x.semana === s);
    return [p.id, {
      finalizados: v ? String(v.finalizados) : '',
      tma: paraTempo(v?.tma_seg ?? null),
      tme: paraTempo(v?.tme_seg ?? null),
    }];
  }));
  const [rascunho, setRascunho] = useState<Rascunho>(() => inicial(1));

  function trocarSemana(s: number) {
    setSemana(s); setRascunho(inicial(s)); setErro(null); setAviso(null);
  }

  const lancadas = new Set(volumes.map((v) => v.semana));

  async function salvar() {
    setErro(null); setAviso(null);
    const gravar: object[] = [];
    const apagar: string[] = [];

    for (const p of pessoas) {
      const d = rascunho[p.id];
      const vazio = !d.finalizados.trim() && !d.tma.trim() && !d.tme.trim();
      const existia = volumes.some((v) => v.pessoa_id === p.id && v.semana === semana);
      if (vazio) { if (existia) apagar.push(p.id); continue; }

      const finalizados = Number(d.finalizados || 0);
      const tma = paraSegundos(d.tma);
      const tme = paraSegundos(d.tme);
      if (!Number.isInteger(finalizados) || finalizados < 0) { setErro(`Finalizados inválido para ${p.nome}.`); return; }
      if (Number.isNaN(tma) || Number.isNaN(tme)) {
        setErro(`Tempo inválido para ${p.nome}. Use H:MM:SS ou MM:SS.`); return;
      }
      gravar.push({
        pessoa_id: p.id, mes_competencia: competencia, semana, canal,
        finalizados, tma_seg: tma, tme_seg: tme, atualizado_em: new Date().toISOString(),
      });
    }

    setOcupado(true);
    const db = criarClienteNavegador();
    if (gravar.length) {
      const { error } = await db.from('volume_semanal')
        .upsert(gravar, { onConflict: 'pessoa_id,mes_competencia,semana,canal' });
      if (error) { setOcupado(false); setErro(error.message); return; }
    }
    if (apagar.length) {
      const { error } = await db.from('volume_semanal').delete()
        .eq('mes_competencia', competencia).eq('canal', canal).eq('semana', semana).in('pessoa_id', apagar);
      if (error) { setOcupado(false); setErro(error.message); return; }
    }
    setOcupado(false);
    setAviso(`${semana}ª semana salva: ${gravar.length} pessoa(s)${apagar.length ? `, ${apagar.length} removida(s)` : ''}.`);
    router.refresh();
  }

  const set = (id: string, campo: 'finalizados' | 'tma' | 'tme', valor: string) =>
    setRascunho((r) => ({ ...r, [id]: { ...r[id], [campo]: valor } }));

  return (
    <Cartao
      titulo={`Volume semanal · ${canal === 'huggy' ? 'Expansão' : 'Diretores-Expansão'}`}
      acao={
        <div className="flex items-center gap-3">
          <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="tablist" aria-label="Semana">
            {[1, 2, 3, 4].map((s) => (
              <button
                key={s} type="button" role="tab" aria-selected={s === semana} disabled={ocupado}
                onClick={() => trocarSemana(s)}
                className={`rounded-md px-3 py-1 text-xs font-medium ${
                  s === semana ? 'bg-superficie text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              >
                {s}ª{lancadas.has(s) && <span className="ml-1 text-emerald-600">●</span>}
              </button>
            ))}
          </div>
          <button
            type="button" onClick={salvar} disabled={ocupado || pessoas.length === 0}
            className="rounded-lg bg-marca-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-marca-700 disabled:opacity-40"
          >
            {ocupado ? 'Salvando…' : `Salvar ${semana}ª semana`}
          </button>
        </div>
      }
    >
      {erro && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {aviso && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

      {pessoas.length === 0 ? (
        <Vazio>Ninguém com cargo que pontue por atendimento nesta competência.</Vazio>
      ) : (
        <div className="py-5">
          <Tabela>
            <thead>
              <tr>
                <Th>Pessoa</Th>
                <Th className="text-right">Finalizados</Th>
                <Th className="text-right">TMA</Th>
                <Th className="text-right">TME</Th>
              </tr>
            </thead>
            <tbody>
              {pessoas.map((p) => {
                const d = rascunho[p.id];
                return (
                  <tr key={p.id}>
                    <Td className="font-medium text-slate-800">
                      {p.nome}{!p.ativo && <span className="ml-2 text-xs text-slate-500">· desligado</span>}
                    </Td>
                    <Td className="text-right">
                      <input inputMode="numeric" value={d.finalizados} disabled={ocupado}
                             aria-label={`Finalizados de ${p.nome}`}
                             onChange={(e) => set(p.id, 'finalizados', e.target.value)} className={entrada} />
                    </Td>
                    <Td className="text-right">
                      <input value={d.tma} disabled={ocupado} placeholder="H:MM:SS"
                             aria-label={`TMA de ${p.nome}`}
                             onChange={(e) => set(p.id, 'tma', e.target.value)} className={entrada} />
                    </Td>
                    <Td className="text-right">
                      <input value={d.tme} disabled={ocupado} placeholder="H:MM:SS"
                             aria-label={`TME de ${p.nome}`}
                             onChange={(e) => set(p.id, 'tme', e.target.value)} className={entrada} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabela>
        </div>
      )}

      <p className="text-xs leading-relaxed text-slate-500">
        Tempos em <strong>H:MM:SS</strong> (as horas podem passar de 24) ou MM:SS. Deixar a linha toda
        em branco e salvar remove o volume da pessoa naquela semana. ● indica semana já lançada.
      </p>
    </Cartao>
  );
}
