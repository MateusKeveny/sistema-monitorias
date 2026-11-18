'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import {
  REGRA_MEDIA, REGRA_META,
  type Cargo, type PesoCargo, type ReferenciaCargo, type RegraCota,
} from '@/lib/tipos';
import { cargoDeReferencia, ehMetricaDeAtendimento } from '@/lib/pontuacaoUnica';
import { EditorDoCargo, NovoCargo } from '@/componentes/MatrizDePesos';

/**
 * Metas e pontuação (4.12.0): a tela de pesos reorganizada pelo que o gestor
 * ajusta de verdade, no lugar da tabela métrica × cargo.
 *
 *   ① Atendimento — finalizado, TME, TMA, C-SAT e notas, de todas as filas.
 *      Com a pontuação única (migração 112), um valor por linha vale para
 *      todos os cargos que atendem; os cargos que atendem são etiquetas que
 *      ligam e desligam.
 *   ② Cargos — um cartão por cargo com só o que é dele: meta, se recebe pela
 *      média de outros cargos, e as demandas que ele pontua (monitoria,
 *      chamados, lançamentos), com "+ Demanda" para pôr uma existente ou criar
 *      uma nova ali mesmo.
 *
 * Nada vai ao banco até "Salvar e recalcular", com o motivo no histórico de
 * pesos (migração 56). Criar demanda nova e editar meta/média gravam na hora,
 * como antes. O cálculo da cota não muda: continua lendo pesos_por_cargo.
 *
 * 4.13.0 (Regras da cota): o corte de cada faixa (TME, TMA, C-SAT, monitoria)
 * fica na mesma linha dos pontos e salva junto — antes ficava em "Métricas e
 * faixas", outra tela. Cada corte é o fim de uma faixa e o começo da próxima,
 * então aparece como campo numa linha só (a primeira das duas na tabela) e
 * como texto na outra. `parte` escolhe o bloco de cada aba da tela.
 */

type Unidade = 'min' | '%';
/** Que métrica tem corte e em que unidade ele aparece (no banco: segundos e fração). */
function unidadeDo(grupo: string): Unidade | null {
  const g = grupo.replace(/_s\d+$/, '');
  if (g === 'csat' || g === 'monitoria') return '%';
  if (g === 'tme' || g === 'tma' || g.startsWith('tme_')) return 'min';
  return null;
}
const paraTela = (v: number, u: Unidade) =>
  (u === 'min' ? Math.round((v / 60) * 100) / 100 : Math.round(v * 10000) / 100).toLocaleString('pt-BR');
const paraBanco = (t: string, u: Unidade) => {
  const n = Number(t.trim().replace(',', '.'));
  if (!t.trim() || !Number.isFinite(n)) return NaN;
  return u === 'min' ? Math.round(n * 60) : Math.round((n / 100) * 10000) / 10000;
};

type Celula = { peso: number; ativo: boolean };
type Fila = { id: number; nome: string; regra_finalizado?: string | null; grupo_tme?: string | null;
  grupo_csat?: string | null; grupo_nota?: string | null; grupo_tma?: string | null };

const botaoPrimario = `rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white
                       hover:bg-marca-700 disabled:opacity-40`;
const botaoSecundario = `rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                         font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40`;
const curto = (nome: string) => nome.replace(/^Atendente\s+/, '');
const numero = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const lerNumero = (t: string) => Number(t.trim().replace(/\./g, '').replace(',', '.'));

/** Chave técnica de uma demanda nova — a mesma regra de Métricas e faixas. */
function chaveDe(rotulo: string, setorId: number) {
  const base = rotulo.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return base ? (setorId === 1 ? base : `${base}_s${setorId}`) : '';
}

/** O tipo de cada métrica de atendimento, para os subtítulos da seção ①. */
function tipoDoAtendimento(r: RegraCota) {
  const g = r.grupo.replace(/_s\d+$/, '');
  if (g === 'atendimento') return 'Finalizado';
  if (g === 'tme' || g === 'tme_diretores') return 'TME';
  if (g === 'tma') return 'TMA';
  if (g === 'csat') return 'C-SAT';
  if (g === 'nota') return 'Notas';
  // Lançados à mão: o C-SAT e as notas de outro setor (iGreen Mob) ficam com os seus.
  if (/c-sat/i.test(r.rotulo)) return 'C-SAT';
  if (/^nota\b/i.test(r.rotulo.trim())) return 'Notas';
  return 'Lançados à mão';
}
const ORDEM_DOS_TIPOS = ['Finalizado', 'TME', 'TMA', 'C-SAT', 'Notas', 'Lançados à mão'];

/** Onde a demanda de um cartão de cargo se encaixa. */
function grupoDaDemanda(r: RegraCota) {
  if (r.grupo === 'monitoria') return 'Monitoria';
  if (r.chave.startsWith('chamados_')) return 'Chamados';
  return 'Demandas';
}

export default function MetasEPontuacao({
  setorId, cargos, regras, pesos, referencias, pessoasPorCargo, filas, pontuacaoUnica, parte,
}: {
  /** O bloco desta aba; sem ele, a tela inteira. */
  parte?: 'atendimento' | 'chamados' | 'demandas';
  setorId: number;
  cargos: Cargo[];
  regras: RegraCota[];
  pesos: PesoCargo[];
  referencias: ReferenciaCargo[];
  pessoasPorCargo: Record<number, number>;
  filas: Fila[];
  pontuacaoUnica: boolean;
}) {
  const router = useRouter();
  const pontuaveis = useMemo(() => regras
    .filter((r) => r.ativo && r.chave !== REGRA_META && r.chave !== REGRA_MEDIA && r.grupo !== 'config')
    .sort((a, b) => a.ordem - b.ordem), [regras]);
  const atendimento = pontuaveis.filter((r) => ehMetricaDeAtendimento(r) && !r.valor_manual);
  // Chamados (tratativas e faixas do SLA): um valor só para quem trata chamados.
  const chamados = pontuaveis.filter((r) => r.chave.startsWith('chamados_') && !atendimento.includes(r));
  const demandas = pontuaveis.filter((r) => !atendimento.includes(r) && !chamados.includes(r));
  const comCota = cargos.filter((c) => c.recebe_cota !== false);

  const original = useMemo(() => {
    const m: Record<string, Celula> = {};
    for (const c of cargos) for (const r of pontuaveis) {
      const p = pesos.find((x) => x.cargo_id === c.id && x.regra === r.chave);
      m[`${c.id}|${r.chave}`] = { peso: Number(p?.peso ?? r.peso), ativo: p?.ativo ?? false };
    }
    return m;
  }, [cargos, pontuaveis, pesos]);

  const [celulas, setCelulas] = useState(original);
  const [unica, setUnica] = useState(pontuacaoUnica);
  const [motivo, setMotivo] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editandoCargo, setEditandoCargo] = useState<number | 'novo' | null>(null);

  const cel = (cargo: number, regra: string) => celulas[`${cargo}|${regra}`];
  // Quem atende: o cargo com cota que pontua alguma métrica de atendimento.
  const atendem = comCota.filter((c) => atendimento.some((r) => cel(c.id, r.chave)?.ativo));
  const referencia = atendem.find((c) => c.id === cargoDeReferencia(cargos)?.id) ?? atendem[0];

  const mudancas = Object.keys(celulas).filter((k) =>
    celulas[k].ativo !== original[k].ativo || (celulas[k].ativo && celulas[k].peso !== original[k].peso));
  const mudouUnica = unica !== pontuacaoUnica;

  // ---- Cortes das faixas (4.13.0)
  const faixasDo = (grupo: string) => pontuaveis.filter((r) => r.grupo === grupo)
    .sort((a, b) => (a.faixa_min ?? -Infinity) - (b.faixa_min ?? -Infinity));
  const gruposComFaixa = useMemo(() => [...new Set(pontuaveis
    .filter((r) => unidadeDo(r.grupo) && (r.faixa_min != null || r.faixa_max != null)).map((r) => r.grupo))], [pontuaveis]);
  const cortesOriginais = useMemo(() => Object.fromEntries(gruposComFaixa.map((g) => {
    const u = unidadeDo(g)!;
    const fx = pontuaveis.filter((r) => r.grupo === g).sort((a, b) => (a.faixa_min ?? -Infinity) - (b.faixa_min ?? -Infinity));
    const valores = g.replace(/_s\d+$/, '') === 'monitoria' ? fx.slice(0, 1).map((r) => r.faixa_min) : fx.slice(0, -1).map((r) => r.faixa_max);
    return [g, valores.map((v) => (v == null ? '' : paraTela(Number(v), u)))];
  })) as Record<string, string[]>, [gruposComFaixa, pontuaveis]);
  const [cortes, setCortes] = useState(cortesOriginais);

  /** Os cortes mudados, em forma de `update` por regra (as duas pontas de cada corte). */
  function alteracoesDeCorte() {
    const lista: { chave: string; rotulo: string; mudanca: Record<string, number> }[] = [];
    for (const g of gruposComFaixa) {
      const u = unidadeDo(g)!;
      const fx = faixasDo(g);
      const valores = (cortes[g] ?? []).map((t) => paraBanco(t, u));
      const nome = fx[0]?.rotulo.replace(/\s*[-–]?\s*(até|acima|abaixo|entre|de)\b.*$/i, '') || g;
      if (valores.some(Number.isNaN)) throw new Error(`Corte vazio ou inválido em ${nome}.`);
      if (valores.some((v, i) => i && v <= valores[i - 1])) throw new Error(`Em ${nome}, cada corte precisa ser maior que o anterior.`);
      if (g.replace(/_s\d+$/, '') === 'monitoria') {
        fx.forEach((r) => { if (valores[0] !== Number(r.faixa_min)) lista.push({ chave: r.chave, rotulo: r.rotulo, mudanca: { faixa_min: valores[0] } }); });
        continue;
      }
      valores.forEach((v, i) => {
        if (v !== Number(fx[i].faixa_max)) lista.push({ chave: fx[i].chave, rotulo: fx[i].rotulo, mudanca: { faixa_max: v } });
        if (v !== Number(fx[i + 1].faixa_min)) lista.push({ chave: fx[i + 1].chave, rotulo: fx[i + 1].rotulo, mudanca: { faixa_min: v } });
      });
    }
    return lista;
  }
  const cortesMudados = gruposComFaixa.reduce((n, g) => n + (cortes[g] ?? []).filter((t, i) => t !== cortesOriginais[g]?.[i]).length, 0);

  /** O texto da faixa de uma linha, com o campo do corte quando ele é desta linha. */
  function faixaDaLinha(r: RegraCota): ReactNode {
    const u = unidadeDo(r.grupo);
    if (!u || !gruposComFaixa.includes(r.grupo)) return null;
    const g = r.grupo;
    const valores = cortes[g] ?? [];
    const campo = (j: number) => (
      <input key={j} value={valores[j] ?? ''} disabled={ocupado} inputMode="decimal" aria-label={`Corte de ${r.rotulo}`}
             onChange={(e) => setCortes((s) => ({ ...s, [g]: (s[g] ?? []).map((x, k) => (k === j ? e.target.value : x)) }))}
             className={`mx-0.5 w-14 rounded-md border px-1.5 py-0.5 text-right text-sm tabular-nums outline-none focus:border-marca-600
                         ${valores[j] !== cortesOriginais[g]?.[j] ? 'border-amber-500 ring-2 ring-amber-500/30' : 'border-slate-300'}`} />
    );
    const sufixo = u === '%' ? '%' : 'min';
    if (g.replace(/_s\d+$/, '') === 'monitoria') {
      return <span className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">média a partir de{campo(0)}%</span>;
    }
    const fx = faixasDo(g);
    const i = fx.findIndex((x) => x.chave === r.chave);
    if (fx.length < 2 || i < 0) return null;
    // O campo do corte j fica na linha que vem primeiro na tabela (menor ordem).
    const donoDoCorte = (j: number) => (fx[j].ordem <= fx[j + 1].ordem ? j : j + 1);
    const ponta = (j: number) => (donoDoCorte(j) === i ? campo(j) : <b key={j} className="font-semibold text-slate-700">{valores[j]}</b>);
    const maiorMelhor = u === '%';
    const ultimo = fx.length - 1;
    return (
      <span className="inline-flex flex-wrap items-center gap-1 text-xs text-slate-500">
        {i === 0 ? <>{maiorMelhor ? 'abaixo de' : 'até'}{ponta(0)}{sufixo}</>
          : i === ultimo ? <>{maiorMelhor ? '' : 'acima de'}{ponta(i - 1)}{sufixo}{maiorMelhor ? ' ou mais' : ''}</>
            : <>de{ponta(i - 1)}a{ponta(i)}{sufixo}</>}
      </span>
    );
  }
  const cargosAfetados = [...new Set(mudancas.map((k) => Number(k.split('|')[0])))];
  const pessoasAfetadas = cargosAfetados.reduce((a, c) => a + (pessoasPorCargo[c] ?? 0), 0);

  /** Grava o texto digitado em uma ou mais células: vazio = não pontua. */
  function gravar(chaves: string[], texto: string) {
    const t = texto.trim();
    if (t && !Number.isFinite(lerNumero(t))) { setErro('Valor inválido: use números, como 4 ou -0,5.'); return; }
    setErro(null);
    setCelulas((s) => ({
      ...s,
      ...Object.fromEntries(chaves.map((k) => [k, t ? { peso: lerNumero(t), ativo: true } : { ...s[k], ativo: false }])),
    }));
  }

  /** Liga um cargo no atendimento (com os valores da referência) ou desliga. */
  function alternarAtende(cargo: Cargo) {
    const liga = !atendem.some((c) => c.id === cargo.id);
    setCelulas((s) => {
      const n = { ...s };
      for (const r of atendimento) {
        const k = `${cargo.id}|${r.chave}`;
        n[k] = liga ? (referencia ? { ...s[`${referencia.id}|${r.chave}`] } : { ...s[k], ativo: true }) : { ...s[k], ativo: false };
      }
      return n;
    });
  }

  /** Ligar a pontuação única: cada linha passa a valer o da referência em todos que atendem. */
  function alternarUnica() {
    const liga = !unica;
    setUnica(liga);
    if (liga) igualar();
  }

  /** Cada linha de atendimento passa a valer o da referência (o Júnior) em todos que atendem. */
  function igualar() {
    if (!referencia) return;
    setCelulas((s) => {
      const n = { ...s };
      for (const r of atendimento) for (const c of atendem) n[`${c.id}|${r.chave}`] = { ...s[`${referencia.id}|${r.chave}`] };
      return n;
    });
    setMotivo((m) => m || 'Pontuação única nos atendimentos');
    setAviso(`Cada métrica de atendimento passa a valer como no ${curto(referencia.nome)} para `
      + `${atendem.map((c) => curto(c.nome)).join(', ')}. O que muda fica em âmbar: confira e salve.`);
  }

  // Quem trata chamados: o cargo com cota que pontua alguma linha de chamados.
  const tratam = comCota.filter((c) => chamados.some((r) => cel(c.id, r.chave)?.ativo));
  /** O valor de uma linha de chamados: o do primeiro cargo que a pontua. */
  const valorDoChamado = (regra: string) => tratam.map((c) => cel(c.id, regra)).find((x) => x?.ativo);
  const chamadoVaria = (regra: string) => new Set(tratam.map((c) => {
    const x = cel(c.id, regra); return x.ativo ? x.peso : 'nao';
  })).size > 1;

  /** Liga ou tira um cargo dos chamados (entra com os valores de hoje). */
  function alternarChamados(cargo: Cargo) {
    const liga = !tratam.some((c) => c.id === cargo.id);
    setCelulas((s) => {
      const n = { ...s };
      for (const r of chamados) {
        const k = `${cargo.id}|${r.chave}`;
        const v = valorDoChamado(r.chave);
        n[k] = liga ? (v ? { ...v } : { ...s[k], ativo: false }) : { ...s[k], ativo: false };
      }
      return n;
    });
  }

  /** Cada linha de chamados passa a valer igual em todos que tratam chamados. */
  function igualarChamados() {
    setCelulas((s) => {
      const n = { ...s };
      for (const r of chamados) {
        const v = tratam.map((c) => s[`${c.id}|${r.chave}`]).find((x) => x?.ativo);
        if (v) for (const c of tratam) n[`${c.id}|${r.chave}`] = { ...v };
      }
      return n;
    });
    setMotivo((m) => m || 'Chamados com o mesmo valor para todos');
  }

  function desfazer() { setCelulas(original); setCortes(cortesOriginais); setUnica(pontuacaoUnica); setAviso(null); setErro(null); }

  async function salvar() {
    let faixas;
    try { faixas = alteracoesDeCorte(); } catch (e) { setErro((e as Error).message); return; }
    setOcupado(true); setErro(null); setAviso(null);
    const db = criarClienteNavegador();
    const agora = new Date().toISOString();
    // Os cortes primeiro: as duas pontas de cada corte (fim de uma faixa, começo da outra).
    for (const f of faixas) {
      const { error } = await db.from('regras').update(f.mudanca).eq('chave', f.chave);
      if (error) { setOcupado(false); setErro(`${f.rotulo}: ${await mensagemDoErro(error)}`); return; }
    }
    const linhas = mudancas.map((k) => {
      const [cargo, regra] = k.split('|');
      return { cargo_id: Number(cargo), regra, peso: celulas[k].peso, ativo: celulas[k].ativo,
               atualizado_em: agora, motivo_alteracao: motivo.trim() };
    });
    if (linhas.length) {
      const { error } = await db.from('pesos_por_cargo').upsert(linhas, { onConflict: 'cargo_id,regra' });
      if (error) { setOcupado(false); setErro(await mensagemDoErro(error)); return; }
    }
    if (mudouUnica) {
      const { error } = await db.from('setores').update({ pontuacao_unica_atendimento: unica }).eq('id', setorId);
      if (error) { setOcupado(false); setErro(await mensagemDoErro(error)); return; }
    }
    setOcupado(false);
    setMotivo('');
    setAviso(`${faixas.length ? 'Faixas salvas. ' : ''}${linhas.length ? `${linhas.length} ${linhas.length === 1 ? 'valor salvo' : 'valores salvos'}. ` : ''}`
      + `${mudouUnica ? (unica ? 'Pontuação única ligada. ' : 'Pontuação única desligada. ') : ''}Meses já fechados não mudam.`);
    router.refresh();
  }

  // Demanda comum: a que mais de um cargo pontua (gravado ou nesta edição). Fica
  // no bloco ② com as etiquetas dos cargos; o cartão do cargo fica só com as dele.
  const quantosPontuam = (regra: string, m: Record<string, Celula>) => cargos.filter((c) => m[`${c.id}|${regra}`]?.ativo).length;
  const comuns = demandas.filter((r) => quantosPontuam(r.chave, original) > 1 || quantosPontuam(r.chave, celulas) > 1);
  const exclusivas = demandas.filter((r) => !comuns.includes(r));

  // As filas de cada métrica de atendimento, para o "Expansão, iGreen Mob" embaixo do nome.
  const filasDa = (r: RegraCota) => filas.filter((f) => f.regra_finalizado === r.chave
    || [f.grupo_tme, f.grupo_csat, f.grupo_nota, f.grupo_tma].includes(r.grupo)).map((f) => f.nome);

  return (
    <div className="space-y-6">
      {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {aviso && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>}

      {/* Atendimento */}
      {(!parte || parte === 'atendimento') && (
      <section className="rounded-[20px] bg-superficie px-5 py-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Atendimento</h2>
            <p className="text-sm text-slate-500">
              Finalizado, TME, TMA, C-SAT e notas de todas as filas, e os atendimentos lançados à mão (presencial, transferências, outro setor).
              {unica ? ' Um valor por linha, para todos os cargos que atendem.' : ' Um valor por cargo.'}
              {' '}A faixa de cada linha (minutos, %) se ajusta ali mesmo.
            </p>
          </div>
          <button type="button" role="switch" aria-checked={unica} onClick={alternarUnica} disabled={ocupado}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${unica
                    ? 'border-marca-600 bg-marca-600/10 font-semibold text-marca-700 dark:text-marca-400'
                    : 'border-slate-200 text-slate-600 hover:border-slate-300'}`}>
            <span className={`relative h-4 w-7 rounded-full transition ${unica ? 'bg-marca-600' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${unica ? 'left-3.5' : 'left-0.5'}`} />
            </span>
            Pontuação única
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Quem atende</span>
          {comCota.map((c) => {
            const liga = atendem.some((a) => a.id === c.id);
            return (
              <button key={c.id} type="button" aria-pressed={liga} disabled={ocupado} onClick={() => alternarAtende(c)}
                      title={liga ? 'Pontua o atendimento — clique para tirar' : 'Não pontua o atendimento — clique para incluir'}
                      className={`rounded-full border px-3 py-1 text-sm transition ${liga
                        ? 'border-marca-600 bg-marca-600 text-white'
                        : 'border-dashed border-slate-300 text-slate-500 hover:border-slate-400'}`}>
                {liga ? '✓ ' : '+ '}{curto(c.nome)}
              </button>
            );
          })}
        </div>

        {unica && referencia && atendimento.some((r) => new Set(atendem.map((c) => {
          const x = cel(c.id, r.chave); return x.ativo ? x.peso : 'nao';
        })).size > 1) && (
          <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200">
            Algumas linhas ainda têm valor diferente por cargo (marcadas &ldquo;varia por cargo&rdquo;).
            <button type="button" onClick={igualar} disabled={ocupado}
                    className="rounded-lg bg-amber-600 px-3 py-1 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-40">
              Igualar tudo pelo {curto(referencia.nome)}
            </button>
          </div>
        )}

        {!atendimento.length ? (
          <p className="mt-4 text-sm text-slate-500">Este setor ainda não tem métricas de atendimento (elas nascem com as filas, em &ldquo;O que cada fila mede&rdquo;, abaixo).</p>
        ) : !atendem.length ? (
          <p className="mt-4 text-sm text-slate-500">Nenhum cargo pontua o atendimento: marque acima quem atende.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wider text-slate-400">
                  <th className="border-b border-slate-200 py-2 pr-2">Métrica</th>
                  <th className="border-b border-slate-200 py-2 pr-2">Faixa</th>
                  {unica
                    ? <th className="w-36 border-b border-slate-200 py-2 text-center">Pontos</th>
                    : atendem.map((c) => <th key={c.id} className="w-28 border-b border-slate-200 py-2 text-center">{curto(c.nome)}</th>)}
                </tr>
              </thead>
              {ORDEM_DOS_TIPOS.map((tipo) => {
                const linhas = atendimento.filter((r) => tipoDoAtendimento(r) === tipo);
                if (!linhas.length) return null;
                return (
                  <tbody key={tipo}>
                    <tr><td colSpan={unica ? 3 : atendem.length + 2} className="pb-1 pt-4 text-[13px] font-semibold text-slate-800">{tipo}</td></tr>
                    {linhas.map((r) => {
                      const doCargo = atendem.map((c) => cel(c.id, r.chave));
                      const varia = new Set(doCargo.map((x) => (x.ativo ? x.peso : 'nao'))).size > 1;
                      const filasTxt = filasDa(r);
                      return (
                        <tr key={r.chave} className="hover:bg-slate-50">
                          <td className="py-1.5 pr-2">
                            <span className="block text-slate-800">{r.rotulo}</span>
                            {filasTxt.length > 0 && <span className="block text-[11.5px] text-slate-400">{filasTxt.join(', ')}</span>}
                          </td>
                          <td className="py-1.5 pr-2">{faixaDaLinha(r)}</td>
                          {unica ? (
                            <td className="py-1.5 text-center">
                              <CampoDePontos celula={referencia ? cel(referencia.id, r.chave) : doCargo[0]}
                                             mudou={atendem.some((c) => mudancas.includes(`${c.id}|${r.chave}`))}
                                             rotulo={r.rotulo} disabled={ocupado}
                                             onGravar={(t) => gravar(atendem.map((c) => `${c.id}|${r.chave}`), t)} />
                              {varia && <span className="block text-[11px] text-amber-700 dark:text-amber-300">varia por cargo: o valor digitado iguala</span>}
                            </td>
                          ) : atendem.map((c) => (
                            <td key={c.id} className="py-1.5 text-center">
                              <CampoDePontos celula={cel(c.id, r.chave)} mudou={mudancas.includes(`${c.id}|${r.chave}`)}
                                             rotulo={`${r.rotulo} · ${c.nome}`} disabled={ocupado}
                                             onGravar={(t) => gravar([`${c.id}|${r.chave}`], t)} />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                );
              })}
            </table>
            <p className="mt-3 text-xs text-slate-500">
              Pontos vazios = não pontua. Cada corte é o fim de uma faixa e o começo da seguinte: muda nas duas linhas.
              O nome da métrica não muda sozinho com o corte — ajuste em &ldquo;Nomes das métricas&rdquo;, na aba Demandas e cargos.
            </p>
          </div>
        )}
      </section>
      )}

      {/* Chamados: tratativas e faixas do SLA, iguais para todos que tratam. */}
      {(!parte || parte === 'chamados') && chamados.length > 0 && (
        <section className="rounded-[20px] bg-superficie px-5 py-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Pontos dos chamados</h2>
          <p className="text-sm text-slate-500">
            Tratativas e faixas do SLA, com o mesmo valor para todos os cargos que tratam chamados.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-slate-400">Quem trata</span>
            {comCota.map((c) => {
              const liga = tratam.some((a) => a.id === c.id);
              return (
                <button key={c.id} type="button" aria-pressed={liga} disabled={ocupado} onClick={() => alternarChamados(c)}
                        className={`rounded-full border px-3 py-1 text-sm transition ${liga
                          ? 'border-marca-600 bg-marca-600 text-white'
                          : 'border-dashed border-slate-300 text-slate-500 hover:border-slate-400'}`}>
                  {liga ? '✓ ' : '+ '}{curto(c.nome)}
                </button>
              );
            })}
          </div>
          {chamados.some((r) => chamadoVaria(r.chave)) && (
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200">
              Algumas faixas ainda valem só para parte de quem trata chamados.
              <button type="button" onClick={igualarChamados} disabled={ocupado}
                      className="rounded-lg bg-amber-600 px-3 py-1 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-40">
                Igualar para todos
              </button>
            </div>
          )}
          {!tratam.length ? (
            <p className="mt-4 text-sm text-slate-500">Nenhum cargo trata chamados: marque acima quem trata.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {chamados.map((r) => {
                const v = valorDoChamado(r.chave);
                return (
                  <li key={r.chave} className="flex items-center gap-3 py-1.5">
                    <span className="flex-1 text-sm text-slate-800">{r.rotulo}</span>
                    {chamadoVaria(r.chave) && <span className="text-[11px] text-amber-700 dark:text-amber-300">varia: o valor digitado iguala</span>}
                    <CampoDePontos celula={v ?? cel(tratam[0].id, r.chave)} rotulo={r.rotulo} disabled={ocupado}
                                   mudou={tratam.some((c) => mudancas.includes(`${c.id}|${r.chave}`))}
                                   onGravar={(t) => gravar(tratam.map((c) => `${c.id}|${r.chave}`), t)} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* Demandas comuns */}
      {(!parte || parte === 'demandas') && comuns.length > 0 && (
        <section className="rounded-[20px] bg-superficie px-5 py-5 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">Demandas comuns</h2>
          <p className="text-sm text-slate-500">
            As que mais de um cargo pontua. Mesmo valor em todos: um campo só. Clique no cargo para tirar ou incluir.
          </p>
          <ul className="mt-3 divide-y divide-slate-100">
            {comuns.map((r) => {
              const quem = comCota.filter((c) => cel(c.id, r.chave)?.ativo);
              const valores = new Set(quem.map((c) => cel(c.id, r.chave).peso));
              const igual = valores.size <= 1;
              const deOutro = quem[0] ? cel(quem[0].id, r.chave) : undefined;
              return (
                <li key={r.chave} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2">
                  <span className="min-w-48 flex-1">
                    <span className="block text-sm text-slate-800">{r.rotulo}</span>
                    <span className="block text-[11.5px] text-slate-400">
                      {grupoDaDemanda(r) === 'Demandas' ? 'lançamento' : grupoDaDemanda(r).toLowerCase()}
                    </span>
                    {faixaDaLinha(r)}
                  </span>
                  <span className="flex flex-wrap gap-1.5">
                    {comCota.map((c) => {
                      const liga = quem.some((q) => q.id === c.id);
                      return (
                        <button key={c.id} type="button" aria-pressed={liga} disabled={ocupado}
                                onClick={() => gravar([`${c.id}|${r.chave}`], liga ? ''
                                  : r.valor_manual ? '0' : String(deOutro?.peso ?? r.peso).replace('.', ','))}
                                className={`rounded-full border px-2.5 py-0.5 text-xs transition ${liga
                                  ? 'border-marca-600 bg-marca-600/15 font-semibold text-marca-700 dark:text-marca-400'
                                  : 'border-dashed border-slate-300 text-slate-400 hover:border-slate-400'}
                                  ${mudancas.includes(`${c.id}|${r.chave}`) ? 'ring-2 ring-amber-500/40' : ''}`}>
                          {curto(c.nome)}
                        </button>
                      );
                    })}
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-1.5">
                    {r.valor_manual ? (
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">digitado</span>
                    ) : !quem.length ? (
                      <span className="text-xs text-slate-400">ninguém pontua</span>
                    ) : igual ? (
                      <CampoDePontos celula={cel(quem[0].id, r.chave)} rotulo={r.rotulo} disabled={ocupado}
                                     mudou={quem.some((c) => mudancas.includes(`${c.id}|${r.chave}`))}
                                     onGravar={(t) => gravar(quem.map((c) => `${c.id}|${r.chave}`), t)} />
                    ) : quem.map((c) => (
                      <span key={c.id} className="inline-flex items-center gap-1 text-xs text-slate-500">
                        {curto(c.nome)}
                        <CampoDePontos celula={cel(c.id, r.chave)} rotulo={`${r.rotulo} · ${c.nome}`} disabled={ocupado}
                                       mudou={mudancas.includes(`${c.id}|${r.chave}`)}
                                       onGravar={(t) => gravar([`${c.id}|${r.chave}`], t)} />
                      </span>
                    ))}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Cargos */}
      {(!parte || parte === 'demandas') && (
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-sobre-fundo">Cargos</h2>
            <p className="text-sm text-sobre-fundo-suave">
              De cada cargo, só o que é dele: a meta, se recebe pela média de outros cargos e as demandas que só ele pontua.
              Demanda nova nasce aqui, no cargo.
            </p>
          </div>
          <button type="button" className={botaoSecundario} onClick={() => setEditandoCargo(editandoCargo === 'novo' ? null : 'novo')}>
            + Cargo
          </button>
        </div>
        {editandoCargo === 'novo' && (
          <div className="mb-4 rounded-[20px] bg-superficie pb-4 shadow-sm">
            <NovoCargo setorId={setorId} cargos={cargos} pesos={pesos} onFechar={() => setEditandoCargo(null)} />
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          {cargos.map((c) => (
            <CartaoDoCargo key={c.id} cargo={c} cargos={cargos} pesos={pesos} referencias={referencias}
                           pessoas={pessoasPorCargo[c.id] ?? 0} demandas={demandas} exclusivas={exclusivas} celulas={celulas}
                           original={original} mudancas={mudancas} atende={atendem.some((a) => a.id === c.id)}
                           setorId={setorId} ocupado={ocupado} editando={editandoCargo === c.id}
                           onEditar={() => setEditandoCargo(editandoCargo === c.id ? null : c.id)}
                           onGravar={gravar} onErro={setErro} onAviso={setAviso} faixaDaLinha={faixaDaLinha} />
          ))}
        </div>
      </section>
      )}

      {(mudancas.length > 0 || mudouUnica || cortesMudados > 0) && (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-marca-600/40
                        bg-[#0f1a14] px-5 py-3 text-sm text-[#e8f5ec] shadow-2xl">
          <span>
            {mudouUnica && <strong className="mr-2">{unica ? 'Liga a pontuação única.' : 'Desliga a pontuação única.'}</strong>}
            {cortesMudados > 0 && <strong className="mr-2">{cortesMudados} {cortesMudados === 1 ? 'corte de faixa' : 'cortes de faixa'}.</strong>}
            {mudancas.length > 0 ? (
              <>
                <strong>{mudancas.length} {mudancas.length === 1 ? 'alteração' : 'alterações'}</strong>
                {' '}em {cargosAfetados.map((id) => curto(cargos.find((c) => c.id === id)?.nome ?? '')).join(', ')}
                {' '}· afeta {pessoasAfetadas} pessoa{pessoasAfetadas === 1 ? '' : 's'} nos meses em aberto
              </>
            ) : cortesMudados ? 'Recalcula os meses em aberto.' : 'Nenhum valor muda.'}
          </span>
          <label className="flex min-w-72 flex-1 items-center gap-2">
            <span className="whitespace-nowrap text-[#bcd6c4]">Motivo</span>
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} disabled={ocupado}
                   placeholder="Ex.: ajuste pedido pela diretoria"
                   className="w-full rounded-lg border border-white/20 bg-white/5 px-2.5 py-1.5 text-sm text-[#e8f5ec]
                              placeholder:text-[#8fa99a] outline-none focus:border-marca-400" />
          </label>
          <span className="flex gap-2">
            <button type="button" disabled={ocupado} onClick={desfazer}
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

/** Um campo de pontos: grava ao sair do campo ou no Enter; vazio = não pontua. */
function CampoDePontos({ celula, mudou, rotulo, disabled, onGravar }: {
  celula: Celula; mudou: boolean; rotulo: string; disabled: boolean; onGravar: (texto: string) => void;
}) {
  const atual = celula.ativo ? String(celula.peso).replace('.', ',') : '';
  const [texto, setTexto] = useState<string | null>(null);
  const valor = texto ?? atual;
  const negativo = celula.ativo && celula.peso < 0;
  return (
    <input value={valor} disabled={disabled} inputMode="decimal" aria-label={`Pontos de ${rotulo}`} placeholder="—"
           onChange={(e) => setTexto(e.target.value)}
           onBlur={() => { if (texto !== null && texto !== atual) onGravar(texto); setTexto(null); }}
           onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setTexto(null); }}
           className={`w-24 rounded-lg border px-2 py-1 text-center text-sm font-semibold outline-none focus:border-marca-600
                       ${mudou ? 'border-amber-500 ring-2 ring-amber-500/30' : 'border-slate-200'}
                       ${!celula.ativo ? 'bg-slate-50 font-normal text-slate-400' : negativo
                         ? 'bg-rose-500/8 text-rose-700 dark:text-rose-300' : 'bg-marca-600/8 text-marca-700 dark:text-marca-400'}`} />
  );
}

/**
 * O cartão do cargo: meta, como recebe e as demandas que ele pontua. "+
 * Demanda" põe uma demanda do setor no cargo (vai para a barra de salvar) ou
 * cria uma nova, que é gravada na hora já com o valor neste cargo.
 */
function CartaoDoCargo({
  cargo, cargos, pesos, referencias, pessoas, demandas, exclusivas, celulas, original, mudancas, atende, setorId, ocupado,
  editando, onEditar, onGravar, onErro, onAviso, faixaDaLinha,
}: {
  /** O corte da faixa da demanda (a monitoria), editável ali mesmo. */
  faixaDaLinha: (r: RegraCota) => ReactNode;
  cargo: Cargo; cargos: Cargo[]; pesos: PesoCargo[]; referencias: ReferenciaCargo[]; pessoas: number;
  /** Todas as demandas do setor (para "+ Demanda") e as que só um cargo pontua (as do cartão). */
  demandas: RegraCota[]; exclusivas: RegraCota[]; celulas: Record<string, Celula>; original: Record<string, Celula>; mudancas: string[];
  atende: boolean; setorId: number; ocupado: boolean; editando: boolean;
  onEditar: () => void; onGravar: (chaves: string[], texto: string) => void;
  onErro: (e: string | null) => void; onAviso: (a: string | null) => void;
}) {
  const router = useRouter();
  const [adicionando, setAdicionando] = useState(false);
  const [escolha, setEscolha] = useState('');
  const [nova, setNova] = useState({ nome: '', pontos: '', digitado: false, motivo: '' });
  const [gravando, setGravando] = useState(false);

  const k = (regra: string) => `${cargo.id}|${regra}`;
  const meta = pesos.find((p) => p.cargo_id === cargo.id && p.regra === REGRA_META);
  const media = pesos.find((p) => p.cargo_id === cargo.id && p.regra === REGRA_MEDIA && p.ativo);
  const refs = referencias.filter((r) => r.cargo_id === cargo.id)
    .map((r) => curto(cargos.find((c) => c.id === r.referencia_id)?.nome ?? ''));
  const semCota = cargo.recebe_cota === false;
  // As que o cargo pontua agora (inclusive as tiradas nesta edição, riscadas, até salvar).
  const doCargo = exclusivas.filter((r) => celulas[k(r.chave)]?.ativo || original[k(r.chave)]?.ativo);
  const comunsDoCargo = demandas.filter((r) => !exclusivas.includes(r) && celulas[k(r.chave)]?.ativo).length;
  const outras = demandas.filter((r) => !celulas[k(r.chave)]?.ativo);
  const tambemEm = (regra: string) => cargos.filter((c) => c.id !== cargo.id && celulas[`${c.id}|${regra}`]?.ativo)
    .map((c) => curto(c.nome));

  function adicionarExistente(regra: string) {
    const r = demandas.find((x) => x.chave === regra);
    if (!r) return;
    // Começa com o valor de outro cargo que já pontua; senão, o sugerido da métrica.
    const deOutro = cargos.map((c) => celulas[`${c.id}|${regra}`]).find((x) => x?.ativo);
    onGravar([k(regra)], r.valor_manual ? '0' : String(deOutro?.peso ?? r.peso).replace('.', ','));
    setEscolha(''); setAdicionando(false);
  }

  async function criarNova() {
    const nome = nova.nome.trim();
    const chave = chaveDe(nome, setorId);
    if (!chave) { onErro('Dê um nome com letras ou números.'); return; }
    if (demandas.some((r) => r.chave === chave || r.rotulo.trim().toLowerCase() === nome.toLowerCase())) {
      onErro(`Já existe a demanda "${nome}": escolha-a na lista.`); return;
    }
    const pontos = nova.digitado ? 0 : lerNumero(nova.pontos);
    if (!nova.digitado && (!nova.pontos.trim() || !Number.isFinite(pontos))) { onErro('Informe os pontos da demanda.'); return; }
    if (!nova.motivo.trim()) { onErro('Escreva o motivo: ele vai para o histórico.'); return; }
    setGravando(true); onErro(null);
    const db = criarClienteNavegador();
    const { error } = await db.from('regras').insert({
      chave, grupo: 'manual', rotulo: nome, peso: pontos, faixa_min: null, faixa_max: null,
      ordem: Math.max(0, ...demandas.map((r) => r.ordem)) + 1, manual: true, valor_manual: nova.digitado,
      ativo: true, setor_id: setorId,
    });
    if (error) { setGravando(false); onErro(/duplicate|unique/i.test(error.message) ? `Já existe uma métrica "${nome}".` : await mensagemDoErro(error)); return; }
    const { error: e2 } = await db.from('pesos_por_cargo').upsert({
      cargo_id: cargo.id, regra: chave, peso: pontos, ativo: true, atualizado_em: new Date().toISOString(),
      motivo_alteracao: nova.motivo.trim(),
    }, { onConflict: 'cargo_id,regra' });
    setGravando(false);
    if (e2) { onErro(await mensagemDoErro(e2)); return; }
    onAviso(`Demanda "${nome}" criada no ${curto(cargo.nome)}. Ela já aparece nos lançamentos.`);
    setNova({ nome: '', pontos: '', digitado: false, motivo: '' }); setAdicionando(false);
    router.refresh();
  }

  const grupos = ['Monitoria', 'Chamados', 'Demandas'];
  return (
    <article className={`rounded-[20px] bg-superficie px-5 py-4 shadow-sm ${semCota ? 'opacity-80' : ''}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900">{cargo.nome}</h3>
          <p className="text-xs text-slate-500">
            {pessoas} pessoa{pessoas === 1 ? '' : 's'}
            {!semCota && <> · {atende ? 'pontua o atendimento' : 'não pontua o atendimento'}</>}
          </p>
        </div>
        <button type="button" onClick={onEditar} className={botaoSecundario}>{editando ? 'Fechar' : 'Meta e média'}</button>
      </header>

      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <dt className="text-xs text-slate-500">Meta do mês</dt>
          <dd className="font-semibold text-slate-800">{semCota ? 'sem cota' : meta ? `${numero(Number(meta.peso))} pts` : '—'}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 px-3 py-2">
          <dt className="text-xs text-slate-500">Recebe</dt>
          <dd className="font-semibold text-slate-800">
            {semCota ? '—' : media ? `média de ${refs.join(' + ') || '—'} ×${numero(Number(media.peso))}` : 'pelo que faz'}
          </dd>
        </div>
      </dl>

      {editando && (
        <div className="-mx-5 mt-3">
          <EditorDoCargo cargo={cargo} cargos={cargos} pesos={pesos.filter((p) => p.cargo_id === cargo.id)}
                         referencias={referencias.filter((r) => r.cargo_id === cargo.id)} onFechar={onEditar} />
        </div>
      )}

      {!semCota && (
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Demandas só deste cargo</p>
          {!doCargo.length && <p className="mt-2 text-sm text-slate-500">Nenhuma demanda só dele.</p>}
          {comunsDoCargo > 0 && (
            <p className="mt-1 text-xs text-slate-400">E {comunsDoCargo} demanda{comunsDoCargo === 1 ? '' : 's'} comu{comunsDoCargo === 1 ? 'm' : 'ns'}, no bloco acima.</p>
          )}
          {grupos.map((g) => {
            const lista = doCargo.filter((r) => grupoDaDemanda(r) === g);
            if (!lista.length) return null;
            return (
              <ul key={g} className="mt-2 divide-y divide-slate-100">
                {g !== 'Demandas' && <li className="pb-1 text-xs font-medium text-slate-500">{g}</li>}
                {lista.map((r) => {
                  const c = celulas[k(r.chave)];
                  const tirada = !c.ativo;
                  const outrosCargos = tambemEm(r.chave);
                  return (
                    <li key={r.chave} className={`flex items-center gap-2 py-1.5 ${tirada ? 'opacity-50' : ''}`}>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm text-slate-800 ${tirada ? 'line-through' : ''}`}>{r.rotulo}</span>
                        {outrosCargos.length > 0 && <span className="block text-[11px] text-slate-400">também: {outrosCargos.join(', ')}</span>}
                        {faixaDaLinha(r)}
                      </span>
                      {r.valor_manual ? (
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500" title="O gestor digita os pontos no lançamento">digitado</span>
                      ) : !tirada && (
                        <CampoDePontos celula={c} mudou={mudancas.includes(k(r.chave))} rotulo={`${r.rotulo} · ${cargo.nome}`}
                                       disabled={ocupado} onGravar={(t) => onGravar([k(r.chave)], t)} />
                      )}
                      <button type="button" disabled={ocupado}
                              onClick={() => onGravar([k(r.chave)], tirada ? (r.valor_manual ? '0' : String(c.peso).replace('.', ',')) : '')}
                              title={tirada ? 'Voltar a pontuar' : 'Tirar do cargo'}
                              className="w-6 text-slate-400 hover:text-rose-700">{tirada ? '↺' : '×'}</button>
                    </li>
                  );
                })}
              </ul>
            );
          })}

          {!adicionando ? (
            <button type="button" onClick={() => setAdicionando(true)} disabled={ocupado}
                    className="mt-3 rounded-full border border-dashed border-slate-300 px-3 py-1 text-sm text-slate-600 hover:border-marca-600 hover:text-marca-700">
              + Demanda
            </button>
          ) : (
            <div className="mt-3 grid gap-2 rounded-2xl border border-marca-600/40 bg-slate-50 p-3">
              <label className="text-sm">
                <span className="mb-1 block text-xs font-medium text-slate-600">Uma demanda que o setor já tem</span>
                <span className="flex gap-2">
                  <select value={escolha} onChange={(e) => setEscolha(e.target.value)} disabled={ocupado || gravando}
                          className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-superficie px-2.5 py-1.5 text-sm">
                    <option value="">Escolha…</option>
                    {outras.map((r) => <option key={r.chave} value={r.chave}>{r.rotulo}</option>)}
                  </select>
                  <button type="button" className={botaoSecundario} disabled={!escolha} onClick={() => adicionarExistente(escolha)}>Pôr</button>
                </span>
              </label>
              <p className="text-center text-xs text-slate-400">ou uma nova</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-40 flex-1">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Nome</span>
                  <input value={nova.nome} disabled={gravando} onChange={(e) => setNova((n) => ({ ...n, nome: e.target.value }))}
                         placeholder="Ex.: Relatório semanal"
                         className="w-full rounded-lg border border-slate-300 bg-superficie px-2.5 py-1.5 text-sm outline-none focus:border-marca-600" />
                </label>
                <label>
                  <span className="mb-1 block text-xs font-medium text-slate-600">Pontos</span>
                  <input value={nova.digitado ? '' : nova.pontos} disabled={gravando || nova.digitado} inputMode="decimal"
                         onChange={(e) => setNova((n) => ({ ...n, pontos: e.target.value }))} placeholder={nova.digitado ? '—' : '0'}
                         className="w-24 rounded-lg border border-slate-300 bg-superficie px-2.5 py-1.5 text-right text-sm outline-none focus:border-marca-600" />
                </label>
                <label className="flex items-center gap-1.5 pb-1.5 text-xs text-slate-600" title="Quando o valor não é quantidade × pontos, como no Atestado">
                  <input type="checkbox" checked={nova.digitado} disabled={gravando}
                         onChange={(e) => setNova((n) => ({ ...n, digitado: e.target.checked }))} />
                  gestor digita os pontos
                </label>
              </div>
              <input value={nova.motivo} disabled={gravando} onChange={(e) => setNova((n) => ({ ...n, motivo: e.target.value }))}
                     placeholder="Motivo (vai para o histórico)"
                     className="rounded-lg border border-slate-300 bg-superficie px-2.5 py-1.5 text-sm outline-none focus:border-marca-600" />
              <span className="flex justify-end gap-2">
                <button type="button" onClick={() => setAdicionando(false)} className="text-sm text-slate-500 hover:underline">cancelar</button>
                <button type="button" disabled={gravando || !nova.nome.trim()} onClick={criarNova} className={botaoPrimario}>
                  {gravando ? 'Criando…' : 'Criar demanda'}
                </button>
              </span>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
