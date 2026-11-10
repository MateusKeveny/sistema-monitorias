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
  /** O grupo como o banco guarda (tme_s8, nota_s8...), para trocar as faixas. */
  grupoChave?: string;
};
type RegraDaLista = {
  chave: string; rotulo: string; ordem: number; ativo: boolean; grupo: string;
  faixa_min?: number | null; faixa_max?: number | null; valor_manual?: boolean | null;
};
/** De cada fila do setor, de onde saem as métricas automáticas. */
export type FilaDaLista = {
  grupo_tme: string | null; grupo_csat: string | null; grupo_nota: string | null; regra_finalizado: string | null;
};
export type ContextoMetas = {
  cargos: { id: number; nome: string; ordem: number }[];
  /** As métricas que pontuam no setor, na ordem da tela. */
  metricas: MetricaDaLista[];
  /** pesos_por_cargo dos cargos do setor, com meta e média. */
  pesos: PesoCargo[];
  /** Para criar métricas pela lista (4.1.0). Sem setor: ainda não criado (assistente). */
  setorId?: number;
  /** Filas do setor; undefined = ainda não se sabe (assistente, antes de criar). */
  filas?: FilaDaLista[];
  /** Todas as chaves do setor (também as desligadas), para não repetir. */
  chaves?: string[];
  /** Os grupos que têm métrica deste setor: grupo de fora é de outro setor (fila copiada). */
  gruposDoSetor?: string[];
  ordemMax?: number;
};

/** As filas do setor passam a usar o grupo próprio que a lista criou. */
export type Repontar = Partial<Record<'grupo_tme' | 'grupo_csat' | 'grupo_nota' | 'regra_finalizado', string>>;

/** Métrica que a lista cria (4.1.0): linha com nome que o setor ainda não tem. */
export type TipoNovo = 'manual' | 'valor' | 'finalizado' | 'tme' | 'csat' | 'nota';
export type MetricaNova = {
  rotulo: string; tipo: TipoNovo; chave: string;
  grupo: string | null; faixa_min: number | null; faixa_max: number | null;
  /** Finalizados: em vez de criar, renomeia a métrica da fila (esta chave). */
  daFila?: string;
  /** Automática no assistente: o grupo só se sabe depois de criar as filas. */
  pendente?: boolean;
  /** Grupos próprios do setor que o grupo novo substitui nas filas (faixas antigas a desligar). */
  substitui?: string[];
  erro?: string; aviso?: string;
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
  /** Métricas que a lista cria (ou, nos finalizados, renomeia). */
  novas: MetricaNova[];
  /** Faixas antigas do mesmo grupo que a lista substitui: são desligadas (senão contariam em dobro). */
  desativar: { chave: string; rotulo: string }[];
  /** Filas do setor que passam a usar os grupos próprios criados pela lista. */
  repontar: Repontar;
};

/** Cabeçalho das colunas vagas do modelo de um setor sem cargos: troque pelo nome do cargo. */
const PREFIXO_VAGO = 'Nome do cargo';
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
  setor?: { setorId: number; filas: FilaDaLista[] },
): ContextoMetas {
  return {
    cargos: cargos.map(({ id, nome, ordem }) => ({ id, nome, ordem })),
    metricas: regras.filter((r) => r.ativo && r.chave !== REGRA_META && r.chave !== REGRA_MEDIA && r.grupo !== 'config')
      .sort((a, b) => a.ordem - b.ordem)
      .map((r) => ({ chave: r.chave, rotulo: r.rotulo, tipo: tipoDaRegra(r), faixa: faixaDaRegra(r),
        grupo: NOME_DO_GRUPO[r.grupo.replace(/_s\d+$/, '')] ?? r.grupo, grupoChave: r.grupo })),
    pesos,
    ...(setor ? { setorId: setor.setorId, filas: setor.filas } : {}),
    chaves: regras.map((r) => r.chave),
    gruposDoSetor: [...new Set(regras.map((r) => r.grupo))],
    ordemMax: Math.max(0, ...regras.map((r) => r.ordem)),
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
  // Uma aba só (4.1.0): à esquerda o que é cada métrica (só leitura); à
  // direita uma coluna por cargo, com o cabeçalho em amarelo — é o que se preenche.
  const colunas = [
    { cabecalho: 'Métrica', chave: 'k', largura: 36 },
    { cabecalho: 'Como pontua', chave: 'tipo', largura: 44, formato: 'quebra' as const },
    { cabecalho: 'Faixa', chave: 'faixa', largura: 20 },
    ...cargos.map((c, i) => ({ cabecalho: c.nome, chave: `c${i}`, formato: 'numero' as const, largura: Math.max(16, c.nome.length + 3), destaque: true })),
    // Setor ainda sem cargos (criado do zero): colunas prontas para dar nome ao cargo e a meta.
    ...(cargos.length ? [] : [1, 2, 3].map((n) => ({ cabecalho: `${PREFIXO_VAGO} ${n}`, chave: `v${n}`, formato: 'numero' as const, largura: 22, destaque: true }))),
  ];
  const info: Record<Item, { tipo: string; faixa: string }> = {
    meta: { tipo: 'Pontos para bater a cota no mês (maior que zero)', faixa: '' },
    media: { tipo: 'Multiplicador da média da equipe (ex.: 1,2 = 120%) — só para quem já recebe média', faixa: '' },
    ...Object.fromEntries(ctx.metricas.map((m) => [m.chave, { tipo: m.tipo ?? '', faixa: m.faixa ?? '' }])),
  };
  const linha = (rotulo: string, item: Item) => Object.fromEntries([
    ['k', rotulo], ['tipo', info[item]?.tipo ?? ''], ['faixa', info[item]?.faixa ?? ''],
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
      nome: 'Como preencher',
      colunas: [
        { cabecalho: 'Item', chave: 'item', largura: 22 },
        { cabecalho: 'Como funciona', chave: 'regra', largura: 90, formato: 'quebra' },
      ],
      linhas: [
        { item: 'Onde preencher', regra: `Na aba "${nomeDaAba}", só nas colunas amarelas (${nomes || 'uma por cargo'}): uma linha por métrica, a pontuação no cruzamento com o cargo. Métrica, Como pontua e Faixa são só para leitura.` },
        ...(cargos.length ? [] : [{ item: 'Setor sem cargos', regra: `Troque "${PREFIXO_VAGO} 1, 2, 3" pelo nome de cada cargo e preencha a Meta do mês: cada coluna vira um cargo. Coluna que continuar "${PREFIXO_VAGO}" é ignorada.` }]),
        ...(ctx.metricas.length ? [] : [{ item: 'Setor sem métricas', regra: 'Este setor ainda não tem métricas (foi criado do zero, sem copiar de outro setor). As métricas nascem com as filas e em Configuração › Faixas e nomes; depois disso, baixe o modelo de novo e as linhas aparecem aqui.' }]),
        { item: 'Número', regra: 'A pontuação da métrica no cargo. Negativo desconta (ex.: -50). Decimal com vírgula (ex.: 0,25).' },
        { item: 'não pontua', regra: 'A métrica não conta para o cargo. Trocar por um número liga; escrever "não pontua" desliga.' },
        { item: 'Célula vazia', regra: 'Não muda nada naquele cargo.' },
        { item: 'Cargo novo', regra: 'Acrescente uma coluna com o nome do cargo: ele é criado com a meta preenchida, e o que ficar vazio é copiado do Atendente Júnior.' },
        { item: 'Métrica nova', regra: 'Acrescente uma linha com um nome que o setor não tem: ela é criada. O tipo vem de "Como pontua": "faixa de TME", "faixa de C-SAT", "avaliação com esta nota" ou "atendimento finalizado" são automáticas (vêm do Hub e pedem uma fila no setor); qualquer outro texto vira lançamento manual. A faixa vem de "Faixa" (ex.: "de 0 a 10 min", "a partir de 30", "de 5 a 5" para a nota).' },
        { item: 'Faixas novas', regra: 'Faixas de TME, C-SAT ou notas trazidas pela lista substituem as antigas do setor (que são desligadas), para o mesmo atendimento não pontuar duas vezes.' },
        { item: 'Nomes', regra: 'Não mude o texto da coluna Métrica das que já existem nem os nomes dos cargos: é por eles que o sistema reconhece cada linha e coluna.' },
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

// ------------------------------------------------------------------ Métricas novas
/** Chave técnica a partir do nome — a mesma regra de Faixas e nomes. */
const chaveDe = (rotulo: string) => normal(rotulo).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

/** O tipo pela coluna "Como pontua" (os textos que o próprio modelo escreve). */
function tipoDoTexto(comoPontua: string): { tipo: TipoNovo; aviso?: string } {
  const t = normal(comoPontua);
  if (t.includes('faixa de tme')) return { tipo: 'tme' };
  if (t.includes('faixa de c-sat') || t.includes('faixa de csat')) return { tipo: 'csat' };
  if (/com (esta|essa) nota/.test(t)) return { tipo: 'nota' };
  if (t.includes('atendimento finalizado')) return { tipo: 'finalizado' };
  if (t.includes('valor digitado')) return { tipo: 'valor' };
  if (t.includes('tma')) return { tipo: 'manual', aviso: 'o TMA não vem do Hub: entra por lançamento' };
  return { tipo: 'manual' };
}

/** "de 0 a 10 min", "a partir de 30", "até 20" — ou, sem faixa, o próprio nome ("TME - até 10 min"). */
function lerFaixa(texto: string): { min: number | null; max: number | null } | null {
  const t = normal(texto);
  const n = (t.match(/-?\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(',', '.')));
  if (!n.length) return null;
  if (/a partir|acima|mais de|maior/.test(t)) return { min: n[0], max: null };
  if (n.length >= 2) return { min: Math.min(n[0], n[1]), max: Math.max(n[0], n[1]) };
  if (/ate|abaixo|menos de|menor/.test(t)) return { min: null, max: n[0] };
  return null;
}

const UNIDADE: Partial<Record<TipoNovo, number>> = { tme: 60, csat: 0.01 };
const textoFaixa = (m: Pick<MetricaNova, 'tipo' | 'faixa_min' | 'faixa_max'>) => {
  const f = (v: number) => m.tipo === 'tme' ? `${Math.round((v / 60) * 100) / 100} min` : m.tipo === 'csat' ? `${Math.round(v * 10000) / 100}%` : String(v);
  if (m.tipo === 'nota') return `nota ${m.faixa_min}`;
  if (m.faixa_min != null && m.faixa_max != null) return `de ${f(m.faixa_min)} a ${f(m.faixa_max)}`;
  if (m.faixa_min != null) return `a partir de ${f(m.faixa_min)}`;
  if (m.faixa_max != null) return `até ${f(m.faixa_max)}`;
  return '';
};
const NOME_DO_TIPO: Record<TipoNovo, string> = {
  manual: 'lançamento', valor: 'valor digitado', finalizado: 'finalizados da fila',
  tme: 'faixa de TME', csat: 'faixa de C-SAT', nota: 'nota do C-SAT',
};
/** Como a conferência descreve a métrica nova: "faixa de TME · de 0 a 10 min". */
export const descricaoDaNova = (m: MetricaNova) =>
  [NOME_DO_TIPO[m.tipo], textoFaixa(m)].filter(Boolean).join(' · ');

/** Monta a métrica nova de uma linha. O grupo das automáticas sai das filas do setor. */
function novaMetrica(rotulo: string, comoPontua: string, faixaTxt: string, ctx: ContextoMetas, usadas: Set<string>, repontar: Repontar): MetricaNova {
  const { tipo, aviso } = tipoDoTexto(comoPontua);
  const sufixo = ctx.setorId == null ? '_novo' : ctx.setorId === 1 ? '' : `_s${ctx.setorId}`;
  const base = chaveDe(rotulo) || 'metrica';
  let chave = `${base}${sufixo}`;
  for (let i = 2; usadas.has(chave) || (ctx.chaves ?? []).includes(chave); i++) chave = `${base}_${i}${sufixo}`;
  usadas.add(chave);
  const m: MetricaNova = { rotulo, tipo, chave, grupo: tipo === 'manual' || tipo === 'valor' ? 'manual' : null, faixa_min: null, faixa_max: null, aviso };
  if (m.grupo) return m;

  // Automática: de qual grupo das filas ela faz parte. Grupo de OUTRO setor
  // (fila que copiou a da Expansão num setor do zero aponta para as regras de
  // lá) nunca é mexido: a lista cria um grupo próprio e as filas passam a usá-lo.
  const campo = ({ tme: 'grupo_tme', csat: 'grupo_csat', nota: 'grupo_nota', finalizado: 'regra_finalizado' } as const)[tipo as 'tme'];
  const doSetor = (x: string) => tipo === 'finalizado' ? (ctx.chaves ?? []).includes(x) : (ctx.gruposDoSetor ?? []).includes(x);
  if (ctx.filas === undefined) { m.pendente = true; }
  else {
    const filas = tipo === 'tme' ? ctx.filas.filter((f) => f.grupo_tme) : ctx.filas;
    const opcoes = [...new Set(filas.map((f) => f[campo]).filter((x): x is string => !!x))];
    if (!opcoes.length) m.erro = `${NOME_DO_TIPO[tipo]} precisa de uma fila do Hub no setor${tipo === 'tme' ? ' que pontue TME' : ''} (Setores e filas › + Fila)`;
    else if (opcoes.length === 1 && doSetor(opcoes[0])) { if (tipo === 'finalizado') m.daFila = opcoes[0]; else m.grupo = opcoes[0]; }
    else if (ctx.setorId == null || ctx.setorId === 1) m.erro = `as filas do setor usam ${NOME_DO_TIPO[tipo]} diferentes: ajuste esta em Configuração › Faixas e nomes`;
    else if (tipo === 'finalizado') {
      if (repontar.regra_finalizado) m.erro = 'só uma linha de finalizados por lista (vale para todas as filas)';
      else { m.grupo = 'atendimento'; repontar.regra_finalizado = chave; m.substitui = opcoes.filter(doSetor); }
    } else {
      m.grupo = `${tipo}_s${ctx.setorId}`;
      repontar[campo] = m.grupo;
      m.substitui = opcoes.filter(doSetor);
    }
  }

  if (tipo === 'finalizado') return m;
  const faixa = lerFaixa(faixaTxt) ?? lerFaixa(rotulo);
  if (tipo === 'nota') {
    const nota = faixa?.min ?? faixa?.max ?? null;
    if (nota == null || nota < 1 || nota > 5 || !Number.isInteger(nota)) m.erro ??= 'a nota precisa ser de 1 a 5 (ex.: Faixa "de 5 a 5")';
    else { m.faixa_min = nota; m.faixa_max = nota; }
    return m;
  }
  if (!faixa) { m.erro ??= `falta a faixa (ex.: ${tipo === 'tme' ? '"de 0 a 10 min"' : '"de 90 a 95"'})`; return m; }
  const conv = (v: number | null) => v == null ? null : tipo === 'tme' ? v * 60 : v > 1 ? v / 100 : v;
  m.faixa_min = conv(faixa.min); m.faixa_max = conv(faixa.max);
  return m;
}

/**
 * Faixas da lista sem buraco: "de 0 a 10" e "de 11 a 20" viram 0–10 e 10–20
 * (o cálculo conta de min até antes do max). Buraco maior ou faixa cruzada
 * fica como veio, com aviso.
 */
function encostarFaixas(novas: MetricaNova[]) {
  for (const tipo of ['tme', 'csat'] as const) {
    const lista = novas.filter((n) => n.tipo === tipo && !n.erro).sort((a, b) => (a.faixa_min ?? -Infinity) - (b.faixa_min ?? -Infinity));
    for (let i = 1; i < lista.length; i++) {
      const ant = lista[i - 1], m = lista[i];
      if (ant.faixa_max == null || m.faixa_min == null) continue;
      const buraco = m.faixa_min - ant.faixa_max;
      if (buraco > 0 && buraco <= UNIDADE[tipo]! + 1e-9) m.faixa_min = ant.faixa_max;
      else if (buraco !== 0) m.aviso = [m.aviso, buraco > 0 ? `há um buraco antes desta faixa (depois de "${ant.rotulo}")` : `esta faixa cruza com "${ant.rotulo}"`].filter(Boolean).join('; ');
    }
  }
}

// ------------------------------------------------------------------ Conferência
export function planejar(grade: string[][], ctx: ContextoMetas): Plano {
  const vazio: Plano = { colunas: [], mudancas: [], ignoradas: [], fora: [], novas: [], desativar: [], repontar: {} };
  if (grade.length < 2) return { ...vazio, erro: 'A lista precisa do cabeçalho e de pelo menos uma linha.' };

  // Formato antigo (cargo por linha): vira para o padrão (métrica por linha).
  let g = grade;
  if (normal(g[0][0]) === 'cargo') {
    const n = Math.max(...g.map((r) => r.length));
    g = Array.from({ length: n }, (_, j) => g.map((r) => r[j] ?? ''));
  }
  // Arquivo trocado: o gabarito de cadastro de pessoas (Nome, E-mail, Setor...) não é lista de metas.
  const cab = g[0].map(normal);
  if (cab[0] === 'nome' || ['e-mail', 'email', 'nome no hub', 'papel'].some((c) => cab.includes(c))) {
    return { ...vazio, erro: 'Este arquivo é o gabarito de cadastro de pessoas, não o de metas. Use "⬇ Baixar modelo" desta tela: a primeira coluna é "Métrica" e cada cargo é uma coluna.' };
  }
  // As colunas de leitura do modelo (Como pontua, Faixa...) não são cargos.
  const leitura = ['como pontua', 'faixa', 'grupo', 'tipo', 'unidade', 'chave no sistema'];
  const cargosDaLista = g[0].slice(1).map((c) => String(c ?? '').trim())
    .map((c) => (leitura.includes(normal(c)) || normal(c).startsWith(normal(PREFIXO_VAGO)) ? '' : c));
  if (!cargosDaLista.some(Boolean)) return { ...vazio, erro: 'Nenhum cargo no cabeçalho da lista.' };

  // Cada linha: Meta, Média, uma métrica do setor (pelo nome da tela ou pela
  // chave) ou uma métrica nova (4.1.0), com o tipo de "Como pontua" e a "Faixa".
  const iComo = cab.indexOf('como pontua');
  const iFaixa = cab.indexOf('faixa');
  const itens: { item: Item; linha: string[] }[] = [];
  const ignoradas: string[] = [];
  const novas: MetricaNova[] = [];
  const usadas = new Set<string>();
  const repontar: Repontar = {};
  const rotulos = new Map<Item, string>([['meta', 'Meta'], ['media', 'Média'], ...ctx.metricas.map((m) => [m.chave, m.rotulo] as [string, string])]);
  for (const linha of g.slice(1)) {
    const rot = normal(linha[0]);
    if (!rot) continue;
    if (rot === 'meta' || rot.startsWith('meta do mes') || rot.startsWith('meta de pontuacao')) itens.push({ item: 'meta', linha });
    else if (rot === 'media' || rot.startsWith('media da equipe') || rot.startsWith('media dos cargos')) itens.push({ item: 'media', linha });
    else {
      const m = ctx.metricas.find((x) => normal(x.rotulo) === rot || normal(x.chave) === rot);
      if (m) { itens.push({ item: m.chave, linha }); continue; }
      if (novas.some((n) => normal(n.rotulo) === rot)) { ignoradas.push(`${String(linha[0]).trim()} (repetida)`); continue; }
      const nova = novaMetrica(String(linha[0]).trim(), iComo > 0 ? linha[iComo] ?? '' : '', iFaixa > 0 ? linha[iFaixa] ?? '' : '', ctx, usadas, repontar);
      novas.push(nova);
      if (nova.erro) continue;
      const item = nova.daFila ?? nova.chave;
      rotulos.set(item, nova.rotulo);
      itens.push({ item, linha });
    }
  }
  encostarFaixas(novas);

  // Faixas novas num grupo trocam as antigas desse grupo que não vieram na
  // lista: as duas valendo juntas pontuariam o mesmo atendimento duas vezes.
  const naLista = new Set(itens.map((x) => x.item));
  const gruposTrocados = new Set(novas.filter((n) => !n.erro && n.grupo && n.grupo !== 'manual' && n.grupo !== 'atendimento')
    .flatMap((n) => [n.grupo!, ...(n.substitui ?? [])]));
  const desativar = ctx.metricas.filter((m) => m.grupoChave && gruposTrocados.has(m.grupoChave) && !naLista.has(m.chave))
    .map((m) => ({ chave: m.chave, rotulo: m.rotulo }));

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
      const rotulo = rotulos.get(item) ?? item;
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
  return { colunas, mudancas, ignoradas, fora, novas, desativar, repontar };
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
  : Promise<{ alteracoes: number; cargosNovos: number; metricasNovas: number; falhas: string[] }> {
  const agora = new Date().toISOString();
  const falhas: string[] = [];
  let alteracoes = 0, cargosNovos = 0, metricasNovas = 0;
  const base = cargoBase(ctx);

  // 0. Métricas (4.1.0): desliga as faixas substituídas, renomeia os
  // finalizados da fila e cria as novas. Pendente ou com erro fica de fora.
  const semRegra = new Set(plano.novas.filter((n) => n.erro || n.pendente).map((n) => n.chave));
  if (plano.desativar.length) {
    const { error } = await db.from('regras').update({ ativo: false }).in('chave', plano.desativar.map((d) => d.chave));
    if (error) falhas.push(`faixas antigas: ${error.message}`);
  }
  for (const n of plano.novas.filter((x) => x.daFila && !x.erro)) {
    const { error } = await db.from('regras').update({ rotulo: n.rotulo }).eq('chave', n.daFila!);
    if (error) falhas.push(`${n.rotulo}: ${error.message}`);
  }
  let ordemRegra = ctx.ordemMax ?? 0;
  const criar = plano.novas.filter((n) => !n.erro && !n.pendente && !n.daFila);
  for (const n of criar) {
    // O peso sugerido da métrica: o primeiro da linha (o que vale é o de cada cargo).
    const sugerido = plano.colunas.map((c) => c.valores[n.chave]).find((v): v is number => typeof v === 'number') ?? 0;
    const { error } = await db.from('regras').insert({
      chave: n.chave, grupo: n.grupo ?? 'manual', rotulo: n.rotulo, peso: sugerido,
      faixa_min: n.faixa_min, faixa_max: n.faixa_max, ordem: ++ordemRegra,
      manual: n.tipo === 'manual' || n.tipo === 'valor', valor_manual: n.tipo === 'valor', ativo: true, setor_id: setorId,
    });
    if (error) { semRegra.add(n.chave); falhas.push(`${n.rotulo}: ${error.message}`); continue; }
    metricasNovas++;
  }
  const criadas = criar.filter((n) => !semRegra.has(n.chave));

  // As filas do setor passam a usar os grupos próprios (e deixam de acompanhar
  // a fila copiada). O TME só nas filas que pontuam TME.
  for (const [campo, valor] of Object.entries(plano.repontar) as [keyof Repontar, string][]) {
    const nova = plano.novas.find((n) => n.chave === valor || n.grupo === valor);
    if (nova && semRegra.has(nova.chave) && campo === 'regra_finalizado') continue;
    let q = db.from('canais_do_setor').update({ [campo]: valor, copia_de: null }).eq('setor_id', setorId).eq('ativo', true);
    if (campo === 'grupo_tme') q = q.not('grupo_tme', 'is', null);
    const { error } = await q;
    if (error) falhas.push(`filas (${campo}): ${error.message}`);
  }

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
      // As métricas que a lista acabou de criar, onde o cargo tem número.
      ...criadas.filter((n) => typeof col.valores[n.chave] === 'number')
        .map((n) => ({ cargo_id: data.id, regra: n.chave, peso: col.valores[n.chave] as number, ativo: true })),
    ].map((l) => ({ ...l, atualizado_em: agora, motivo_alteracao: `${motivo} (cargo criado pela lista)` }));
    const { error: e2 } = await db.from('pesos_por_cargo').upsert(linhas, { onConflict: 'cargo_id,regra' });
    if (e2) falhas.push(`${col.cargo} (pesos): ${e2.message}`);
  }

  // 2. O que muda nos cargos existentes. "Não pontua" desliga e guarda o peso.
  const mudancas = plano.mudancas.filter((m) => !semRegra.has(m.item));
  if (mudancas.length) {
    const linhas = mudancas.map((m) => {
      const regra = m.item === 'meta' ? REGRA_META : m.item === 'media' ? REGRA_MEDIA : m.item;
      const pesoAntigo = Number(ctx.pesos.find((p) => p.cargo_id === m.id && p.regra === regra)?.peso ?? 0);
      return { cargo_id: m.id, regra, peso: m.para ?? pesoAntigo, ativo: m.para !== null, atualizado_em: agora, motivo_alteracao: motivo };
    });
    const { error } = await db.from('pesos_por_cargo').upsert(linhas, { onConflict: 'cargo_id,regra' });
    if (error) falhas.push(error.message); else alteracoes = linhas.length;
  }
  return { alteracoes, cargosNovos, metricasNovas, falhas };
}
