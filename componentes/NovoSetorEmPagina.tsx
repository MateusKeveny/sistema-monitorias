'use client';

import { useMemo, useState } from 'react';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import { normalizarSetor, type Canal, type Setor } from '@/lib/setores';
import {
  aplicarPlano, contextoDasMetas, descricaoDaNova, gradeDoArquivo, gradeDoTexto, modeloXlsx, planejar, valorAtual,
  type ContextoMetas, type FilaDaLista, type Plano,
} from '@/lib/metasPorLista';
import { baixarArquivo, nomeDoArquivo } from '@/componentes/MetasPorLista';
import type { PesoCargo } from '@/lib/tipos';

type Regras = { copiar: string; tme: boolean };
type CamposMonitoria = { qtd: string; piso: string; de?: string };
type FilaNova = { nome: string; hub: string; regras: Regras };
type CargoNovo = { nome: string; meta: string; copiado: boolean };

const PASSOS = ['Nome', 'Base', 'Filas', 'Cargos e metas', 'Monitorias', 'Revisar'];
const campo = `w-full rounded-xl border border-slate-300 bg-superficie px-3 py-2.5 text-sm outline-none transition
               focus:border-marca-600 focus:ring-4 focus:ring-marca-600/15`;
const inteiro = (v: number) => Math.round(v).toLocaleString('pt-BR');
const atraso = (i: number) => ({ animationDelay: `${i * 90}ms` });

/**
 * Novo setor em página (4.0.0, só o administrador): a criação do setor como
 * uma página de site — abertura animada, 6 passos que deslizam (Nome, Base,
 * Filas, Cargos e metas, Monitorias, Revisar), a pré-visualização do setor se
 * montando ao lado e um visto animado no fim. Substitui o assistente de 4
 * passos da 3.2.0.
 *
 * Grava como antes (clonar_setor, filas com definir_regras_da_fila) e, por
 * cima, as metas do passo 4: as digitadas e a lista subida, pelo mesmo
 * caminho da Configuração (lib/metasPorLista), com motivo no histórico.
 */
export default function NovoSetorEmPagina({
  setores, canais, comRegras, metasPorSetor, camposDe, lerCampos, CamposDeMonitoria, EscolhaDeRegras, aoFechar, aoCriar,
}: {
  setores: Setor[]; canais: Canal[]; comRegras: Canal[];
  metasPorSetor: Record<number, ContextoMetas>;
  camposDe: (id?: number) => CamposMonitoria;
  lerCampos: (c: CamposMonitoria) => [number, number] | string;
  CamposDeMonitoria: (p: { c: CamposMonitoria; mudar: (c: CamposMonitoria) => void; ocupado: boolean }) => React.ReactNode;
  EscolhaDeRegras: (p: { r: Regras; mudar: (r: Partial<Regras>) => void; filas: Canal[]; ocupado: boolean }) => React.ReactNode;
  aoFechar: () => void;
  aoCriar: (aviso: string) => void;
}) {
  const [passo, setPasso] = useState(0); // 0 = abertura; 7 = criado
  const [direcao, setDirecao] = useState<'dir' | 'esq'>('dir');
  const [nome, setNome] = useState('');
  const [origem, setOrigem] = useState(setores[0] ? String(setores[0].id) : '');
  const regrasPadrao = (): Regras => ({ copiar: comRegras[0] ? String(comRegras[0].id) : '', tme: true });
  const [filas, setFilas] = useState<FilaNova[]>([{ nome: '', hub: '', regras: regrasPadrao() }]);
  const [cargos, setCargos] = useState<CargoNovo[] | null>(null);
  const [lista, setLista] = useState<{ grade: string[][]; plano: Plano; arquivo: string } | null>(null);
  const [comMonitorias, setComMonitorias] = useState(false);
  const [campos, setCampos] = useState<CamposMonitoria>(() => camposDe(setores[0]?.id));
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [criado, setCriado] = useState<{ nome: string; id: number; falhas: string[] } | null>(null);

  const separar = (t: string) => [...new Set(t.split(',').map((x) => x.trim()).filter(Boolean))];
  const base = setores.find((s) => String(s.id) === origem);
  const ctxBase: ContextoMetas = (base && metasPorSetor[base.id]) || { cargos: [], metricas: [], pesos: [] };
  const filasValidas = filas.filter((f) => f.nome.trim());
  // Os cargos do passo 4 nascem da base (com a meta dela); dá para mudar a meta e acrescentar cargos.
  const cargosDoPasso = useMemo<CargoNovo[]>(() => cargos ?? [...ctxBase.cargos].sort((a, b) => a.ordem - b.ordem)
    .map((c) => ({ nome: c.nome, meta: String(valorAtual(ctxBase, c.id, 'meta') ?? ''), copiado: true })), [cargos, ctxBase]);

  function irPara(p: number) { setErro(null); setDirecao(p > passo ? 'dir' : 'esq'); setPasso(p); }

  function validar(): string | null {
    if (passo === 1) {
      if (!nome.trim()) return 'Dê um nome ao setor.';
      if (setores.some((s) => s.nome.trim().toLowerCase() === nome.trim().toLowerCase())) return `Já existe o setor "${nome.trim()}".`;
    }
    if (passo === 3) {
      const ocupados = new Map(canais.flatMap((c) => c.nomes_no_hub.map((n) => [normalizarSetor(n), c.nome] as const)));
      const daqui = new Set<string>();
      for (const f of filasValidas) for (const n of separar(f.hub || f.nome)) {
        const k = normalizarSetor(n);
        if (ocupados.has(k)) return `"${n}" já está na fila ${ocupados.get(k)}.`;
        if (daqui.has(k)) return `"${n}" está em duas filas novas.`;
        daqui.add(k);
      }
    }
    if (passo === 4) {
      for (const c of cargosDoPasso) {
        if (!c.nome.trim()) return 'Todo cargo precisa de nome.';
        // Copiado sem meta (cargo sem cota, como Diretora) fica como na base.
        if (c.copiado && !c.meta.trim()) continue;
        const m = Number(c.meta.replace(/\./g, '').replace(',', '.'));
        if (!(m > 0)) return `A meta de ${c.nome} precisa ser maior que zero.`;
      }
      if (new Set(cargosDoPasso.map((c) => c.nome.trim().toLowerCase())).size < cargosDoPasso.length) return 'Há dois cargos com o mesmo nome.';
    }
    if (passo === 5 && comMonitorias) { const l = lerCampos(campos); if (typeof l === 'string') return l; }
    return null;
  }

  async function lerLista(fonte: File | string) {
    try {
      const grade = typeof fonte === 'string' ? gradeDoTexto(fonte) : await gradeDoArquivo(fonte);
      setLista({ grade, plano: planejar(grade, ctxBase), arquivo: typeof fonte === 'string' ? 'colada do Excel' : fonte.name });
    } catch { setErro('Não consegui ler esta planilha. Salve como .xlsx no Excel e tente de novo.'); }
  }

  async function criar() {
    const lidos = comMonitorias ? lerCampos(campos) : null;
    if (typeof lidos === 'string') { setErro(lidos); return; }
    setOcupado(true); setErro(null);
    const db = criarClienteNavegador();
    const { data: id, error } = await db.rpc('clonar_setor', lidos ? {
      p_nome: nome.trim(), p_origem: origem ? Number(origem) : null, p_monitorias: true, p_por_semana: lidos[0], p_piso: lidos[1],
    } : { p_nome: nome.trim(), p_origem: origem ? Number(origem) : null, p_monitorias: false });
    if (error) { setOcupado(false); setErro(await mensagemDoErro(error)); return; }
    const setorId = Number(id);
    const falhas: string[] = [];
    for (const [i, f] of filasValidas.entries()) {
      const { data: fila, error: e1 } = await db.from('canais_do_setor')
        .insert({ setor_id: setorId, nome: f.nome.trim(), nomes_no_hub: separar(f.hub || f.nome), ordem: i + 1 }).select('id').single();
      if (e1) { falhas.push(`${f.nome}: ${await mensagemDoErro(e1)}`); continue; }
      const { error: e2 } = await db.rpc('definir_regras_da_fila', {
        p_fila: fila.id, p_copiar_de: f.regras.copiar ? Number(f.regras.copiar) : null, p_tme: f.regras.tme });
      if (e2) falhas.push(`${f.nome} (regras): ${await mensagemDoErro(e2)}`);
    }

    // As metas do passo 4 e a lista, sobre os cargos que o setor novo acabou de ganhar.
    const lerCtx = async (): Promise<ContextoMetas> => {
      const [{ data: cs }, { data: rs }, { data: fs }] = await Promise.all([
        db.from('cargos').select('id, nome, ordem').eq('setor_id', setorId).eq('ativo', true),
        db.from('regras').select('chave, rotulo, ordem, ativo, grupo, faixa_min, faixa_max, valor_manual').eq('setor_id', setorId),
        // As filas que o passo 3 acabou de criar: as métricas automáticas da lista entram nelas.
        db.from('canais_do_setor').select('grupo_tme, grupo_csat, grupo_nota, regra_finalizado').eq('setor_id', setorId).eq('ativo', true),
      ]);
      const ids = (cs ?? []).map((c) => c.id as number);
      const { data: ps } = ids.length ? await db.from('pesos_por_cargo').select('cargo_id, regra, peso, ativo').in('cargo_id', ids) : { data: [] };
      return contextoDasMetas((cs ?? []) as ContextoMetas['cargos'], (rs ?? []) as Parameters<typeof contextoDasMetas>[1], (ps ?? []) as PesoCargo[],
        { setorId, filas: (fs ?? []) as FilaDaLista[] });
    };
    const motivo = `Setor ${nome.trim()} criado no assistente`;
    const digitadas = [['Métrica', ...cargosDoPasso.map((c) => c.nome.trim())], ['Meta do mês', ...cargosDoPasso.map((c) => c.meta)]];
    for (const grade of [digitadas, lista?.grade].filter(Boolean) as string[][][]) {
      try {
        const ctx = await lerCtx();
        const r = await aplicarPlano(db, planejar(grade, ctx), ctx, setorId, motivo);
        falhas.push(...r.falhas);
      } catch (e) { falhas.push(`metas: ${(e as Error).message}`); }
    }

    setOcupado(false);
    setCriado({ nome: nome.trim(), id: setorId, falhas });
    irPara(7);
    aoCriar(falhas.length
      ? `Setor "${nome.trim()}" criado, mas parte não foi gravada: ${falhas.join('; ')}. Ajuste abaixo.`
      : `Setor "${nome.trim()}" criado. Próximo passo: cadastrar o gestor do setor em Pessoas › + Novo usuário.`);
  }

  // ------------------------------------------------------------- Abertura
  if (passo === 0) {
    return (
      <section className="sobe relative grid min-h-[420px] items-center gap-8 overflow-hidden rounded-[26px] bg-superficie px-8 py-12 shadow-sm ring-1 ring-slate-200 lg:grid-cols-[1.1fr_1fr] lg:px-14">
        <div>
          <p className="sobe text-xs font-bold uppercase tracking-[.08em] text-marca-700 dark:text-marca-400" style={atraso(1)}>Novo setor</p>
          <h1 className="sobe mt-2 text-4xl font-semibold leading-[1.08] tracking-[-.035em] text-slate-900" style={atraso(2)}>
            Uma equipe nova,<br /><span className="text-marca-700 dark:text-marca-400">pronta em 6 passos.</span>
          </h1>
          <p className="sobe mt-3 max-w-xl text-base text-slate-600" style={atraso(3)}>
            Dê um nome, escolha de onde vêm as regras, cadastre as filas do Hub e as metas de cada cargo.
            O setor nasce com tudo no lugar — e cada setor segue independente.
          </p>
          <ul className="mt-5 space-y-2.5">
            {['Copie as regras de um setor que já funciona, ou comece do zero',
              'Filas e nomes do Hub: os atendimentos já chegam no lugar certo',
              'Metas por cargo digitadas ou por lista, direto da planilha'].map((t, i) => (
              <li key={t} className="sobe flex items-center gap-2.5 text-slate-600" style={atraso(4 + i)}>
                <span className="grid h-6 w-6 place-items-center rounded-lg bg-marca-600/15 text-xs font-bold text-marca-700 dark:text-marca-400">{i + 1}</span>{t}
              </li>
            ))}
          </ul>
          <div className="sobe mt-7 flex items-center gap-4" style={atraso(7)}>
            <button type="button" onClick={() => { setPasso(1); setDirecao('dir'); }}
                    className="rounded-full bg-marca-600 px-7 py-3 text-[15px] font-semibold text-white shadow-lg shadow-marca-600/30 transition hover:-translate-y-px hover:bg-marca-700">
              Começar
            </button>
            <button type="button" onClick={aoFechar} className="text-sm text-slate-500 hover:underline">voltar aos setores</button>
          </div>
        </div>
        <div className="relative hidden h-80 lg:block" aria-hidden="true">
          <svg viewBox="0 0 400 320" className="absolute inset-0 h-full w-full">
            <g fill="none" className="stroke-slate-300" strokeWidth="1.5" strokeDasharray="4 6">
              <line x1="200" y1="160" x2="70" y2="55" /><line x1="200" y1="160" x2="335" y2="60" />
              <line x1="200" y1="160" x2="60" y2="265" /><line x1="200" y1="160" x2="330" y2="270" />
            </g>
          </svg>
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-marca-600 px-5 py-4 text-base font-semibold text-white shadow-xl">Setor novo</span>
          {[['left-[4%] top-[8%]', 'Filas do Hub', 0], ['right-[2%] top-[10%]', 'Cargos', .8], ['left-0 bottom-[8%]', 'Metas por lista', 1.6], ['right-[4%] bottom-[6%]', 'Monitorias', 2.4]].map(([pos, t, d]) => (
            <span key={t as string} className={`flutua absolute ${pos} rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-lg`}
                  style={{ animationDelay: `${d}s` }}>{t}</span>
          ))}
        </div>
      </section>
    );
  }

  // ------------------------------------------------------------- Criado
  if (passo === 7 && criado) {
    return (
      <section className="sobe rounded-[26px] bg-superficie px-6 py-14 text-center shadow-sm ring-1 ring-slate-200">
        <svg viewBox="0 0 110 110" className="mx-auto h-28 w-28" aria-hidden="true">
          <circle cx="55" cy="55" r="48" fill="none" stroke="var(--color-marca-600)" strokeWidth="6" strokeDasharray="302" strokeDashoffset="302" className="traco" />
          <path d="M33 57 l15 15 l30 -32" fill="none" stroke="var(--color-marca-600)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round"
                strokeDasharray="70" strokeDashoffset="70" className="traco" style={{ animationDelay: '600ms' }} />
        </svg>
        <h1 className="sobe mt-4 text-3xl font-semibold tracking-[-.03em] text-slate-900" style={atraso(8)}>{criado.nome} criado</h1>
        <p className="sobe mt-1 text-slate-500" style={atraso(9)}>Já aparece na tela da CEO, aguardando o primeiro fechamento.</p>
        {criado.falhas.length > 0 && (
          <p className="mx-auto mt-4 max-w-2xl rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-600/20">
            Parte não foi gravada: {criado.falhas.join('; ')}. Ajuste em Configuração.
          </p>
        )}
        <div className="sobe mt-7 flex flex-wrap justify-center gap-3" style={atraso(10)}>
          <a href={`/cota/configuracao?setor=${criado.id}`} className="rounded-full bg-marca-600 px-5 py-2 text-sm font-semibold text-white hover:bg-marca-700">Ver as metas e pesos</a>
          <a href="/cota/usuarios" className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cadastrar o gestor e as pessoas</a>
          <button type="button" onClick={aoFechar} className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">Voltar aos setores</button>
        </div>
      </section>
    );
  }

  // ------------------------------------------------------------- Os passos
  const pc = Math.min(1, (passo - 1) / (PASSOS.length - 1));
  const novos = lista ? lista.plano.colunas.filter((c) => c.id == null && !c.erros.length).length : 0;
  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo">Novo setor</h1>
        <p className="text-sm text-sobre-fundo-suave">Passo {passo} de {PASSOS.length} · nada é gravado antes de &quot;Criar setor&quot;.</p>
      </div>

      {/* A trilha: preenche a cada passo; o atual pulsa. */}
      <ol className="relative flex">
        <span className="absolute left-[8%] right-[8%] top-[17px] h-[3px] rounded bg-slate-200" />
        <span className="absolute left-[8%] top-[17px] h-[3px] rounded bg-marca-600 transition-all duration-500" style={{ width: `${pc * 84}%` }} />
        {PASSOS.map((p, i) => {
          const n = i + 1;
          return (
            <li key={p} className="relative z-10 flex flex-1 flex-col items-center gap-1.5">
              <span className={`grid h-[34px] w-[34px] place-items-center rounded-full border-2 text-[13px] font-semibold transition-all duration-300 ${n < passo
                ? 'border-marca-600 bg-marca-600 text-white' : n === passo ? 'pulso-passo border-marca-600 bg-superficie text-marca-700' : 'border-slate-300 bg-superficie text-slate-400'}`}>
                {n < passo ? '✓' : n}
              </span>
              <span className={`text-center text-xs ${n === passo ? 'font-semibold text-sobre-fundo' : 'text-sobre-fundo-suave'}`}>{p}</span>
            </li>
          );
        })}
      </ol>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="overflow-hidden rounded-[22px] bg-superficie px-8 py-7 shadow-sm ring-1 ring-slate-200">
          <div key={passo} className={direcao === 'dir' ? 'entra-dir' : 'entra-esq'}>
            {passo === 1 && (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Como se chama a equipe?</h2>
                <p className="mb-6 mt-1 text-slate-500">É o nome que aparece no menu, nos relatórios e na tela da diretoria.</p>
                <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600">Nome do setor</span>
                  <input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Conexão Energia"
                         onKeyDown={(e) => { if (e.key === 'Enter') { const v = validar(); if (v) setErro(v); else irPara(2); } }}
                         className={`${campo} py-3.5 text-xl font-semibold`} />
                </label>
              </>
            )}
            {passo === 2 && (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">De onde vêm as regras?</h2>
                <p className="mb-6 mt-1 text-slate-500">Copiar traz cargos, metas, pesos e faixas de um setor que já funciona. Depois, cada um segue independente.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[...setores.map((s) => ({ id: String(s.id), titulo: `Copiar de ${s.nome}`, texto: `${metasPorSetor[s.id]?.cargos.length ?? 0} cargos com metas e pesos` })),
                    { id: '', titulo: 'Do zero', texto: 'Sem cargos nem pesos: tudo se cadastra depois' }].map((o, i) => (
                    <button key={o.id || 'zero'} type="button" style={atraso(i)}
                            onClick={() => { setOrigem(o.id); setCampos(camposDe(o.id ? Number(o.id) : undefined)); setCargos(null); setLista(null); }}
                            className={`sobe rounded-2xl border-[1.5px] p-4 text-left transition hover:-translate-y-0.5 ${origem === o.id
                              ? 'border-marca-600 bg-marca-600/10' : 'border-slate-200 hover:border-marca-600/50'}`}>
                      <b className="block text-slate-900">{o.titulo}</b>
                      <span className="text-xs text-slate-500">{o.texto}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {passo === 3 && (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Quais filas o setor atende?</h2>
                <p className="mb-6 mt-1 text-slate-500">Como o Hub separa os atendimentos. O nome no Hub liga os relatórios importados à fila certa. Dá para criar depois.</p>
                <div className="space-y-2">
                  {filas.map((f, i) => (
                    <div key={i} className="estala flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5">
                      <input value={f.nome} placeholder="Nome da fila" aria-label={`Nome da fila ${i + 1}`}
                             onChange={(e) => setFilas((l) => l.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} className={`${campo} w-44 py-1.5`} />
                      <input value={f.hub} placeholder="Nome no Hub (se for diferente)" aria-label={`Nome no Hub da fila ${i + 1}`}
                             onChange={(e) => setFilas((l) => l.map((x, j) => (j === i ? { ...x, hub: e.target.value } : x)))} className={`${campo} w-56 py-1.5`} />
                      <EscolhaDeRegras r={f.regras} filas={comRegras} ocupado={ocupado}
                                       mudar={(r) => setFilas((l) => l.map((x, j) => (j === i ? { ...x, regras: { ...x.regras, ...r } } : x)))} />
                      {filas.length > 1 && <button type="button" onClick={() => setFilas((l) => l.filter((_, j) => j !== i))} className="text-xs text-slate-500 hover:underline">remover</button>}
                    </div>
                  ))}
                  <button type="button" onClick={() => setFilas((l) => [...l, { nome: '', hub: '', regras: regrasPadrao() }])}
                          className="text-sm font-medium text-marca-700 hover:underline dark:text-marca-400">+ outra fila</button>
                </div>
              </>
            )}
            {passo === 4 && (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Cargos e metas</h2>
                <p className="mb-5 mt-1 text-slate-500">
                  {base ? `Vieram de ${base.nome}. ` : ''}Ajuste a meta aqui, acrescente cargos, ou suba a lista inteira de uma vez — o mesmo modelo da Configuração.
                </p>
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-slate-200 text-xs text-slate-500"><th className="py-2 text-left font-medium">Cargo</th><th className="py-2 text-right font-medium">Meta do mês (pts)</th><th /></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {cargosDoPasso.map((c, i) => (
                      <tr key={i} className="estala">
                        <td className="py-1.5 pr-3">
                          {c.copiado ? <span className="font-medium text-slate-800">{c.nome}</span>
                            : <input value={c.nome} placeholder="Nome do cargo" onChange={(e) => setCargos(cargosDoPasso.map((x, j) => (j === i ? { ...x, nome: e.target.value } : x)))} className={`${campo} py-1.5`} />}
                        </td>
                        <td className="py-1.5 text-right">
                          <input value={c.meta} inputMode="numeric" placeholder={c.copiado ? 'sem meta' : ''}
                                 title={c.copiado && !c.meta ? 'Cargo sem meta na base (sem cota): fica assim' : undefined}
                                 onChange={(e) => setCargos(cargosDoPasso.map((x, j) => (j === i ? { ...x, meta: e.target.value } : x)))}
                                 className={`${campo} w-32 py-1.5 text-right tabular-nums`} />
                        </td>
                        <td className="pl-2 text-right">{!c.copiado && <button type="button" onClick={() => setCargos(cargosDoPasso.filter((_, j) => j !== i))} className="text-xs text-slate-500 hover:underline">remover</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                  <button type="button" onClick={() => setCargos([...cargosDoPasso, { nome: '', meta: '5000', copiado: false }])}
                          className="font-medium text-marca-700 hover:underline dark:text-marca-400">+ cargo</button>
                  {ctxBase.cargos.length > 0 && (
                    <button type="button" onClick={() => baixarArquivo(modeloXlsx(ctxBase), nomeDoArquivo(nome || 'setor-novo'))}
                            className="rounded-full border border-slate-300 px-3.5 py-1 font-semibold text-slate-700 hover:bg-slate-50">⬇ Baixar modelo</button>
                  )}
                  <label className="cursor-pointer rounded-full bg-marca-600 px-3.5 py-1 font-semibold text-white hover:bg-marca-700">
                    ⬆ Subir por lista<input type="file" accept=".xlsx,.csv" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) lerLista(f); e.target.value = ''; }} />
                  </label>
                </div>
                {lista && (
                  <div className="estala mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm ring-1 ring-slate-200">
                    {lista.plano.erro ? <p className="text-rose-700">{lista.plano.erro}</p> : (
                      <>
                        <p className="font-semibold text-slate-800">Lista {lista.arquivo}: {lista.plano.colunas.length} cargos, {lista.plano.mudancas.length} valor(es) muda(m){novos ? `, ${novos} cargo(s) novo(s)` : ''}.</p>
                        {lista.plano.colunas.filter((c) => c.erros.length).map((c) => <p key={c.cargo} className="text-rose-700">{c.cargo}: {c.erros.join('; ')} — fica de fora.</p>)}
                        {lista.plano.novas.length > 0 && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-slate-700">
                              {lista.plano.novas.filter((n) => !n.erro).length} métrica(s) nova(s) criada(s) com o setor
                              {lista.plano.novas.some((n) => n.pendente) ? ' — as automáticas (TME, C-SAT, notas, finalizados) entram nas filas do passo 3' : ''}
                              {lista.plano.novas.some((n) => n.erro) ? `; ${lista.plano.novas.filter((n) => n.erro).length} com erro` : ''}
                            </summary>
                            <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto text-xs">
                              {lista.plano.novas.map((n) => (
                                <li key={n.chave} className={n.erro ? 'text-rose-700' : 'text-slate-600'}>
                                  <b>{n.rotulo}</b> · {descricaoDaNova(n)}{n.erro ? ` — ${n.erro}` : n.aviso ? ` — ${n.aviso}` : ''}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                        {filasValidas.length === 0 && lista.plano.novas.some((n) => n.pendente) && (
                          <p className="text-amber-700">Sem fila no passo 3, as métricas automáticas não são criadas (só as de lançamento).</p>
                        )}
                        <p className="mt-1 text-xs text-slate-500">É aplicada depois das metas acima, ao criar o setor (com motivo no histórico de pesos).</p>
                        <button type="button" onClick={() => setLista(null)} className="mt-1 text-xs text-slate-500 hover:underline">tirar a lista</button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
            {passo === 5 && (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Monitorias</h2>
                <p className="mb-6 mt-1 text-slate-500">Com monitorias, o setor aparece no sistema de Monitorias e a nota pontua na cota.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[[true, 'Com monitorias', `Critérios copiados${base ? ` de ${base.nome}` : ''}`], [false, 'Sem monitorias', 'Dá para ligar depois']].map(([v, t, d], i) => (
                    <button key={t as string} type="button" onClick={() => setComMonitorias(v as boolean)} style={atraso(i)}
                            className={`sobe rounded-2xl border-[1.5px] p-4 text-left transition ${comMonitorias === v ? 'border-marca-600 bg-marca-600/10' : 'border-slate-200 hover:border-marca-600/50'}`}>
                      <b className="block text-slate-900">{t as string}</b><span className="text-xs text-slate-500">{d as string}</span>
                    </button>
                  ))}
                </div>
                {comMonitorias && <div className="estala mt-4 flex flex-wrap items-center gap-2 text-sm text-slate-600"><CamposDeMonitoria c={campos} mudar={setCampos} ocupado={ocupado} /></div>}
              </>
            )}
            {passo === 6 && (
              <>
                <h2 className="text-2xl font-semibold tracking-tight text-slate-900">Tudo certo?</h2>
                <p className="mb-5 mt-1 text-slate-500">Confira antes de criar. Depois disso, cada coisa se ajusta na própria tela.</p>
                <dl className="divide-y divide-slate-100 text-sm">
                  {[
                    ['Setor', nome.trim()],
                    ['Regras', base ? `cópia de ${base.nome}` : 'do zero'],
                    ['Filas', filasValidas.map((f) => f.nome.trim()).join(', ') || 'nenhuma por enquanto'],
                    ['Cargos', cargosDoPasso.map((c) => `${c.nome} (${c.meta ? `${inteiro(Number(c.meta.replace(/\./g, '').replace(',', '.')) || 0)} pts` : 'sem meta'})`).join(' · ') || 'nenhum'],
                    ['Lista de metas', lista && !lista.plano.erro ? `${lista.arquivo}, aplicada ao criar` : 'não'],
                    ['Monitorias', comMonitorias ? `${campos.qtd} por semana, pontua a partir de ${campos.piso}%` : 'sem monitorias'],
                  ].map(([k, v], i) => (
                    <div key={k} className="sobe grid grid-cols-[130px_1fr] gap-3 py-2.5" style={atraso(i)}>
                      <dt className="text-slate-500">{k}</dt><dd className="font-semibold text-slate-800">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-slate-500">Depois: cadastrar o gestor do setor (Pessoas › + Novo usuário) e, se precisar, mover pessoas pela Árvore.</p>
              </>
            )}
          </div>

          {erro && <p className="estala mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
          <div className="mt-7 flex items-center justify-between border-t border-slate-100 pt-5">
            <button type="button" disabled={ocupado} onClick={() => (passo === 1 ? aoFechar() : irPara(passo - 1))}
                    className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              {passo === 1 ? 'Cancelar' : '← Voltar'}
            </button>
            {passo < 6 ? (
              <button type="button" onClick={() => { const v = validar(); if (v) setErro(v); else irPara(passo + 1); }}
                      className="rounded-full bg-marca-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-marca-600/25 transition hover:-translate-y-px hover:bg-marca-700">
                Continuar →
              </button>
            ) : (
              <button type="button" onClick={criar} disabled={ocupado}
                      className="rounded-full bg-marca-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-marca-600/25 hover:bg-marca-700 disabled:opacity-40">
                {ocupado ? 'Criando…' : 'Criar setor'}
              </button>
            )}
          </div>
        </div>

        {/* A pré-visualização: o setor se montando enquanto se preenche. */}
        <aside className="sticky top-5 rounded-[22px] bg-superficie px-6 py-5 shadow-sm ring-1 ring-slate-200">
          <p className="text-[11px] font-bold uppercase tracking-[.08em] text-slate-400">Pré-visualização</p>
          <h3 className={`mt-1.5 min-h-7 text-xl font-semibold tracking-tight ${nome.trim() ? 'text-slate-900' : 'text-slate-400'}`}>{nome.trim() || 'Nome do setor'}</h3>
          <div className="mt-3 space-y-3 border-l-2 border-slate-200 pl-4">
            <Galho titulo="Regras" itens={passo > 2 ? [base ? `Cópia de ${base.nome}` : 'Do zero'] : []} vazio={base ? `Cópia de ${base.nome}` : 'Do zero'} />
            <Galho titulo="Filas" itens={filasValidas.map((f) => f.nome.trim())} vazio="nenhuma ainda" />
            <div>
              <p className="mb-1 text-xs font-semibold text-slate-500">Cargos e metas</p>
              {passo >= 4 && cargosDoPasso.length
                ? cargosDoPasso.map((c, i) => (
                  <div key={i} className="estala flex justify-between border-b border-dashed border-slate-200 py-1 text-[13px]">
                    <span>{c.nome || '—'}</span><b className="tabular-nums">{c.meta ? `${inteiro(Number(c.meta.replace(/\./g, '').replace(',', '.')) || 0)} pts` : '—'}</b>
                  </div>
                ))
                : <span className="inline-block rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs text-slate-400">no passo 4</span>}
            </div>
            <Galho titulo="Monitorias" itens={passo >= 5 ? [comMonitorias ? `${campos.qtd}/semana · a partir de ${campos.piso}%` : 'sem monitorias'] : []} vazio="no passo 5" />
          </div>
          <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <svg viewBox="0 0 42 42" className="h-10 w-10" aria-hidden="true">
              <circle cx="21" cy="21" r="17" fill="none" className="stroke-slate-200" strokeWidth="5" />
              <circle cx="21" cy="21" r="17" fill="none" stroke="var(--color-marca-600)" strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 17} strokeDashoffset={2 * Math.PI * 17 * (1 - pc)} transform="rotate(-90 21 21)"
                      style={{ transition: 'stroke-dashoffset .6s' }} />
            </svg>
            <span><b className="text-slate-800">{Math.round(pc * 100)}%</b> montado</span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Galho({ titulo, itens, vazio }: { titulo: string; itens: string[]; vazio: string }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-500">{titulo}</p>
      {itens.length
        ? itens.map((t) => <span key={t} className="estala mb-1.5 mr-1.5 inline-block rounded-full bg-marca-600/15 px-2.5 py-0.5 text-xs font-semibold text-marca-800 dark:text-marca-300">{t}</span>)
        : <span className="inline-block rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-xs text-slate-400">{vazio}</span>}
    </div>
  );
}
