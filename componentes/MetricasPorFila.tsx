'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import {
  MEDIDAS, REGUA_PADRAO, aplicarMetricas, conferirRegua, copiarRegua, descricaoAtual, reguaDoGrupo, rotuloDaFaixa,
  type ConfigDasMetricas, type Escolha, type Faixa, type FilaDaConfig, type FilaReal, type Medida, type RegraReal, type Regua, type Tipo,
} from '@/lib/metricasPorFila';

const campo = 'w-16 rounded-md border border-slate-300 bg-superficie px-1.5 py-1 text-right text-sm tabular-nums outline-none focus:border-marca-600';
const num = (v: number | null) => (v == null ? '' : String(v).replace('.', ','));
const lerNum = (t: string) => { const n = Number(t.replace(',', '.')); return t.trim() && Number.isFinite(n) ? n : null; };

const NOME_ESCOLHA: Record<Escolha, string> = { geral: 'Geral', propria: 'Própria', nao: 'Não mede', manter: 'Manter' };

// ------------------------------------------------------------ A régua de um tipo
/**
 * As faixas como cortes encadeados: "Quantas faixas" e onde cada uma termina.
 * Assim não sobra buraco nem cruzamento: a faixa seguinte começa onde a
 * anterior termina. A primeira começa no zero (C-SAT: "abaixo de") e a última
 * não tem teto.
 */
function EditorDeFaixas({ tipo, faixas, mudar, ocupado }: {
  tipo: Exclude<Tipo, 'nota'>; faixas: Faixa[]; mudar: (f: Faixa[]) => void; ocupado: boolean;
}) {
  const cortes = faixas.slice(0, -1).map((f) => f.ate);
  const montar = (cs: (number | null)[]) => {
    const inicio = tipo === 'csat' ? null : 0;
    const lista: Faixa[] = [];
    for (let i = 0; i <= cs.length; i++) lista.push({ de: i === 0 ? inicio : cs[i - 1], ate: i < cs.length ? cs[i] : null });
    mudar(lista);
  };
  const quantas = (n: number) => {
    const cs = [...cortes];
    const passo = tipo === 'csat' ? 5 : 10;
    while (cs.length < n - 1) cs.push(((cs.at(-1) ?? (tipo === 'csat' ? 80 : 0)) ?? 0) + passo);
    montar(cs.slice(0, n - 1));
  };
  const u = tipo === 'csat' ? '%' : 'min';
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-slate-600">
        Quantas faixas
        <select value={faixas.length} disabled={ocupado} onChange={(e) => quantas(Number(e.target.value))}
                className="rounded-md border border-slate-300 bg-superficie px-1.5 py-1 text-sm">
          {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {cortes.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
          <span>Limites ({u}):</span>
          {cortes.map((c, i) => (
            <input key={i} value={num(c)} disabled={ocupado} inputMode="decimal" aria-label={`Limite ${i + 1}`}
                   onChange={(e) => { const cs = [...cortes]; cs[i] = lerNum(e.target.value); montar(cs); }} className={campo} />
          ))}
        </div>
      )}
      <ul className="flex flex-wrap gap-1.5">
        {faixas.map((f, i) => (
          <li key={i} className="rounded-full bg-marca-600/10 px-2.5 py-0.5 text-xs font-medium text-marca-800 dark:text-marca-300">
            {rotuloDaFaixa(tipo, f)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditorDeNotas({ notas, mudar, ocupado }: { notas: number[]; mudar: (n: number[]) => void; ocupado: boolean }) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className="flex items-center gap-1">
          <input type="checkbox" disabled={ocupado} checked={notas.includes(n)}
                 onChange={(e) => mudar(e.target.checked ? [...notas, n].sort() : notas.filter((x) => x !== n))} />
          nota {n}
        </label>
      ))}
    </div>
  );
}

/** A régua inteira (TME, TMA, C-SAT e notas), mostrando só os tipos em uso. */
function EditorDeRegua({ regua, mudar, tipos, ocupado }: {
  regua: Regua; mudar: (r: Regua) => void; tipos: Tipo[]; ocupado: boolean;
}) {
  if (!tipos.length) return <p className="text-xs text-slate-500">Nenhuma métrica com faixa usa esta régua.</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {tipos.map((t) => {
        const problema = conferirRegua(t, regua);
        return (
          <div key={t} className="rounded-xl border border-slate-200 px-3 py-2.5">
            <p className="mb-1.5 text-sm font-semibold text-slate-800">{MEDIDAS.find((m) => m.chave === t)!.nome}</p>
            {t === 'nota'
              ? <EditorDeNotas notas={regua.nota} mudar={(nota) => mudar({ ...regua, nota })} ocupado={ocupado} />
              : <EditorDeFaixas tipo={t} faixas={regua[t]} mudar={(f) => mudar({ ...regua, [t]: f })} ocupado={ocupado} />}
            {problema && <p className="mt-1 text-xs text-rose-700">{problema}</p>}
          </div>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------ A tela
/** Os tipos com faixa que usam a régua geral, ou a própria de uma fila. */
const tiposQueUsam = (cfg: ConfigDasMetricas, fila?: FilaDaConfig): Tipo[] =>
  (['tme', 'tma', 'csat', 'nota'] as Tipo[]).filter((t) => (fila
    ? fila.escolha[t] === 'propria' : cfg.filas.some((f) => f.escolha[t] === 'geral')));

/** Problemas que impedem gravar (ou avançar no assistente). */
export function problemasDaConfig(cfg: ConfigDasMetricas): string[] {
  const p: string[] = [];
  for (const t of tiposQueUsam(cfg)) { const x = conferirRegua(t, cfg.geral); if (x) p.push(`Régua geral, ${MEDIDAS.find((m) => m.chave === t)!.nome}: ${x}`); }
  for (const f of cfg.filas) for (const t of tiposQueUsam(cfg, f)) {
    const x = conferirRegua(t, f.propria); if (x) p.push(`${f.nome}, ${MEDIDAS.find((m) => m.chave === t)!.nome}: ${x}`);
  }
  return p;
}

/** Fila nova no assistente: finalizado, TME, C-SAT e notas pela régua geral; TMA desligado. */
export const escolhaDeFilaNova = (copia: boolean): Record<Medida, Escolha> => (copia
  ? { finalizado: 'manter', tme: 'manter', tma: 'nao', csat: 'manter', nota: 'manter' }
  : { finalizado: 'geral', tme: 'geral', tma: 'nao', csat: 'geral', nota: 'geral' });

export function MetricasPorFilaEditor({ cfg, mudar, ocupado = false, assistente = false, atual }: {
  cfg: ConfigDasMetricas; mudar: (c: ConfigDasMetricas) => void; ocupado?: boolean;
  /** No assistente, "Manter" vira "Igual à copiada" (só para fila que copia outra). */
  assistente?: boolean;
  /** Na Configuração: como cada fila mede hoje, por fila e métrica. */
  atual?: (chave: string, m: Medida) => string;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const setFila = (chave: string, f: (x: FilaDaConfig) => FilaDaConfig) => mudar({ ...cfg, filas: cfg.filas.map((x) => (x.chave === chave ? f(x) : x)) });
  const opcoes = (fila: FilaDaConfig): Escolha[] => (assistente && !fila.copia
    ? ['geral', 'propria', 'nao'] : ['manter', 'geral', 'propria', 'nao']);
  const tiposGerais = tiposQueUsam(cfg);

  return (
    <div className="space-y-5">
      <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <th className="px-3 py-2 text-left font-medium">Fila</th>
              {MEDIDAS.map((m) => <th key={m.chave} className="px-2 py-2 text-left font-medium" title={m.ajuda}>{m.nome}</th>)}
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cfg.filas.map((f) => {
              const temPropria = tiposQueUsam(cfg, f).length > 0;
              return (
                <tr key={f.chave} className="align-top">
                  <td className="px-3 py-2 font-medium text-slate-800">{f.nome || '—'}</td>
                  {MEDIDAS.map((m) => (
                    <td key={m.chave} className="px-2 py-2">
                      <select value={f.escolha[m.chave]} disabled={ocupado} aria-label={`${m.nome} · ${f.nome}`}
                              onChange={(e) => setFila(f.chave, (x) => ({ ...x, escolha: { ...x.escolha, [m.chave]: e.target.value as Escolha } }))}
                              className="rounded-md border border-slate-300 bg-superficie px-1.5 py-1 text-xs">
                        {opcoes(f).map((o) => <option key={o} value={o}>{o === 'manter' && assistente ? 'Igual à copiada' : NOME_ESCOLHA[o]}</option>)}
                      </select>
                      {atual && f.escolha[m.chave] === 'manter' && (
                        <p className="mt-0.5 max-w-[14rem] text-[11px] leading-tight text-slate-500">{atual(f.chave, m.chave)}</p>
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right">
                    {temPropria && (
                      <button type="button" onClick={() => setAberta(aberta === f.chave ? null : f.chave)}
                              className="text-xs font-medium text-marca-700 hover:underline dark:text-marca-400">
                        {aberta === f.chave ? 'fechar régua' : 'régua própria'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        <b>Geral</b>: a régua do setor, igual em todas as filas que a escolhem (o nome não leva a fila). <b>Própria</b>: uma régua só da fila
        (o nome leva a fila, ex.: &quot;TME até 15 min · Logística&quot;). Os pontos de cada faixa por cargo ficam em Pesos por cargo ou na planilha.
      </p>

      {aberta && (() => {
        const f = cfg.filas.find((x) => x.chave === aberta);
        if (!f) return null;
        return (
          <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-200">
            <p className="mb-2 text-sm font-semibold text-slate-800">Régua própria · {f.nome}</p>
            <EditorDeRegua regua={f.propria} tipos={tiposQueUsam(cfg, f)} ocupado={ocupado}
                           mudar={(propria) => setFila(f.chave, (x) => ({ ...x, propria }))} />
          </div>
        );
      })()}

      <div>
        <p className="mb-2 text-sm font-semibold text-slate-800">Régua geral do setor</p>
        <EditorDeRegua regua={cfg.geral} tipos={tiposGerais} ocupado={ocupado} mudar={(geral) => mudar({ ...cfg, geral })} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Na Configuração
/** A configuração de hoje: tudo em "Manter", com as réguas atuais para começar a editar. */
function configAtual(filas: FilaReal[], regras: RegraReal[], setorId: number): ConfigDasMetricas {
  const geral = copiarRegua(REGUA_PADRAO);
  const grupoGeral = (t: Tipo) => (setorId === 1 ? t : `${t}_s${setorId}`);
  for (const t of ['tme', 'tma', 'csat', 'nota'] as Tipo[]) {
    const r = reguaDoGrupo(t, grupoGeral(t), regras) ?? reguaDoGrupo(t, filas.map((f) => f[`grupo_${t}` as 'grupo_tme']).find(Boolean), regras);
    if (r) (geral as Record<Tipo, unknown>)[t] = r;
  }
  return {
    geral,
    filas: filas.map((f) => {
      const propria = copiarRegua(geral);
      for (const t of ['tme', 'tma', 'csat', 'nota'] as Tipo[]) {
        const r = reguaDoGrupo(t, f[`grupo_${t}` as 'grupo_tme'], regras);
        if (r) (propria as Record<Tipo, unknown>)[t] = r;
      }
      return { chave: String(f.id), nome: f.nome, escolha: { finalizado: 'manter', tme: 'manter', tma: 'manter', csat: 'manter', nota: 'manter' }, propria };
    }),
  };
}

export default function MetricasPorFila({ setorId, setorNome, filas, regras }: {
  setorId: number; setorNome: string; filas: FilaReal[]; regras: RegraReal[];
}) {
  const router = useRouter();
  const [cfg, setCfg] = useState<ConfigDasMetricas>(() => configAtual(filas, regras, setorId));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  if (!filas.length) {
    return <p className="text-sm text-slate-500">O setor {setorNome} ainda não tem filas. Cadastre em Usuários e setores › Setores e filas.</p>;
  }
  const mudancas = cfg.filas.flatMap((f) => MEDIDAS.filter((m) => f.escolha[m.chave] !== 'manter')
    .map((m) => `${f.nome}: ${m.nome} → ${NOME_ESCOLHA[f.escolha[m.chave]]}`));
  const problemas = problemasDaConfig(cfg);

  async function salvar() {
    if (problemas.length) { setErro(problemas.join(' · ')); return; }
    if (!confirm(`Gravar as métricas de ${setorNome}?\n\n${mudancas.join('\n')}\n\n`
      + 'Vale já para o mês aberto (os meses fechados guardam o que foi fechado). Faixa nova começa sem pontos: '
      + 'defina em Pesos por cargo ou na planilha.')) return;
    setOcupado(true); setErro(null); setAviso(null);
    const r = await aplicarMetricas(criarClienteNavegador(), setorId, cfg, filas);
    setOcupado(false);
    if (r.falhas.length) setErro(`Parte não foi gravada: ${r.falhas.join('; ')}`);
    else setAviso(`Gravado: ${r.criadas} faixa(s) nova(s), ${r.desligadas} desligada(s), ${r.filasMudadas} fila(s) ajustada(s). Agora defina os pontos em Pesos por cargo.`);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        O que cada fila de <b>{setorNome}</b> mede e as faixas de TME, TMA e C-SAT. Comece em <b>Manter</b> (como está hoje) e troque só o que
        quiser mudar.
      </p>
      <MetricasPorFilaEditor cfg={cfg} mudar={setCfg} ocupado={ocupado}
                             atual={(chave, m) => { const f = filas.find((x) => String(x.id) === chave); return f ? `hoje: ${descricaoAtual(f, m, regras, setorId)}` : ''; }} />
      {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}
      <div className="flex items-center justify-end gap-3">
        <span className="text-sm text-slate-600">{mudancas.length ? `${mudancas.length} mudança(s)` : 'nada mudou'}</span>
        <button type="button" disabled={ocupado || !mudancas.length} onClick={() => setCfg(configAtual(filas, regras, setorId))}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">Descartar</button>
        <button type="button" disabled={ocupado || !mudancas.length} onClick={salvar}
                className="rounded-lg bg-marca-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
          {ocupado ? 'Gravando…' : 'Gravar métricas'}
        </button>
      </div>
    </div>
  );
}
