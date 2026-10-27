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

/** Como a fila pontua: copiar = '' é regras próprias; senão, o id da fila copiada. */
type Regras = { copiar: string; tme: boolean };

/**
 * Setores e filas (2.10.0, migração 79): a árvore do plano da 3.0
 * (docs/PLANO-SETORES.md). A tela edita os nomes e os "nomes no Hub" de cada
 * fila — é por eles que a importação do relatório decide para qual fila vai
 * cada linha — e cria setor e fila. Desde a etapa 3 (migrações 84 e 85) a
 * fila diz como pontua: copiando as métricas de outra (e acompanhando as
 * mudanças dela) ou com regras próprias, com peso zero até o gestor preencher.
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
        if (vistosNomes.has(k)) { setErro(`"${n}" está em duas filas (${vistosNomes.get(k)} e ${c.nome}).`); return; }
        vistosNomes.set(k, c.nome);
      }
      if (!rascunho[`c${c.id}`].trim()) { setErro('Toda fila precisa de nome.'); return; }
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
      const { error } = await db.from('canais_do_setor').update({ nome, nomes_no_hub: nomes }).eq('id', c.id);
      if (error) { setOcupado(false); setErro(await mensagemDoErro(error)); return; }
    }
    setOcupado(false);
    setAviso('Salvo. As próximas importações do Hub já usam estes nomes.');
    iniciar(() => router.refresh());
  }

  // Criar setor e fila (versao-3). A fila nasce com as regras escolhidas aqui.
  const [novoSetor, setNovoSetor] = useState('');
  const [novoCanal, setNovoCanal] = useState<Record<number, { nome: string; hub: string }>>({});
  const comRegras = canais.filter((c) => c.regra_finalizado);
  const regrasPadrao = (): Regras => ({ copiar: comRegras[0] ? String(comRegras[0].id) : '', tme: true });
  const [regrasDe, setRegrasDe] = useState<Record<string, Regras>>({});
  const regrasDa = (chave: string) => regrasDe[chave] ?? regrasPadrao();
  const mudarRegras = (chave: string, r: Partial<Regras>) =>
    setRegrasDe((x) => ({ ...x, [chave]: { ...(x[chave] ?? regrasPadrao()), ...r } }));

  /** Grava como a fila pontua (migração 85). Só para fila ainda sem regras. */
  async function definirRegras(filaId: number, r: Regras) {
    const { error } = await criarClienteNavegador().rpc('definir_regras_da_fila', {
      p_fila: filaId, p_copiar_de: r.copiar ? Number(r.copiar) : null, p_tme: r.tme,
    });
    return error ? await mensagemDoErro(error) : null;
  }

  async function definirRegrasDaFila(c: Canal) {
    setOcupado(true); setErro(null); setAviso(null);
    const falha = await definirRegras(c.id, regrasDa(`f${c.id}`));
    setOcupado(false);
    if (falha) { setErro(falha); return; }
    setAviso(`Regras da fila "${c.nome}" definidas.`);
    iniciar(() => router.refresh());
  }

  async function criarSetor() {
    const nome = novoSetor.trim();
    if (!nome) return;
    setOcupado(true); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().from('setores')
      .insert({ nome, ordem: Math.max(0, ...setores.map((x) => x.ordem)) + 1 });
    setOcupado(false);
    if (error) { setErro(/duplicate|unique/i.test(error.message) ? `Já existe o setor "${nome}".` : await mensagemDoErro(error)); return; }
    setNovoSetor(''); setAviso(`Setor "${nome}" criado. Agora crie as filas dele.`);
    iniciar(() => router.refresh());
  }

  async function criarCanal(setorId: number) {
    const c = novoCanal[setorId];
    const nome = c?.nome.trim();
    if (!nome) return;
    const nomes = lista(c.hub || nome);
    const ocupados = new Set(canais.flatMap((x) => x.nomes_no_hub.map(normalizarSetor)));
    const repetido = nomes.find((n) => ocupados.has(normalizarSetor(n)));
    if (repetido) { setErro(`"${repetido}" já está em outra fila.`); return; }
    setOcupado(true); setErro(null); setAviso(null);
    const { data: criada, error } = await criarClienteNavegador().from('canais_do_setor').insert({
      setor_id: setorId, nome, nomes_no_hub: nomes,
      ordem: Math.max(0, ...canais.filter((x) => x.setor_id === setorId).map((x) => x.ordem)) + 1,
    }).select('id').single();
    if (error) {
      setOcupado(false);
      setErro(/duplicate|unique/i.test(error.message) ? `Já existe a fila "${nome}" neste setor.` : await mensagemDoErro(error));
      return;
    }
    const falha = await definirRegras(criada.id, regrasDa(`s${setorId}`));
    setOcupado(false);
    setNovoCanal((r) => ({ ...r, [setorId]: { nome: '', hub: '' } }));
    if (falha) setErro(`Fila "${nome}" criada, mas as regras não foram gravadas: ${falha} Defina-as na linha da fila.`);
    else setAviso(`Fila "${nome}" criada.`);
    iniciar(() => router.refresh());
  }

  /** Uma linha dizendo de onde vêm as regras da fila. */
  function comoPontua(c: Canal): string {
    if (!c.regra_finalizado) return 'Ainda não pontua: escolha como.';
    const tme = c.grupo_tme ? 'com TME' : 'sem TME';
    if (c.copia_de) {
      return `Copia as métricas da fila ${canais.find((x) => x.id === c.copia_de)?.nome ?? 'original'} e acompanha as mudanças dela · ${tme}.`;
    }
    if (c.apelido === 'huggy' || c.apelido === 'diretores') return `Regras da equipe · ${tme}.`;
    return `Regras próprias (Configuração › Pesos por cargo) · ${tme}.`;
  }

  function ligar(setorDoHub: string, canalId: number) {
    setRascunho((r) => {
      const atual = lista(r[`h${canalId}`]);
      return { ...r, [`h${canalId}`]: [...atual, setorDoHub].join(', ') };
    });
  }

  return (
    <div className="space-y-6">
      <Quadro titulo="Setores e filas"
              subtitulo="O setor é a equipe; as filas são como o Hub separa os atendimentos. A importação manda cada linha do relatório para a fila cujo nome no Hub bate.">
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
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Fila{!c.regra_finalizado && <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-px text-[10px] normal-case tracking-normal text-amber-700 dark:text-amber-300" title="Defina abaixo como esta fila pontua">sem regras</span>}
                      </span>
                      <input value={rascunho[`c${c.id}`]} disabled={ocupado} aria-label="Nome da fila"
                             onChange={(e) => setRascunho((r) => ({ ...r, [`c${c.id}`]: e.target.value }))}
                             className={`${entrada} font-medium`} />
                      <span className="text-xs text-slate-500">Nomes no Hub</span>
                      <input value={rascunho[`h${c.id}`]} disabled={ocupado} aria-label={`Nomes no Hub da fila ${c.nome}`}
                             placeholder="Como a fila aparece no relatório; separe por vírgula"
                             onChange={(e) => setRascunho((r) => ({ ...r, [`h${c.id}`]: e.target.value }))}
                             className={entrada} />
                      <p className="text-xs text-slate-500 sm:col-span-4">{comoPontua(c)}</p>
                      {!c.regra_finalizado && (
                        <div className="flex flex-wrap items-center gap-2 sm:col-span-4">
                          <EscolhaDeRegras r={regrasDa(`f${c.id}`)} mudar={(r) => mudarRegras(`f${c.id}`, r)}
                                           filas={comRegras.filter((x) => x.id !== c.id)} ocupado={ocupado} />
                          <button type="button" onClick={() => definirRegrasDaFila(c)} disabled={ocupado}
                                  className="rounded-lg bg-marca-600 px-3 py-1 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
                            Definir regras
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                  <li className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2">
                    <span className="text-xs font-semibold text-slate-500">+ Fila</span>
                    <input value={novoCanal[s.id]?.nome ?? ''} disabled={ocupado} placeholder="Nome da fila" aria-label={`Nome da nova fila em ${s.nome}`}
                           onChange={(e) => setNovoCanal((r) => ({ ...r, [s.id]: { hub: r[s.id]?.hub ?? '', nome: e.target.value } }))}
                           className={`${entrada} w-48`} />
                    <input value={novoCanal[s.id]?.hub ?? ''} disabled={ocupado} placeholder="Nome no Hub (se for diferente)" aria-label="Nomes no Hub da nova fila"
                           onChange={(e) => setNovoCanal((r) => ({ ...r, [s.id]: { nome: r[s.id]?.nome ?? '', hub: e.target.value } }))}
                           className={`${entrada} min-w-56 flex-1`} />
                    <EscolhaDeRegras r={regrasDa(`s${s.id}`)} mudar={(r) => mudarRegras(`s${s.id}`, r)}
                                     filas={comRegras} ocupado={ocupado} />
                    <button type="button" onClick={() => criarCanal(s.id)} disabled={ocupado || !novoCanal[s.id]?.nome.trim()}
                            className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                      Criar fila
                    </button>
                  </li>
                </ul>
              </li>
            ))}
            <li className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2.5">
              <span className="text-xs font-semibold text-slate-500">+ Novo setor</span>
              <input value={novoSetor} disabled={ocupado} placeholder="Nome do setor (a equipe)" aria-label="Nome do novo setor"
                     onChange={(e) => setNovoSetor(e.target.value)} className={`${entrada} w-64`} />
              <button type="button" onClick={criarSetor} disabled={ocupado || !novoSetor.trim()}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                Criar setor
              </button>
            </li>
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-slate-500">
            Fila nova recebe volume, avaliações e lançamentos já na próxima importação. Copiando, ela usa as mesmas regras da original e acompanha qualquer mudança de peso feita lá; com regras próprias, os pesos começam em zero (Configuração › Pesos por cargo). C-SAT e notas de 1 a 5 são os da equipe.
          </p>
          <button type="button" onClick={salvar} disabled={!mudou || ocupado || atualizando}
                  className="rounded-lg bg-marca-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
            {ocupado ? 'Salvando…' : atualizando ? 'Atualizando…' : 'Salvar'}
          </button>
        </div>
      </Quadro>

      <Quadro titulo={`Filas do Hub fora da árvore (${fora.length})`}
              subtitulo="Apareceram nos relatórios e não estão em nenhuma fila da árvore: viram demanda extra pendente. Ligar a uma fila faz as próximas importações contarem como ela (o que já foi importado não muda).">
        {fora.length === 0 ? <Vazio>Nenhuma. Toda fila que apareceu nos relatórios está na árvore.</Vazio> : (
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
                      {canais.map((c) => <option key={c.id} value={c.id}>Ligar à fila {c.nome}</option>)}
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

/** Copiar de uma fila (acompanha a original) ou regras próprias; pontuar TME ou não. */
function EscolhaDeRegras({ r, mudar, filas, ocupado }: {
  r: Regras; mudar: (r: Partial<Regras>) => void; filas: Canal[]; ocupado: boolean;
}) {
  return (
    <>
      <select value={r.copiar} disabled={ocupado} onChange={(e) => mudar({ copiar: e.target.value })}
              aria-label="Como a fila pontua" className={entrada}>
        {filas.map((f) => <option key={f.id} value={f.id}>Copiar métricas da fila {f.nome}</option>)}
        <option value="">Regras próprias (peso zero)</option>
      </select>
      <label className="flex items-center gap-1.5 text-sm text-slate-700">
        <input type="checkbox" checked={r.tme} disabled={ocupado} onChange={(e) => mudar({ tme: e.target.checked })}
               className="h-4 w-4 accent-marca-600" />
        Pontuar TME
      </label>
    </>
  );
}
