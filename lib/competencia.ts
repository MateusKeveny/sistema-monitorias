import { cache } from 'react';
import { cookies } from 'next/headers';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { hojeNoBrasil, mesDeCompetencia, mesValido } from '@/lib/formatar';

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
export function mesAnterior(competencia: string) {
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
 * mês anterior ser fechado, a tela abre no anterior.
 *
 * Só o fechamento vira o mês (2.9.1, pedido do gestor): antes, o primeiro dado
 * do mês novo (volume, avaliação, lançamento ou monitoria) também virava, e
 * o mês em fechamento sumia das telas no meio da conferência.
 *
 * As consultas respeitam a RLS: para o operador, "fechado" e "tem dado" são
 * sobre ele mesmo, que é o que a tela dele mostra.
 */
const competenciaPadrao = cache(async (): Promise<Competencia> => {
  const atual = mesDeCompetencia(hojeNoBrasil());
  const anterior = mesAnterior(atual);

  const db = await criarClienteServidor();
  const { count: fechado } = await db.from('fechamentos_cota')
    .select('id', { count: 'exact', head: true }).eq('mes_competencia', anterior);

  const emAberto = (fechado ?? 0) === 0;
  return { competencia: emAberto ? anterior : atual, atual, emAberto };
});

/**
 * A competência pedida na URL (`?mes=2026-09`), a escolhida há pouco em outra
 * tela (cookie "mes", 3.0) ou, sem nenhuma das duas, a padrão. Pedido
 * explícito vale sempre, mesmo que seja um mês vazio.
 */
export async function resolverCompetencia(mes?: string): Promise<Competencia> {
  const escolhido = mesValido(mes) ? mes : (await cookies()).get('mes')?.value;
  if (mesValido(escolhido)) {
    return { competencia: `${escolhido}-01`, atual: mesDeCompetencia(hojeNoBrasil()), emAberto: false };
  }
  return competenciaPadrao();
}
