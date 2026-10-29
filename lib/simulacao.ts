/**
 * Simulação de cenários (1.53.0; faixas de TME e projeção na 2.0.0): o extrato
 * do mês aberto refeito na tela, sem gravar nada.
 *
 * Parte das linhas de hoje (as mesmas do extrato: quantidade × peso) e aplica
 * o cenário por cima, na ordem em que o banco calcula:
 *
 *   1. semanas tiradas de uma pessoa (ex.: atestado) — as linhas da semana saem;
 *   2. TME — a semana que sai ou volta (desligada hoje em Métricas da semana)
 *      e, se os limites das faixas mudaram, a faixa de cada semana reescolhida
 *      pelo TME médio da equipe e aplicada aos finalizados de cada um;
 *   3. faixas de C-SAT com outros limites — a faixa da semana é reescolhida
 *      pelo C-SAT da semana e aplicada à mesma base;
 *   4. atendimentos presenciais a mais;
 *   5. pesos diferentes (por cargo, ou de uma regra em todos os cargos, como os
 *      pontos das faixas de TME) — cada linha vira quantidade × peso novo;
 *   6. o que deriva do resto: o multiplicador sobre o realizado, o atestado e
 *      a média da equipe (quem recebe pela média).
 *
 * A projeção do mês estende o ritmo: a média das semanas com dado, já com o
 * cenário, vale para as semanas que faltam; o que é do mês entra como está.
 *
 * A média e o atestado são refeitos em proporção (média simulada dos cargos
 * de referência ÷ média de hoje), e não pela função do banco: é uma conta de
 * simulação, próxima da real, não o fechamento.
 */

export type LinhaDoExtrato = {
  pessoa_id: string; semana: number | null; origem: string | null; regra: string; rotulo: string;
  grupo: string; ordem: number; cargo_id: number; cargo: string | null;
  quantidade: number; peso: number; cota: number;
};
export type PessoaDoMes = { pessoa_id: string; pessoa: string; cargo: string | null; resultado: number; meta: number | null; compoe_media: boolean };
export type Faixa = { chave: string; rotulo: string; grupo: string; faixa_min: number | null; faixa_max: number | null; ordem: number };
export type Peso = { cargo_id: number; regra: string; peso: number };
export type TmeDaSemana = { semana: number; canal: string; tme_seg: number | null };
export type VolumeDaSemana = { pessoa_id: string; semana: number; canal: string; finalizados: number;
  /** TME da pessoa na semana (migração 90), para a fila que avalia o TME por pessoa. */
  tme_seg?: number | null };
export type CsatDaSemana = { pessoa_id: string; origem: string; semana: number; csat: number };

export type Base = {
  linhas: LinhaDoExtrato[];
  pessoas: PessoaDoMes[];
  faixas: Faixa[];
  pesos: Peso[];
  referencias: { cargo_id: number; referencia_id: number }[];
  tme: TmeDaSemana[];
  /** "semana|canal" desligadas hoje em Métricas da semana. */
  tmeDesligado: string[];
  volume: VolumeDaSemana[];
  csat: CsatDaSemana[];
  /** Filas que, neste mês, avaliam o TME por pessoa (migração 90): a faixa
   *  sai do TME de cada um, e quem não tem TME fica na melhor faixa. */
  tmePorPessoa?: string[];
  /** Semanas já lançadas, quando quem chama sabe melhor (a tela do atendente só
   *  enxerga o próprio volume; ali vem do TME da equipe). */
  semanasLancadas?: number[];
};

export type Cenario = {
  /** "semana|canal" com a faixa de TME invertida em relação a hoje. */
  tmeInvertido: string[];
  /** chave da faixa de TME → novo mínimo (segundos). */
  tmeMinimos: Record<string, number>;
  /** "pessoa|semana" tiradas. */
  semanasFora: string[];
  /** chave da faixa de C-SAT → novo mínimo (fração, ex.: 0,9). */
  csatMinimos: Record<string, number>;
  /** pessoa → presenciais a mais. */
  presenciais: Record<string, number>;
  /** "cargo|regra" → peso. */
  pesos: Record<string, number>;
  /** regra → peso em todos os cargos que a pontuam (ex.: pontos das faixas de TME). */
  pesosTodos: Record<string, number>;
  /** cargo → meta (pts). */
  metas: Record<string, number>;
};

export const CENARIO_VAZIO: Cenario = {
  tmeInvertido: [], tmeMinimos: {}, semanasFora: [], csatMinimos: {}, presenciais: {}, pesos: {}, pesosTodos: {}, metas: {},
};

const DERIVADAS = new Set(['media_da_equipe', 'media_sobre_realizado', 'atestado']);
export const GRUPO_TME: Record<string, string> = { huggy: 'tme', diretores: 'tme_diretores' };
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** A faixa (de um grupo) em que um valor cai. */
export function faixaDe(faixas: Faixa[], grupo: string, valor: number) {
  return faixas.find((f) => f.grupo === grupo
    && (f.faixa_min == null || valor >= f.faixa_min) && (f.faixa_max == null || valor < f.faixa_max));
}

/**
 * As faixas de um grupo com os mínimos do cenário. Cada faixa vai do seu
 * mínimo até o mínimo da faixa de cima — mudar um mínimo move a fronteira das
 * duas. Serve ao C-SAT e às faixas de TME.
 */
export function faixasDoGrupo(faixas: Faixa[], grupo: string, minimos: Record<string, number>): Faixa[] {
  const doGrupo = faixas.filter((f) => f.grupo === grupo)
    .map((f) => ({ ...f, faixa_min: f.chave in minimos ? minimos[f.chave] : f.faixa_min }))
    .sort((a, b) => (a.faixa_min ?? -Infinity) - (b.faixa_min ?? -Infinity));
  return doGrupo.map((f, i) => ({ ...f, faixa_max: doGrupo[i + 1]?.faixa_min ?? null }));
}
export const faixasDeCsat = (faixas: Faixa[], minimos: Record<string, number>) => faixasDoGrupo(faixas, 'csat', minimos);

export type Resultado = {
  pessoa_id: string; pessoa: string; cargo: string | null;
  hoje: number; simulado: number; projecao: number;
  metaHoje: number | null; metaSimulada: number | null;
};

/**
 * Semanas do mês já lançadas: as que têm volume (o volume é digitado quando a
 * semana fecha). As avaliações chegam durante a semana, então uma semana só
 * com avaliações ainda está correndo. Sem volume nenhum, valem as linhas.
 */
export function semanasLancadas(base: Base): Set<number> {
  if (base.semanasLancadas) return new Set(base.semanasLancadas);
  const comVolume = new Set(base.volume.map((v) => v.semana));
  return comVolume.size ? comVolume
    : new Set(base.linhas.filter((l) => l.semana != null && !DERIVADAS.has(l.regra)).map((l) => l.semana as number));
}
export const semanasComDado = (base: Base) => semanasLancadas(base).size;

export function simular(base: Base, cen: Cenario): Resultado[] {
  const peso = new Map(base.pesos.map((p) => [`${p.cargo_id}|${p.regra}`, Number(p.peso)]));
  const pesoDe = (cargo: number, regra: string) =>
    cen.pesos[`${cargo}|${regra}`] ?? (peso.has(`${cargo}|${regra}`) ? cen.pesosTodos[regra] ?? peso.get(`${cargo}|${regra}`)! : 0);
  const cargoDe = new Map<string, LinhaDoExtrato>();
  for (const l of base.linhas) if (!cargoDe.has(l.pessoa_id)) cargoDe.set(l.pessoa_id, l);
  const rotulo = new Map(base.faixas.map((f) => [f.chave, f.rotulo]));

  // 1. Semanas tiradas.
  const fora = new Set(cen.semanasFora);
  let linhas = base.linhas.filter((l) => !DERIVADAS.has(l.regra) && !(l.semana != null && fora.has(`${l.pessoa_id}|${l.semana}`)));

  // 2. TME, canal a canal.
  const desligado = new Set(base.tmeDesligado);
  const invertido = new Set(cen.tmeInvertido);
  for (const canal of Object.keys(GRUPO_TME)) {
    const grupo = GRUPO_TME[canal];
    const limitesMudaram = base.faixas.some((f) => f.grupo === grupo && f.chave in cen.tmeMinimos);
    const semanasMexidas = [1, 2, 3, 4].filter((s) => invertido.has(`${s}|${canal}`));
    if (!limitesMudaram && !semanasMexidas.length) continue;
    const faixas = faixasDoGrupo(base.faixas, grupo, cen.tmeMinimos);
    // Semanas a refazer: todas, se os limites mudaram; senão, só as invertidas.
    const refazer = limitesMudaram ? [1, 2, 3, 4] : semanasMexidas;
    linhas = linhas.filter((l) => !(l.semana != null && refazer.includes(l.semana) && l.origem === canal && l.grupo === grupo));
    for (const semana of refazer) {
      const k = `${semana}|${canal}`;
      const conta = desligado.has(k) ? invertido.has(k) : !invertido.has(k);
      const t = base.tme.find((x) => x.semana === semana && x.canal === canal)?.tme_seg;
      const porPessoa = base.tmePorPessoa?.includes(canal) ?? false;
      const daEquipe = conta && t ? faixaDe(faixas, grupo, t) : undefined;
      if (!conta || (!porPessoa && !daEquipe)) continue;
      for (const v of base.volume.filter((x) => x.semana === semana && x.canal === canal)) {
        // Por pessoa (90): a faixa do TME dela; sem TME, a melhor faixa.
        const f = porPessoa ? faixaDe(faixas, grupo, Number(v.tme_seg ?? 0)) : daEquipe;
        if (!f) continue;
        const ref = cargoDe.get(v.pessoa_id);
        if (!ref || fora.has(`${v.pessoa_id}|${semana}`) || !peso.has(`${ref.cargo_id}|${f.chave}`)) continue;
        linhas.push({ ...ref, semana, origem: canal, regra: f.chave, rotulo: f.rotulo, grupo: f.grupo, ordem: f.ordem,
          quantidade: v.finalizados, peso: 0, cota: 0 });
      }
    }
  }

  // 3. Faixas de C-SAT.
  if (Object.keys(cen.csatMinimos).length) {
    const novas = faixasDeCsat(base.faixas, cen.csatMinimos);
    linhas = linhas.map((l) => {
      if (l.grupo !== 'csat' || l.semana == null) return l;
      const c = base.csat.find((x) => x.pessoa_id === l.pessoa_id && x.origem === l.origem && x.semana === l.semana);
      const f = c ? faixaDe(novas, 'csat', Number(c.csat)) : undefined;
      return f && f.chave !== l.regra ? { ...l, regra: f.chave, rotulo: f.rotulo, peso: 0, cota: 0 } : l;
    });
  }

  // 4. Presenciais a mais.
  for (const [pessoa, n] of Object.entries(cen.presenciais)) {
    const ref = cargoDe.get(pessoa);
    if (!ref || !n) continue;
    linhas.push({ ...ref, semana: null, origem: null, regra: 'presencial', rotulo: rotulo.get('presencial') ?? 'Atendimento presencial',
      grupo: 'extra', ordem: 900, quantidade: n, peso: 0, cota: 0 });
  }

  // 5. Pesos: linha nova (peso 0 acima) ou com peso mudado vira quantidade × peso.
  // Linha de valor digitado pelo gestor (cota ≠ quantidade × peso) fica como está.
  linhas = linhas.map((l) => {
    const novo = l.cota === 0 && l.peso === 0;
    const mudou = `${l.cargo_id}|${l.regra}` in cen.pesos || l.regra in cen.pesosTodos;
    const regular = Math.abs(l.quantidade * l.peso - l.cota) < 0.01;
    if (!novo && !(mudou && regular)) return l;
    const p = pesoDe(l.cargo_id, l.regra);
    return { ...l, peso: p, cota: r4(l.quantidade * p) };
  });

  // Pontos diretos, e a projeção deles para o mês inteiro.
  // Projeção: o que é do mês entra como está; das semanas, só as já lançadas,
  // e a média delas vale para cada semana que falta (a semana correndo, que
  // só tem parte das avaliações, é trocada pela média).
  const lancadas = semanasLancadas(base);
  const direto = new Map<string, number>();
  const doMes = new Map<string, number>();
  const nasLancadas = new Map<string, number>();
  const somar = (m: Map<string, number>, id: string, v: number) => m.set(id, (m.get(id) ?? 0) + v);
  for (const l of linhas) {
    somar(direto, l.pessoa_id, l.cota);
    if (l.semana == null) somar(doMes, l.pessoa_id, l.cota);
    else if (lancadas.has(l.semana)) somar(nasLancadas, l.pessoa_id, l.cota);
  }
  const diretoProj = new Map<string, number>();
  for (const id of direto.keys()) {
    const semanasDela = [...lancadas].filter((s) => !fora.has(`${id}|${s}`)).length;
    const porSemana = semanasDela > 0 ? (nasLancadas.get(id) ?? 0) / semanasDela : 0;
    diretoProj.set(id, lancadas.size >= 4 ? direto.get(id)!
      : (doMes.get(id) ?? 0) + (nasLancadas.get(id) ?? 0) + porSemana * (4 - lancadas.size));
  }
  const diretoHoje = new Map<string, number>();
  for (const l of base.linhas) if (!DERIVADAS.has(l.regra)) diretoHoje.set(l.pessoa_id, (diretoHoje.get(l.pessoa_id) ?? 0) + l.cota);

  // 6. O que deriva do resto.
  const derivadas = base.linhas.filter((l) => DERIVADAS.has(l.regra));
  const semMedia = (id: string, d: number) => {
    let total = d;
    for (const l of derivadas.filter((x) => x.pessoa_id === id && x.regra !== 'media_da_equipe')) {
      if (l.regra === 'media_sobre_realizado') {
        const p = cen.pesos[`${l.cargo_id}|media_da_equipe`];
        total += d * (p != null ? p - 1 : l.peso);
      } else {
        // Atestado: a mesma fração dos pontos de antes.
        const antes = diretoHoje.get(id) ?? 0;
        total += antes ? l.cota * (d / antes) : l.cota;
      }
    }
    return total;
  };

  const pessoas = base.pessoas;
  const hoje = new Map(pessoas.map((p) => [p.pessoa_id, Number(p.resultado)]));
  const recebeMedia = new Set(derivadas.filter((l) => l.regra === 'media_da_equipe').map((l) => l.pessoa_id));

  /** Resultado de todos a partir dos pontos diretos (simulados ou projetados). */
  const totais = (dir: Map<string, number>) => {
    const r = new Map<string, number>();
    for (const p of pessoas) if (!recebeMedia.has(p.pessoa_id)) r.set(p.pessoa_id, semMedia(p.pessoa_id, dir.get(p.pessoa_id) ?? 0));
    for (const id of recebeMedia) {
      const l = derivadas.find((x) => x.pessoa_id === id && x.regra === 'media_da_equipe')!;
      const refs = new Set(base.referencias.filter((x) => x.cargo_id === l.cargo_id).map((x) => x.referencia_id));
      const quem = pessoas.filter((p) => p.compoe_media && refs.has(cargoDe.get(p.pessoa_id)?.cargo_id ?? -1) && !recebeMedia.has(p.pessoa_id));
      const soma = (m: Map<string, number>) => quem.reduce((a, p) => a + (m.get(p.pessoa_id) ?? 0), 0);
      const proporcao = quem.length && soma(hoje) ? soma(r) / soma(hoje) : 1;
      // O multiplicador do cenário, ou o da própria linha (a projeção carrega o
      // extrato sem a tabela de pesos).
      const p = cen.pesos[`${l.cargo_id}|media_da_equipe`] ?? cen.pesosTodos.media_da_equipe ?? l.peso;
      r.set(id, semMedia(id, dir.get(id) ?? 0) + l.quantidade * proporcao * p);
    }
    return r;
  };
  const simulado = totais(direto);
  const projetado = totais(diretoProj);

  return pessoas.map((p) => {
    const cargo = cargoDe.get(p.pessoa_id)?.cargo_id;
    const metaSim = cargo != null && `${cargo}` in cen.metas ? cen.metas[`${cargo}`] : p.meta;
    return {
      pessoa_id: p.pessoa_id, pessoa: p.pessoa, cargo: p.cargo, hoje: Number(p.resultado),
      simulado: r4(simulado.get(p.pessoa_id) ?? Number(p.resultado)),
      projecao: r4(projetado.get(p.pessoa_id) ?? Number(p.resultado)),
      metaHoje: p.meta == null ? null : Number(p.meta), metaSimulada: metaSim == null ? null : Number(metaSim),
    };
  });
}
