'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Quadro, Tabela, Td, Th, Vazio } from '@/componentes/ui';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { data as formatarData, hojeNoBrasil, mesDeCompetencia, mesRotulo } from '@/lib/formatar';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import { normalizarSetor, type Canal, type Setor } from '@/lib/setores';
import { MONITORIAS_PADRAO, type MonitoriasDoSetor } from '@/lib/monitoriasDoSetor';

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
export default function SetoresECanais({ setores, canais, vistos, monitorias = {} }: {
  setores: Setor[]; canais: Canal[]; vistos: SetorDoHubVisto[];
  /** Quantas por semana e o piso de cada setor (Monitorias 6.0, migração 89). */
  monitorias?: Record<number, MonitoriasDoSetor>;
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
  const [setorOrigem, setSetorOrigem] = useState(setores[0] ? String(setores[0].id) : '');
  const [monitoriasNoSetor, setMonitoriasNoSetor] = useState(false);
  // Monitorias 6.0: quantas por semana e o piso (em %), na criação, ao ligar
  // depois e na edição de cada setor. Texto, para o campo aceitar "85,5".
  const camposDe = (id?: number): CamposMonitoria => {
    const m = (id != null && monitorias[id]) || MONITORIAS_PADRAO;
    return { qtd: String(m.porSemana), piso: String(Math.round(m.piso * 1000) / 10).replace('.', ','), de: id != null ? String(id) : undefined };
  };
  const [novasMonitorias, setNovasMonitorias] = useState<CamposMonitoria>(() => camposDe(setores[0]?.id));
  const [ligando, setLigando] = useState<Record<number, CamposMonitoria>>({});
  const [editando, setEditando] = useState<Record<number, CamposMonitoria>>({});
  /** Lê os campos: [quantidade, piso de 0 a 1] ou a mensagem do que está errado. */
  const lerCampos = (c: CamposMonitoria): [number, number] | string => {
    const qtd = Number(c.qtd);
    const piso = Number(c.piso.replace(',', '.')) / 100;
    if (!Number.isInteger(qtd) || qtd < 1 || qtd > 10) return 'Monitorias por semana: de 1 a 10.';
    if (!(piso > 0 && piso <= 1)) return 'O piso é um percentual entre 1% e 100%.';
    return [qtd, piso];
  };
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

  /** Liga/desliga as monitorias do setor (migração 88). Ligar dá aos cargos
   *  que pontuam finalizado o peso padrão da régua de monitoria do setor. */
  async function ligarMonitorias(s: Setor, ligar: boolean, campos?: CamposMonitoria) {
    if (ligar && !campos) {
      // Ligar pergunta antes quantas por semana, o piso e de onde vêm os critérios.
      setLigando((l) => ({ ...l, [s.id]: camposDe(setores.find((x) => x.id !== s.id && x.monitorias !== false)?.id ?? 1) }));
      return;
    }
    const lidos = campos ? lerCampos(campos) : null;
    if (typeof lidos === 'string') { setErro(lidos); return; }
    if (!confirm(ligar
      ? `Ligar as monitorias de "${s.nome}"? A monitoria passa a pontuar no setor a partir dos meses em aberto, e as pessoas dele aparecem no Monitorias.`
      : `Desligar as monitorias de "${s.nome}"? A monitoria deixa de pontuar nos meses em aberto do setor e ele sai do Monitorias. Meses fechados não mudam.`)) return;
    setOcupado(true); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().rpc('ligar_monitorias', ligar && lidos
      ? { p_setor: s.id, p_ligar: true, p_por_semana: lidos[0], p_piso: lidos[1], p_copiar_de: Number(campos!.de ?? 1) }
      : { p_setor: s.id, p_ligar: ligar });
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    setLigando((l) => { const n = { ...l }; delete n[s.id]; return n; });
    setAviso(`Monitorias ${ligar ? 'ligadas' : 'desligadas'} em "${s.nome}".`);
    iniciar(() => router.refresh());
  }

  /** Quantas por semana e o piso de um setor (Configuração; valem nos meses em aberto). */
  async function salvarMonitorias(s: Setor) {
    const lidos = lerCampos(editando[s.id]);
    if (typeof lidos === 'string') { setErro(lidos); return; }
    setOcupado(true); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().rpc('definir_monitorias_do_setor', {
      p_setor: s.id, p_por_semana: lidos[0], p_piso: lidos[1],
    });
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    setAviso(`Monitorias de "${s.nome}": ${lidos[0]} por semana, pontuando a partir de ${editando[s.id].piso}%.`);
    setEditando((e) => { const n = { ...e }; delete n[s.id]; return n; });
    iniciar(() => router.refresh());
  }

  async function criarSetor() {
    const nome = novoSetor.trim();
    if (!nome) return;
    const lidos = monitoriasNoSetor ? lerCampos(novasMonitorias) : null;
    if (typeof lidos === 'string') { setErro(lidos); return; }
    setOcupado(true); setErro(null); setAviso(null);
    // Copiando outro setor (migrações 86 e 87): cargos com pesos e meta, faixas
    // e nomes das métricas e a régua da monitoria, em cópias independentes.
    // Com monitorias (migração 89): quantas por semana, o piso e os critérios
    // do setor de origem.
    const { error } = await criarClienteNavegador().rpc('clonar_setor', lidos ? {
      p_nome: nome, p_origem: setorOrigem ? Number(setorOrigem) : null, p_monitorias: true,
      p_por_semana: lidos[0], p_piso: lidos[1],
    } : {
      p_nome: nome, p_origem: setorOrigem ? Number(setorOrigem) : null, p_monitorias: monitoriasNoSetor,
    });
    setOcupado(false);
    if (error) { setErro(/duplicate|unique/i.test(error.message) ? `Já existe o setor "${nome}".` : await mensagemDoErro(error)); return; }
    setNovoSetor('');
    setAviso(`Setor "${nome}" criado${setorOrigem ? ' com os cargos e as métricas copiados' : ''}. Agora crie as filas dele.`);
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
  /**
   * TME por pessoa (migração 90): a partir de qual competência a fila avalia
   * o TME de cada um. Só muda o que ainda não fechou — a data não pode voltar
   * para antes do mês aberto, nem sair de um mês que já está valendo para trás.
   */
  const mesAberto = mesDeCompetencia(hojeNoBrasil());
  async function definirTmePorPessoa(c: Canal, desde: string | null) {
    if (!confirm(desde
      ? `TME por pessoa na fila "${c.nome}" a partir de ${mesRotulo(desde)}: a faixa passa a sair do TME de cada um (sem TME na semana = melhor faixa). Meses anteriores não mudam.`
      : `Voltar a fila "${c.nome}" para o TME da equipe? Vale para os meses ainda abertos.`)) return;
    setOcupado(true); setErro(null); setAviso(null);
    const { error } = await criarClienteNavegador().from('canais_do_setor').update({ tme_por_pessoa_desde: desde }).eq('id', c.id);
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    setAviso(desde ? `"${c.nome}": TME por pessoa a partir de ${mesRotulo(desde)}.` : `"${c.nome}": TME da equipe.`);
    iniciar(() => router.refresh());
  }

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
                  <label className="ml-auto flex items-center gap-1.5 text-sm text-slate-700"
                         title="Desligadas: a monitoria não pontua neste setor e ele some do Monitorias">
                    <input type="checkbox" checked={s.monitorias !== false} disabled={ocupado}
                           onChange={(e) => ligarMonitorias(s, e.target.checked)} className="h-4 w-4 accent-marca-600" />
                    Monitorias neste setor
                  </label>
                </div>
                {s.monitorias !== false && (
                  <div className="ml-5 mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    {editando[s.id] ? (
                      <>
                        <CamposDeMonitoria c={editando[s.id]} mudar={(c) => setEditando((e) => ({ ...e, [s.id]: c }))} ocupado={ocupado} />
                        <button type="button" onClick={() => salvarMonitorias(s)} disabled={ocupado}
                                className="rounded-lg bg-marca-600 px-3 py-1 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
                          Salvar
                        </button>
                        <button type="button" onClick={() => setEditando((e) => { const n = { ...e }; delete n[s.id]; return n; })}
                                className="text-xs text-slate-500 hover:underline">cancelar</button>
                        <span className="w-full text-xs text-slate-500">Vale para os meses em aberto; mês fechado não muda.</span>
                      </>
                    ) : (
                      <>
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                          {(monitorias[s.id] ?? MONITORIAS_PADRAO).porSemana} monitorias por semana
                        </span>
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                          pontua com média a partir de {camposDe(s.id).piso}%
                        </span>
                        <button type="button" onClick={() => setEditando((e) => ({ ...e, [s.id]: camposDe(s.id) }))} disabled={ocupado}
                                className="text-xs text-marca-700 hover:underline dark:text-marca-400">alterar</button>
                      </>
                    )}
                  </div>
                )}
                {ligando[s.id] && (
                  <div className="ml-5 mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-marca-600/40 bg-slate-50 px-3 py-2.5 text-sm text-slate-600">
                    <span className="font-semibold text-slate-800">Ligar as monitorias:</span>
                    <CamposDeMonitoria c={ligando[s.id]} mudar={(c) => setLigando((l) => ({ ...l, [s.id]: c }))} ocupado={ocupado} />
                    <select value={ligando[s.id].de} disabled={ocupado} aria-label="De onde vêm os critérios"
                            onChange={(e) => setLigando((l) => ({ ...l, [s.id]: { ...l[s.id], de: e.target.value } }))} className={entrada}>
                      {setores.filter((x) => x.id !== s.id).map((x) => <option key={x.id} value={x.id}>Critérios copiados de {x.nome}</option>)}
                    </select>
                    <button type="button" onClick={() => ligarMonitorias(s, true, ligando[s.id])} disabled={ocupado}
                            className="rounded-lg bg-marca-600 px-3 py-1 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
                      Ligar
                    </button>
                    <button type="button" onClick={() => setLigando((l) => { const n = { ...l }; delete n[s.id]; return n; })}
                            className="text-xs text-slate-500 hover:underline">cancelar</button>
                  </div>
                )}
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
                      {c.grupo_tme && c.regra_finalizado && (
                        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600 sm:col-span-4">
                          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold">
                            {c.tme_por_pessoa_desde ? `TME de cada pessoa desde ${mesRotulo(c.tme_por_pessoa_desde)}` : 'TME da equipe (média da fila)'}
                          </span>
                          {/* Só o que ainda não fechou: o mês aberto em diante. */}
                          {(!c.tme_por_pessoa_desde || c.tme_por_pessoa_desde >= mesAberto) && (
                            <>
                              <label className="flex items-center gap-1.5">
                                por pessoa a partir de
                                <input type="month" disabled={ocupado} min={mesAberto.slice(0, 7)}
                                       defaultValue={(c.tme_por_pessoa_desde ?? mesAberto).slice(0, 7)}
                                       onChange={(e) => e.target.value && definirTmePorPessoa(c, `${e.target.value}-01`)}
                                       aria-label={`TME por pessoa a partir de, na fila ${c.nome}`} className={entrada} />
                              </label>
                              {c.tme_por_pessoa_desde && (
                                <button type="button" onClick={() => definirTmePorPessoa(c, null)} disabled={ocupado}
                                        className="text-marca-700 hover:underline dark:text-marca-400">voltar ao TME da equipe</button>
                              )}
                            </>
                          )}
                        </p>
                      )}
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
              <select value={setorOrigem} disabled={ocupado}
                      onChange={(e) => { setSetorOrigem(e.target.value); setNovasMonitorias(camposDe(e.target.value ? Number(e.target.value) : undefined)); }}
                      aria-label="De onde vêm os cargos e as métricas" className={entrada}>
                {setores.map((s) => <option key={s.id} value={s.id}>Cargos e métricas copiados de {s.nome}</option>)}
                <option value="">Do zero</option>
              </select>
              <label className="flex items-center gap-1.5 text-sm text-slate-700">
                <input type="checkbox" checked={monitoriasNoSetor} disabled={ocupado}
                       onChange={(e) => setMonitoriasNoSetor(e.target.checked)} className="h-4 w-4 accent-marca-600" />
                Monitorias neste setor
              </label>
              {monitoriasNoSetor && (
                <CamposDeMonitoria c={novasMonitorias} mudar={setNovasMonitorias} ocupado={ocupado} />
              )}
              <button type="button" onClick={criarSetor} disabled={ocupado || !novoSetor.trim()}
                      className="rounded-lg border border-slate-300 px-3 py-1 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                Criar setor
              </button>
              <p className="w-full text-xs text-slate-500">
                Copiar leva os cargos (com pesos e meta), as faixas e os nomes das métricas e a régua da monitoria — e, com
                monitorias, também os critérios do formulário de monitoria. Depois cada setor é independente. Sem monitorias, o setor não aparece no Monitorias e a monitoria não pontua; dá para
                ligar depois.
              </p>
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
/** Os campos da monitoria do setor, em texto (o piso em %, aceitando "85,5"). */
type CamposMonitoria = { qtd: string; piso: string; de?: string };

/** Quantas monitorias por semana e o piso da média que pontua (Monitorias 6.0). */
function CamposDeMonitoria({ c, mudar, ocupado }: {
  c: CamposMonitoria; mudar: (c: CamposMonitoria) => void; ocupado: boolean;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
      <input value={c.qtd} disabled={ocupado} inputMode="numeric" aria-label="Monitorias por semana"
             onChange={(e) => mudar({ ...c, qtd: e.target.value.replace(/\D/g, '') })} className={`${entrada} w-12 text-right`} />
      monitorias por semana · pontua com média a partir de
      <input value={c.piso} disabled={ocupado} inputMode="decimal" aria-label="Piso da média, em %"
             onChange={(e) => mudar({ ...c, piso: e.target.value.replace(/[^\d,]/g, '') })} className={`${entrada} w-14 text-right`} />
      %
    </span>
  );
}

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
