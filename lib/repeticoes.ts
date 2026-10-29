import { mesAnterior } from '@/lib/competencia';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { conferida } from '@/lib/consultas';

/**
 * "O que mais se repete" (2.6.0; equipe na 2.7.0 / 5.7.0): os critérios
 * reprovados nos últimos 3 meses, contados mês a mês. A falha crítica entra
 * como um critério à parte — o motivo do zeramento não é critério reprovado.
 */

export const FALHA_CRITICA = 'Falha crítica';

/** Os 3 meses que terminam em `ultimo`, do mais antigo ao mais recente. */
export const janelaDe = (ultimo: string) => [mesAnterior(mesAnterior(ultimo)), mesAnterior(ultimo), ultimo];

export type Ocorrencia = { criterio: string; mes: string; data: string; texto: string | null; pessoa: string };

export type LinhaRepeticao = {
  criterio: string;
  /** Contagem em cada mês da janela, do mais antigo ao mais recente. */
  meses: number[];
  total: number;
  /** Quantas pessoas tiveram o critério no mês mais recente. */
  pessoas: number;
  ultima: { data: string; texto: string | null };
  /**
   * Tendência pela taxa (vezes por monitoria do mês), não pela contagem: o mês
   * em andamento tem menos monitorias e pareceria sempre melhor.
   */
  tendencia: 'aumentou' | 'diminuiu' | 'estavel' | 'resolvido';
};

/**
 * Diferença de taxa que conta como mudança: um quarto da maior das duas, e
 * no mínimo 2 pontos — abaixo disso é ruído, estável. Proporcional porque na
 * equipe as taxas são pequenas e na pessoa uma ocorrência já pesa muito.
 */
const margem = (a: number, b: number) => Math.max(0.02, 0.25 * Math.max(a, b));

/** Ordem: os que mais aparecem e, no empate, o mais recente. */
export function repeticoes(ocorrencias: Ocorrencia[], janela: string[], monitoriasPorMes: number[]): LinhaRepeticao[] {
  const porCriterio = new Map<string, LinhaRepeticao & { quem: Set<string> }>();
  for (const o of ocorrencias) {
    const i = janela.indexOf(o.mes);
    if (i < 0) continue;
    let l = porCriterio.get(o.criterio);
    if (!l) {
      l = { criterio: o.criterio, meses: [0, 0, 0], total: 0, pessoas: 0, ultima: { data: o.data, texto: o.texto }, tendencia: 'estavel', quem: new Set() };
      porCriterio.set(o.criterio, l);
    }
    l.meses[i]++;
    l.total++;
    if (i === 2) l.quem.add(o.pessoa);
    if (o.data > l.ultima.data) l.ultima = { data: o.data, texto: o.texto };
  }
  return [...porCriterio.values()]
    .map(({ quem, ...l }) => ({ ...l, pessoas: quem.size, tendencia: tendenciaDe(l.meses, monitoriasPorMes) }))
    .sort((a, b) => b.total - a.total || b.ultima.data.localeCompare(a.ultima.data));
}

/** As ocorrências de uma pessoa, das monitorias e dos critérios reprovados já carregados pela tela. */
export function ocorrenciasDaPessoa(
  monitorias: { id: string; mes_referencia: string; data_atendimento: string; zerado: boolean; motivo_zeramento: string | null }[],
  reprovados: Map<string, { criterio: string; observacao: string | null }[]>,
): Ocorrencia[] {
  return monitorias.flatMap((m) => [
    ...(m.zerado ? [{ criterio: FALHA_CRITICA, texto: m.motivo_zeramento }] : []),
    ...(reprovados.get(m.id) ?? []).map((a) => ({ criterio: a.criterio, texto: a.observacao })),
  ].map((o) => ({ ...o, mes: m.mes_referencia, data: m.data_atendimento, pessoa: '' })));
}

function tendenciaDe([antes, anterior, atual]: number[], porMes: number[]): LinhaRepeticao['tendencia'] {
  if (antes > 0 && anterior === 0 && atual === 0) return 'resolvido';
  const taxa = (q: number, n: number) => (n ? q / n : 0);
  const agora = taxa(atual, porMes[2]);
  const antes1 = taxa(anterior, porMes[1]);
  const m = margem(agora, antes1);
  return agora - antes1 >= m ? 'aumentou' : antes1 - agora >= m ? 'diminuiu' : 'estavel';
}

/** Quantas monitorias houve em cada mês da janela. */
export const monitoriasPorMes = (meses: string[], janela: string[]) => janela.map((j) => meses.filter((m) => m === j).length);

type Db = Awaited<ReturnType<typeof criarClienteServidor>>;

/** Lê em páginas: na equipe, 3 meses passam do limite de 1.000 linhas por consulta. */
async function paginado<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> {
  const tudo: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data } = await conferida(consulta(de, de + 999) as PromiseLike<{ data: unknown; error: { message: string } | null }>);
    const pagina = (data ?? []) as T[];
    tudo.push(...pagina);
    if (pagina.length < 1000) return tudo;
  }
}

/**
 * As ocorrências da equipe toda na janela, e quantas pessoas foram
 * monitoradas no mês mais recente (o "de N" do quadro).
 */
export async function repeticoesDaEquipe(db: Db, janela: string[], setor?: number) {
  const [monitorias, itens] = await Promise.all([
    paginado<{ operador_id: string; mes_referencia: string; data_atendimento: string; zerado: boolean; motivo_zeramento: string | null }>(
      // Com setor (Monitorias 6.0), só as monitorias dele.
      (de, ate) => { const q = db.from('vw_monitorias').select('operador_id, mes_referencia, data_atendimento, zerado, motivo_zeramento')
        .in('mes_referencia', janela); return (setor ? q.eq('setor_id', setor) : q).order('id').range(de, ate); }),
    paginado<{ operador_id: string; mes_referencia: string; data_atendimento: string; criterio: string; observacao: string | null }>(
      (de, ate) => { const q = db.from('vw_feedback_individual').select('operador_id, mes_referencia, data_atendimento, criterio, observacao')
        .in('mes_referencia', janela).eq('conforme', false);
        return (setor ? q.eq('setor_id', setor) : q).order('monitoria_id').order('criterio_ordem').range(de, ate); }),
  ]);
  const ocorrencias: Ocorrencia[] = [
    ...monitorias.filter((m) => m.zerado).map((m) => ({
      criterio: FALHA_CRITICA, mes: m.mes_referencia, data: m.data_atendimento, texto: m.motivo_zeramento, pessoa: m.operador_id,
    })),
    ...itens.map((a) => ({
      criterio: a.criterio, mes: a.mes_referencia, data: a.data_atendimento, texto: a.observacao, pessoa: a.operador_id,
    })),
  ];
  const monitoradas = new Set(monitorias.filter((m) => m.mes_referencia === janela[2]).map((m) => m.operador_id)).size;
  const porMes = monitoriasPorMes(monitorias.map((m) => m.mes_referencia), janela);
  return { linhas: repeticoes(ocorrencias, janela, porMes), monitoradas };
}
