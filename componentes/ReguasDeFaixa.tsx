'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import type { RegraCota } from '@/lib/tipos';

type Unidade = 'min' | '%';

/** No banco, TME é segundo e C-SAT/monitoria é fração; na tela, minutos e %. */
const paraTela = (v: number, u: Unidade) =>
  (u === 'min' ? Math.round((v / 60) * 100) / 100 : Math.round(v * 10000) / 100).toLocaleString('pt-BR');
const paraBanco = (t: string, u: Unidade) => {
  const n = Number(t.trim().replace(',', '.'));
  if (!t.trim() || !Number.isFinite(n)) return NaN;
  return u === 'min' ? Math.round(n * 60) : Math.round((n / 100) * 10000) / 10000;
};

const REGUAS: { grupo: string; titulo: string; cor: string; unidade: Unidade; maiorMelhor: boolean; texto: string }[] = [
  { grupo: 'csat', titulo: 'C-SAT', cor: '#60a5fa', unidade: '%', maiorMelhor: true,
    texto: 'O C-SAT da semana escolhe a faixa; a faixa multiplica os finalizados. Vale para os dois canais.' },
  { grupo: 'tme', titulo: 'TME Médio Equipe · Expansão', cor: '#34d399', unidade: 'min', maiorMelhor: false,
    texto: 'O TME médio da equipe na semana escolhe a faixa.' },
  { grupo: 'tme_diretores', titulo: 'TME · Diretores-Expansão', cor: '#2dd4bf', unidade: 'min', maiorMelhor: false,
    texto: 'O TME da pessoa na semana escolhe a faixa.' },
  { grupo: 'monitoria', titulo: 'Monitoria', cor: '#fbbf24', unidade: '%', maiorMelhor: true,
    texto: 'A média da semana só pontua acima do mínimo — o valor exato do corte não pontua.' },
];

const TOM = {
  v2: 'bg-marca-600/25', v1: 'bg-marca-600/13', a: 'bg-amber-500/15', r1: 'bg-rose-500/12', r2: 'bg-rose-500/22',
};

/**
 * Faixas das métricas (1.20.0): cada métrica com faixa numa régua, do que tira
 * ao que soma, com o peso do cargo de base em cada faixa e os cortes
 * editáveis logo abaixo.
 *
 * As faixas no banco são contínuas — o fim de uma é o começo da próxima —, e
 * por isso cada corte grava as duas pontas de uma vez. Antes eram dois campos
 * soltos por métrica ("de" e "até"), e dava para deixar um buraco entre faixas.
 */
export default function ReguasDeFaixa({
  regras, pesosBase, nomeBase,
}: {
  regras: RegraCota[];
  /** Peso de cada regra no cargo de base, só para mostrar na régua. */
  pesosBase: Record<string, number | null>;
  nomeBase: string;
}) {
  const router = useRouter();
  const inicial = (): Record<string, string[]> => Object.fromEntries(REGUAS.map((g) => {
    const faixas = ordenadas(g.grupo);
    const valores = g.grupo === 'monitoria'
      ? faixas.map((r) => r.faixa_min)
      : faixas.slice(0, -1).map((r) => r.faixa_max);
    return [g.grupo, valores.map((v) => (v == null ? '' : paraTela(Number(v), g.unidade)))];
  }));
  const [cortes, setCortes] = useState(inicial);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  function ordenadas(grupo: string) {
    return regras.filter((r) => r.grupo === grupo && r.ativo)
      .sort((a, b) => (a.faixa_min ?? -Infinity) - (b.faixa_min ?? -Infinity));
  }

  /** As mudanças em forma de `update` por regra. */
  function alteracoes() {
    const lista: { chave: string; rotulo: string; mudanca: Record<string, number> }[] = [];
    for (const g of REGUAS) {
      const faixas = ordenadas(g.grupo);
      const valores = (cortes[g.grupo] ?? []).map((t) => paraBanco(t, g.unidade));
      if (valores.some(Number.isNaN)) throw new Error(`Corte inválido em ${g.titulo}.`);
      if (valores.some((v, i) => i && v <= valores[i - 1])) throw new Error(`Em ${g.titulo}, os cortes precisam crescer da esquerda para a direita.`);
      if (g.grupo === 'monitoria') {
        faixas.forEach((r, i) => { if (valores[i] !== Number(r.faixa_min)) lista.push({ chave: r.chave, rotulo: r.rotulo, mudanca: { faixa_min: valores[i] } }); });
        continue;
      }
      valores.forEach((v, i) => {
        if (v !== Number(faixas[i].faixa_max)) lista.push({ chave: faixas[i].chave, rotulo: faixas[i].rotulo, mudanca: { faixa_max: v } });
        if (v !== Number(faixas[i + 1].faixa_min)) lista.push({ chave: faixas[i + 1].chave, rotulo: faixas[i + 1].rotulo, mudanca: { faixa_min: v } });
      });
    }
    return lista;
  }

  let pendentes = 0;
  try { pendentes = alteracoes().length; } catch { pendentes = 1; }

  async function salvar() {
    let lista;
    try { lista = alteracoes(); } catch (e) { setErro((e as Error).message); return; }
    if (!lista.length) return;
    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    for (const item of lista) {
      const { error } = await db.from('regras').update(item.mudanca).eq('chave', item.chave);
      if (error) { setOcupado(false); setErro(`${item.rotulo}: ${error.message}`); return; }
    }
    setOcupado(false);
    setAviso('Faixas salvas. Os meses em aberto foram recalculados; os fechados não mudam.');
    router.refresh();
  }

  const numero = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

  return (
    <div className="space-y-4">
      {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

      <div className="grid gap-4 xl:grid-cols-2">
        {REGUAS.map((g) => {
          const faixas = ordenadas(g.grupo);
          if (!faixas.length) return null;
          const valores = cortes[g.grupo] ?? [];
          const u = g.unidade;

          // Segmentos da régua: na monitoria, "até o corte" é um segmento sem regra.
          const segmentos = g.grupo === 'monitoria'
            ? [{ rotulo: `até ${valores[0]}${u}`, peso: null as number | null, semRegra: true },
               { rotulo: `acima de ${valores[0]}${u}`, peso: pesosBase[faixas[0].chave] ?? null, semRegra: false }]
            : faixas.map((r, i) => ({
              rotulo: i === 0
                ? (g.maiorMelhor ? `abaixo de ${valores[0]}${u}` : `até ${valores[0]} ${u}`)
                : i === faixas.length - 1
                  ? (g.maiorMelhor ? `${valores[i - 1]}${u} ou mais` : `acima de ${valores[i - 1]} ${u}`)
                  : `${valores[i - 1]} a ${valores[i]}${u === '%' ? '%' : ' min'}`,
              peso: pesosBase[r.chave] ?? null,
              semRegra: false,
            }));

          const positivos = segmentos.map((s) => s.peso ?? 0);
          const maior = Math.max(...positivos), menor = Math.min(...positivos);
          const tom = (s: { peso: number | null; semRegra: boolean }) => s.semRegra || s.peso == null ? TOM.r1
            : s.peso > 0 ? (s.peso === maior ? TOM.v2 : TOM.v1)
              : s.peso < 0 ? (s.peso === menor ? TOM.r2 : TOM.r1) : TOM.a;

          return (
            <section key={g.grupo} className="rounded-[20px] bg-superficie px-6 py-5 shadow-sm">
              <h2 className="flex items-center text-base font-semibold text-slate-800">
                <i className="mr-2.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: g.cor }} />
                {g.titulo}
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">{g.texto}</p>

              <div className="my-4 flex gap-1">
                {segmentos.map((s, i) => (
                  <div key={i} className={`flex-1 rounded-xl px-2 py-3 text-center ${tom(s)}`}>
                    <b className="block text-[13px] text-slate-900">{s.rotulo}</b>
                    <span className="mt-0.5 block text-xs text-slate-600">
                      {s.semRegra ? 'não pontua'
                        : s.peso == null ? `não pontua no ${nomeBase}`
                          : g.grupo === 'monitoria' ? `${numero(s.peso)} × média no ${nomeBase}`
                            : `${s.peso > 0 ? '+' : s.peso < 0 ? '−' : ''}${numero(Math.abs(s.peso))}${i === 0 ? ` no ${nomeBase}` : ''}`}
                    </span>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
                {valores.length === 1 ? 'Corte em' : 'Cortes em'}
                {valores.map((v, i) => (
                  <label key={i} className="flex items-center gap-1.5">
                    <input value={v} disabled={ocupado} inputMode="decimal"
                           aria-label={`Corte ${i + 1} de ${g.titulo}`}
                           onChange={(e) => setCortes((s) => ({ ...s, [g.grupo]: s[g.grupo].map((x, j) => (j === i ? e.target.value : x)) }))}
                           className="w-20 rounded-lg border border-slate-300 bg-superficie px-2 py-1 text-right text-sm tabular-nums
                                      outline-none focus:border-marca-600" />
                    {u}
                  </label>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {pendentes > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-marca-600/40
                        bg-[#0f1a14] px-5 py-3 text-sm text-[#e8f5ec] shadow-2xl">
          <span>Faixas alteradas · recalcula os meses em aberto</span>
          <span className="flex gap-2">
            <button type="button" disabled={ocupado} onClick={() => { setCortes(inicial()); setErro(null); }}
                    className="rounded-lg border border-white/25 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-40">
              Desfazer
            </button>
            <button type="button" disabled={ocupado} onClick={salvar}
                    className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
              {ocupado ? 'Salvando…' : 'Salvar e recalcular'}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
