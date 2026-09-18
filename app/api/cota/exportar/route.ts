import { NextResponse, type NextRequest } from 'next/server';
import { criarClienteServidor, obterPerfil } from '@/lib/supabase/servidor';
import { gerarXlsx, type Aba, type Coluna } from '@/lib/xlsx-escrever';
import { mesRotulo } from '@/lib/formatar';

export const dynamic = 'force-dynamic';

type Linha = {
  pessoa_id: string; semana: number | null; origem: 'huggy' | 'diretores' | null;
  regra: string; rotulo: string; grupo: string; ordem: number;
  cargo: string | null; quantidade: number; peso: number; cota: number;
};
type Cota = { pessoa_id: string; pessoa: string; cargo: string | null; resultado: number; meta: number | null };
type Csat = { pessoa_id: string; origem: 'huggy' | 'diretores'; avaliacoes: number; positivas: number };

/** Data para o número de série do Excel, como o arquivo modelo usa. */
const serialDoExcel = (iso: string) =>
  Math.round((Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);

/**
 * Colunas do resumo, na ordem do arquivo que o outro sistema importa.
 *
 * Cada uma diz de onde tira o número: a chave da regra e o canal. O valor é a
 * QUANTIDADE (o "feito"), não os pontos — é assim que o modelo veio.
 */
const COLUNAS_RESUMO: { cabecalho: string; regra?: string; canal?: 'huggy' | 'diretores'; campo?: string }[] = [
  { cabecalho: 'Colaborador', campo: 'colaborador' },
  { cabecalho: 'Mês Ref', campo: 'mes' },
  { cabecalho: 'Mês (Ordem)', campo: 'mes' },
  { cabecalho: 'Atendimentos', regra: 'huggy_atendimento', canal: 'huggy' },
  { cabecalho: 'Transferencia', regra: 'transferencias' },
  { cabecalho: 'Cota (pts)', campo: 'resultado' },
  { cabecalho: 'CSAT  Mensal (Huggy) (%)', campo: 'csat_huggy' },
  { cabecalho: 'Acima de 95% (Huggy)', regra: 'csat_95', canal: 'huggy' },
  { cabecalho: 'Entre 90% e 94,9% (Huggy)', regra: 'csat_90_95', canal: 'huggy' },
  { cabecalho: 'Entre 85% e 89,9% (Huggy)', regra: 'csat_85_90', canal: 'huggy' },
  { cabecalho: 'Entre 80% e 84,9% (Huggy)', regra: 'csat_80_85', canal: 'huggy' },
  { cabecalho: 'Abaixo de 80% (Huggy)', regra: 'csat_abaixo_80', canal: 'huggy' },
  { cabecalho: 'Nota 1 (Huggy)', regra: 'nota_1', canal: 'huggy' },
  { cabecalho: 'Nota 2 (Huggy)', regra: 'nota_2', canal: 'huggy' },
  { cabecalho: 'Nota 3 (Huggy)', regra: 'nota_3', canal: 'huggy' },
  { cabecalho: 'Nota 4 (Huggy)', regra: 'nota_4', canal: 'huggy' },
  { cabecalho: 'Nota 5 (Huggy)', regra: 'nota_5', canal: 'huggy' },
  { cabecalho: 'Atendimento Diretores', regra: 'diretores_atendimento', canal: 'diretores' },
  { cabecalho: 'Tempo de resposta - até 30 min', regra: 'diretores_ate_30', canal: 'diretores' },
  { cabecalho: 'Tempo de resposta - até 1h00', regra: 'diretores_ate_1h', canal: 'diretores' },
  { cabecalho: 'Tempo de resposta - acima de 1h00', regra: 'diretores_acima_1h', canal: 'diretores' },
  { cabecalho: 'C-SAT Semanal Diretores', campo: 'csat_diretores' },
  { cabecalho: 'Acima de 95% (Diretores)', regra: 'csat_95', canal: 'diretores' },
  { cabecalho: 'Entre 90% e 94,9% (Diretores)', regra: 'csat_90_95', canal: 'diretores' },
  { cabecalho: 'Entre 85% e 89,9% (Diretores)', regra: 'csat_85_90', canal: 'diretores' },
  { cabecalho: 'Entre 80% e 84,9% (Diretores)', regra: 'csat_80_85', canal: 'diretores' },
  { cabecalho: 'Abaixo de 80% (Diretores)', regra: 'csat_abaixo_80', canal: 'diretores' },
  { cabecalho: 'Nota 1 (Diretores)', regra: 'nota_1', canal: 'diretores' },
  { cabecalho: 'Nota 2 (Diretores)', regra: 'nota_2', canal: 'diretores' },
  { cabecalho: 'Nota 3 (Diretores)', regra: 'nota_3', canal: 'diretores' },
  { cabecalho: 'Nota 4 (Diretores)', regra: 'nota_4', canal: 'diretores' },
  { cabecalho: 'Nota 5 (Diretores)', regra: 'nota_5', canal: 'diretores' },
  { cabecalho: 'Atendimento presencial', regra: 'presencial' },
  { cabecalho: 'Monitorias', campo: 'monitoria_pontos' },
  { cabecalho: '1° Semana', campo: 'monitoria_1' },
  { cabecalho: '2° Semana', campo: 'monitoria_2' },
  { cabecalho: '3° Semana', campo: 'monitoria_3' },
  { cabecalho: '4° Semana', campo: 'monitoria_4' },
  { cabecalho: 'Atestado', regra: 'atestado' },
  { cabecalho: 'Atraso sem atestado por mim', regra: 'atraso' },
  { cabecalho: 'Procedimento incorreto', regra: 'proc_incorreto' },
  { cabecalho: 'Uso do Celular', regra: 'celular' },
  { cabecalho: 'Uso do uniforme', regra: 'uniforme' },
  { cabecalho: 'Omissão de atendimento', regra: 'omissao' },
  { cabecalho: 'Inconsistência de atendimentos', regra: 'inconsistencia' },
  { cabecalho: 'Tratativa de chamados', regra: 'chamados_tratados' },
  { cabecalho: 'SLA < 2', regra: 'chamados_sla_ate_2d' },
  { cabecalho: 'SLA > 2', regra: 'chamados_sla_acima_2d' },
];

/**
 * Exportação da cota da competência, em dois formatos:
 *
 *   resumo    — uma linha por pessoa, nas colunas do sistema de acompanhamento
 *   detalhado — o resumo mais o extrato semana a semana, como as planilhas
 *               antigas de conferência
 *
 * Só gestor: é a base do que vai para o outro departamento.
 */
export async function GET(requisicao: NextRequest) {
  const perfil = await obterPerfil();
  if (!perfil || perfil.papel !== 'gestor') {
    return NextResponse.json({ erro: 'Apenas gestores exportam a cota.' }, { status: 403 });
  }

  const params = requisicao.nextUrl.searchParams;
  const mes = params.get('mes') ?? '';
  if (!/^\d{4}-\d{2}$/.test(mes)) {
    return NextResponse.json({ erro: 'Informe a competência como AAAA-MM.' }, { status: 400 });
  }
  const competencia = `${mes}-01`;
  const detalhado = params.get('formato') === 'detalhado';

  const db = await criarClienteServidor();
  const [extrato, cotas, csat] = await Promise.all([
    db.from('vw_extrato_cota')
      .select('pessoa_id, semana, origem, regra, rotulo, grupo, ordem, cargo, quantidade, peso, cota')
      .eq('mes_competencia', competencia).order('ordem'),
    db.from('vw_cota_mensal').select('pessoa_id, pessoa, cargo, resultado, meta')
      .eq('mes_competencia', competencia).order('pessoa'),
    db.from('vw_csat_semanal').select('pessoa_id, origem, avaliacoes, positivas')
      .eq('mes_competencia', competencia),
  ]);

  const linhas = (extrato.data ?? []) as Linha[];
  const lista = (cotas.data ?? []) as Cota[];
  const avaliacoes = (csat.data ?? []) as Csat[];

  const serial = serialDoExcel(competencia);

  const csatDe = (pessoa: string, origem: 'huggy' | 'diretores') => {
    const suas = avaliacoes.filter((c) => c.pessoa_id === pessoa && c.origem === origem);
    const total = suas.reduce((a, c) => a + c.avaliacoes, 0);
    return total ? suas.reduce((a, c) => a + c.positivas, 0) / total : null;
  };

  // ------------------------------------------------------------------ resumo
  const linhasResumo = lista.map((p) => {
    const suas = linhas.filter((l) => l.pessoa_id === p.pessoa_id);
    const soma = (regra: string, canal?: 'huggy' | 'diretores', campo: 'quantidade' | 'cota' = 'quantidade') =>
      suas.filter((l) => l.regra === regra && (!canal || l.origem === canal))
        .reduce((a, l) => a + Number(l[campo]), 0);

    const registro: Record<string, unknown> = {
      colaborador: p.pessoa,
      mes: serial,
      resultado: Number(p.resultado),
      csat_huggy: csatDe(p.pessoa_id, 'huggy'),
      csat_diretores: csatDe(p.pessoa_id, 'diretores'),
      monitoria_pontos: soma('monitoria', undefined, 'cota'),
    };
    for (const s of [1, 2, 3, 4]) {
      registro[`monitoria_${s}`] = suas
        .filter((l) => l.regra === 'monitoria' && l.semana === s)
        .reduce((a, l) => a + Number(l.cota), 0);
    }
    for (const c of COLUNAS_RESUMO) {
      if (c.regra) registro[`${c.regra}|${c.canal ?? ''}`] = soma(c.regra, c.canal);
    }
    return registro;
  });

  const colunasResumo: Coluna[] = COLUNAS_RESUMO.map((c) => ({
    cabecalho: c.cabecalho,
    chave: c.campo ?? `${c.regra}|${c.canal ?? ''}`,
    formato: c.campo === 'colaborador' ? 'texto'
      : c.campo?.startsWith('csat_') ? 'percentual' : 'numero',
    largura: c.campo === 'colaborador' ? 34 : 16,
  }));

  const abas: Aba[] = [{ nome: 'Base', colunas: colunasResumo, linhas: linhasResumo }];

  // --------------------------------------------------------------- detalhado
  if (detalhado) {
    const nomeDe = new Map(lista.map((p) => [p.pessoa_id, p.pessoa]));
    const NOME_CANAL: Record<string, string> = { huggy: 'Expansão', diretores: 'Diretores-Expansão' };

    abas.push({
      nome: 'Extrato semanal',
      colunas: [
        { cabecalho: 'Colaborador', chave: 'colaborador', largura: 34 },
        { cabecalho: 'Cargo', chave: 'cargo', largura: 18 },
        { cabecalho: 'Semana', chave: 'semana', largura: 10 },
        { cabecalho: 'Canal', chave: 'canal', largura: 20 },
        { cabecalho: 'Categoria', chave: 'categoria', largura: 36 },
        { cabecalho: 'Feito', chave: 'quantidade', formato: 'numero', largura: 14 },
        { cabecalho: 'Pontuação', chave: 'peso', formato: 'numero', largura: 12 },
        { cabecalho: 'Cota', chave: 'cota', formato: 'numero', largura: 12 },
      ],
      linhas: linhas
        .slice()
        .sort((a, b) => (nomeDe.get(a.pessoa_id) ?? '').localeCompare(nomeDe.get(b.pessoa_id) ?? '')
          || (a.semana ?? 9) - (b.semana ?? 9) || a.ordem - b.ordem)
        .map((l) => ({
          colaborador: nomeDe.get(l.pessoa_id) ?? '—',
          cargo: l.cargo ?? '',
          semana: l.semana ? `${l.semana}ª` : 'mês',
          canal: l.origem ? NOME_CANAL[l.origem] : '—',
          categoria: l.rotulo,
          quantidade: Number(l.quantidade),
          peso: Number(l.peso),
          cota: Number(l.cota),
        })),
    });

    abas.push({
      nome: 'Resumo do mês',
      colunas: [
        { cabecalho: 'Colaborador', chave: 'colaborador', largura: 34 },
        { cabecalho: 'Cargo', chave: 'cargo', largura: 18 },
        { cabecalho: 'Competência', chave: 'competencia', largura: 16 },
        { cabecalho: 'Cota (pts)', chave: 'resultado', formato: 'numero', largura: 14 },
        { cabecalho: 'Meta', chave: 'meta', formato: 'numero', largura: 12 },
        { cabecalho: 'Atingimento', chave: 'atingimento', formato: 'percentual', largura: 14 },
      ],
      linhas: lista.map((p) => ({
        colaborador: p.pessoa,
        cargo: p.cargo ?? '',
        competencia: mesRotulo(competencia),
        resultado: Number(p.resultado),
        meta: p.meta == null ? null : Number(p.meta),
        atingimento: p.meta ? Number(p.resultado) / Number(p.meta) : null,
      })),
    });
  }

  const arquivo = gerarXlsx(abas);
  const nome = `Cota ${mes}${detalhado ? ' - detalhado' : ''}.xlsx`;

  return new NextResponse(arquivo as unknown as BodyInit, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${nome}"`,
      'cache-control': 'no-store',
    },
  });
}
