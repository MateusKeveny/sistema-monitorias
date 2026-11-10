import type { criarClienteNavegador } from '@/lib/supabase/cliente';

/**
 * Métricas por fila (4.2.0, migração 103): o que cada fila do setor mede e as
 * faixas de cada métrica automática (as que vêm do Hub).
 *
 * Cada métrica de cada fila escolhe entre:
 *   - "geral": a régua do setor, a mesma para todas as filas que a escolhem
 *     (nome sem fila: "TME até 15 min");
 *   - "propria": uma régua só da fila (nome com a fila: "TME até 15 min · Logística");
 *   - "nao": a fila não mede;
 *   - "manter": como está hoje (o padrão na Configuração; não grava nada).
 *
 * Os pontos de cada faixa por cargo continuam em Pesos por cargo (ou na
 * planilha): uma faixa nova começa sem pontos. Faixa que já existe com os
 * mesmos limites é reaproveitada, com os pontos que tem.
 *
 * Nunca mexe em regra de outro setor: fila que aponta para a régua de outro
 * setor (cópia da Expansão) passa a apontar para a régua do próprio setor.
 */

export type Tipo = 'tme' | 'tma' | 'csat' | 'nota';
export type Medida = 'finalizado' | Tipo;
export type Escolha = 'geral' | 'propria' | 'nao' | 'manter';
/** TME e TMA em minutos; C-SAT em %. `de` null = desde o começo; `ate` null = sem teto. */
export type Faixa = { de: number | null; ate: number | null };
export type Regua = { tme: Faixa[]; tma: Faixa[]; csat: Faixa[]; nota: number[] };

export type FilaDaConfig = {
  /** id da fila (Configuração) ou a posição dela no assistente (ainda sem id). */
  chave: string;
  nome: string;
  escolha: Record<Medida, Escolha>;
  propria: Regua;
  /** No assistente: a fila copia as regras de outra (aí "manter" = igual à copiada). */
  copia?: boolean;
};
export type ConfigDasMetricas = { geral: Regua; filas: FilaDaConfig[] };

export const MEDIDAS: { chave: Medida; nome: string; ajuda: string }[] = [
  { chave: 'finalizado', nome: 'Finalizado', ajuda: 'pontos por atendimento finalizado' },
  { chave: 'tme', nome: 'TME', ajuda: 'tempo médio de espera da equipe na semana, em faixas (min)' },
  { chave: 'tma', nome: 'TMA', ajuda: 'tempo médio de atendimento da pessoa na semana, em faixas (min)' },
  { chave: 'csat', nome: 'C-SAT', ajuda: 'satisfação da pessoa na semana, em faixas (%)' },
  { chave: 'nota', nome: 'Notas', ajuda: 'pontos por avaliação com cada nota (1 a 5)' },
];

export const REGUA_PADRAO: Regua = {
  tme: [{ de: 0, ate: 15 }, { de: 15, ate: 30 }, { de: 30, ate: null }],
  tma: [{ de: 0, ate: 10 }, { de: 10, ate: 20 }, { de: 20, ate: null }],
  csat: [{ de: null, ate: 85 }, { de: 85, ate: 90 }, { de: 90, ate: 95 }, { de: 95, ate: null }],
  nota: [1, 2, 3, 4, 5],
};
export const copiarRegua = (r: Regua): Regua => ({
  tme: r.tme.map((f) => ({ ...f })), tma: r.tma.map((f) => ({ ...f })), csat: r.csat.map((f) => ({ ...f })), nota: [...r.nota],
});

// ------------------------------------------------------------------ Nomes
const num = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const PREFIXO: Record<Tipo, string> = { tme: 'TME', tma: 'TMA', csat: 'C-SAT', nota: 'Avaliação' };

/** "TME até 15 min", "C-SAT de 85% a 90%", "Avaliação nota 5" — com " · Fila" na régua própria. */
export function rotuloDaFaixa(tipo: Tipo, f: Faixa | number, fila?: string): string {
  const sufixo = fila ? ` · ${fila}` : '';
  if (tipo === 'nota') return `${PREFIXO.nota} nota ${f as number}${sufixo}`;
  const { de, ate } = f as Faixa;
  const u = tipo === 'csat' ? '%' : ' min';
  const desde = de == null || (de === 0 && tipo !== 'csat');
  const txt = desde && ate != null ? (tipo === 'csat' ? `abaixo de ${num(ate)}${u}` : `até ${num(ate)}${u}`)
    : ate == null ? (tipo === 'csat' ? `a partir de ${num(de ?? 0)}${u}` : `acima de ${num(de ?? 0)}${u}`)
      : tipo === 'csat' ? `de ${num(de!)}% a ${num(ate)}%` : `de ${num(de!)} a ${num(ate)} min`;
  return `${PREFIXO[tipo]} ${txt}${sufixo}`;
}
export const rotuloDoFinalizado = (fila?: string) => (fila ? `Finalizado · ${fila}` : 'Finalizado');

/** Limites no banco: segundos (TME/TMA), fração (C-SAT), a nota. */
function limites(tipo: Tipo, f: Faixa | number): { min: number | null; max: number | null } {
  if (tipo === 'nota') return { min: f as number, max: null };
  const { de, ate } = f as Faixa;
  const k = tipo === 'csat' ? 0.01 : 60;
  const arred = (v: number) => (tipo === 'csat' ? Math.round(v * k * 10000) / 10000 : Math.round(v * k));
  return { min: de == null ? null : arred(de), max: ate == null ? null : arred(ate) };
}

/** Faixas que se cruzam, com buraco ou vazias: o texto do problema, ou null. */
export function conferirRegua(tipo: Tipo, regua: Regua): string | null {
  if (tipo === 'nota') {
    if (!regua.nota.length) return 'escolha pelo menos uma nota';
    return regua.nota.some((n) => !Number.isInteger(n) || n < 1 || n > 5) ? 'as notas vão de 1 a 5' : null;
  }
  const fs = regua[tipo];
  if (!fs.length) return 'pelo menos uma faixa';
  for (const [i, f] of fs.entries()) {
    if (f.de != null && f.ate != null && f.ate <= f.de) return `a faixa ${i + 1} termina antes de começar`;
    if (i > 0) {
      const ant = fs[i - 1];
      if (ant.ate == null) return `a faixa ${i} não tem teto, então não pode haver faixa depois`;
      if (f.de == null || Math.abs(f.de - ant.ate) > 1e-9) return `a faixa ${i + 1} precisa começar onde a ${i} termina (${num(ant.ate)})`;
    }
  }
  if (tipo === 'csat' && fs.some((f) => (f.de ?? 0) > 100 || (f.ate ?? 0) > 100)) return 'C-SAT vai até 100%';
  return null;
}

// ------------------------------------------------------------------ Planejado
/** As métricas que a configuração dá ao setor (para o modelo da planilha antes de criar). */
export type MetricaPlanejada = { rotulo: string; tipo: string; faixa: string; tipoBase: string; faixaMin: number | null; faixaMax: number | null };
export function metricasPlanejadas(cfg: ConfigDasMetricas): MetricaPlanejada[] {
  const lista: MetricaPlanejada[] = [];
  const vistos = new Set<string>();
  const add = (rotulo: string, tipo: string, faixa = '', tipoBase = 'atendimento', lim: { min: number | null; max: number | null } = { min: null, max: null }) => {
    if (!vistos.has(rotulo)) { vistos.add(rotulo); lista.push({ rotulo, tipo, faixa, tipoBase, faixaMin: lim.min, faixaMax: lim.max }); }
  };
  const como: Record<Tipo, string> = {
    tme: 'pontos por atendimento, conforme a faixa de TME', tma: 'pontos por atendimento, conforme a faixa de TMA',
    csat: 'pontos por atendimento, conforme a faixa de C-SAT', nota: 'pontos por avaliação com esta nota',
  };
  for (const m of MEDIDAS) {
    for (const quem of [null, ...cfg.filas] as (FilaDaConfig | null)[]) {
      const usa = cfg.filas.filter((f) => f.escolha[m.chave] === (quem ? 'propria' : 'geral') && (!quem || f.chave === quem.chave));
      if (!usa.length) continue;
      const fila = quem?.nome;
      if (m.chave === 'finalizado') { add(rotuloDoFinalizado(fila), 'pontos por atendimento finalizado'); continue; }
      const t = m.chave;
      const regua = quem ? quem.propria : cfg.geral;
      const itens = t === 'nota' ? regua.nota : regua[t];
      for (const f of itens as (Faixa | number)[]) add(rotuloDaFaixa(t, f, fila), como[t], '', t, limites(t, f));
    }
  }
  return lista;
}

// ------------------------------------------------------------------ Estado atual
export type FilaReal = {
  id: number; apelido: string; nome: string; setor_id: number;
  regra_finalizado: string | null; grupo_tme: string | null; grupo_tma?: string | null;
  grupo_csat: string | null; grupo_nota: string | null; copia_de?: number | null;
};
export type RegraReal = {
  chave: string; grupo: string; rotulo: string; ativo: boolean; ordem: number;
  faixa_min: number | null; faixa_max: number | null; setor_id?: number | null;
};
const CAMPO: Record<Medida, 'regra_finalizado' | 'grupo_tme' | 'grupo_tma' | 'grupo_csat' | 'grupo_nota'> = {
  finalizado: 'regra_finalizado', tme: 'grupo_tme', tma: 'grupo_tma', csat: 'grupo_csat', nota: 'grupo_nota',
};

/** Como a fila mede hoje, em texto: "TME até 15 min, …" ou "não mede". */
export function descricaoAtual(fila: FilaReal, medida: Medida, regras: RegraReal[], setorId: number): string {
  const v = fila[CAMPO[medida]] ?? null;
  if (!v) return 'não mede';
  if (medida === 'finalizado') {
    const r = regras.find((x) => x.chave === v);
    return r ? `${r.rotulo}${r.setor_id != null && r.setor_id !== setorId ? ' (de outro setor)' : ''}` : v;
  }
  const rs = regras.filter((x) => x.grupo === v && x.ativo).sort((a, b) => a.ordem - b.ordem);
  if (!rs.length) return 'sem faixas';
  const fora = rs.some((r) => r.setor_id != null && r.setor_id !== setorId);
  return `${rs.length} faixa(s): ${rs.map((r) => r.rotulo).join(' · ')}${fora ? ' (de outro setor)' : ''}`;
}

/** A régua de hoje de um grupo, para começar a edição dela. */
export function reguaDoGrupo(tipo: Tipo, grupo: string | null | undefined, regras: RegraReal[]): Faixa[] | number[] | null {
  if (!grupo) return null;
  const rs = regras.filter((x) => x.grupo === grupo && x.ativo).sort((a, b) => (a.faixa_min ?? -1) - (b.faixa_min ?? -1));
  if (!rs.length) return null;
  if (tipo === 'nota') return rs.map((r) => Number(r.faixa_min)).filter((n) => n >= 1 && n <= 5);
  const k = tipo === 'csat' ? 100 : 1 / 60;
  const conv = (v: number | null) => (v == null ? null : Math.round(Number(v) * k * 100) / 100);
  return rs.map((r) => ({ de: conv(r.faixa_min), ate: conv(r.faixa_max) }));
}

// ------------------------------------------------------------------ Gravar
type Banco = ReturnType<typeof criarClienteNavegador>;

const grupoGeral = (t: Tipo, setorId: number) => (setorId === 1 ? t : `${t}_s${setorId}`);
const grupoProprio = (t: Tipo, apelido: string) => `${t}_${apelido}`;

/**
 * Grava a configuração. `filas` são as filas reais do setor, na mesma ordem
 * de `cfg.filas` quando a chave é a posição (assistente) — ou pelo id.
 */
export async function aplicarMetricas(db: Banco, setorId: number, cfg: ConfigDasMetricas, filas: FilaReal[])
  : Promise<{ falhas: string[]; criadas: number; desligadas: number; filasMudadas: number }> {
  const falhas: string[] = [];
  let criadas = 0, desligadas = 0, filasMudadas = 0;
  const filaDe = (fc: FilaDaConfig, i: number) => filas.find((f) => String(f.id) === fc.chave) ?? filas[i];

  // Regra sem setor é da Expansão (setor 1), como na Configuração.
  const doSetor = db.from('regras').select('chave, grupo, rotulo, ativo, ordem, faixa_min, faixa_max, setor_id');
  const [{ data: rs, error: e1 }, { data: todas, error: e2 }, { data: todasAsFilas, error: e3 }] = await Promise.all([
    setorId === 1 ? doSetor.or('setor_id.eq.1,setor_id.is.null') : doSetor.eq('setor_id', setorId),
    db.from('regras').select('chave'),
    db.from('canais_do_setor').select('id, regra_finalizado, grupo_tme, grupo_tma, grupo_csat, grupo_nota'),
  ]);
  if (e1 || e2 || e3) return { falhas: [`regras: ${(e1 ?? e2 ?? e3)!.message}`], criadas, desligadas, filasMudadas };
  const regras = (rs ?? []) as RegraReal[];
  const chaves = new Set(((todas ?? []) as { chave: string }[]).map((r) => r.chave));
  let ordem = Math.max(100, ...regras.map((r) => r.ordem));
  const novaChave = (base: string) => {
    const b = base.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
    let c = b; for (let i = 2; chaves.has(c); i++) c = `${b}_${i}`;
    chaves.add(c); return c;
  };

  // Uma régua num grupo: reaproveita a faixa com os mesmos limites, cria as
  // que faltam e desliga as que saíram.
  async function gravarRegua(grupo: string, tipo: Tipo, itens: (Faixa | number)[], fila?: string) {
    const doGrupo = regras.filter((r) => r.grupo === grupo);
    const usadas = new Set<string>();
    for (const f of itens) {
      const { min, max } = limites(tipo, f);
      const rotulo = rotuloDaFaixa(tipo, f, fila);
      // Mesmo limite: os dois vazios, ou os dois com o mesmo número.
      const mesmo = (a: number | null | undefined, b: number | null) =>
        (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - b) < 1e-9);
      const igual = doGrupo.find((r) => !usadas.has(r.chave) && mesmo(r.faixa_min, min) && (tipo === 'nota' || mesmo(r.faixa_max, max)));
      if (igual) {
        usadas.add(igual.chave);
        if (!igual.ativo || igual.rotulo !== rotulo) {
          const { error } = await db.from('regras').update({ ativo: true, rotulo }).eq('chave', igual.chave);
          if (error) falhas.push(`${rotulo}: ${error.message}`);
        }
        continue;
      }
      const chave = novaChave(`${grupo}_${rotulo.replace(/ · .*$/, '')}`);
      const { error } = await db.from('regras').insert({
        chave, grupo, rotulo, peso: 0, faixa_min: min, faixa_max: tipo === 'nota' ? min : max, ordem: ++ordem,
        manual: false, valor_manual: false, ativo: true, setor_id: setorId,
      });
      if (error) { falhas.push(`${rotulo}: ${error.message}`); continue; }
      usadas.add(chave); criadas++;
    }
    const sair = doGrupo.filter((r) => r.ativo && !usadas.has(r.chave)).map((r) => r.chave);
    if (sair.length) {
      const { error } = await db.from('regras').update({ ativo: false }).in('chave', sair);
      if (error) falhas.push(`faixas antigas de ${grupo}: ${error.message}`); else desligadas += sair.length;
    }
  }

  async function gravarFinalizado(fila?: FilaReal): Promise<string | null> {
    const rotulo = rotuloDoFinalizado(fila?.nome);
    const procurada = fila ? `${fila.apelido}_finalizado` : `finalizado_s${setorId}`;
    const existe = regras.find((r) => r.chave === procurada);
    if (existe) {
      if (!existe.ativo || existe.rotulo !== rotulo) {
        const { error } = await db.from('regras').update({ ativo: true, rotulo }).eq('chave', existe.chave);
        if (error) { falhas.push(`${rotulo}: ${error.message}`); return null; }
      }
      return existe.chave;
    }
    const chave = chaves.has(procurada) ? novaChave(procurada) : (chaves.add(procurada), procurada);
    const { error } = await db.from('regras').insert({
      chave, grupo: 'atendimento', rotulo, peso: 0, faixa_min: null, faixa_max: null, ordem: ++ordem,
      manual: false, valor_manual: false, ativo: true, setor_id: setorId,
    });
    if (error) { falhas.push(`${rotulo}: ${error.message}`); return null; }
    criadas++;
    return chave;
  }

  // O que cada fila passa a apontar.
  const antes = new Map(filas.map((f) => [f.id, { ...f }]));
  const depois = new Map(filas.map((f) => [f.id, { ...f }]));
  let finalGeral: string | null | undefined;
  for (const m of MEDIDAS) {
    const usaGeral = cfg.filas.some((f) => f.escolha[m.chave] === 'geral');
    let geral: string | null = null;
    if (usaGeral) {
      if (m.chave === 'finalizado') geral = finalGeral ??= await gravarFinalizado();
      else {
        geral = grupoGeral(m.chave, setorId);
        await gravarRegua(geral, m.chave, (m.chave === 'nota' ? cfg.geral.nota : cfg.geral[m.chave]) as (Faixa | number)[]);
      }
    }
    for (const [i, fc] of cfg.filas.entries()) {
      const real = filaDe(fc, i);
      if (!real) continue;
      const e = fc.escolha[m.chave];
      if (e === 'manter') continue;
      let alvo: string | null = null;
      if (e === 'geral') alvo = geral;
      else if (e === 'propria') {
        if (m.chave === 'finalizado') alvo = await gravarFinalizado(real);
        else {
          alvo = grupoProprio(m.chave, real.apelido);
          await gravarRegua(alvo, m.chave, (m.chave === 'nota' ? fc.propria.nota : fc.propria[m.chave]) as (Faixa | number)[], real.nome);
        }
      }
      if (e !== 'nao' && alvo == null) continue; // falhou ao gravar: fica como estava
      (depois.get(real.id) as Record<string, unknown>)[CAMPO[m.chave]] = alvo;
    }
  }

  for (const f of filas) {
    const a = antes.get(f.id)!, d = depois.get(f.id)!;
    const mudou = (Object.values(CAMPO) as (keyof FilaReal)[]).filter((c) => (a[c] ?? null) !== (d[c] ?? null));
    if (!mudou.length) continue;
    const { error } = await db.from('canais_do_setor')
      .update({ ...Object.fromEntries(mudou.map((c) => [c, d[c] ?? null])), copia_de: null }).eq('id', f.id);
    if (error) falhas.push(`fila ${f.nome}: ${error.message}`); else filasMudadas++;
  }

  // Réguas do setor que nenhuma fila usa mais (e que alguma usava): desligadas,
  // para não ficarem na tela de pesos. As de outro setor nunca são tocadas.
  // "Usado" conta as filas de TODOS os setores (uma fila de outro setor pode
  // apontar para uma régua deste — a cópia da Expansão).
  const deste = new Set(filas.map((f) => f.id));
  const outras = ((todasAsFilas ?? []) as Partial<FilaReal>[]).filter((f) => !deste.has(f.id!));
  const usados = new Set([...depois.values(), ...outras].flatMap((f) => (Object.values(CAMPO) as (keyof FilaReal)[]).map((c) => f[c])).filter(Boolean) as string[]);
  const largados = new Set([...antes.values()].flatMap((f) => (Object.values(CAMPO) as (keyof FilaReal)[]).map((c) => f[c]))
    .filter((v): v is string => typeof v === 'string' && !!v && !usados.has(v)));
  const desligar = regras.filter((r) => r.ativo && (largados.has(r.grupo) || largados.has(r.chave))
    && r.grupo !== 'manual' && (r.grupo !== 'atendimento' || largados.has(r.chave))).map((r) => r.chave);
  if (desligar.length) {
    const { error } = await db.from('regras').update({ ativo: false }).in('chave', desligar);
    if (error) falhas.push(`réguas sem uso: ${error.message}`); else desligadas += desligar.length;
  }
  return { falhas, criadas, desligadas, filasMudadas };
}
