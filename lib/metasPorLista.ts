import { gerarXlsx } from '@/lib/xlsx-escrever';
import { lerPlanilha } from '@/lib/xlsx-navegador';
import { REGRA_MEDIA, REGRA_META, type PesoCargo } from '@/lib/tipos';
import type { criarClienteNavegador } from '@/lib/supabase/cliente';

/**
 * Metas e pesos por lista (4.0.0): a matriz de Configuração › Pesos por cargo
 * numa planilha. Uma linha por métrica (Meta do mês, Média da equipe e cada
 * métrica) e uma coluna por cargo, com os pontos no cruzamento — o mesmo
 * desenho da tela.
 *
 * Na planilha: célula vazia = não muda; "não pontua" = desliga a métrica no
 * cargo; número = o peso (e liga, se estava desligada). Cargo que não existe
 * no setor vira cargo novo: o que não vier na lista é copiado do cargo de
 * base. A média só tem o multiplicador trocado em quem já recebe média — quem
 * compõe a média se escolhe em Editar cargo.
 *
 * O formato antigo (um cargo por linha, "Cargo" na primeira coluna) também é
 * aceito.
 */

export type MetricaDaLista = {
  chave: string; rotulo: string;
  /** Para a aba "Métricas" do modelo (4.1.0): como conta e a faixa. */
  tipo?: string; faixa?: string; grupo?: string;
};
type RegraDaLista = {
  chave: string; rotulo: string; ordem: number; ativo: boolean; grupo: string;
  faixa_min?: number | null; faixa_max?: number | null; valor_manual?: boolean | null;
};
export type ContextoMetas = {
  cargos: { id: number; nome: string; ordem: number }[];
  /** As métricas que pontuam no setor, na ordem da tela. */
  metricas: MetricaDaLista[];
  /** pesos_por_cargo dos cargos do setor, com meta e média. */
  pesos: PesoCargo[];
};

/** null = não pontua. */
type Valor = number | null;
export type Item = 'meta' | 'media' | string; // string = chave da métrica

export type ColunaDoPlano = {
  cargo: string;
  /** Cargo existente (id) ou novo (null). */
  id: number | null;
  erros: string[];
  avisos: string[];
  /** O que a lista traz para este cargo, por item. */
  valores: Record<Item, Valor>;
};
export type Mudanca = { cargo: string; id: number; item: Item; de: Valor; para: Valor };
export type Plano = {
  erro?: string;
  colunas: ColunaDoPlano[];
  mudancas: Mudanca[];
  /** Linhas da planilha que não são métricas do setor. */
  ignoradas: string[];
  /** Cargos do setor que não estão na lista: ficam como estão. */
  fora: string[];
};

export const ROTULO_META = 'Meta do mês';
export const ROTULO_MEDIA = 'Média da equipe (×)';
const NAO_PONTUA = 'não pontua';

const normal = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * O contexto da lista a partir do que a Configuração já carrega: as métricas
 * que pontuam são as mesmas linhas da matriz (sem meta, média e "config").
 */
export function contextoDasMetas(
  cargos: { id: number; nome: string; ordem: number }[],
  regras: RegraDaLista[],
  pesos: PesoCargo[],
): ContextoMetas {
  return {
    cargos: cargos.map(({ id, nome, ordem }) => ({ id, nome, ordem })),
    metricas: regras.filter((r) => r.ativo && r.chave !== REGRA_META && r.chave !== REGRA_MEDIA && r.grupo !== 'config')
      .sort((a, b) => a.ordem - b.ordem)
      .map((r) => ({ chave: r.chave, rotulo: r.rotulo, tipo: tipoDaRegra(r), faixa: faixaDaRegra(r), grupo: NOME_DO_GRUPO[r.grupo.replace(/_s\d+$/, '')] ?? r.grupo })),
    pesos,
  };
}

const NOME_DO_GRUPO: Record<string, string> = {
  atendimento: 'Atendimento', tme: 'TME', tme_diretores: 'TME Diretores', csat: 'C-SAT',
  nota: 'Notas do C-SAT', monitoria: 'Monitoria', manual: 'Lançamento manual',
};

/** Como a métrica conta — o mesmo texto da tabela de Pesos por cargo. */
function tipoDaRegra(r: RegraDaLista): string {
  const g = r.grupo.replace(/_s\d+$/, '');
  if (r.valor_manual) return 'valor digitado no lançamento (o peso multiplica o valor)';
  if (g === 'atendimento') return 'pontos por atendimento finalizado';
  if (g === 'tme' || g === 'tme_diretores') return 'pontos por atendimento, conforme a faixa de TME';
  if (g === 'csat') return 'pontos por atendimento, conforme a faixa de C-SAT (os dois canais)';
  if (g === 'nota') return 'pontos por avaliação com esta nota';
  if (g === 'monitoria') return 'pontos por ponto percentual acima do mínimo da monitoria';
  return 'pontos por lançamento (quantidade lançada × peso)';
}

/** A faixa da régua, na unidade da tela (minutos ou %). */
function faixaDaRegra(r: RegraDaLista): string {
  const g = r.grupo.replace(/_s\d+$/, '');
  const conv = (v: number) => g === 'tme' || g === 'tme_diretores' ? `${Math.round((v / 60) * 100) / 100} min`
    : g === 'csat' || g === 'monitoria' ? `${Math.round(v * 10000) / 100}%` : String(v);
  const min = r.faixa_min != null ? conv(Number(r.faixa_min)) : null;
  const max = r.faixa_max != null ? conv(Number(r.faixa_max)) : null;
  if (min && max) return `de ${min} a ${max}`;
  if (min) return `a partir de ${min}`;
  if (max) return `até ${max}`;
  return '';
}

/** O cargo de onde um cargo novo copia o que não veio: o de base, ou o primeiro. */
export const cargoBase = (ctx: ContextoMetas) =>
  ctx.cargos.find((c) => c.nome === 'Atendente Júnior') ?? [...ctx.cargos].sort((a, b) => a.ordem - b.ordem)[0];

/** Peso vigente de um item num cargo: número, null (não pontua) ou undefined (sem linha). */
export function valorAtual(ctx: ContextoMetas, cargoId: number, item: Item): Valor | undefined {
  const regra = item === 'meta' ? REGRA_META : item === 'media' ? REGRA_MEDIA : item;
  const p = ctx.pesos.find((x) => x.cargo_id === cargoId && x.regra === regra);
  if (!p) return undefined;
  return p.ativo ? Number(p.peso) : null;
}

// ------------------------------------------------------------------ Modelo
export function modeloXlsx(ctx: ContextoMetas, nomeDaAba = 'Metas'): Uint8Array {
  const cargos = [...ctx.cargos].sort((a, b) => a.ordem - b.ordem);
  const colunas = [
    { cabecalho: 'Métrica', chave: 'k', largura: 34 },
    ...cargos.map((c, i) => ({ cabecalho: c.nome, chave: `c${i}`, formato: 'numero' as const, largura: Math.max(16, c.nome.length + 3) })),
  ];
  const linha = (rotulo: string, item: Item) => Object.fromEntries([
    ['k', rotulo],
    ...cargos.map((c, i) => {
      const v = valorAtual(ctx, c.id, item);
      // Cada célula com a pontuação de hoje (4.1.0). Métrica desligada sai
      // escrita "não pontua" (subir de volta não muda nada); meta e média de
      // quem não tem saem vazias (vazio = não muda).
      if (v != null) return [`c${i}`, v];
      return [`c${i}`, item === 'meta' || item === 'media' ? '' : NAO_PONTUA];
    }),
  ]);
  const nomes = cargos.map((c) => c.nome).join(', ');
  return gerarXlsx([
    {
      nome: nomeDaAba,
      colunas,
      linhas: [linha(ROTULO_META, 'meta'), linha(ROTULO_MEDIA, 'media'), ...ctx.metricas.map((m) => linha(m.rotulo, m.chave))],
    },
    {
      nome: 'Métricas',
      colunas: [
        { cabecalho: 'Métrica', chave: 'rotulo', largura: 38 },
        { cabecalho: 'Grupo', chave: 'grupo', largura: 18 },
        { cabecalho: 'Como pontua', chave: 'tipo', largura: 60, formato: 'quebra' },
        { cabecalho: 'Faixa', chave: 'faixa', largura: 22 },
        { cabecalho: 'Chave no sistema', chave: 'chave', largura: 30 },
      ],
      linhas: [
        { rotulo: ROTULO_META, grupo: 'Configuração', tipo: 'Pontos que o cargo precisa somar no mês para bater a cota.', faixa: '', chave: REGRA_META },
        { rotulo: ROTULO_MEDIA, grupo: 'Média da equipe', tipo: 'Multiplicador sobre a média dos cargos de referência (ex.: 1,2 = 120% da média). Só para cargo que já recebe média: quem compõe a média se escolhe em Editar cargo.', faixa: '', chave: REGRA_MEDIA },
        ...ctx.metricas.map((m) => ({ rotulo: m.rotulo, grupo: m.grupo ?? '', tipo: m.tipo ?? '', faixa: m.faixa ?? '', chave: m.chave })),
      ],
    },
    {
      nome: 'Como preencher',
      colunas: [
        { cabecalho: 'Item', chave: 'item', largura: 24 },
        { cabecalho: 'Como funciona', chave: 'regra', largura: 90, formato: 'quebra' },
      ],
      linhas: [
        { item: 'Onde editar', regra: `Só na aba "${nomeDaAba}": uma linha por métrica, uma coluna por cargo (${nomes || 'os cargos do setor'}), a pontuação no cruzamento. As abas "Métricas" e "Como preencher" são só de consulta.` },
        { item: 'Número', regra: 'A pontuação da métrica no cargo. Negativo desconta (ex.: -50). Decimal com vírgula (ex.: 0,25). Número numa métrica que não pontuava liga a métrica no cargo.' },
        { item: '"não pontua"', regra: 'Desliga a métrica no cargo (o peso fica guardado, para religar depois).' },
        { item: 'Célula vazia', regra: 'Não muda nada naquele cargo.' },
        { item: ROTULO_META, regra: 'Os pontos para bater a cota no mês. Precisa ser maior que zero.' },
        { item: ROTULO_MEDIA, regra: 'Só troca o multiplicador de quem já recebe média. Para ligar ou tirar a média, use Editar cargo.' },
        { item: 'Cargo novo', regra: 'Uma coluna com um nome de cargo que não existe vira cargo novo. Precisa da meta; o que ficar vazio é copiado do cargo de base (Atendente Júnior).' },
        { item: 'Nomes', regra: 'Não mude o texto da coluna Métrica nem o nome dos cargos no cabeçalho: é por eles que o sistema reconhece cada linha e coluna. Linha que não for métrica do setor é ignorada.' },
        { item: 'Subir', regra: 'Salve como .xlsx e use "Subir lista". Nada é gravado antes da conferência, que mostra cada valor que muda (de → para).' },
      ],
    },
  ]);
}

// ------------------------------------------------------------------ Leitura
/** Texto colado do Excel (tabulação) ou CSV (; ou ,) em grade. */
export function gradeDoTexto(texto: string): string[][] {
  const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!linhas.length) return [];
  const sep = linhas[0].includes('\t') ? '\t' : linhas[0].includes(';') ? ';' : ',';
  return linhas.map((l) => {
    const r: string[] = []; let c = ''; let aspas = false;
    for (const ch of l) {
      if (ch === '"') { aspas = !aspas; continue; }
      if (ch === sep && !aspas) { r.push(c); c = ''; continue; }
      c += ch;
    }
    r.push(c);
    return r;
  });
}

/** .xlsx (padrão) ou .csv em grade. Números do .xlsx viram texto com vírgula decimal. */
export async function gradeDoArquivo(arquivo: File): Promise<string[][]> {
  if (!/\.xlsx$/i.test(arquivo.name)) return gradeDoTexto(await arquivo.text());
  const abas = await lerPlanilha(arquivo);
  // A aba de metas: a primeira que não é de consulta ("Métricas", "Como preencher").
  const consulta = ['metricas', 'como preencher'];
  const linhas = [...abas].find(([nome]) => !consulta.includes(normal(nome)))?.[1] ?? [...abas.values()][0] ?? [];
  const indice = (col: string) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  const ultima = Math.max(0, ...linhas.flatMap((l) => Object.keys(l).map(indice)));
  return linhas.map((l) => {
    const r = Array<string>(ultima + 1).fill('');
    for (const [k, v] of Object.entries(l)) r[indice(k)] = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return r;
  });
}

/** "5.000" → 5000, "1,25" → 1.25, "" → undefined, "não pontua" → null, outra coisa → NaN. */
function lerValor(bruto: string): Valor | undefined {
  const t = String(bruto ?? '').trim();
  if (!t) return undefined;
  if (normal(t) === normal(NAO_PONTUA) || t === '—' || t === '-') return null;
  let s = t.replace(/\s|pts|×/gi, '');
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : Number.NaN;
}

const fmt = (v: Valor | undefined) => v === undefined ? 'vazio' : v === null ? NAO_PONTUA : v.toLocaleString('pt-BR', { maximumFractionDigits: 4 });

// ------------------------------------------------------------------ Conferência
export function planejar(grade: string[][], ctx: ContextoMetas): Plano {
  const vazio: Plano = { colunas: [], mudancas: [], ignoradas: [], fora: [] };
  if (grade.length < 2) return { ...vazio, erro: 'A lista precisa do cabeçalho e de pelo menos uma linha.' };

  // Formato antigo (cargo por linha): vira para o padrão (métrica por linha).
  let g = grade;
  if (normal(g[0][0]) === 'cargo') {
    const n = Math.max(...g.map((r) => r.length));
    g = Array.from({ length: n }, (_, j) => g.map((r) => r[j] ?? ''));
  }
  const cargosDaLista = g[0].slice(1).map((c) => String(c ?? '').trim());
  if (!cargosDaLista.some(Boolean)) return { ...vazio, erro: 'Nenhum cargo no cabeçalho da lista.' };

  // Cada linha: Meta, Média ou uma métrica do setor (pelo nome da tela ou pela chave).
  const itens: { item: Item; linha: string[] }[] = [];
  const ignoradas: string[] = [];
  for (const linha of g.slice(1)) {
    const rot = normal(linha[0]);
    if (!rot) continue;
    if (rot.startsWith('meta')) itens.push({ item: 'meta', linha });
    else if (rot.startsWith('media')) itens.push({ item: 'media', linha });
    else {
      const m = ctx.metricas.find((x) => normal(x.rotulo) === rot || normal(x.chave) === rot);
      if (m) itens.push({ item: m.chave, linha });
      else ignoradas.push(String(linha[0]).trim());
    }
  }

  const colunas: ColunaDoPlano[] = [];
  const mudancas: Mudanca[] = [];
  const vistos = new Set<string>();
  cargosDaLista.forEach((nome, j) => {
    if (!nome) return;
    const existente = ctx.cargos.find((c) => normal(c.nome) === normal(nome));
    const col: ColunaDoPlano = { cargo: existente?.nome ?? nome, id: existente?.id ?? null, erros: [], avisos: [], valores: {} };
    if (vistos.has(normal(nome))) col.erros.push('cargo repetido na lista');
    vistos.add(normal(nome));

    for (const { item, linha } of itens) {
      const v = lerValor(linha[j + 1]);
      if (v === undefined) continue;
      const rotulo = item === 'meta' ? 'Meta' : item === 'media' ? 'Média' : ctx.metricas.find((m) => m.chave === item)!.rotulo;
      if (Number.isNaN(v)) { col.erros.push(`${rotulo}: "${String(linha[j + 1]).trim()}" não é número`); continue; }
      if (item === 'meta' && (v == null || v <= 0)) { col.erros.push('a meta precisa ser maior que zero'); continue; }
      if (item === 'media') {
        const atual = existente ? valorAtual(ctx, existente.id, 'media') : undefined;
        if (v == null || v <= 0) { col.avisos.push('média: para tirar, use Editar cargo'); continue; }
        if (!existente || atual == null) { col.avisos.push('média ignorada: o cargo não recebe média (ligue em Editar cargo)'); continue; }
      }
      col.valores[item] = v;
    }
    if (!existente && col.valores.meta == null && !col.erros.length) col.erros.push('cargo novo precisa da meta');
    colunas.push(col);

    if (existente && !col.erros.length) {
      for (const [item, para] of Object.entries(col.valores)) {
        const de = valorAtual(ctx, existente.id, item);
        if (de === para || (de === undefined && para === null)) continue;
        mudancas.push({ cargo: existente.nome, id: existente.id, item, de: de ?? null, para });
      }
    }
  });

  const fora = ctx.cargos.filter((c) => !vistos.has(normal(c.nome))).map((c) => c.nome);
  return { colunas, mudancas, ignoradas, fora };
}

/** Texto curto de uma mudança, para a conferência: "5.000 → 5.500". */
export const textoDaMudanca = (m: Pick<Mudanca, 'de' | 'para'>) => `${fmt(m.de)} → ${fmt(m.para)}`;
export { fmt as formatarValor };

// ------------------------------------------------------------------ Gravar
type Banco = ReturnType<typeof criarClienteNavegador>;

/**
 * Grava o plano: cria os cargos novos (com o que não veio copiado do cargo de
 * base, sem a média) e atualiza os pesos com o motivo, que o histórico de
 * pesos registra (migração 56). Linhas com erro ficam de fora.
 */
export async function aplicarPlano(db: Banco, plano: Plano, ctx: ContextoMetas, setorId: number, motivo: string)
  : Promise<{ alteracoes: number; cargosNovos: number; falhas: string[] }> {
  const agora = new Date().toISOString();
  const falhas: string[] = [];
  let alteracoes = 0, cargosNovos = 0;
  const base = cargoBase(ctx);

  // 1. Cargos novos.
  let ordem = Math.max(0, ...ctx.cargos.map((c) => c.ordem));
  for (const col of plano.colunas.filter((c) => c.id == null && !c.erros.length)) {
    const { data, error } = await db.from('cargos').insert({ nome: col.cargo, ordem: ++ordem, setor_id: setorId }).select('id').single();
    if (error || !data) { falhas.push(`${col.cargo}: ${error?.message ?? 'não criado'}`); continue; }
    cargosNovos++;
    const linhas = [
      { cargo_id: data.id, regra: REGRA_META, peso: col.valores.meta, ativo: true },
      ...ctx.metricas.map((m) => {
        const v = col.valores[m.chave];
        const daBase = base ? valorAtual(ctx, base.id, m.chave) : undefined;
        const peso = v != null ? v : daBase != null ? daBase
          : Number(ctx.pesos.find((p) => p.cargo_id === base?.id && p.regra === m.chave)?.peso ?? 0);
        return { cargo_id: data.id, regra: m.chave, peso, ativo: v !== undefined ? v !== null : daBase != null };
      }),
    ].map((l) => ({ ...l, atualizado_em: agora, motivo_alteracao: `${motivo} (cargo criado pela lista)` }));
    const { error: e2 } = await db.from('pesos_por_cargo').upsert(linhas, { onConflict: 'cargo_id,regra' });
    if (e2) falhas.push(`${col.cargo} (pesos): ${e2.message}`);
  }

  // 2. O que muda nos cargos existentes. "Não pontua" desliga e guarda o peso.
  if (plano.mudancas.length) {
    const linhas = plano.mudancas.map((m) => {
      const regra = m.item === 'meta' ? REGRA_META : m.item === 'media' ? REGRA_MEDIA : m.item;
      const pesoAntigo = Number(ctx.pesos.find((p) => p.cargo_id === m.id && p.regra === regra)?.peso ?? 0);
      return { cargo_id: m.id, regra, peso: m.para ?? pesoAntigo, ativo: m.para !== null, atualizado_em: agora, motivo_alteracao: motivo };
    });
    const { error } = await db.from('pesos_por_cargo').upsert(linhas, { onConflict: 'cargo_id,regra' });
    if (error) falhas.push(error.message); else alteracoes = linhas.length;
  }
  return { alteracoes, cargosNovos, falhas };
}
