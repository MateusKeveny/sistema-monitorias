'use client';

import { Fragment, useMemo, useState } from 'react';
import { diaMes, duracao } from '@/lib/formatar';
import { CENARIO_VAZIO, simular, type Base, type Cenario } from '@/lib/simulacao';

const CANAIS = [['huggy', 'Expansão', 'tme'], ['diretores', 'Diretores-Expansão', 'tme_diretores']] as const;
const pts = (v: number) => Math.round(v).toLocaleString('pt-BR');
const pct = (v: number | null) => v == null ? '—' : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
const entrada = 'w-20 rounded-md border px-2 py-0.5 text-right text-sm tabular-nums outline-none focus:border-marca-600 bg-superficie';

function Diferenca({ d, sufixo = '' }: { d: number; sufixo?: string }) {
  if (Math.abs(d) < 0.5) return <span className="text-slate-400">—</span>;
  return (
    <span className={`font-semibold ${d > 0 ? 'text-marca-700 dark:text-marca-400' : 'text-rose-700 dark:text-rose-400'}`}>
      {d > 0 ? '+' : '−'}{pts(Math.abs(d))}{sufixo}
    </span>
  );
}

/**
 * Simulação de cenários (1.53.0): o cenário fica só na tela; o cálculo é o de
 * lib/simulacao.ts. Nada é gravado — fechar ou recarregar descarta.
 */
export default function SimuladorDeCenarios({ base, periodos, cargos }: {
  base: Base;
  periodos: [string, string][];
  cargos: { id: number; nome: string }[];
}) {
  const [cen, setCen] = useState<Cenario>(CENARIO_VAZIO);
  const [aberta, setAberta] = useState<string | null>(null);

  // Cargos com gente no mês, para pesos e meta.
  const cargosDoMes = useMemo(() => {
    const ids = [...new Set(base.linhas.map((l) => l.cargo_id))];
    return cargos.filter((c) => ids.includes(c.id)).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [base.linhas, cargos]);
  const [cargo, setCargo] = useState<number | null>(cargosDoMes[0]?.id ?? null);

  const resultado = useMemo(() => simular(base, cen), [base, cen]);
  const comMeta = resultado.filter((r) => r.metaHoje != null || r.metaSimulada != null);
  const naMetaHoje = comMeta.filter((r) => r.metaHoje != null && r.hoje >= r.metaHoje).length;
  const naMetaSim = comMeta.filter((r) => r.metaSimulada != null && r.simulado >= r.metaSimulada).length;
  const totalHoje = resultado.reduce((a, r) => a + r.hoje, 0);
  const totalSim = resultado.reduce((a, r) => a + r.simulado, 0);
  const ordenado = [...resultado].sort((a, b) => (b.simulado - b.hoje) - (a.simulado - a.hoje) || b.simulado - a.simulado);

  const alternar = <K extends 'tmeInvertido' | 'semanasFora'>(campo: K, chave: string) =>
    setCen((c) => ({ ...c, [campo]: c[campo].includes(chave) ? c[campo].filter((x) => x !== chave) : [...c[campo], chave] }));
  const definir = <K extends 'csatMinimos' | 'presenciais' | 'pesos' | 'metas'>(campo: K, chave: string, valor: number | null, hoje: number | null) =>
    setCen((c) => {
      const mapa = { ...c[campo] } as Record<string, number>;
      if (valor == null || Number.isNaN(valor) || valor === hoje) delete mapa[chave]; else mapa[chave] = valor;
      return { ...c, [campo]: mapa };
    });

  const pesoHoje = new Map(base.pesos.map((p) => [`${p.cargo_id}|${p.regra}`, p.peso]));
  const rotulo = new Map(base.faixas.map((f) => [f.chave, f.rotulo]));
  const regrasDoCargo = cargo == null ? [] : base.pesos
    .filter((p) => p.cargo_id === cargo && p.regra !== 'meta')
    .sort((a, b) => (base.faixas.find((f) => f.chave === a.regra)?.ordem ?? 999) - (base.faixas.find((f) => f.chave === b.regra)?.ordem ?? 999));
  const faixasCsat = base.faixas.filter((f) => f.grupo === 'csat').sort((a, b) => (b.faixa_min ?? -1) - (a.faixa_min ?? -1));
  const nomeCargo = new Map(cargos.map((c) => [c.id, c.nome]));

  const descricao = [
    ...cen.tmeInvertido.map((k) => {
      const [s, c] = k.split('|');
      return `TME ${c === 'huggy' ? 'Expansão' : 'Diretores'} ${s}ª sem. ${base.tmeDesligado.includes(k) ? 'volta a contar' : 'fora'}`;
    }),
    ...Object.entries(cen.csatMinimos).map(([k, v]) => `${rotulo.get(k)}: a partir de ${pct(v)}`),
    ...Object.entries(cen.pesos).map(([k, v]) => {
      const [c, r] = k.split('|');
      return `${rotulo.get(r) ?? r} (${nomeCargo.get(Number(c))}): ${pesoHoje.get(k) ?? 0} → ${v}`;
    }),
    ...Object.entries(cen.metas).map(([c, v]) => `meta ${nomeCargo.get(Number(c))}: ${pts(v)}`),
    ...cen.semanasFora.map((k) => {
      const [p, s] = k.split('|');
      return `${resultado.find((r) => r.pessoa_id === p)?.pessoa.split(' ')[0]} sem a ${s}ª semana`;
    }),
    ...Object.entries(cen.presenciais).map(([p, n]) => `${resultado.find((r) => r.pessoa_id === p)?.pessoa.split(' ')[0]} +${n} presencial`),
  ];

  return (
    <div className="space-y-4">
      <p className="rounded-2xl border border-dashed border-amber-500 bg-amber-500/12 px-4 py-2.5 text-sm text-slate-800 dark:text-amber-100">
        <b>Só simulação.</b> Nada aqui é gravado nem muda o extrato de ninguém; fechar a tela descarta o cenário. Para valer
        de verdade, use as telas de sempre (Métricas da semana, Configuração › Pesos por cargo, Presencial).
      </p>

      <div className="grid items-start gap-4 xl:grid-cols-[26rem_1fr]">
        <section className="space-y-4 rounded-[20px] bg-superficie px-5 py-4 shadow-sm">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Cenário</h2>
            <p className="text-xs text-slate-500">Tudo recalcula na hora.</p>
          </div>

          {CANAIS.map(([canal, nome, grupo]) => (
            <div key={canal} className="border-t border-slate-100 pt-3">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">TME · {nome}</h3>
              <div className="grid grid-cols-4 gap-1.5">
                {[1, 2, 3, 4].map((s) => {
                  const k = `${s}|${canal}`;
                  const t = base.tme.find((x) => x.semana === s && x.canal === canal)?.tme_seg ?? null;
                  const f = t ? base.faixas.find((x) => x.grupo === grupo && (x.faixa_min == null || t >= x.faixa_min) && (x.faixa_max == null || t < x.faixa_max)) : null;
                  const hojeConta = !base.tmeDesligado.includes(k);
                  const conta = cen.tmeInvertido.includes(k) ? !hojeConta : hojeConta;
                  return (
                    <button key={s} type="button" disabled={!t} onClick={() => alternar('tmeInvertido', k)}
                            aria-pressed={!conta} title={conta ? 'Tirar a faixa desta semana' : 'Voltar a contar'}
                            className={`rounded-lg border px-2 py-1.5 text-left text-xs disabled:opacity-40 ${
                              conta === hojeConta ? 'border-slate-200' : 'border-amber-500 bg-amber-500/10'}`}>
                      <b className={`block text-[13px] text-slate-900 ${conta ? '' : 'line-through'}`}>{s}ª sem.</b>
                      <span className="text-slate-600">{t ? duracao(t) : 'sem dado'}</span>
                      {f && <span className="block text-slate-500">{f.rotulo.replace(/^TME[^-–]*[-–]\s*/i, '')}</span>}
                      <span className="block text-slate-500">{conta ? 'conta' : 'não conta'}{!hojeConta && ' · hoje desligada'}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="border-t border-slate-100 pt-3">
            <h3 className="mb-1 text-sm font-semibold text-slate-800">Faixas de C-SAT</h3>
            <p className="mb-2 text-xs text-slate-500">O mínimo de cada faixa; ela vai até o mínimo da de cima. Vale para os dois canais.</p>
            <table className="w-full text-sm">
              <tbody>
                {faixasCsat.map((f) => {
                  const hoje = f.faixa_min;
                  const sim = cen.csatMinimos[f.chave];
                  return (
                    <tr key={f.chave} className="border-t border-slate-100">
                      <td className="py-1 pr-2 text-slate-700">{f.rotulo}</td>
                      <td className="px-1 text-right text-xs text-slate-400">{hoje == null ? 'qualquer' : `desde ${pct(hoje)}`}</td>
                      <td className="py-1 text-right">
                        {hoje != null && (
                          <input type="number" step="0.5" min="0" max="100" aria-label={`Mínimo de ${f.rotulo}`}
                                 value={sim != null ? +(sim * 100).toFixed(2) : +(hoje * 100).toFixed(2)}
                                 onChange={(e) => definir('csatMinimos', f.chave, e.target.value === '' ? null : Number(e.target.value) / 100, hoje)}
                                 className={`${entrada} ${sim != null ? 'border-amber-500 bg-amber-500/10' : 'border-slate-300'}`} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800">Pesos e meta</h3>
              <select value={cargo ?? ''} onChange={(e) => setCargo(Number(e.target.value))}
                      className="rounded-md border border-slate-300 bg-superficie px-2 py-1 text-sm text-slate-800">
                {cargosDoMes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            {cargo != null && (
              <table className="w-full text-sm">
                <tbody>
                  {[{ regra: 'meta', peso: pesoHoje.get(`${cargo}|meta`) ?? null }, ...regrasDoCargo].map((p) => {
                    const meta = p.regra === 'meta';
                    if (meta && p.peso == null) return null;
                    const k = `${cargo}|${p.regra}`;
                    const sim = meta ? cen.metas[`${cargo}`] : cen.pesos[k];
                    return (
                      <tr key={p.regra} className="border-t border-slate-100">
                        <td className="py-1 pr-2 text-slate-700">{meta ? <b>Meta (pts)</b> : rotulo.get(p.regra) ?? p.regra}</td>
                        <td className="px-1 text-right text-xs tabular-nums text-slate-400">{p.peso}</td>
                        <td className="py-1 text-right">
                          <input type="number" step={meta ? 100 : 0.25} aria-label={`Simular ${meta ? 'meta' : rotulo.get(p.regra) ?? p.regra}`}
                                 value={sim ?? p.peso ?? ''}
                                 onChange={(e) => meta
                                   ? definir('metas', `${cargo}`, e.target.value === '' ? null : Number(e.target.value), p.peso)
                                   : definir('pesos', k, e.target.value === '' ? null : Number(e.target.value), p.peso)}
                                 className={`${entrada} ${sim != null ? 'border-amber-500 bg-amber-500/10' : 'border-slate-300'}`} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="border-t border-slate-100 pt-3 text-xs text-slate-600">
            {descricao.length ? <><b>Cenário:</b> {descricao.join(' · ')}</> : 'Sem mudanças: o simulado é igual a hoje.'}
            <div className="mt-2">
              <button type="button" onClick={() => { setCen(CENARIO_VAZIO); setAberta(null); }} disabled={!descricao.length}
                      className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                Limpar cenário
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-[20px] bg-superficie px-5 py-4 shadow-sm">
          <div className="mb-3 grid gap-2.5 sm:grid-cols-3">
            {[
              ['Na meta', `${naMetaSim} de ${comMeta.length}`, <Diferenca key="m" d={naMetaSim - naMetaHoje} sufixo={Math.abs(naMetaSim - naMetaHoje) === 1 ? ' pessoa' : ' pessoas'} />],
              ['Pontos da equipe', pts(totalSim), <Diferenca key="p" d={totalSim - totalHoje} />],
              ['Média por pessoa', pts(resultado.length ? totalSim / resultado.length : 0), <Diferenca key="d" d={resultado.length ? (totalSim - totalHoje) / resultado.length : 0} />],
            ].map(([r, v, d]) => (
              <div key={r as string} className="rounded-xl bg-slate-50 px-3 py-2.5">
                <p className="text-xs text-slate-500">{r}</p>
                <p className="text-xl font-semibold tabular-nums text-slate-900">{v} <span className="text-sm">{d}</span></p>
              </div>
            ))}
          </div>

          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="border-b border-slate-200 py-2 pr-2 font-medium">Pessoa</th>
                <th className="border-b border-slate-200 px-2 py-2 text-right font-medium">Hoje</th>
                <th className="border-b border-slate-200 px-2 py-2 text-right font-medium">Simulado</th>
                <th className="border-b border-slate-200 px-2 py-2 text-right font-medium">Diferença</th>
                <th className="border-b border-slate-200 py-2 pl-2 font-medium">Meta</th>
              </tr>
            </thead>
            <tbody>
              {ordenado.map((r) => {
                const antes = r.metaHoje != null && r.hoje >= r.metaHoje;
                const depois = r.metaSimulada != null && r.simulado >= r.metaSimulada;
                const aqui = aberta === r.pessoa_id;
                const mexida = cen.semanasFora.some((k) => k.startsWith(`${r.pessoa_id}|`)) || cen.presenciais[r.pessoa_id];
                return (
                  <Fragment key={r.pessoa_id}>
                    <tr className={`cursor-pointer border-b border-slate-100 hover:bg-slate-50 ${aqui ? 'bg-slate-50' : ''}`}
                        onClick={() => setAberta(aqui ? null : r.pessoa_id)}>
                      <td className="py-2 pr-2 text-slate-800">
                        <span className="mr-1 text-slate-400">{aqui ? '▾' : '▸'}</span>{r.pessoa}
                        {mexida && <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 text-[11px] text-amber-700 dark:text-amber-300">ajustada</span>}
                        {r.cargo && <span className="ml-1.5 text-xs text-slate-400">{r.cargo}</span>}
                      </td>
                      <td className="px-2 py-2 text-right text-slate-600">{pts(r.hoje)}</td>
                      <td className="px-2 py-2 text-right font-semibold text-slate-900">{pts(r.simulado)}</td>
                      <td className="px-2 py-2 text-right"><Diferenca d={r.simulado - r.hoje} /></td>
                      <td className="py-2 pl-2">
                        {r.metaSimulada == null && r.metaHoje == null ? <span className="text-xs text-slate-400">sem meta</span>
                          : antes === depois
                            ? <span className={`rounded-full px-2 py-px text-[11px] ${depois ? 'bg-marca-600/15 text-marca-700 dark:text-marca-400' : 'bg-slate-100 text-slate-500'}`}>{depois ? 'na meta' : 'abaixo'}</span>
                            : <span className={`rounded-full px-2 py-px text-[11px] font-semibold ${depois ? 'bg-marca-600/25 text-marca-700 dark:text-marca-400' : 'bg-rose-500/15 text-rose-700 dark:text-rose-400'}`}>{depois ? 'passa a bater' : 'deixa de bater'}</span>}
                      </td>
                    </tr>
                    {aqui && (
                      <tr className="border-b border-slate-100 bg-slate-50">
                        <td colSpan={5} className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                            <span>Tirar semana:</span>
                            {[1, 2, 3, 4].map((s) => {
                              const k = `${r.pessoa_id}|${s}`; const fora = cen.semanasFora.includes(k);
                              return (
                                <button key={s} type="button" onClick={() => alternar('semanasFora', k)} aria-pressed={fora}
                                        className={`rounded-md border px-2 py-1 ${fora ? 'border-amber-500 bg-amber-500/10 line-through' : 'border-slate-300 bg-superficie'}`}>
                                  {s}ª · {diaMes(periodos[s - 1][0])} a {diaMes(periodos[s - 1][1])}
                                </button>
                              );
                            })}
                            <span className="ml-3">Presenciais a mais:</span>
                            <input type="number" min="0" step="1" aria-label={`Presenciais a mais para ${r.pessoa}`}
                                   value={cen.presenciais[r.pessoa_id] ?? 0}
                                   onClick={(e) => e.stopPropagation()}
                                   onChange={(e) => definir('presenciais', r.pessoa_id, Number(e.target.value) || null, null)}
                                   className={`${entrada} w-16 border-slate-300`} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">
            Clique numa pessoa para tirar uma semana dela ou somar presenciais. Quem recebe pela média da equipe tem a média
            refeita na proporção dos resultados simulados dos cargos de referência (o atestado também, na proporção) — é uma
            conta de simulação, próxima da do fechamento.
          </p>
        </section>
      </div>
    </div>
  );
}
