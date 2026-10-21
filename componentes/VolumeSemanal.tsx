'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Quadro, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import type { Pessoa } from '@/lib/tipos';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import { MoverPara } from '@/componentes/RealocacaoDeLancamentos';
import { lerColagemDoHub, type LinhaDoHub } from '@/lib/colar-do-hub';

export type LinhaVolume = {
  id?: number;
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

const normalizar = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

const entrada = `w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm tabular-nums
                 outline-none focus:border-marca-600 disabled:bg-slate-50`;

/**
 * Volume de UMA semana, digitado pelo gestor: uma linha por pessoa, a semana
 * inteira de uma vez. É daqui que saem os pontos por atendimento, a faixa de
 * TME da equipe e a base do C-SAT de Expansão.
 *
 * Desde a 1.19.0 cada semana é aberta pelo cartão dela no topo da tela de
 * Lançamentos, em vez das abas de semana dentro deste quadro. Quem ainda não
 * tem volume aparece marcado, e o número da semana anterior fica ao lado
 * como referência para pegar erro de digitação.
 */
export default function VolumeSemanal({
  competencia, canal, semana, periodo, pessoas: todas, volumes, esperados, recebem = [],
}: {
  /** Para quem dá para mover o volume (⇄ mover, migração 71). */
  recebem?: { id: string; nome: string }[];
  competencia: string;
  /** 'huggy' = Expansão · 'diretores' = Diretores-Expansão. */
  canal: 'huggy' | 'diretores';
  semana: number;
  /** "03/09 a 10/09", só para o subtítulo. */
  periodo: string;
  /** Só quem pontua por atendimento no cargo vigente. */
  pessoas: Pessoa[];
  /** O mês inteiro do canal: a semana anterior serve de referência. */
  volumes: LinhaVolume[];
  /** Quem se espera nesta semana (teve volume na última lançada). Os demais
   *  continuam na lista para digitar, mas sem a marca de "falta". */
  esperados: string[];
}) {
  const esperado = new Set(esperados);
  // Esperados primeiro, na ordem do nome; depois quem não atendeu na última.
  const pessoas = [...todas].sort((a, b) =>
    Number(esperado.has(b.id)) - Number(esperado.has(a.id)) || a.nome.localeCompare(b.nome, 'pt-BR'));
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const daSemana = new Map(volumes.filter((v) => v.semana === semana).map((v) => [v.pessoa_id, v]));
  const anterior = new Map(volumes.filter((v) => v.semana === semana - 1).map((v) => [v.pessoa_id, v]));

  const [rascunho, setRascunho] = useState<Rascunho>(() => Object.fromEntries(pessoas.map((p) => {
    const v = daSemana.get(p.id);
    return [p.id, {
      finalizados: v ? String(v.finalizados) : '',
      tma: paraTempo(v?.tma_seg ?? null),
      tme: paraTempo(v?.tme_seg ?? null),
    }];
  })));

  async function salvar() {
    setErro(null); setAviso(null);
    const gravar: object[] = [];
    const apagar: string[] = [];

    for (const p of pessoas) {
      const d = rascunho[p.id];
      const vazio = !d.finalizados.trim() && !d.tma.trim() && !d.tme.trim();
      if (vazio) { if (daSemana.has(p.id)) apagar.push(p.id); continue; }

      const finalizados = Number(d.finalizados || 0);
      const tma = paraSegundos(d.tma);
      const tme = paraSegundos(d.tme);
      if (!Number.isInteger(finalizados) || finalizados < 0) { setErro(`Finalizados inválido para ${p.nome}.`); return; }
      if (Number.isNaN(tma) || Number.isNaN(tme)) {
        setErro(`Tempo inválido para ${p.nome}. Use H:MM:SS ou MM:SS.`); return;
      }
      gravar.push({
        pessoa_id: p.id, mes_competencia: competencia, semana, canal,
        finalizados, tma_seg: tma, tme_seg: tme,
        atualizado_em: new Date().toISOString(),
      });
    }

    setOcupado(true);
    const db = criarClienteNavegador();
    if (gravar.length) {
      const { error } = await db.from('volume_semanal')
        .upsert(gravar, { onConflict: 'pessoa_id,mes_competencia,semana,canal' });
      if (error) { setOcupado(false); setErro(await mensagemDoErro(error)); return; }
    }
    if (apagar.length) {
      const { error } = await db.from('volume_semanal').delete()
        .eq('mes_competencia', competencia).eq('canal', canal).eq('semana', semana).in('pessoa_id', apagar);
      if (error) { setOcupado(false); setErro(await mensagemDoErro(error)); return; }
    }
    setOcupado(false);
    setAviso(`${semana}ª semana salva: ${gravar.length} pessoa(s)${apagar.length ? `, ${apagar.length} removida(s)` : ''}.`);
    router.refresh();
  }

  // Colar do Hub (2.1.0): lê a tabela copiada do Hub e preenche o quadro —
  // nada é gravado até "Salvar", como na digitação.
  const [colando, setColando] = useState(false);
  const [colado, setColado] = useState('');
  const [lidoDoHub, setLidoDoHub] = useState<LinhaDoHub[] | null>(null);
  const [ligar, setLigar] = useState<Record<string, string>>({});
  const [vindoDoHub, setVindoDoHub] = useState<Set<string>>(new Set());
  const porNomeHub = new Map<string, Pessoa>();
  for (const p of pessoas) for (const n of [p.nome_hub, ...(p.nomes_hub_extras ?? []), p.nome]) if (n) porNomeHub.set(normalizar(n), p);
  const casar = (l: LinhaDoHub) => porNomeHub.get(normalizar(l.nome)) ?? pessoas.find((p) => p.id === ligar[l.nome]);

  async function preencherDoHub() {
    if (!lidoDoHub) return;
    const novo = { ...rascunho }; const vieram = new Set<string>();
    for (const l of lidoDoHub) {
      const p = casar(l);
      if (!p) continue;
      novo[p.id] = { finalizados: String(l.resolvidos), tma: paraTempo(l.tmaSeg), tme: paraTempo(l.tmeUtilSeg) };
      vieram.add(p.id);
    }
    setRascunho(novo); setVindoDoHub(vieram);
    // Quem foi ligado à mão fica lembrado como outro Nome no Hub da pessoa.
    const db = criarClienteNavegador();
    for (const l of lidoDoHub) {
      if (!porNomeHub.has(normalizar(l.nome)) && ligar[l.nome]) {
        await db.rpc('salvar_nome_hub', { p_pessoa: ligar[l.nome], p_nome: l.nome, p_extra: true });
      }
    }
    setColando(false); setLidoDoHub(null); setColado(''); setLigar({});
    setAviso(`${vieram.size} pessoa(s) preenchidas do Hub. Confira e clique em Salvar ${semana}ª semana.`);
  }

  const set = (id: string, campo: 'finalizados' | 'tma' | 'tme', valor: string) =>
    setRascunho((r) => ({ ...r, [id]: { ...r[id], [campo]: valor } }));

  const total = pessoas.reduce((a, p) => a + (Number(rascunho[p.id]?.finalizados) || 0), 0);
  const preenchidas = pessoas.filter((p) => rascunho[p.id]?.finalizados.trim()).length;
  const esperadosOuPreenchidos = pessoas.filter((p) => esperado.has(p.id) || rascunho[p.id]?.finalizados.trim()).length;

  return (
    <Quadro
      titulo={`Volume · ${semana}ª semana · ${canal === 'huggy' ? 'Expansão' : 'Diretores-Expansão'}`}
      subtitulo={`${periodo} · tempos em H:MM:SS (as horas podem passar de 24) ou MM:SS · linha em branco remove o volume da pessoa`}
      acao={
        <button
          type="button" onClick={salvar} disabled={ocupado || pessoas.length === 0}
          className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40"
        >
          {ocupado ? 'Salvando…' : `Salvar ${semana}ª semana`}
        </button>
      }
    >
      {erro && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {aviso && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

      {pessoas.length > 0 && !colando && (
        <button type="button" onClick={() => setColando(true)} disabled={ocupado}
                className="mb-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-marca-600">
          Colar do Hub
        </button>
      )}
      {colando && (
        <div className="mb-4 rounded-xl border border-marca-600/40 bg-slate-50 px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">Colar do Hub</p>
          <p className="text-xs text-slate-500">
            No Hub, filtre o canal {canal === 'huggy' ? 'Expansão' : 'Diretores-Expansão'} e o período {periodo}, selecione a
            tabela de analistas e copie (Ctrl+C). Entram os <b>resolvidos</b> (como finalizados), o TMA e o <b>TME útil</b>.
          </p>
          <textarea value={colado} onChange={(e) => { setColado(e.target.value); setLidoDoHub(null); }}
                    placeholder="Cole a tabela do Hub aqui…" aria-label="Tabela copiada do Hub"
                    className="mt-2 min-h-28 w-full rounded-lg border border-slate-300 bg-superficie px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-marca-600" />
          {lidoDoHub && (
            lidoDoHub.length === 0 ? <p className="mt-2 text-sm text-rose-700">Não reconheci nenhuma linha. Copie a tabela inteira, com o cabeçalho.</p> : (
              <table className="mt-2 w-full text-sm tabular-nums">
                <thead><tr className="text-left text-xs text-slate-500">
                  <th className="py-1 font-medium">No Hub</th><th className="py-1 font-medium">No cadastro</th>
                  <th className="py-1 text-right font-medium">Finalizados</th><th className="py-1 text-right font-medium">TMA</th>
                  <th className="py-1 text-right font-medium">TME útil</th><th />
                </tr></thead>
                <tbody>
                  {lidoDoHub.map((l) => {
                    const automatico = porNomeHub.get(normalizar(l.nome));
                    const p = casar(l);
                    const antes = p ? daSemana.get(p.id) : undefined;
                    return (
                      <tr key={l.nome} className={`border-t border-slate-200 ${antes ? 'bg-amber-500/10' : ''}`}>
                        <td className="py-1.5 pr-2 text-slate-700">{l.nome}</td>
                        <td className="py-1.5 pr-2">
                          {automatico ? <span className="text-slate-800">{automatico.nome}</span> : (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="rounded-full bg-amber-500/15 px-2 py-px text-xs text-amber-700 dark:text-amber-300">não reconhecido</span>
                              <select value={ligar[l.nome] ?? ''} onChange={(e) => setLigar((s) => ({ ...s, [l.nome]: e.target.value }))}
                                      className="rounded-md border border-slate-300 bg-superficie px-1.5 py-0.5 text-xs text-slate-800">
                                <option value="">Deixar de fora</option>
                                {pessoas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
                              </select>
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right font-semibold">{l.resolvidos.toLocaleString('pt-BR')}</td>
                        <td className="py-1.5 text-right">{paraTempo(l.tmaSeg) || '—'}</td>
                        <td className="py-1.5 text-right">{paraTempo(l.tmeUtilSeg) || '—'}</td>
                        <td className="py-1.5 pl-2 text-xs text-amber-700 dark:text-amber-300">{antes ? `substitui ${antes.finalizados}` : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          )}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => { setColando(false); setLidoDoHub(null); setColado(''); setLigar({}); }}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700">Cancelar</button>
            {!lidoDoHub ? (
              <button type="button" onClick={() => setLidoDoHub(lerColagemDoHub(colado))} disabled={!colado.trim()}
                      className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40">Ler</button>
            ) : lidoDoHub.length > 0 && (
              <button type="button" onClick={preencherDoHub}
                      className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white">Preencher a {semana}ª semana</button>
            )}
          </div>
          {lidoDoHub && lidoDoHub.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              Preencher só coloca os números no quadro abaixo; nada é gravado até <b>Salvar {semana}ª semana</b>. Em âmbar, quem
              já tinha volume lançado. Quem você ligar à mão fica lembrado para as próximas semanas.
            </p>
          )}
        </div>
      )}

      {pessoas.length === 0 ? (
        <Vazio>Ninguém com cargo que pontue por atendimento nesta competência.</Vazio>
      ) : (
        <Tabela noQuadro>
          <thead>
            <tr>
              <Th>Pessoa</Th>
              <Th className="text-right">Finalizados</Th>
              <Th className="text-right">TMA</Th>
              <Th className="text-right">TME</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {pessoas.map((p) => {
              const d = rascunho[p.id];
              const falta = esperado.has(p.id) && !daSemana.has(p.id);
              const fora = !esperado.has(p.id) && !daSemana.has(p.id);
              const ref = anterior.get(p.id);
              const borda = falta ? 'border-dashed' : '';
              return (
                <tr key={p.id} className={vindoDoHub.has(p.id) ? 'bg-marca-600/5' : ''}>
                  <Td className={`font-medium ${fora ? 'text-slate-400' : 'text-slate-800'}`}>
                    {p.nome}
                    {!p.ativo && <span className="ml-2 text-xs text-slate-500">· desligado</span>}
                    {fora && <span className="ml-2 text-xs font-normal text-slate-400">· não atendeu na última semana</span>}
                    {falta && (
                      <span className="ml-2 rounded-md bg-amber-500/15 px-1.5 py-px text-xs font-semibold
                                       text-amber-700 dark:text-amber-300">falta</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-right">
                    <input inputMode="numeric" value={d.finalizados} disabled={ocupado}
                           aria-label={`Finalizados de ${p.nome}`}
                           onChange={(e) => set(p.id, 'finalizados', e.target.value)} className={`${entrada} ${borda}`} />
                    {semana > 1 && (
                      <span className="ml-2 inline-block w-24 text-left text-xs tabular-nums text-slate-400">
                        {ref ? `sem. ant. ${ref.finalizados}` : 'sem. ant. —'}
                      </span>
                    )}
                  </Td>
                  <Td className="text-right">
                    <input value={d.tma} disabled={ocupado} placeholder="H:MM:SS"
                           aria-label={`TMA de ${p.nome}`}
                           onChange={(e) => set(p.id, 'tma', e.target.value)} className={`${entrada} ${borda}`} />
                  </Td>
                  <Td className="text-right">
                    <input value={d.tme} disabled={ocupado} placeholder="H:MM:SS"
                           aria-label={`TME de ${p.nome}`}
                           onChange={(e) => set(p.id, 'tme', e.target.value)} className={`${entrada} ${borda}`} />
                  </Td>
                  <Td className="whitespace-nowrap">
                    {daSemana.get(p.id)?.id != null && (
                      <MoverPara tipo="volume" id={Number(daSemana.get(p.id)!.id)} de={p.id} pessoas={recebem} recarregar />
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200 font-semibold text-slate-800">
              <td className="px-4 py-2.5">Equipe · {preenchidas} de {esperadosOuPreenchidos} preenchidos</td>
              <td className={`px-4 py-2.5 text-right tabular-nums ${semana > 1 ? 'pr-[8.5rem]' : ''}`}>
                {total.toLocaleString('pt-BR')}
              </td>
              <td /><td />
              <td />
            </tr>
          </tfoot>
        </Tabela>
      )}
    </Quadro>
  );
}
