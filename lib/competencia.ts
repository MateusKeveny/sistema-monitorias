import { cache } from 'react';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { hojeNoBrasil, mesDeCompetencia } from '@/lib/formatar';

export type Competencia = {
  /** A competência que a tela mostra, no formato '2026-09-01'. */
  competencia: string;
  /** A competência do calendário, a de hoje. */
  atual: string;
  /**
   * A tela abriu na competência anterior por falta de dado na atual — e não
   * porque alguém escolheu. Serve para a tela dizer por que não está no mês
   * de hoje.
   */
  emAberto: boolean;
};

/** '2026-10-01' → '2026-09-01'. */
function mesAnterior(competencia: string) {
  let ano = Number(competencia.slice(0, 4));
  let mes = Number(competencia.slice(5, 7)) - 1;
  if (mes === 0) { mes = 12; ano -= 1; }
  return `${ano}-${String(mes).padStart(2, '0')}-01`;
}

/**
 * Qual competência a tela abre quando ninguém escolheu uma.
 *
 * No dia 26 o ciclo vira, mas o mês que acabou ainda não foi fechado e o novo
 * ainda não tem nada: abrir no mês do calendário mostrava um painel vazio
 * justo quando o gestor precisa conferir o anterior para fechar. Então, até o
 * mês anterior ser fechado ou o novo ter algum dado, a tela abre no anterior.
 *
 * "Algum dado" é volume, avaliação, lançamento ou monitoria. O presencial fica
 * de fora de propósito: o operador registra desde o primeiro dia do ciclo, e
 * um atendimento registrado no dia 26 viraria o mês de todo mundo antes de
 * existir resultado para ver.
 *
 * As consultas respeitam a RLS: para o operador, "fechado" e "tem dado" são
 * sobre ele mesmo, que é o que a tela dele mostra.
 */
const competenciaPadrao = cache(async (): Promise<Competencia> => {
  const atual = mesDeCompetencia(hojeNoBrasil());
  const anterior = mesAnterior(atual);
  // O ciclo da competência atual: do dia 26 do mês anterior ao dia 25.
  const de = `${anterior.slice(0, 8)}26`;
  const ate = `${atual.slice(0, 8)}25`;

  const db = await criarClienteServidor();
  const contar = { count: 'exact', head: true } as const;
  const [fechado, ...dados] = await Promise.all([
    db.from('fechamentos_cota').select('id', contar).eq('mes_competencia', anterior),
    db.from('volume_semanal').select('id', contar).eq('mes_competencia', atual),
    db.from('avaliacoes').select('id', contar).gte('data', de).lte('data', ate),
    db.from('lancamentos').select('id', contar).eq('mes_competencia', atual),
    db.from('monitorias').select('id', contar).eq('mes_referencia', atual),
  ]);
  const existe = (r: { count: number | null }) => (r.count ?? 0) > 0;

  const emAberto = !existe(fechado) && !dados.some(existe);
  return { competencia: emAberto ? anterior : atual, atual, emAberto };
});

/**
 * A competência pedida na URL (`?mes=2026-09`) ou, sem pedido, a padrão.
 * Pedido explícito vale sempre, mesmo que seja um mês vazio.
 */
export async function resolverCompetencia(mes?: string): Promise<Competencia> {
  if (/^\d{4}-\d{2}$/.test(mes ?? '')) {
    return { competencia: `${mes}-01`, atual: mesDeCompetencia(hojeNoBrasil()), emAberto: false };
  }
  return competenciaPadrao();
}
