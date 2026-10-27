'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Quadro, Tabela, Td, Th } from '@/componentes/ui';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { lerColagemDoHub, type LinhaDoHub } from '@/lib/colar-do-hub';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import type { Pessoa } from '@/lib/tipos';

export type VolumeOutroSetor = { setor: string; pessoa_id: string; semana: number; resolvidos: number };

const normalizar = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Volume de uma semana do outro setor — bypass de outubro/2026 (2.11.0,
 * migração 81; aba própria na 2.11.2), PROVISÓRIO até a árvore de setores.
 * Igual ao volume da Expansão: cola-se a tabela de analistas do Hub filtrada
 * no setor; só a equipe entra (quem não tem ficha ou não tem cota aparece e é
 * ignorado). Salvar já recalcula os pontos do setor no mês com as regras da
 * Expansão (finalizado, faixa de C-SAT do setor e notas).
 */
export default function BypassOutroSetor({ competencia, setor, semana, periodo, volumes, pessoas }: {
  competencia: string; setor: string; semana: number; periodo: string; volumes: VolumeOutroSetor[]; pessoas: Pessoa[];
}) {
  const router = useRouter();
  const [colado, setColado] = useState('');
  const [lido, setLido] = useState<LinhaDoHub[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [atualizando, iniciar] = useTransition();

  const porNome = new Map<string, Pessoa>();
  for (const p of pessoas) for (const n of [p.nome_hub, ...(p.nomes_hub_extras ?? []), p.nome]) if (n) porNome.set(normalizar(n), p);
  const nome = new Map(pessoas.map((p) => [p.id, p.nome]));
  const daSemana = volumes.filter((v) => v.setor === setor && v.semana === semana)
    .sort((a, b) => (nome.get(a.pessoa_id) ?? '').localeCompare(nome.get(b.pessoa_id) ?? ''));

  // Só a equipe conta: atendente avaliado e ativo.
  const daEquipe = (p?: Pessoa) => !!p && p.avaliado && p.ativo && !p.desligado_em;
  const reconhecidos = (lido ?? []).map((l) => {
    const achado = porNome.get(normalizar(l.nome));
    return { l, p: daEquipe(achado) ? achado : undefined, semCota: !!achado && !daEquipe(achado) ? achado : undefined };
  }).sort((a, b) => Number(!a.p) - Number(!b.p) || a.l.nome.localeCompare(b.l.nome));

  async function salvar() {
    const linhas = reconhecidos.filter((x) => x.p);
    if (!linhas.length) { setErro('Ninguém da equipe na colagem.'); return; }
    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    const { error } = await db.from('volume_outro_setor').upsert(
      linhas.map(({ l, p }) => ({ setor, pessoa_id: p!.id, mes_competencia: competencia, semana, resolvidos: l.resolvidos })),
      { onConflict: 'setor,pessoa_id,mes_competencia,semana' },
    );
    // Salvar já recalcula os pontos do setor no mês.
    const calculo = error ? null : await db.rpc('calcular_outro_setor', { p_setor: setor, p_mes: competencia });
    setOcupado(false);
    if (error || calculo?.error) { setErro(await mensagemDoErro((error ?? calculo!.error)!)); return; }
    setColado(''); setLido(null);
    setAviso(`${semana}ª semana salva e pontos recalculados.`);
    iniciar(() => router.refresh());
  }

  return (
    <Quadro titulo={`Volume · ${semana}ª semana · ${setor}`}
            subtitulo={`${periodo} · resolvidos da tabela de analistas do Hub, filtrada no ${setor}`}>
      {erro && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {aviso && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

      {daSemana.length > 0 && !lido && (
        <div className="mb-4">
          <Tabela noQuadro>
            <thead><tr><Th>Pessoa</Th><Th className="text-right">Resolvidos</Th></tr></thead>
            <tbody>
              {daSemana.map((v) => (
                <tr key={v.pessoa_id}>
                  <Td>{nome.get(v.pessoa_id) ?? '—'}</Td>
                  <Td className="text-right font-semibold tabular-nums">{v.resolvidos}</Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </div>
      )}

      <textarea value={colado} onChange={(e) => { setColado(e.target.value); setLido(null); }} disabled={ocupado}
                placeholder={daSemana.length ? 'Cole de novo para substituir a semana' : 'Cole aqui (Ctrl+V) a tabela de analistas do Hub'}
                className="h-20 w-full rounded-xl border border-dashed border-slate-300 bg-slate-50 p-2.5 text-sm" />
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => setLido(lerColagemDoHub(colado))} disabled={!colado.trim() || ocupado}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">Ler</button>
        {lido && (
          <button type="button" onClick={salvar} disabled={ocupado || atualizando || !reconhecidos.some((x) => x.p)}
                  className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
            {ocupado ? 'Salvando…' : `Salvar a ${semana}ª semana`}
          </button>
        )}
      </div>

      {lido && (
        <div className="mt-3">
          <Tabela noQuadro>
            <thead><tr><Th>No Hub</Th><Th>Equipe</Th><Th className="text-right">Resolvidos</Th></tr></thead>
            <tbody>
              {reconhecidos.map(({ l, p, semCota }) => (
                <tr key={l.nome} className={p ? '' : 'text-slate-400'}>
                  <Td>{l.nome}{p && p.nome !== l.nome && <span className="ml-1.5 text-xs text-slate-500">({p.nome})</span>}</Td>
                  <Td>
                    {p ? <span className="rounded-full bg-marca-600/15 px-2 py-px text-xs font-semibold text-marca-700 dark:text-marca-400">equipe</span>
                      : <span className="text-xs">{semCota ? 'sem cota — ignorado' : 'outra equipe — ignorado'}</span>}
                  </Td>
                  <Td className="text-right tabular-nums">{l.resolvidos}</Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </div>
      )}
    </Quadro>
  );
}
