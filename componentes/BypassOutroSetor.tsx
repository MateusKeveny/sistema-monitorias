'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Quadro, Tabela, Td, Th } from '@/componentes/ui';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { lerColagemDoHub, type LinhaDoHub } from '@/lib/colar-do-hub';
import { mesRotulo } from '@/lib/formatar';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import type { Pessoa } from '@/lib/tipos';

export type VolumeOutroSetor = { setor: string; pessoa_id: string; semana: number; resolvidos: number };

const normalizar = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Bypass de outubro/2026 (2.11.0, migração 81) — PROVISÓRIO, até a árvore de
 * setores (docs/PLANO-SETORES.md). Para cada setor do Hub fora da Expansão que
 * apareceu no mês: o volume colado da tabela de analistas (resolvidos) e o
 * botão que calcula os pontos com as regras da Expansão — finalizado, faixa de
 * C-SAT (só com as avaliações do setor) e notas de 1 a 5.
 */
export default function BypassOutroSetor({ competencia, setores, volumes, pessoas }: {
  competencia: string; setores: string[]; volumes: VolumeOutroSetor[]; pessoas: Pessoa[];
}) {
  const router = useRouter();
  const [setor, setSetor] = useState(setores[0] ?? '');
  const [semana, setSemana] = useState(4);
  const [colado, setColado] = useState('');
  const [lido, setLido] = useState<LinhaDoHub[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [atualizando, iniciar] = useTransition();
  if (!setores.length) return null;

  const porNome = new Map<string, Pessoa>();
  for (const p of pessoas) for (const n of [p.nome_hub, ...(p.nomes_hub_extras ?? []), p.nome]) if (n) porNome.set(normalizar(n), p);
  const nome = new Map(pessoas.map((p) => [p.id, p.nome]));
  const doSetor = volumes.filter((v) => v.setor === setor);
  const pessoasComVolume = [...new Set(doSetor.map((v) => v.pessoa_id))]
    .sort((a, b) => (nome.get(a) ?? '').localeCompare(nome.get(b) ?? ''));
  // Só a equipe conta: atendente avaliado e ativo. Quem não tem ficha é da
  // equipe do outro setor; quem tem ficha sem ser avaliado (Diretora, gestor)
  // não tem cota. Os dois ficam de fora, identificados.
  const daEquipe = (p?: Pessoa) => !!p && p.avaliado && p.ativo && !p.desligado_em;
  const reconhecidos = (lido ?? []).map((l) => {
    const achado = porNome.get(normalizar(l.nome));
    return { l, p: daEquipe(achado) ? achado : undefined, semCota: !!achado && !daEquipe(achado) ? achado : undefined };
  }).sort((a, b) => Number(!a.p) - Number(!b.p) || a.l.nome.localeCompare(b.l.nome));
  const ignorados = reconhecidos.filter((x) => !x.p).length;

  async function salvar() {
    const linhas = reconhecidos.filter((x) => x.p);
    if (!linhas.length) { setErro('Nenhuma pessoa da colagem foi reconhecida.'); return; }
    setOcupado(true); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().from('volume_outro_setor').upsert(
      linhas.map(({ l, p }) => ({ setor, pessoa_id: p!.id, mes_competencia: competencia, semana, resolvidos: l.resolvidos })),
      { onConflict: 'setor,pessoa_id,mes_competencia,semana' },
    );
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    setColado(''); setLido(null);
    setAviso(`${semana}ª semana salva (${linhas.length} pessoa${linhas.length > 1 ? 's' : ''}). Agora clique em "Calcular pontos".`);
    iniciar(() => router.refresh());
  }

  async function calcular() {
    setOcupado(true); setErro(null); setAviso(null);
    const { data, error } = await criarClienteNavegador().rpc('calcular_outro_setor', { p_setor: setor, p_mes: competencia });
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    setAviso(`Pontos do ${setor} calculados: ${data} lançamento${data === 1 ? '' : 's'}. Veja no extrato de cada pessoa.`);
    iniciar(() => router.refresh());
  }

  return (
    <Quadro titulo={`Outro setor com as regras da Expansão · ${mesRotulo(competencia)}`}
            subtitulo="Provisório até a árvore de setores: cole os resolvidos da tabela de analistas do Hub (filtrada no setor) e calcule — finalizado, faixa de C-SAT (só com as avaliações do setor) e notas de 1 a 5, com os pesos da Expansão. Calcular de novo substitui o anterior.">
      {erro && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {aviso && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        {setores.length > 1 && (
          <select value={setor} onChange={(e) => setSetor(e.target.value)} className="rounded-md border border-slate-300 bg-superficie px-2 py-1">
            {setores.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {setores.length === 1 && <b className="text-slate-800">{setor}</b>}
        <span className="text-slate-500">Semana</span>
        <span className="inline-flex overflow-hidden rounded-lg border border-slate-300">
          {[1, 2, 3, 4].map((s) => (
            <button key={s} type="button" onClick={() => setSemana(s)} aria-pressed={semana === s}
                    className={`px-3 py-1 ${semana === s ? 'bg-slate-100 font-semibold text-slate-900' : 'text-slate-600'}`}>{s}ª</button>
          ))}
        </span>
      </div>

      <textarea value={colado} onChange={(e) => { setColado(e.target.value); setLido(null); }} disabled={ocupado}
                placeholder={`Cole aqui (Ctrl+V) a tabela de analistas do Hub, filtrada no ${setor}, da ${semana}ª semana`}
                className="h-20 w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 p-2.5 text-sm" />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => setLido(lerColagemDoHub(colado))} disabled={!colado.trim() || ocupado}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">Ler</button>
        {lido && (
          <button type="button" onClick={salvar} disabled={ocupado || !reconhecidos.some((x) => x.p)}
                  className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
            Salvar a {semana}ª semana
          </button>
        )}
      </div>
      {lido && (
        <div className="mt-3">
          <p className="mb-2 text-xs text-slate-500">
            Entram só os atendentes da equipe ({reconhecidos.length - ignorados}); {ignorados} ignorado{ignorados === 1 ? '' : 's'} — da equipe do
            setor ou sem cota.
          </p>
          <Tabela noQuadro>
            <thead><tr><Th>No Hub</Th><Th>Equipe</Th><Th className="text-right">Resolvidos</Th></tr></thead>
            <tbody>
              {reconhecidos.map(({ l, p, semCota }) => (
                <tr key={l.nome} className={p ? '' : 'text-slate-400'}>
                  <Td>{l.nome}{p && p.nome !== l.nome && <span className="ml-1.5 text-xs text-slate-500">({p.nome})</span>}</Td>
                  <Td>
                    {p ? <span className="rounded-full bg-marca-600/15 px-2 py-px text-xs font-semibold text-marca-700 dark:text-marca-400">Conexão Expansão</span>
                      : semCota ? <span className="text-xs">{semCota.nome} · sem cota — ignorado</span>
                        : <span className="text-xs">outra equipe — ignorado</span>}
                  </Td>
                  <Td className="text-right tabular-nums">{l.resolvidos}</Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </div>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <p className="mb-2 text-sm font-semibold text-slate-800">Resolvidos salvos · {setor}</p>
        {pessoasComVolume.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma semana salva ainda.</p>
        ) : (
          <Tabela noQuadro>
            <thead><tr><Th>Pessoa</Th>{[1, 2, 3, 4].map((s) => <Th key={s} className="text-right">{s}ª</Th>)}</tr></thead>
            <tbody>
              {pessoasComVolume.map((id) => (
                <tr key={id}>
                  <Td>{nome.get(id) ?? '—'}</Td>
                  {[1, 2, 3, 4].map((s) => (
                    <Td key={s} className="text-right tabular-nums">{doSetor.find((v) => v.pessoa_id === id && v.semana === s)?.resolvidos ?? '—'}</Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={calcular} disabled={ocupado || atualizando}
                  className="rounded-lg bg-marca-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
            {ocupado ? 'Calculando…' : atualizando ? 'Atualizando…' : 'Calcular pontos'}
          </button>
        </div>
      </div>
    </Quadro>
  );
}
