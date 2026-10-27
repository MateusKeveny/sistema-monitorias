'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Quadro, Tabela, Td, Th, Vazio } from '@/componentes/ui';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { data as formatarData } from '@/lib/formatar';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import { normalizarSetor, type Canal, type Setor } from '@/lib/setores';

export type SetorDoHubVisto = { setor: string; atendimentos: number; ultima_vez: string };

const entrada = 'rounded-md border border-slate-300 bg-superficie px-2 py-1 text-sm outline-none focus:border-marca-600';

/**
 * Setores e canais (2.10.0, migração 79): a árvore do plano da 3.0
 * (docs/PLANO-SETORES.md). Nesta etapa a tela edita os nomes e, o que
 * importa, os "nomes no Hub" de cada canal — é por eles que a importação do
 * relatório decide para qual canal vai cada linha. Criar setor ou canal novo
 * fica para quando o cálculo ler o cadastro (etapa 3).
 */
export default function SetoresECanais({ setores, canais, vistos }: {
  setores: Setor[]; canais: Canal[]; vistos: SetorDoHubVisto[];
}) {
  const router = useRouter();
  const [rascunho, setRascunho] = useState<Record<string, string>>(() => Object.fromEntries([
    ...setores.map((s) => [`s${s.id}`, s.nome]),
    ...canais.flatMap((c) => [[`c${c.id}`, c.nome], [`h${c.id}`, c.nomes_no_hub.join(', ')]]),
  ]));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [atualizando, iniciar] = useTransition();

  const lista = (t: string) => [...new Set(t.split(',').map((x) => x.trim()).filter(Boolean))];
  const mudou = setores.some((s) => rascunho[`s${s.id}`].trim() !== s.nome)
    || canais.some((c) => rascunho[`c${c.id}`].trim() !== c.nome
      || lista(rascunho[`h${c.id}`]).join('|') !== c.nomes_no_hub.join('|'));

  // Nome do Hub que já está em algum canal (pelo rascunho, normalizado).
  const ligados = new Map(canais.flatMap((c) => lista(rascunho[`h${c.id}`]).map((n) => [normalizarSetor(n), c.nome])));
  const fora = vistos.filter((v) => !ligados.has(normalizarSetor(v.setor)));

  async function salvar() {
    // Um nome do Hub só pode ir para um canal.
    const vistosNomes = new Map<string, string>();
    for (const c of canais) {
      for (const n of lista(rascunho[`h${c.id}`])) {
        const k = normalizarSetor(n);
        if (vistosNomes.has(k)) { setErro(`"${n}" está em dois canais (${vistosNomes.get(k)} e ${c.nome}).`); return; }
        vistosNomes.set(k, c.nome);
      }
      if (!rascunho[`c${c.id}`].trim()) { setErro('Todo canal precisa de nome.'); return; }
    }
    if (setores.some((s) => !rascunho[`s${s.id}`].trim())) { setErro('Todo setor precisa de nome.'); return; }

    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    for (const s of setores) {
      const nome = rascunho[`s${s.id}`].trim();
      if (nome === s.nome) continue;
      const { error } = await db.from('setores').update({ nome }).eq('id', s.id);
      if (error) { setOcupado(false); setErro(await mensagemDoErro(error)); return; }
    }
    for (const c of canais) {
      const nome = rascunho[`c${c.id}`].trim();
      const nomes = lista(rascunho[`h${c.id}`]);
      if (nome === c.nome && nomes.join('|') === c.nomes_no_hub.join('|')) continue;
      const { error } = await db.from('canais').update({ nome, nomes_no_hub: nomes }).eq('id', c.id);
      if (error) { setOcupado(false); setErro(await mensagemDoErro(error)); return; }
    }
    setOcupado(false);
    setAviso('Salvo. As próximas importações do Hub já usam estes nomes.');
    iniciar(() => router.refresh());
  }

  function ligar(setorDoHub: string, canalId: number) {
    setRascunho((r) => {
      const atual = lista(r[`h${canalId}`]);
      return { ...r, [`h${canalId}`]: [...atual, setorDoHub].join(', ') };
    });
  }

  return (
    <div className="space-y-6">
      <Quadro titulo="Setores e canais"
              subtitulo="O setor é a equipe; os canais são como o relatório do Hub separa os atendimentos. A importação manda cada linha para o canal cujo nome no Hub bate.">
        {erro && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
        {aviso && <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}
        {setores.length === 0 ? <Vazio>Falta rodar a migração 79 no banco.</Vazio> : (
          <ul className="space-y-4">
            {setores.map((s) => (
              <li key={s.id}>
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Setor</span>
                  <input value={rascunho[`s${s.id}`]} disabled={ocupado} aria-label="Nome do setor"
                         onChange={(e) => setRascunho((r) => ({ ...r, [`s${s.id}`]: e.target.value }))}
                         className={`${entrada} w-64 font-semibold`} />
                </div>
                <ul className="ml-5 mt-2 space-y-2 border-l-2 border-slate-200 pl-4">
                  {canais.filter((c) => c.setor_id === s.id).map((c) => (
                    <li key={c.id} className="grid gap-2 rounded-xl border border-slate-200 bg-superficie px-3 py-2.5 sm:grid-cols-[auto_14rem_auto_1fr] sm:items-center">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Canal</span>
                      <input value={rascunho[`c${c.id}`]} disabled={ocupado} aria-label="Nome do canal"
                             onChange={(e) => setRascunho((r) => ({ ...r, [`c${c.id}`]: e.target.value }))}
                             className={`${entrada} font-medium`} />
                      <span className="text-xs text-slate-500">Nomes no Hub</span>
                      <input value={rascunho[`h${c.id}`]} disabled={ocupado} aria-label={`Nomes no Hub do canal ${c.nome}`}
                             placeholder="Como o setor aparece no relatório; separe por vírgula"
                             onChange={(e) => setRascunho((r) => ({ ...r, [`h${c.id}`]: e.target.value }))}
                             className={entrada} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Criar setor ou canal novo chega quando o cálculo da cota passar a ler este cadastro (etapa 3 do plano).
          </p>
          <button type="button" onClick={salvar} disabled={!mudou || ocupado || atualizando}
                  className="rounded-lg bg-marca-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
            {ocupado ? 'Salvando…' : atualizando ? 'Atualizando…' : 'Salvar'}
          </button>
        </div>
      </Quadro>

      <Quadro titulo={`Setores do Hub fora da árvore (${fora.length})`}
              subtitulo="Apareceram nos relatórios e não estão em nenhum canal: viram demanda extra pendente. Ligar a um canal faz as próximas importações contarem como ele (o que já foi importado não muda).">
        {fora.length === 0 ? <Vazio>Nenhum. Todo setor que apareceu nos relatórios está num canal.</Vazio> : (
          <Tabela noQuadro>
            <thead><tr><Th>No Hub</Th><Th className="text-right">Atendimentos</Th><Th>Visto por último</Th><Th /></tr></thead>
            <tbody>
              {fora.map((v) => (
                <tr key={v.setor}>
                  <Td className="font-medium text-slate-800">{v.setor}</Td>
                  <Td className="text-right tabular-nums">{v.atendimentos}</Td>
                  <Td className="text-xs text-slate-500">{formatarData(v.ultima_vez)}</Td>
                  <Td className="text-right">
                    <select value="" disabled={ocupado} onChange={(e) => e.target.value && ligar(v.setor, Number(e.target.value))}
                            className="rounded-md border border-slate-300 bg-superficie px-2 py-1 text-sm">
                      <option value="">Deixar como demanda extra</option>
                      {canais.map((c) => <option key={c.id} value={c.id}>Ligar ao canal {c.nome}</option>)}
                    </select>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </Quadro>
    </div>
  );
}
