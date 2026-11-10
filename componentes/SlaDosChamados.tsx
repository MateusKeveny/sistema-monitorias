'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import {
  HORAS_DO_DIA, MAX_FAIXAS, chaveDaFaixa, faixasDoSla, gravarSla, problemasDosCortes, rotuloDaFaixaSla, textoDoPrazo, unidadesSalvas,
  type RegraSla, type UnidadeSla,
} from '@/lib/sla';

const campo = 'w-20 rounded-lg border border-slate-300 bg-superficie px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-marca-600';
const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const lerNum = (t: string) => { const n = Number(t.trim().replace(',', '.')); return t.trim() && Number.isFinite(n) ? n : null; };

/** Um limite como está na tela: o número digitado e a unidade dele. */
type Limite = { texto: string; unidade: UnidadeSla };
const paraHoras = (l: Limite) => { const n = lerNum(l.texto); return n == null ? null : Math.round(n * (l.unidade === 'd' ? HORAS_DO_DIA : 1) * 100) / 100; };
const naUnidade = (horas: number, u: UnidadeSla) => fmt(u === 'd' ? horas / HORAS_DO_DIA : horas);

/**
 * SLA dos chamados (4.3.0, migração 104): quantas faixas e onde cada uma
 * termina. Cada limite tem a sua unidade, horas ou dias úteis (ex.: até 12 h,
 * de 12 h a 2 dias úteis). A última faixa é o "fora do prazo".
 * Os pesos de cada faixa ficam na tabela de Pesos por cargo.
 */
export default function SlaDosChamados({ regras, pesosBase, nomeBase }: {
  regras: RegraSla[];
  /** Peso de cada regra num cargo que recebe o SLA, só para mostrar. */
  pesosBase: Record<string, number | null>;
  nomeBase: string;
}) {
  const router = useRouter();
  const faixas = faixasDoSla(regras);
  const cortesSalvos = faixas.slice(0, -1).map((r) => Number(r.faixa_max));
  const unidadesIniciais = unidadesSalvas(faixas);
  const limitesSalvos = (): Limite[] => cortesSalvos.map((c, i) => ({ texto: naUnidade(c, unidadesIniciais[i]), unidade: unidadesIniciais[i] }));

  const [limites, setLimites] = useState<Limite[]>(limitesSalvos);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  if (!faixas.length) return null;

  const cortesEmHoras = limites.map(paraHoras);
  const unidades = limites.map((l) => l.unidade);
  const problema = problemasDosCortes(cortesEmHoras);
  const mudou = limites.length !== cortesSalvos.length
    || cortesEmHoras.some((c, i) => c !== cortesSalvos[i])
    || unidades.some((u, i) => u !== unidadesIniciais[i]);
  const prazoDias = cortesEmHoras.at(-1) != null ? cortesEmHoras.at(-1)! / HORAS_DO_DIA : null;

  const mudarLimite = (i: number, l: Partial<Limite>) => setLimites((ls) => ls.map((x, j) => (j === i ? { ...x, ...l } : x)));

  /** Troca a unidade de um limite convertendo o número (36 h ↔ 1,5 d). */
  function trocarUnidade(i: number, u: UnidadeSla) {
    const atual = limites[i];
    if (atual.unidade === u) return;
    const h = paraHoras(atual);
    mudarLimite(i, { unidade: u, texto: h == null ? atual.texto : naUnidade(h, u) });
  }

  function quantas(n: number) {
    const lista = [...limites];
    while (lista.length < n - 1) {
      const ultimo = lista.at(-1);
      const u = ultimo?.unidade ?? 'd';
      const base = (ultimo && lerNum(ultimo.texto)) ?? 0;
      lista.push({ texto: fmt(base + (u === 'd' ? 1 : 24)), unidade: u });
    }
    setLimites(lista.slice(0, n - 1));
  }

  async function salvar() {
    if (problema) { setErro(problema); return; }
    setOcupado(true); setErro(null); setAviso(null);
    const falha = await gravarSla(criarClienteNavegador(), regras, cortesEmHoras as number[], unidades);
    setOcupado(false);
    if (falha) { setErro(falha); return; }
    setAviso('SLA salvo. O mês em aberto é recalculado com as faixas novas; os meses fechados não mudam. Confira os pesos das faixas novas em Pesos por cargo.');
    router.refresh();
  }

  const peso = (chave: string) => {
    const p = pesosBase[chave];
    return p == null ? `não pontua no ${nomeBase}` : `${p > 0 ? '+' : p < 0 ? '−' : ''}${fmt(Math.abs(p))} no ${nomeBase}`;
  };

  return (
    <section className="rounded-[20px] bg-superficie px-6 py-5 shadow-sm">
      <h2 className="flex items-center text-base font-semibold text-slate-800">
        <i className="mr-2.5 inline-block h-2.5 w-2.5 rounded-full bg-sky-500" />
        SLA dos chamados
      </h2>
      <p className="mt-0.5 text-sm text-slate-500">
        O tempo de cada chamado resolvido escolhe a faixa. A última faixa é o fora do prazo: vai para a Fila de atrasos e só
        conta quando a gestão mantém o desconto. Cada limite pode ser em horas ou em dias úteis. Hoje o tempo vem do Elo,
        em dias úteis de 24 h.
      </p>

      {erro && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {aviso && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
        Quantas faixas
        <select value={limites.length + 1} disabled={ocupado} onChange={(e) => quantas(Number(e.target.value))}
                className="rounded-lg border border-slate-300 bg-superficie px-2 py-1 text-sm">
          {Array.from({ length: MAX_FAIXAS - 1 }, (_, i) => i + 2).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
        {limites.length === 1 ? 'Limite em' : 'Limites em'}
        {limites.map((l, i) => (
          <span key={i} className="flex items-center gap-1.5">
            <input value={l.texto} disabled={ocupado} inputMode="decimal" aria-label={`Limite ${i + 1} do SLA`}
                   onChange={(e) => mudarLimite(i, { texto: e.target.value })} className={campo} />
            <select value={l.unidade} disabled={ocupado} aria-label={`Unidade do limite ${i + 1}`}
                    onChange={(e) => trocarUnidade(i, e.target.value as UnidadeSla)}
                    className="rounded-lg border border-slate-300 bg-superficie px-1.5 py-1 text-sm">
              <option value="h">horas</option>
              <option value="d">dias úteis</option>
            </select>
          </span>
        ))}
      </div>

      {!problema && (
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {Array.from({ length: limites.length + 1 }, (_, i) => {
            // A chave que esta posição vai usar ao salvar: a primeira e a última
            // são sempre as mesmas, e as do meio voltam com o peso que tinham.
            const chave = chaveDaFaixa(i, limites.length + 1);
            const existente = chave in pesosBase ? { chave } : null;
            return (
              <li key={i} className={`rounded-xl px-3 py-2 text-center text-[13px] ${i === limites.length ? 'bg-rose-500/12' : 'bg-marca-600/13'}`}>
                <b className="block text-slate-900">{rotuloDaFaixaSla(i, cortesEmHoras as number[], unidades).replace(/^SLA /, '')}</b>
                <span className="text-xs text-slate-600">{existente ? peso(existente.chave) : 'peso a definir'}</span>
              </li>
            );
          })}
        </ul>
      )}
      {prazoDias != null && !problema && (
        <p className="mt-2 text-xs text-slate-500">Fora do prazo a partir de {textoDoPrazo(prazoDias)}.</p>
      )}

      {mudou && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          <button type="button" disabled={ocupado} onClick={() => { setLimites(limitesSalvos()); setErro(null); }}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-40">
            Desfazer
          </button>
          <button type="button" disabled={ocupado || !!problema} onClick={salvar}
                  className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
            {ocupado ? 'Salvando…' : 'Salvar SLA e recalcular'}
          </button>
        </div>
      )}
    </section>
  );
}
