import { NextResponse, type NextRequest } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { gerarXlsx, type Aba } from '@/lib/xlsx-escrever';

export const dynamic = 'force-dynamic';

/**
 * Exportação dos dados.
 *   /api/exportar?formato=xlsx                    -> pasta com 2 abas (monitorias + critérios)
 *   /api/exportar?formato=csv&relatorio=ranking   -> ranking mensal em CSV
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
    const ehRanking = relatorio === 'ranking';
    const colunas = ehRanking
      ? ['mes_referencia', 'operador', 'total_monitorias', 'nota_media',
         'nota_minima', 'nota_maxima', 'zeradas', 'impecaveis']
      : ['protocolo', 'data_atendimento', 'operador', 'canal', 'semana_mes',
         'numero_monitoria', 'nota_final', 'zerado', 'parecer'];

    const linhas = ehRanking
      ? await ler('vw_ranking_mensal', [['mes_referencia', false], ['nota_media', false]])
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
