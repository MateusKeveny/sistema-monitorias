'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Quadro, Tabela, Td, Th } from '@/componentes/ui';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mesRotulo } from '@/lib/formatar';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import type { RegraCota } from '@/lib/tipos';

/** Um atendimento de outro setor ainda sem decisão (migração 78). */
export type AtendimentoOutroSetor = {
  id: number; pessoa_id: string; setor: string; mes_competencia: string; semana: number;
};

type Grupo = { chave: string; pessoa: string; setor: string; mes: string; semana: number; ids: number[] };

/**
 * Demandas extras pendentes (2.9.0): os atendimentos em outros setores que a
 * importação do relatório do Hub guardou sem pontos. O gestor escolhe a regra
 * e lança — vira um lançamento normal, com a quantidade de atendimentos — ou
 * descarta. A pontuação fica para quando a regra existir (decisão do gestor,
 * 26/10/2026).
 */
export default function DemandasExtrasPendentes({ pendentes, pessoas, regras }: {
  pendentes: AtendimentoOutroSetor[];
  pessoas: { id: string; nome: string }[];
  regras: RegraCota[];
}) {
  const router = useRouter();
  const [escolha, setEscolha] = useState<Record<string, string>>({});
  const [paraTodos, setParaTodos] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, iniciar] = useTransition();
  if (!pendentes.length) return null;

  const nome = new Map(pessoas.map((p) => [p.id, p.nome]));
  const grupos = [...pendentes.reduce((m, a) => {
    const k = `${a.pessoa_id}|${a.setor}|${a.mes_competencia}|${a.semana}`;
    if (!m.has(k)) m.set(k, { chave: k, pessoa: nome.get(a.pessoa_id) ?? '—', setor: a.setor, mes: a.mes_competencia, semana: a.semana, ids: [] });
    m.get(k)!.ids.push(a.id);
    return m;
  }, new Map<string, Grupo>()).values()]
    .sort((x, y) => x.mes.localeCompare(y.mes) || x.pessoa.localeCompare(y.pessoa) || x.semana - y.semana);

  // Só regras de demanda extra que somam: fora as de valor digitado, as de
  // desconto (peso negativo, como atraso e uso do celular), atestado,
  // transferências, chamados e presencial — nenhuma conta atendimento de outro setor.
  const FORA = new Set(['atestado', 'transferencias', 'presencial', 'huggy_atendimento', 'diretores_atendimento']);
  // As métricas do bypass de outro setor (migração 81) só entram pelo cálculo dele.
  const opcoes = regras.filter((r) => !r.valor_manual && Number(r.peso) > 0 && !FORA.has(r.chave)
    && !r.chave.startsWith('chamados') && !r.chave.startsWith('outro_setor_'));

  async function decidir(ids: number[], regra: string | null) {
    if (regra === null && !confirm(`Descartar ${ids.length} atendimento${ids.length > 1 ? 's' : ''}? Não vão pontuar.`)) return;
    setOcupado(true); setErro(null);
    const { error } = await criarClienteNavegador().rpc('decidir_outro_setor', { p_ids: ids, p_regra: regra });
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    iniciar(() => router.refresh());
  }

  const seletor = (valor: string, mudar: (v: string) => void) => (
    <select value={valor} onChange={(e) => mudar(e.target.value)} disabled={ocupado || atualizando}
            className="max-w-56 rounded-md border border-slate-300 bg-superficie px-2 py-1 text-sm">
      <option value="">Escolha a regra…</option>
      {opcoes.map((r) => <option key={r.chave} value={r.chave}>{r.rotulo}</option>)}
    </select>
  );

  return (
    <Quadro titulo={`Demandas extras pendentes (${pendentes.length})`}
            subtitulo="Atendimentos em outros setores, vindos do relatório do Hub. Não pontuam até você decidir: escolha a regra e lance, ou descarte.">
      {erro && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {opcoes.length === 0 && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-600/20">
          Ainda não há regra de demanda extra para lançar. Crie a regra em Configuração (com a pontuação que decidir) e
          volte aqui — até lá, os atendimentos ficam guardados, sem pontos.
        </p>
      )}
      <Tabela noQuadro>
        <thead>
          <tr>
            <Th>Pessoa</Th><Th>Setor</Th><Th>Mês · semana</Th><Th className="text-right">Atendimentos</Th><Th>Regra</Th><Th />
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => (
            <tr key={g.chave}>
              <Td className="font-medium text-slate-800">{g.pessoa}</Td>
              <Td><span className="rounded-full bg-slate-100 px-2 py-px text-xs text-slate-700">{g.setor}</span></Td>
              <Td className="whitespace-nowrap">{mesRotulo(g.mes)} · {g.semana}ª</Td>
              <Td className="text-right font-semibold tabular-nums">{g.ids.length}</Td>
              <Td>{seletor(escolha[g.chave] ?? '', (v) => setEscolha((e) => ({ ...e, [g.chave]: v })))}</Td>
              <Td className="whitespace-nowrap text-right">
                <button type="button" disabled={ocupado || atualizando || !escolha[g.chave]} onClick={() => decidir(g.ids, escolha[g.chave])}
                        className="rounded-md bg-marca-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
                  Lançar
                </button>{' '}
                <button type="button" disabled={ocupado || atualizando} onClick={() => decidir(g.ids, null)}
                        className="rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                  Descartar
                </button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Tabela>
      {grupos.length > 1 && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 text-sm">
          <span className="text-slate-500">Para todos:</span>
          {seletor(paraTodos, setParaTodos)}
          <button type="button" disabled={ocupado || atualizando || !paraTodos} onClick={() => decidir(pendentes.map((a) => a.id), paraTodos)}
                  className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
            Lançar os {grupos.length}
          </button>
        </div>
      )}
      {atualizando && <p className="mt-2 text-right text-sm text-slate-600">Feito, atualizando a tela…</p>}
    </Quadro>
  );
}
