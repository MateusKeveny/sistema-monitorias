/**
 * Simulação de cenários (1.53.0): o extrato do mês aberto refeito na tela,
 * sem gravar nada.
 *
 * Parte das linhas de hoje (as mesmas do extrato: quantidade × peso) e aplica
 * o cenário por cima, na ordem em que o banco calcula:
 *
 *   1. semanas tiradas de uma pessoa (ex.: atestado) — as linhas da semana saem;
 *   2. TME de uma semana de um canal — a faixa sai (ou volta, se hoje está
 *      desligada em Métricas da semana: aí é refeita pelo TME da equipe);
 *   3. faixas de C-SAT com outros limites — a faixa da semana é reescolhida
 *      pelo C-SAT da semana e aplicada à mesma base;
 *   4. atendimentos presenciais a mais;
 *   5. pesos diferentes — cada linha vira quantidade × peso novo;
 *   6. o que deriva do resto: o multiplicador sobre o realizado, o atestado e
 *      a média da equipe (quem recebe pela média).
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
export type VolumeDaSemana = { pessoa_id: string; semana: number; canal: string; finalizados: number };
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
};

export type Cenario = {
  /** "semana|canal" com a faixa de TME invertida em relação a hoje. */
  tmeInvertido: string[];
  /** "pessoa|semana" tiradas. */
  semanasFora: string[];
  /** chave da faixa de C-SAT → novo mínimo (fração, ex.: 0,9). */
  csatMinimos: Record<string, number>;
  /** pessoa → presenciais a mais. */
  presenciais: Record<string, number>;
  /** "cargo|regra" → peso. */
  pesos: Record<string, number>;
  /** cargo → meta (pts). */
  metas: Record<string, number>;
};

export const CENARIO_VAZIO: Cenario = { tmeInvertido: [], semanasFora: [], csatMinimos: {}, presenciais: {}, pesos: {}, metas: {} };

const DERIVADAS = new Set(['media_da_equipe', 'media_sobre_realizado', 'atestado']);
const GRUPO_TME: Record<string, string> = { huggy: 'tme', diretores: 'tme_diretores' };
const r4 = (v: number) => Math.round(v * 10_000) / 10_000;

/** A faixa (de um grupo) em que um valor cai. */
function faixaDe(faixas: Faixa[], grupo: string, valor: number) {
  return faixas.find((f) => f.grupo === grupo
    && (f.faixa_min == null || valor >= f.faixa_min) && (f.faixa_max == null || valor < f.faixa_max));
}

/**
 * Faixas de C-SAT com os mínimos do cenário. Cada faixa vai do seu mínimo até
 * o mínimo da faixa de cima — mudar um mínimo move a fronteira das duas.
 */
export function faixasDeCsat(faixas: Faixa[], minimos: Record<string, number>): Faixa[] {
  const csat = faixas.filter((f) => f.grupo === 'csat')
    .map((f) => ({ ...f, faixa_min: f.chave in minimos ? minimos[f.chave] : f.faixa_min }))
    .sort((a, b) => (a.faixa_min ?? -Infinity) - (b.faixa_min ?? -Infinity));
  return csat.map((f, i) => ({ ...f, faixa_max: csat[i + 1]?.faixa_min ?? null }));
}

export type Resultado = { pessoa_id: string; pessoa: string; cargo: string | null; hoje: number; simulado: number; metaHoje: number | null; metaSimulada: number | null };

export function simular(base: Base, cen: Cenario): Resultado[] {
  const peso = new Map(base.pesos.map((p) => [`${p.cargo_id}|${p.regra}`, Number(p.peso)]));
  const pesoDe = (cargo: number, regra: string) => cen.pesos[`${cargo}|${regra}`] ?? peso.get(`${cargo}|${regra}`) ?? 0;
  const cargoDe = new Map<string, LinhaDoExtrato>();
  for (const l of base.linhas) if (!cargoDe.has(l.pessoa_id)) cargoDe.set(l.pessoa_id, l);
  const rotulo = new Map(base.faixas.map((f) => [f.chave, f.rotulo]));

  // 1. Semanas tiradas.
  const fora = new Set(cen.semanasFora);
  let linhas = base.linhas.filter((l) => !DERIVADAS.has(l.regra) && !(l.semana != null && fora.has(`${l.pessoa_id}|${l.semana}`)));

  // 2. TME.
  const desligado = new Set(base.tmeDesligado);
  for (const k of cen.tmeInvertido) {
    const [s, canal] = k.split('|'); const semana = Number(s);
    if (!desligado.has(k)) {
      linhas = linhas.filter((l) => !(l.semana === semana && l.origem === canal && l.grupo === GRUPO_TME[canal]));
    } else {
      const t = base.tme.find((x) => x.semana === semana && x.canal === canal)?.tme_seg;
      const f = t ? faixaDe(base.faixas, GRUPO_TME[canal], t) : undefined;
      if (!f) continue;
      for (const v of base.volume.filter((x) => x.semana === semana && x.canal === canal)) {
        const ref = cargoDe.get(v.pessoa_id);
        if (!ref || fora.has(`${v.pessoa_id}|${semana}`)) continue;
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
    const mudou = `${l.cargo_id}|${l.regra}` in cen.pesos;
    const regular = Math.abs(l.quantidade * l.peso - l.cota) < 0.01;
    if (!novo && !(mudou && regular)) return l;
    const p = pesoDe(l.cargo_id, l.regra);
    return { ...l, peso: p, cota: r4(l.quantidade * p) };
  });

  // 6. O que deriva do resto.
  const direto = new Map<string, number>();
  for (const l of linhas) direto.set(l.pessoa_id, (direto.get(l.pessoa_id) ?? 0) + l.cota);
  const diretoHoje = new Map<string, number>();
  for (const l of base.linhas) if (!DERIVADAS.has(l.regra)) diretoHoje.set(l.pessoa_id, (diretoHoje.get(l.pessoa_id) ?? 0) + l.cota);

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
  const simulado = new Map<string, number>();
  const recebeMedia = new Set(derivadas.filter((l) => l.regra === 'media_da_equipe').map((l) => l.pessoa_id));
  for (const p of pessoas) if (!recebeMedia.has(p.pessoa_id)) simulado.set(p.pessoa_id, semMedia(p.pessoa_id, direto.get(p.pessoa_id) ?? 0));

  for (const id of recebeMedia) {
    const l = derivadas.find((x) => x.pessoa_id === id && x.regra === 'media_da_equipe')!;
    const refs = new Set(base.referencias.filter((r) => r.cargo_id === l.cargo_id).map((r) => r.referencia_id));
    const quem = pessoas.filter((p) => p.compoe_media && refs.has(cargoDe.get(p.pessoa_id)?.cargo_id ?? -1) && !recebeMedia.has(p.pessoa_id));
    const soma = (m: Map<string, number>) => quem.reduce((a, p) => a + (m.get(p.pessoa_id) ?? 0), 0);
    const proporcao = quem.length && soma(hoje) ? soma(simulado) / soma(hoje) : 1;
    const p = pesoDe(l.cargo_id, 'media_da_equipe');
    simulado.set(id, semMedia(id, direto.get(id) ?? 0) + l.quantidade * proporcao * p);
  }

  return pessoas.map((p) => {
    const cargo = cargoDe.get(p.pessoa_id)?.cargo_id;
    const metaSim = cargo != null && `${cargo}` in cen.metas ? cen.metas[`${cargo}`] : p.meta;
    return { pessoa_id: p.pessoa_id, pessoa: p.pessoa, cargo: p.cargo, hoje: Number(p.resultado),
      simulado: r4(simulado.get(p.pessoa_id) ?? Number(p.resultado)),
      metaHoje: p.meta == null ? null : Number(p.meta), metaSimulada: metaSim == null ? null : Number(metaSim) };
  });
}
