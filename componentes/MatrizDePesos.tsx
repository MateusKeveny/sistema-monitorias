'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import Link from '@/componentes/Link';
import {
  REGRA_MEDIA, REGRA_META,
  type Cargo, type PesoCargo, type ReferenciaCargo, type RegraCota,
} from '@/lib/tipos';
import { mensagemDoErro } from '@/lib/erro-amigavel';

/**
 * O cargo de base é avaliado em todas as regras e serve de referência para os
 * outros. Por decisão do gestor, "recebe por média" não se aplica a ele.
 */
const CARGO_BASE = 'Atendente Júnior';

const entrada = `rounded-lg border border-slate-300 bg-superficie px-2.5 py-1.5 text-sm outline-none
                 focus:border-marca-600 disabled:opacity-50`;
const botaoPrimario = `rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-40`;
const botaoSecundario = `rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                         font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40`;

const numero = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const curto = (nome: string) => nome.replace(/^Atendente\s+/, '');
const iniciais = (nome: string) =>
  curto(nome).normalize('NFD').replace(/\p{Diacritic}/gu, '').slice(0, 2).toUpperCase();

/** Os grupos na ordem da planilha, com a cor da bolinha. */
const GRUPOS = [
  { chave: 'expansao', titulo: 'Expansão', cor: '#34d399' },
  { chave: 'csat', titulo: 'C-SAT', cor: '#60a5fa' },
  { chave: 'notas', titulo: 'Notas', cor: '#a78bfa' },
  { chave: 'diretores', titulo: 'Diretores-Expansão', cor: '#2dd4bf' },
  { chave: 'monitoria', titulo: 'Monitoria', cor: '#fbbf24' },
  { chave: 'extra', titulo: 'Demanda extra', cor: '#f472b6' },
  { chave: 'chamados', titulo: 'Chamados', cor: '#94a3b8' },
] as const;

function grupoDa(r: RegraCota): string {
  // Cópia de outro setor (etapa 4): a chave e o grupo levam o sufixo do setor.
  const chave = r.chave.replace(/_sd+$/, '');
  const grupo = r.grupo.replace(/_sd+$/, '');
  if (chave === 'huggy_atendimento' || chave === 'transferencias' || grupo === 'tme') return 'expansao';
  if (grupo === 'csat') return 'csat';
  if (grupo === 'nota') return 'notas';
  if (chave === 'diretores_atendimento' || grupo === 'tme_diretores') return 'diretores';
  if (r.grupo === 'monitoria') return 'monitoria';
  if (r.chave.startsWith('chamados_')) return 'chamados';
  return 'extra';
}

function tipoDa(r: RegraCota): string {
  if (r.valor_manual) return 'valor digitado';
  if (r.grupo === 'atendimento') return 'por atendimento';
  if (r.grupo === 'tme' || r.grupo === 'tme_diretores') return 'faixa de TME';
  if (r.grupo === 'csat') return 'faixa · os dois canais';
  if (r.grupo === 'nota') return 'por avaliação';
  if (r.grupo === 'monitoria') return 'pontua acima do mínimo';
  return 'lançamento';
}

type Celula = { peso: number; ativo: boolean };

/**
 * Pesos por cargo (1.20.0): a tabela da planilha — cada métrica numa linha,
 * cada cargo numa coluna, o peso no cruzamento.
 *
 * Antes era um cargo por vez, com a lista inteira de regras embaixo: para
 * comparar Júnior e Pleno era preciso alternar. Aqui tudo aparece junto; o
 * clique num valor edita, e nada vai para o banco até "Salvar e recalcular",
 * com a barra dizendo quantas pessoas a mudança atinge.
 *
 * "Não pontua" é `ativo = false`, com o peso preservado: religar volta ao
 * valor anterior, como no editor antigo.
 */
export default function MatrizDePesos({
  setorId = 1, cargos, regras, pesos, referencias, pessoasPorCargo,
}: {
  /** O setor da tela (etapa 4): cargo novo nasce nele. */
  setorId?: number;
  cargos: Cargo[];
  regras: RegraCota[];
  pesos: PesoCargo[];
  referencias: ReferenciaCargo[];
  pessoasPorCargo: Record<number, number>;
}) {
  const router = useRouter();
  const pontuaveis = useMemo(() => regras
    .filter((r) => r.ativo && r.chave !== REGRA_META && r.chave !== REGRA_MEDIA && r.grupo !== 'config')
    .sort((a, b) => a.ordem - b.ordem), [regras]);

  const original = useMemo(() => {
    const m: Record<string, Celula> = {};
    for (const c of cargos) {
      for (const r of pontuaveis) {
        const p = pesos.find((x) => x.cargo_id === c.id && x.regra === r.chave);
        m[`${c.id}|${r.chave}`] = { peso: Number(p?.peso ?? r.peso), ativo: p?.ativo ?? false };
      }
    }
    return m;
  }, [cargos, pontuaveis, pesos]);

  const [celulas, setCelulas] = useState<Record<string, Celula>>(original);
  const [editando, setEditando] = useState<string | null>(null);
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState('');
  const [soPontuam, setSoPontuam] = useState(false);
  const [fechados, setFechados] = useState<Set<string>>(new Set());
  const [cargoAberto, setCargoAberto] = useState<number | 'novo' | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Motivo obrigatório de cada alteração: vai para o histórico (migração 56).
  const [motivo, setMotivo] = useState('');

  const mudancas = Object.keys(celulas).filter((k) =>
    celulas[k].ativo !== original[k].ativo || (celulas[k].ativo && celulas[k].peso !== original[k].peso));
  const cargosAfetados = [...new Set(mudancas.map((k) => Number(k.split('|')[0])))];
  const pessoasAfetadas = cargosAfetados.reduce((a, c) => a + (pessoasPorCargo[c] ?? 0), 0);

  function abrir(chave: string) {
    const c = celulas[chave];
    setEditando(chave);
    setTexto(c.ativo ? String(c.peso).replace('.', ',') : '');
  }

  function aplicar(chave: string, valor: string) {
    const t = valor.trim();
    if (!t) {
      setCelulas((s) => ({ ...s, [chave]: { ...s[chave], ativo: false } }));
    } else {
      const n = Number(t.replace(/\./g, '').replace(',', '.'));
      if (!Number.isFinite(n)) { setErro('Peso inválido: use números, como 4 ou -0,5.'); return; }
      setCelulas((s) => ({ ...s, [chave]: { peso: n, ativo: true } }));
    }
    setErro(null);
    setEditando(null);
  }

  async function salvar() {
    setOcupado(true); setErro(null); setAviso(null);
    const agora = new Date().toISOString();
    const linhas = mudancas.map((k) => {
      const [cargo, regra] = k.split('|');
      return { cargo_id: Number(cargo), regra, peso: celulas[k].peso, ativo: celulas[k].ativo, atualizado_em: agora,
               motivo_alteracao: motivo.trim() };
    });
    const { error } = await criarClienteNavegador().from('pesos_por_cargo')
      .upsert(linhas, { onConflict: 'cargo_id,regra' });
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    setAviso(`${linhas.length} ${linhas.length === 1 ? 'peso salvo' : 'pesos salvos'}. Meses já fechados não mudam.`);
    setMotivo('');
    router.refresh();
  }

  // O cargo de base: de onde a pontuação pode ser copiada para os outros (1.49.0).
  const base = cargos.find((c) => c.nome === CARGO_BASE);

  const termo = busca.trim().toLocaleLowerCase('pt-BR');
  const nomeCargo = new Map(cargos.map((c) => [c.id, c.nome]));

  return (
    <div className="space-y-4">
      <div className="rounded-[20px] bg-superficie shadow-sm">
        {/* Ferramentas */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-100 px-5 py-4">
          <label className="flex min-w-60 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-slate-500">
            <span aria-hidden>⌕</span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar métrica…"
                   aria-label="Buscar métrica" className="flex-1 bg-transparent text-sm text-slate-800 outline-none" />
          </label>
          <button type="button" aria-pressed={soPontuam} onClick={() => setSoPontuam((v) => !v)}
                  className={`rounded-full border px-3 py-1 text-xs ${soPontuam
                    ? 'border-marca-600 bg-marca-600/10 text-marca-700 dark:text-marca-400'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
            Só as que pontuam em algum cargo
          </button>
          <span className="flex-1" />
          <span className="mr-1 hidden items-center gap-1.5 text-xs text-slate-500 xl:inline-flex">
            <i className="h-2.5 w-2.5 rounded-sm bg-marca-600/35" /> soma
            <i className="ml-2 h-2.5 w-2.5 rounded-sm bg-rose-500/35" /> tira
            <i className="ml-2 h-2.5 w-2.5 rounded-sm bg-slate-200" /> valor digitado
            <i className="ml-2 h-1 w-1 rounded-full bg-slate-300" /> não pontua
          </span>
          <Link href="/cota/configuracao?cat=faixas#nova-metrica" className={botaoSecundario}>+ Métrica manual</Link>
          <button type="button" onClick={() => setCargoAberto(cargoAberto === 'novo' ? null : 'novo')} className={botaoSecundario}>
            + Cargo
          </button>
        </div>

        {erro && <p className="mx-5 mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
        {aviso && <p className="mx-5 mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

        {cargoAberto === 'novo' && (
          <NovoCargo setorId={setorId} cargos={cargos} pesos={pesos} onFechar={() => setCargoAberto(null)} />
        )}
        {typeof cargoAberto === 'number' && base && cargoAberto !== base.id && (
          <CopiarDoCargoBase
            key={`copiar-${cargoAberto}`}
            destino={cargos.find((c) => c.id === cargoAberto)!}
            grupos={GRUPOS.filter((g) => pontuaveis.some((r) => grupoDa(r) === g.chave))}
            onCopiar={(grupos) => {
              const destino = cargoAberto;
              const copiadas = pontuaveis.filter((r) => grupos.includes(grupoDa(r)));
              setCelulas((atual) => {
                const novo = { ...atual };
                for (const r of copiadas) novo[`${destino}|${r.chave}`] = { ...atual[`${base.id}|${r.chave}`] };
                return novo;
              });
              const nomeDestino = curto(cargos.find((c) => c.id === destino)?.nome ?? '');
              setMotivo((m) => m || `${nomeDestino} passa a pontuar como o ${curto(base.nome)}`);
              setAviso(`Pontuação do ${curto(base.nome)} copiada para o ${nomeDestino} — confira na tabela e salve.`);
            }}
          />
        )}
        {typeof cargoAberto === 'number' && (
          <EditorDoCargo
            key={cargoAberto}
            cargo={cargos.find((c) => c.id === cargoAberto)!}
            cargos={cargos}
            pesos={pesos.filter((p) => p.cargo_id === cargoAberto)}
            referencias={referencias.filter((r) => r.cargo_id === cargoAberto)}
            onFechar={() => setCargoAberto(null)}
          />
        )}

        <div className="overflow-x-auto xl:overflow-visible">
          <table className="w-full min-w-[56rem] table-fixed border-separate border-spacing-0 text-sm tabular-nums">
            <colgroup>
              <col className="w-[30%]" />
              {cargos.map((c) => <col key={c.id} />)}
            </colgroup>
            <thead>
              <tr>
                <th className="sticky top-0 z-10 border-b border-slate-200 bg-superficie py-3 pl-5 text-left align-middle
                               text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Métrica
                </th>
                {cargos.map((c) => {
                  const meta = pesos.find((p) => p.cargo_id === c.id && p.regra === REGRA_META)?.peso;
                  const media = pesos.find((p) => p.cargo_id === c.id && p.regra === REGRA_MEDIA && p.ativo);
                  const refs = referencias.filter((r) => r.cargo_id === c.id).map((r) => curto(nomeCargo.get(r.referencia_id) ?? ''));
                  const qtd = pontuaveis.filter((r) => original[`${c.id}|${r.chave}`]?.ativo).length;
                  const aberto = cargoAberto === c.id;
                  return (
                    <th key={c.id} className="sticky top-0 z-10 border-b border-slate-200 bg-superficie px-1.5 py-3 align-middle font-normal">
                      <button type="button" onClick={() => setCargoAberto(aberto ? null : c.id)}
                              title="Editar nome, meta e média do cargo"
                              className={`w-full rounded-2xl border bg-slate-50 px-3.5 py-3 text-left transition ${aberto
                                ? 'border-marca-600' : 'border-slate-200 hover:border-slate-300'}`}>
                        <span className="mb-2 flex items-center gap-2.5 whitespace-nowrap">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] bg-marca-600/15 text-[11px]
                                           font-bold text-marca-700 dark:text-marca-400">{iniciais(c.nome)}</span>
                          <span className="min-w-0">
                            <span className="block truncate text-[14.5px] font-semibold text-slate-900">{curto(c.nome)}</span>
                            <span className="block text-xs text-slate-500">
                              {pessoasPorCargo[c.id] ?? 0} pessoa{(pessoasPorCargo[c.id] ?? 0) === 1 ? '' : 's'}
                            </span>
                          </span>
                        </span>
                        {([
                          ['Meta', c.recebe_cota === false ? '—' : meta != null ? `${numero(Number(meta))} pts` : '—'],
                          ['Recebe', c.recebe_cota === false ? 'sem cota' : media ? `média ×${numero(Number(media.peso))}${qtd ? ' + pelo que faz' : ''}` : 'pelo que faz'],
                          ['Média de', media && refs.length ? refs.join(' + ') : '—'],
                          ['Métricas', qtd ? `${qtd} pontuam` : 'nenhuma'],
                        ] as const).map(([rotulo, valor]) => (
                          <span key={rotulo} className="flex justify-between gap-2 whitespace-nowrap py-px text-xs text-slate-500">
                            {rotulo}<b className="truncate font-semibold text-slate-700">{valor}</b>
                          </span>
                        ))}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>

            {GRUPOS.map((g, gi) => {
              const regrasDoGrupo = pontuaveis.filter((r) => grupoDa(r) === g.chave
                && (!termo || r.rotulo.toLocaleLowerCase('pt-BR').includes(termo))
                && (!soPontuam || cargos.some((c) => celulas[`${c.id}|${r.chave}`]?.ativo)));
              if (!regrasDoGrupo.length) return null;
              const aberto = !fechados.has(g.chave) || !!termo;
              return (
                <tbody key={g.chave}>
                  <tr className="group cursor-pointer select-none"
                      onClick={() => setFechados((s) => { const n = new Set(s); if (n.has(g.chave)) n.delete(g.chave); else n.add(g.chave); return n; })}>
                    <td colSpan={cargos.length + 1}
                        className={`whitespace-nowrap px-5 pb-2 pt-5 text-[13px] font-semibold text-slate-800 group-hover:text-marca-700
                                    dark:group-hover:text-marca-400 ${gi ? 'border-t border-slate-100' : ''}`}>
                      <span className="inline-block w-4 text-slate-400">{aberto ? '▾' : '▸'}</span>
                      <i className="mr-2.5 inline-block h-2 w-2 rounded-full align-[1px]" style={{ background: g.cor }} />
                      {g.titulo}
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-px text-xs font-medium text-slate-500">
                        {regrasDoGrupo.length}
                      </span>
                    </td>
                  </tr>
                  {aberto && regrasDoGrupo.map((r) => (
                    <tr key={r.chave} className="hover:bg-slate-50">
                      <td className="py-1.5 pl-11 pr-2">
                        <span className="block text-slate-800">{r.rotulo}</span>
                        <span className="block text-[11.5px] text-slate-400">{tipoDa(r)}</span>
                      </td>
                      {cargos.map((c) => {
                        const k = `${c.id}|${r.chave}`;
                        const cel = celulas[k];
                        const mudou = mudancas.includes(k);
                        if (editando === k) {
                          return (
                            <td key={c.id} className="py-1.5 text-center">
                              <span className="inline-flex flex-col items-center gap-0.5">
                                <input autoFocus value={texto} onChange={(e) => setTexto(e.target.value)}
                                       inputMode="decimal" aria-label={`Peso de ${r.rotulo} em ${c.nome}`}
                                       onKeyDown={(e) => {
                                         if (e.key === 'Enter') aplicar(k, texto);
                                         if (e.key === 'Escape') setEditando(null);
                                       }}
                                       onBlur={() => aplicar(k, texto)}
                                       className="w-24 rounded-lg border border-marca-600 bg-superficie px-2 py-1 text-center text-sm
                                                  outline-none ring-4 ring-marca-600/20" />
                                <button type="button" onMouseDown={(e) => { e.preventDefault(); aplicar(k, ''); }}
                                        className="text-[11.5px] text-slate-500 hover:text-rose-700 hover:underline">
                                  não pontua
                                </button>
                              </span>
                            </td>
                          );
                        }
                        const [classe, txt] = !cel.ativo ? ['', '']
                          : r.valor_manual ? ['bg-slate-100 text-slate-500 font-medium text-[12.5px]', 'digitado']
                            : cel.peso < 0 ? ['bg-rose-500/12 text-rose-700 dark:text-rose-300', `−${numero(Math.abs(cel.peso))}`]
                              : ['bg-marca-600/13 text-marca-700 dark:text-marca-400', `+${numero(cel.peso)}`];
                        return (
                          <td key={c.id} className="py-1.5 text-center">
                            <button type="button" onClick={() => abrir(k)}
                                    aria-label={`${r.rotulo} em ${c.nome}: ${cel.ativo ? txt : 'não pontua'}. Editar`}
                                    className={`group/c relative inline-grid h-7 min-w-[4.25rem] place-items-center rounded-full px-3 font-semibold
                                                transition hover:-translate-y-px hover:ring-2 hover:ring-slate-200
                                                ${classe} ${mudou ? 'ring-2 ring-amber-500 hover:ring-amber-500' : ''}
                                                ${cel.ativo ? '' : 'hover:bg-slate-100'}`}>
                              {cel.ativo ? txt : (
                                <>
                                  <i className="h-1 w-1 rounded-full bg-slate-300 group-hover/c:hidden" />
                                  <span className="hidden text-slate-500 group-hover/c:inline">+</span>
                                </>
                              )}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
        <div className="h-4" />
      </div>

      {mudancas.length > 0 && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-marca-600/40
                        bg-[#0f1a14] px-5 py-3 text-sm text-[#e8f5ec] shadow-2xl">
          <span>
            <strong>{mudancas.length} {mudancas.length === 1 ? 'alteração' : 'alterações'}</strong>
            {' '}em {cargosAfetados.map((c) => curto(nomeCargo.get(c) ?? '')).join(', ')}
            {' '}· afeta {pessoasAfetadas} pessoa{pessoasAfetadas === 1 ? '' : 's'} nos meses em aberto
          </span>
          <label className="flex min-w-72 flex-1 items-center gap-2">
            <span className="whitespace-nowrap text-[#bcd6c4]">Motivo</span>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={ocupado}
                   placeholder="Ex.: ajuste pedido pela diretoria"
                   className="w-full rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-sm text-[#e8f5ec]
                              placeholder:text-[#8fa99a] outline-none focus:border-marca-400" />
          </label>
          <span className="flex gap-2">
            <button type="button" disabled={ocupado} onClick={() => { setCelulas(original); setEditando(null); }}
                    className="rounded-lg border border-white/25 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-40">
              Desfazer
            </button>
            <button type="button" disabled={ocupado || !motivo.trim()} onClick={salvar} className={botaoPrimario}
                    title={motivo.trim() ? undefined : 'Escreva o motivo da alteração'}>
              {ocupado ? 'Salvando…' : 'Salvar e recalcular'}
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Copiar a pontuação do Júnior (1.49.0): traz para outro cargo, de uma vez, os
 * pesos que o cargo de base tem nos grupos escolhidos — antes era preciso
 * digitar métrica por métrica. Nada vai ao banco aqui: as células copiadas
 * viram alterações na matriz (em âmbar) e só valem com "Salvar e recalcular",
 * com o motivo, e entram no histórico de pesos como qualquer alteração. Meta
 * e média são do cargo e não são copiadas.
 */
function CopiarDoCargoBase({
  destino, grupos, onCopiar,
}: {
  destino: Cargo;
  grupos: readonly (typeof GRUPOS)[number][];
  onCopiar: (grupos: string[]) => void;
}) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set(grupos.map((g) => g.chave)));
  return (
    <div className="mx-5 mt-4 rounded-2xl border border-dashed border-marca-600/60 bg-marca-600/5 px-4 py-3">
      <p className="text-sm font-semibold text-slate-900">Copiar a pontuação do {curto(CARGO_BASE)}</p>
      <p className="mt-0.5 text-xs text-slate-500">
        Traz para o {curto(destino.nome)} os pesos que o {curto(CARGO_BASE)} tem hoje, de uma vez. Os grupos
        desmarcados ficam como estão. Meta e média não são copiadas.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {grupos.map((g) => (
          <label key={g.chave} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
            <input type="checkbox" checked={marcados.has(g.chave)}
                   onChange={(e) => setMarcados((s) => {
                     const n = new Set(s); if (e.target.checked) n.add(g.chave); else n.delete(g.chave); return n;
                   })} />
            <i className="inline-block h-2 w-2 rounded-full" style={{ background: g.cor }} />
            {g.titulo}
          </label>
        ))}
        <button type="button" disabled={!marcados.size} onClick={() => onCopiar([...marcados])}
                className={`${botaoPrimario} ml-auto py-1.5`}>
          Copiar para o {curto(destino.nome)}
        </button>
      </div>
    </div>
  );
}

/** Nome, meta e média do cargo: o que não é peso de métrica. */
function EditorDoCargo({
  cargo, cargos, pesos, referencias, onFechar,
}: {
  cargo: Cargo;
  cargos: Cargo[];
  pesos: PesoCargo[];
  referencias: ReferenciaCargo[];
  onFechar: () => void;
}) {
  const router = useRouter();
  const pesoDe = new Map(pesos.map((p) => [p.regra, p]));
  const media = pesoDe.get(REGRA_MEDIA);
  const [nome, setNome] = useState(cargo.nome);
  const [meta, setMeta] = useState(String(pesoDe.get(REGRA_META)?.peso ?? ''));
  const [recebeMedia, setRecebeMedia] = useState(Boolean(media?.ativo));
  const [multiplicador, setMultiplicador] = useState(String(media?.peso ?? '1'));
  const [compoem, setCompoem] = useState<number[]>(referencias.map((r) => r.referencia_id));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  // Cargo sem cota (migração 71): quem está nele não tem extrato nem resultado.
  const [recebeCota, setRecebeCota] = useState(cargo.recebe_cota !== false);
  const ehBase = cargo.nome === CARGO_BASE;

  async function salvar() {
    const nomeNovo = nome.trim();
    const metaNum = Number(meta);
    const multNum = Number(multiplicador.replace(',', '.'));
    if (!nomeNovo) { setErro('Informe o nome do cargo.'); return; }
    // O cargo de base é reconhecido pelo nome (ver CARGO_BASE): renomeá-lo
    // faria a tela passar a oferecer "recebe por média" a ele.
    if (ehBase && nomeNovo !== cargo.nome) {
      setErro(`"${CARGO_BASE}" é o cargo de referência dos demais e não pode ser renomeado.`); return;
    }
    if (cargos.some((c) => c.id !== cargo.id && c.nome.trim().toLowerCase() === nomeNovo.toLowerCase())) {
      setErro(`Já existe um cargo chamado "${nomeNovo}".`); return;
    }
    if (!recebeCota) {
      if (ehBase) { setErro(`"${CARGO_BASE}" é a base dos demais e sempre recebe cota.`); return; }
      setOcupado(true); setErro(null);
      const { error } = await criarClienteNavegador().from('cargos')
        .update({ nome: nomeNovo, recebe_cota: false }).eq('id', cargo.id);
      setOcupado(false);
      if (error) { setErro(await mensagemDoErro(error)); return; }
      onFechar(); router.refresh(); return;
    }
    if (!Number.isFinite(metaNum) || metaNum <= 0) { setErro('Informe uma meta maior que zero.'); return; }
    // Mudou meta ou média: o motivo é obrigatório, como na matriz (migração 56).
    const mudouPeso = metaNum !== Number(pesoDe.get(REGRA_META)?.peso ?? NaN)
      || (!ehBase && (recebeMedia !== Boolean(media?.ativo)
        || (recebeMedia && multNum !== Number(media?.peso ?? 1))));
    if (mudouPeso && !motivo.trim()) { setErro('Escreva o motivo da alteração da meta ou da média.'); return; }
    if (recebeMedia && (!Number.isFinite(multNum) || multNum <= 0)) { setErro('Informe um multiplicador maior que zero.'); return; }
    if (recebeMedia && !compoem.length) { setErro('Escolha ao menos um cargo para compor a média.'); return; }

    setOcupado(true); setErro(null);
    const db = criarClienteNavegador();
    const agora = new Date().toISOString();

    if (nomeNovo !== cargo.nome || cargo.recebe_cota === false) {
      const { error } = await db.from('cargos').update({ nome: nomeNovo, recebe_cota: true }).eq('id', cargo.id);
      if (error) {
        setOcupado(false);
        setErro(/duplicate|unique/i.test(error.message) ? `Já existe um cargo chamado "${nomeNovo}".` : error.message);
        return;
      }
    }

    const linhas = [{ cargo_id: cargo.id, regra: REGRA_META, peso: metaNum, ativo: true, atualizado_em: agora,
                      motivo_alteracao: motivo.trim() }];
    if (!ehBase) {
      linhas.push({
        cargo_id: cargo.id, regra: REGRA_MEDIA,
        peso: recebeMedia ? multNum : Number(media?.peso ?? 1), ativo: recebeMedia, atualizado_em: agora,
        motivo_alteracao: motivo.trim(),
      });
    }
    const { error } = await db.from('pesos_por_cargo').upsert(linhas, { onConflict: 'cargo_id,regra' });
    if (error) { setOcupado(false); setErro(await mensagemDoErro(error)); return; }

    if (!ehBase) {
      // Regrava a composição inteira: é pequena e evita calcular diferença.
      const { error: e1 } = await db.from('cargos_referencia').delete().eq('cargo_id', cargo.id);
      if (e1) { setOcupado(false); setErro(e1.message); return; }
      if (recebeMedia) {
        const { error: e2 } = await db.from('cargos_referencia')
          .insert(compoem.map((id) => ({ cargo_id: cargo.id, referencia_id: id })));
        if (e2) {
          setOcupado(false);
          setErro(/circular/i.test(e2.message)
            ? 'Configuração circular: um dos cargos escolhidos já recebe a média deste. '
              + 'A composição anterior foi removida — ajuste e salve de novo.'
            : e2.message);
          router.refresh();
          return;
        }
      }
    }

    setOcupado(false);
    onFechar();
    router.refresh();
  }

  return (
    <div className="surgir mx-5 mt-4 rounded-2xl border border-marca-600/40 bg-slate-50 px-5 py-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Nome do cargo</span>
          <input value={nome} disabled={ocupado || ehBase} onChange={(e) => setNome(e.target.value)}
                 title={ehBase ? `"${CARGO_BASE}" é o cargo de referência e não pode ser renomeado.` : undefined}
                 className={`${entrada} w-56`} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Meta do mês</span>
          <span className="flex items-center gap-1.5 text-sm text-slate-500">
            <input type="number" min="1" step="1" value={meta} disabled={ocupado}
                   onChange={(e) => setMeta(e.target.value)} className={`${entrada} w-28 text-right tabular-nums`} /> pts
          </span>
        </label>
        {!ehBase && (
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700"
                 title="Desligado: quem está neste cargo não tem extrato nem resultado, a partir do mês em que entrou nele">
            <input type="checkbox" checked={recebeCota} disabled={ocupado} onChange={(e) => setRecebeCota(e.target.checked)} />
            Recebe cota
          </label>
        )}
        {!ehBase && recebeCota && (
          <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" checked={recebeMedia} disabled={ocupado} onChange={(e) => setRecebeMedia(e.target.checked)} />
            Recebe pela média de outros cargos
          </label>
        )}
        <label className="min-w-56 flex-1">
          <span className="mb-1 block text-xs font-medium text-slate-600">Motivo (obrigatório se mudar meta ou média)</span>
          <input value={motivo} disabled={ocupado} onChange={(e) => setMotivo(e.target.value)}
                 placeholder="Ex.: ajuste pedido pela diretoria" className={`${entrada} w-full`} />
        </label>
        <button type="button" onClick={onFechar} disabled={ocupado} className={botaoSecundario}>Cancelar</button>
        <button type="button" onClick={salvar} disabled={ocupado} className={botaoPrimario}>
          {ocupado ? 'Salvando…' : `Salvar ${curto(cargo.nome)}`}
        </button>
      </div>

      {!ehBase && recebeCota && recebeMedia && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-200 pt-3 text-sm text-slate-700">
          <label className="flex items-center gap-2">
            Multiplicador
            <input value={multiplicador} disabled={ocupado} inputMode="decimal"
                   onChange={(e) => setMultiplicador(e.target.value)} className={`${entrada} w-20 text-right tabular-nums`} />
          </label>
          <span className="text-slate-500">Média de:</span>
          {cargos.filter((c) => c.id !== cargo.id).map((c) => (
            <label key={c.id} className="flex items-center gap-1.5">
              <input type="checkbox" checked={compoem.includes(c.id)} disabled={ocupado}
                     onChange={() => setCompoem((l) => (l.includes(c.id) ? l.filter((x) => x !== c.id) : [...l, c.id]))} />
              {curto(c.nome)}
            </label>
          ))}
        </div>
      )}
      <p className="mt-2 text-xs text-slate-500">
        {!recebeCota
          ? 'Sem cota: quem está neste cargo (a partir do mês em que entrou) não tem extrato nem resultado e sai do fechamento, da exportação e das médias. O acesso é o do papel.'
          : recebeMedia
          ? 'Média do resultado mensal de quem está nos cargos marcados, multiplicada. As métricas da tabela continuam somando por cima.'
          : 'Os pesos de cada métrica se editam direto na tabela.'}
      </p>
      {erro && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
    </div>
  );
}

/** Cargo novo, nascendo com os pesos de outro para não começar do zero. */
function NovoCargo({ setorId, cargos, pesos, onFechar }: { setorId: number; cargos: Cargo[]; pesos: PesoCargo[]; onFechar: () => void }) {
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [copiarDe, setCopiarDe] = useState(String(cargos[0]?.id ?? ''));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    const n = nome.trim();
    if (!n) return;
    setOcupado(true); setErro(null);
    const db = criarClienteNavegador();
    const { data, error } = await db.from('cargos')
      .insert({ nome: n, ordem: Math.max(0, ...cargos.map((c) => c.ordem)) + 1, setor_id: setorId })
      .select('id').single();
    if (error || !data) {
      setOcupado(false);
      setErro(/duplicate|unique/i.test(error?.message ?? '') ? `Já existe um cargo chamado "${n}" neste setor.` : error?.message ?? 'Falha ao criar.');
      return;
    }
    // A média não é copiada: é uma escolha própria de cada cargo.
    const copia = pesos
      .filter((p) => p.cargo_id === Number(copiarDe) && p.regra !== REGRA_MEDIA)
      .map((p) => ({ cargo_id: data.id, regra: p.regra, peso: p.peso, ativo: p.ativo,
                     motivo_alteracao: `Cargo criado copiando os pesos de ${cargos.find((c) => c.id === Number(copiarDe))?.nome ?? 'outro cargo'}` }));
    if (copia.length) {
      const { error: e2 } = await db.from('pesos_por_cargo').insert(copia);
      if (e2) { setOcupado(false); setErro(e2.message); return; }
    }
    setOcupado(false);
    onFechar();
    router.refresh();
  }

  return (
    <form onSubmit={criar} className="surgir mx-5 mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-marca-600/40 bg-slate-50 px-5 py-4">
      <label>
        <span className="mb-1 block text-xs font-medium text-slate-600">Novo cargo</span>
        <input value={nome} disabled={ocupado} onChange={(e) => setNome(e.target.value)}
               placeholder="Ex.: Analista Sênior" className={`${entrada} w-64`} />
      </label>
      <label>
        <span className="mb-1 block text-xs font-medium text-slate-600">Começa com os pesos de</span>
        <select value={copiarDe} disabled={ocupado} onChange={(e) => setCopiarDe(e.target.value)} className={entrada}>
          {cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
        </select>
      </label>
      <span className="flex-1" />
      <button type="button" onClick={onFechar} disabled={ocupado} className={botaoSecundario}>Cancelar</button>
      <button type="submit" disabled={ocupado || !nome.trim()} className={botaoPrimario}>Criar cargo</button>
      {erro && <p className="w-full rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
    </form>
  );
}

