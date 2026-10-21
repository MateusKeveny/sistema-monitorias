import { dataDoExcel, type Linha } from '@/lib/xlsx-navegador';

/**
 * Leitura do "Dashboard Expansão" de um mês antes do sistema (1.52.0).
 *
 * A planilha tem, por mês:
 *   - uma aba por pessoa: os 4 blocos semanais ("Tiragem semanal") com
 *     Categoria · Pontuação · Feito · Cota, o bloco "Cota Mensal" à direita e,
 *     no rodapé, o nome completo e o e-mail;
 *   - "Volume de atendimentos e TME": por semana e pessoa, finalizados, TMA e
 *     TME (em fração de dia); fila e transferidos não entram (2.1.0);
 *   - "Atendimentos e Avaliações": uma linha por atendimento.
 *
 * Daqui sai o que a migração 69 grava. O resultado é o da planilha, congelado;
 * as linhas do extrato são as da planilha, e a conferência diz se a soma das
 * semanas, mais o que só conta no mês, fecha com o resultado.
 */

export type VolumeDaSemana = {
  semana: number; canal: 'huggy' | 'diretores'; finalizados: number;
  tma_seg: number | null; tme_seg: number | null;
};
export type LinhaDoExtrato = {
  semana: number | null; origem: string | null; regra: string; rotulo: string; grupo: string;
  ordem: number; quantidade: number; peso: number; cota: number;
};
export type PessoaDaPlanilha = {
  /** E-mail em minúsculas (ou o nome, se a aba não tiver e-mail). */
  chave: string;
  aba: string;
  nome: string;
  email: string | null;
  meta: number | null;
  resultado: number | null;
  semanas: (number | null)[];
  /** Soma das semanas + itens só do mês − resultado (0 = fecha). */
  diferenca: number;
  soMes: { rotulo: string; cota: number }[];
  volume: VolumeDaSemana[];
  linhas: LinhaDoExtrato[];
};
export type AvaliacaoDaPlanilha = { chave: string; data: string; protocolo: string; nota: number | null; tabulacao: string | null };
export type MesDaPlanilha = {
  mes: string;
  de: string;
  ate: string;
  pessoas: PessoaDaPlanilha[];
  avaliacoes: AvaliacaoDaPlanilha[];
  /** E-mails com avaliação e sem aba de pessoa. */
  soAvaliacoes: string[];
  fora: { depois: number; antes: number; semData: number; repetidas: number };
  avisos: string[];
};

const PERIODO = /^(\d\d)\/(\d\d) a (\d\d)\/(\d\d)$/;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const txt = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
/** Fração de dia do Excel → segundos. "-" e vazio → null. */
const segundos = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v * 86_400) : null);
export const comparavel = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const slug = (s: string) => comparavel(s).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const arred = (v: number) => Math.round(v * 10_000) / 10_000;

/** Grupo e canal de uma categoria da planilha, para o extrato. */
function classificar(rotulo: string, sub: 'Diretores' | 'Executivos' | null) {
  if (/^Atendimento Huggy/i.test(rotulo) || /^Transfer/i.test(rotulo)) return { grupo: 'atendimento', origem: 'huggy' };
  if (/^TME/i.test(rotulo)) return { grupo: 'tme', origem: 'huggy' };
  if (/^C-SAT/i.test(rotulo)) return { grupo: 'csat', origem: 'huggy' };
  if (/^Nota \d/i.test(rotulo)) return { grupo: 'nota', origem: 'huggy' };
  if (/^Monitoria/i.test(rotulo)) return { grupo: 'monitoria', origem: null };
  if (/^Atendimento (Diretores|Executivos)/i.test(rotulo)) return { grupo: 'atendimento', origem: 'diretores' };
  if (/^Tempo de resposta/i.test(rotulo) && sub) return { grupo: 'tme_diretores', origem: 'diretores' };
  return { grupo: 'extra', origem: null };
}

/** Linhas do bloco Mensal que não são item próprio do mês (resumos e cabeçalhos). */
const NAO_E_ITEM = /^(Categoria|Resultado|Demanda extra|C-SAT Mensal|Monitoria \(Média semanal\)|\dª Semana)$/i;

function lerPessoa(aba: string, linhas: Linha[]): Omit<PessoaDaPlanilha, 'volume'> & { porSemana: Map<number, { dir: number }> } {
  let email: string | null = null; let nome = aba; let meta: number | null = null;
  linhas.forEach((l, i) => {
    for (const [col, v] of Object.entries(l)) {
      if (typeof v === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())) {
        email = v.trim().toLowerCase();
        const acima = linhas[i - 1]?.[col];
        if (typeof acima === 'string' && acima.trim()) nome = acima.trim();
      }
      if (typeof v === 'string' && /^Meta de pontua/i.test(v.trim())) {
        const prox = String.fromCharCode(col.charCodeAt(0) + 1);
        meta = num(l[prox]) ?? meta;
      }
    }
  });

  // Blocos semanais (colunas B a E).
  const semanas: (number | null)[] = [];
  const linhasExtrato: LinhaDoExtrato[] = [];
  const rotulosSemanais = new Set<string>();
  const porSemana = new Map<number, { dir: number }>();
  let semana = 0; let ordem = 100; let sub: 'Diretores' | 'Executivos' | null = null;
  for (const l of linhas) {
    const b = txt(l.B);
    if (PERIODO.test(b)) { semana++; sub = null; semanas[semana - 1] = null; porSemana.set(semana, { dir: 0 }); continue; }
    if (!semana || !b || b === 'Categoria') continue;
    if (b === 'Resultado') { semanas[semana - 1] = num(l.E); continue; }
    rotulosSemanais.add(b);
    if (/^Atendimento Diretores/i.test(b)) sub = 'Diretores';
    if (/^Atendimento Executivos/i.test(b)) sub = 'Executivos';
    if (/^Atendimento (Diretores|Executivos)/i.test(b)) porSemana.get(semana)!.dir += num(l.D) ?? 0;
    const cota = num(l.E);
    if (!cota) continue;
    const { grupo, origem } = classificar(b, sub);
    const rotulo = grupo === 'tme_diretores' ? `${b} · ${sub}` : grupo === 'monitoria' ? 'Monitoria semanal' : b;
    // Monitoria: a nota fica em "Pontuação" e não há "Feito".
    const quantidade = grupo === 'monitoria' ? (num(l.C) ?? 0) : (num(l.D) ?? 0);
    const peso = grupo === 'monitoria' ? (quantidade ? cota / quantidade : 0) : (num(l.C) ?? 0);
    linhasExtrato.push({ semana, origem, regra: `planilha_${slug(rotulo)}`, rotulo, grupo, ordem: ++ordem,
      quantidade: arred(quantidade), peso: arred(peso), cota: arred(cota) });
  }

  // Bloco mensal (colunas N a Q): o resultado e o que só conta no mês.
  let resultado: number | null = null; let noBloco = false;
  const soMes: { rotulo: string; cota: number }[] = [];
  for (const l of linhas) {
    const n = txt(l.N);
    if (n === 'Categoria') { noBloco = true; continue; }
    if (!noBloco || !n) continue;
    if (n === 'Resultado') { resultado = num(l.Q); noBloco = false; continue; }
    if (NAO_E_ITEM.test(n) || rotulosSemanais.has(n)) continue;
    const cota = num(l.Q);
    if (cota) soMes.push({ rotulo: n, cota });
  }
  for (const s of soMes) {
    linhasExtrato.push({ semana: null, origem: null, regra: `planilha_${slug(s.rotulo)}`, rotulo: s.rotulo,
      grupo: 'extra', ordem: ++ordem, quantidade: 1, peso: arred(s.cota), cota: arred(s.cota) });
  }

  const soma = semanas.reduce<number>((a, b) => a + (b ?? 0), 0) + soMes.reduce((a, s) => a + s.cota, 0);
  const diferenca = resultado == null ? 0 : arred(resultado - soma);
  // A soma das linhas precisa dar o resultado entregue: o que não fechar vira
  // uma linha à vista, em vez de sumir.
  if (Math.abs(diferenca) >= 0.01) {
    linhasExtrato.push({ semana: null, origem: null, regra: 'planilha_diferenca', rotulo: 'Diferença da planilha (não explicada)',
      grupo: 'extra', ordem: ++ordem, quantidade: 1, peso: diferenca, cota: diferenca });
  }

  return { chave: email ?? comparavel(nome), aba, nome, email, meta, resultado, semanas, diferenca, soMes,
    linhas: linhasExtrato, porSemana };
}

/** O ciclo de 26 a 25 que termina no mês da última semana. */
function cicloDe(fimMes: number, ano: number) {
  const mes = `${ano}-${String(fimMes).padStart(2, '0')}-01`;
  const anterior = new Date(Date.UTC(ano, fimMes - 2, 26)).toISOString().slice(0, 10);
  // O ciclo sempre fecha no dia 25 (a planilha de agosto escreve "19/08 a 26/08").
  const ate = `${ano}-${String(fimMes).padStart(2, '0')}-25`;
  return { mes, de: anterior, ate };
}

export function lerMesDaPlanilha(abas: Map<string, Linha[]>): MesDaPlanilha {
  const avisos: string[] = [];
  const nomeVolume = [...abas.keys()].find((n) => /^Volume de atendimentos/i.test(n));
  const nomeAvaliacoes = [...abas.keys()].find((n) => /^Atendimentos( e Avalia| - Huggy)/i.test(n));
  const abasPessoa = [...abas.entries()].filter(([, ls]) => ls.slice(0, 3).some((l) => txt(l.B) === 'Tiragem semanal'));
  if (!nomeVolume || !abasPessoa.length) {
    throw new Error('Não parece um "Dashboard Expansão": faltam as abas das pessoas ou a de volume.');
  }

  // Volume: blocos por semana, linhas por nome completo.
  const volume = new Map<string, Map<number, { fin: number | null; tma: number | null; tme: number | null }>>();
  let semana = 0; let ultimoPeriodo: RegExpExecArray | null = null;
  for (const l of abas.get(nomeVolume)!) {
    const b = txt(l.B);
    const p = PERIODO.exec(b);
    if (p) { semana++; ultimoPeriodo = p; continue; }
    if (!semana || !b || b === 'Nome' || b === 'Total') continue;
    const k = comparavel(b);
    if (!volume.has(k)) volume.set(k, new Map());
    volume.get(k)!.set(semana, { fin: num(l.C), tma: segundos(l.G), tme: segundos(l.I) });
  }
  if (semana !== 4) avisos.push(`A aba de volume tem ${semana} semana(s); o sistema usa 4.`);

  // Avaliações: o ano sai das datas (o período da planilha só tem dia/mês).
  const brutas = nomeAvaliacoes ? abas.get(nomeAvaliacoes)!.slice(1) : [];
  const anos = new Map<number, number>();
  for (const l of brutas) if (typeof l.C === 'number') { const a = Number(dataDoExcel(l.C).slice(0, 4)); anos.set(a, (anos.get(a) ?? 0) + 1); }
  const ano = [...anos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? new Date().getFullYear();
  if (!ultimoPeriodo) throw new Error('Não achei os períodos das semanas na aba de volume.');
  const { mes, de, ate } = cicloDe(Number(ultimoPeriodo[4]), ano);

  const fora = { depois: 0, antes: 0, semData: 0, repetidas: 0 };
  const vistas = new Set<string>();
  const avaliacoes: AvaliacaoDaPlanilha[] = [];
  for (const l of brutas) {
    if (l.A == null || l.A === '') continue;
    if (typeof l.C !== 'number') { fora.semData++; continue; }
    const data = dataDoExcel(l.C);
    if (data > ate) { fora.depois++; continue; }
    if (data < de) { fora.antes++; continue; }
    const protocolo = String(l.A).trim();
    if (vistas.has(`${data}|${protocolo}`)) { fora.repetidas++; continue; }
    vistas.add(`${data}|${protocolo}`);
    const nota = typeof l.D === 'number' ? l.D : null;
    avaliacoes.push({ chave: String(l.B ?? '').trim().toLowerCase(), data, protocolo, nota, tabulacao: txt(l.E) || null });
  }

  const pessoas: PessoaDaPlanilha[] = abasPessoa.map(([aba, ls]) => {
    const { porSemana, ...p } = lerPessoa(aba, ls);
    const vol = volume.get(comparavel(p.nome)) ?? volume.get(comparavel(aba));
    if (vol) { volume.delete(comparavel(p.nome)); volume.delete(comparavel(aba)); } else avisos.push(`${aba}: não achei "${p.nome}" na aba de volume.`);
    const linhas: VolumeDaSemana[] = [];
    for (let s = 1; s <= 4; s++) {
      const v = vol?.get(s);
      if (v && (v.fin != null || v.tme != null)) {
        linhas.push({ semana: s, canal: 'huggy', finalizados: v.fin ?? 0, tma_seg: v.tma, tme_seg: v.tme });
      }
      const dir = porSemana.get(s)?.dir ?? 0;
      if (dir > 0) linhas.push({ semana: s, canal: 'diretores', finalizados: dir, tma_seg: null, tme_seg: null });
    }
    if (p.resultado == null) avisos.push(`${aba}: sem resultado no bloco Cota Mensal.`);
    return { ...p, volume: linhas };
  });
  for (const [nome] of volume) avisos.push(`Volume de "${nome}" sem aba de pessoa: não entra.`);

  const chaves = new Set(pessoas.map((p) => p.chave));
  const soAvaliacoes = [...new Set(avaliacoes.map((a) => a.chave))].filter((c) => !chaves.has(c));

  return { mes, de, ate, pessoas, avaliacoes, soAvaliacoes, fora, avisos };
}
