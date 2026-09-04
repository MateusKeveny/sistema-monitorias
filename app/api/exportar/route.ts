import { NextResponse, type NextRequest } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { gerarXlsx, type Aba } from '@/lib/xlsx-escrever';

export const dynamic = 'force-dynamic';

type LinhaSemana = {
  competencia: string;
  operador: string;
  semana_mes: number;
  nota_1: number | null;
  nota_2: number | null;
  nota_3: number | null;
  nota_4: number | null;
  quantidade: number;
  media: number | null;
};

/**
 * Uma linha por operador e semana, com a nota de cada monitoria.
 *
 * É o insumo do cálculo da cota, onde a monitoria entra pela média da semana.
 * Por isso a média é sobre as monitorias que existirem, e não sobre quatro
 * fixas: uma semana com duas monitorias tem a média das duas, e não das duas
 * mais dois zeros. A diferença muda a pontuação inteira.
 *
 * O agrupamento é por `operador_id`, nunca pelo nome: dois homônimos viariam
 * uma linha só, com as notas embaralhadas entre eles.
 */
function agruparPorSemana(linhas: Record<string, unknown>[]): LinhaSemana[] {
  const grupos = new Map<string, { linha: LinhaSemana; notas: number[] }>();

  for (const m of linhas) {
    const chave = `${m.mes_referencia}|${m.operador_id}|${m.semana_mes}`;
    let g = grupos.get(chave);
    if (!g) {
      g = {
        linha: {
          competencia: String(m.mes_referencia ?? '').slice(0, 7),
          operador: String(m.operador ?? ''),
          semana_mes: Number(m.semana_mes),
          nota_1: null, nota_2: null, nota_3: null, nota_4: null,
          quantidade: 0, media: null,
        },
        notas: [],
      };
      grupos.set(chave, g);
    }

    if (m.nota_final == null) continue;
    const nota = Number(m.nota_final);

    const numero = Number(m.numero_monitoria);
    if (numero >= 1 && numero <= 4) {
      g.linha[`nota_${numero}` as 'nota_1' | 'nota_2' | 'nota_3' | 'nota_4'] = nota;
    }
    g.notas.push(nota);
    g.linha.quantidade++;
  }

  for (const { linha, notas } of grupos.values()) {
    linha.media = notas.length
      ? Number((notas.reduce((s, n) => s + n, 0) / notas.length).toFixed(4))
      : null;
  }

  return [...grupos.values()]
    .map((g) => g.linha)
    .sort((a, b) =>
      b.competencia.localeCompare(a.competencia)
      || a.operador.localeCompare(b.operador, 'pt-BR')
      || a.semana_mes - b.semana_mes);
}

/**
 * Exportação dos dados.
 *   /api/exportar?formato=xlsx                    -> pasta com 3 abas
 *   /api/exportar?formato=csv&relatorio=ranking   -> ranking mensal em CSV
 *   /api/exportar?formato=csv&relatorio=semanal   -> operador x semana, com as notas
 *   /api/exportar?formato=csv                     -> monitorias em CSV
 * Aceita &mes=AAAA-MM-01 para filtrar.
 *
 * A consulta usa a sessão do usuário, então a RLS se aplica: um operador
 * só consegue exportar os próprios dados.
 */
export async function GET(requisicao: NextRequest) {
  const db = await criarClienteServidor();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'não autenticado' }, { status: 401 });

  const p = requisicao.nextUrl.searchParams;
  const formato = p.get('formato') ?? 'xlsx';
  const relatorio = p.get('relatorio') ?? 'monitorias';
  const mes = p.get('mes');

  /** Lê uma view inteira, opcionalmente restrita a um mês. */
  async function ler(view: string, ordem: [string, boolean][]) {
    let q = db.from(view).select('*');
    if (mes) q = q.eq('mes_referencia', mes);
    for (const [coluna, ascendente] of ordem) q = q.order(coluna, { ascending: ascendente });
    const { data } = await q;
    return (data ?? []) as Record<string, unknown>[];
  }

  const sufixo = mes ? '-' + mes.slice(0, 7) : '';

  // ------------------------------------------------------------------- CSV
  if (formato === 'csv') {
    const colunas =
      relatorio === 'ranking'
        ? ['mes_referencia', 'operador', 'total_monitorias', 'nota_media',
           'nota_minima', 'nota_maxima', 'zeradas', 'impecaveis']
        : relatorio === 'semanal'
          ? ['competencia', 'operador', 'semana_mes',
             'nota_1', 'nota_2', 'nota_3', 'nota_4', 'quantidade', 'media']
          : ['codigo', 'protocolo', 'data_atendimento', 'operador', 'canal',
             'semana_mes', 'numero_monitoria', 'nota_final', 'zerado', 'parecer'];

    const linhas =
      relatorio === 'ranking'
        ? await ler('vw_ranking_mensal', [['mes_referencia', false], ['nota_media', false]])
        : relatorio === 'semanal'
          ? agruparPorSemana(
              await ler('vw_monitorias', [['data_atendimento', true]])) as unknown as Record<string, unknown>[]
          : await ler('vw_monitorias', [['data_atendimento', false]]);

    const escapar = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    // Separador ponto e vírgula e BOM: é o que o Excel em pt-BR abre direito.
    const csv = '﻿' + [
      colunas.join(';'),
      ...linhas.map((l) => colunas.map((c) => escapar(l[c])).join(';')),
    ].join('\r\n');

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="monitorias-${relatorio}${sufixo}.csv"`,
      },
    });
  }

  // ------------------------------------------------------------------ XLSX
  const [monitorias, detalhes] = await Promise.all([
    ler('vw_monitorias', [['data_atendimento', false]]),
    ler('vw_feedback_individual', [['data_atendimento', true], ['criterio_ordem', true]]),
  ]);

  const simNao = (linhas: Record<string, unknown>[], campo: string) =>
    linhas.map((l) => ({ ...l, [campo]: l[campo] ? 'Sim' : 'Não' }));

  const abas: Aba[] = [
    {
      nome: 'Monitorias',
      colunas: [
        { cabecalho: 'Código', chave: 'codigo', largura: 9, formato: 'numero' },
        { cabecalho: 'Protocolo', chave: 'protocolo', largura: 16 },
        { cabecalho: 'Data', chave: 'data_atendimento', largura: 12 },
        { cabecalho: 'Operador', chave: 'operador', largura: 22 },
        { cabecalho: 'Canal', chave: 'canal', largura: 20 },
        { cabecalho: 'Semana', chave: 'semana_mes', largura: 9, formato: 'numero' },
        { cabecalho: 'Nº', chave: 'numero_monitoria', largura: 6, formato: 'numero' },
        { cabecalho: 'Nota final', chave: 'nota_final', largura: 11, formato: 'percentual' },
        { cabecalho: 'Zerada', chave: 'zerado', largura: 9 },
        { cabecalho: 'Motivo do zeramento', chave: 'motivo_zeramento', largura: 34, formato: 'quebra' },
        { cabecalho: 'Monitor', chave: 'monitor', largura: 20 },
        { cabecalho: 'Parecer', chave: 'parecer', largura: 80, formato: 'quebra' },
      ],
      linhas: simNao(monitorias, 'zerado'),
    },
    {
      nome: 'Critérios avaliados',
      colunas: [
        { cabecalho: 'Protocolo', chave: 'protocolo', largura: 16 },
        { cabecalho: 'Data', chave: 'data_atendimento', largura: 12 },
        { cabecalho: 'Operador', chave: 'operador', largura: 22 },
        { cabecalho: 'Ordem', chave: 'criterio_ordem', largura: 8, formato: 'numero' },
        { cabecalho: 'Critério', chave: 'criterio', largura: 46 },
        { cabecalho: 'Peso', chave: 'peso', largura: 8, formato: 'percentual' },
        { cabecalho: 'Atendeu?', chave: 'conforme', largura: 11 },
        { cabecalho: 'Observação', chave: 'observacao', largura: 60, formato: 'quebra' },
      ],
      linhas: simNao(detalhes, 'conforme'),
    },
    {
      // A média vem calculada porque é ela que entra na cota — deixar para o
      // Excel significaria a mesma conta escrita em cada arquivo, e divergindo
      // no dia em que alguém arrastar a fórmula uma linha a mais.
      //
      // Os pontos NÃO são calculados aqui de propósito. A regra da monitoria
      // (75 × média, quando passa de 85%) pertence ao cadastro de regras do
      // painel de cota, e repeti-la neste arquivo criaria uma segunda
      // definição para o mesmo número.
      nome: 'Por semana',
      colunas: [
        { cabecalho: 'Competência', chave: 'competencia', largura: 13 },
        { cabecalho: 'Operador', chave: 'operador', largura: 22 },
        { cabecalho: 'Semana', chave: 'semana_mes', largura: 9, formato: 'numero' },
        { cabecalho: '1ª', chave: 'nota_1', largura: 9, formato: 'percentual' },
        { cabecalho: '2ª', chave: 'nota_2', largura: 9, formato: 'percentual' },
        { cabecalho: '3ª', chave: 'nota_3', largura: 9, formato: 'percentual' },
        { cabecalho: '4ª', chave: 'nota_4', largura: 9, formato: 'percentual' },
        { cabecalho: 'Qtde', chave: 'quantidade', largura: 8, formato: 'numero' },
        { cabecalho: 'Média', chave: 'media', largura: 11, formato: 'percentual' },
      ],
      linhas: agruparPorSemana(monitorias) as unknown as Record<string, unknown>[],
    },
  ];

  const arquivo = gerarXlsx(abas);

  return new NextResponse(arquivo as unknown as BodyInit, {
    headers: {
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="monitorias${sufixo}.xlsx"`,
    },
  });
}
