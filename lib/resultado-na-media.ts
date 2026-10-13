import type { criarClienteServidor } from '@/lib/supabase/servidor';

type Db = Awaited<ReturnType<typeof criarClienteServidor>>;

/** O que cada pessoa levou para a média do cargo de referência. */
export type NaMedia = { valor: number; comAtestado: number | null };

/**
 * Resultado de cada pessoa como entrou na média dos cargos que recebem por
 * média — para a lista "como a média foi formada" fechar com a média.
 *
 * Duas regras moram aqui:
 *   - mês fechado é congelado: o resultado vem de `fechamentos_cota`, não do
 *     cálculo de hoje. Um peso alterado depois do fechamento (o do Analista,
 *     20 → 15 em 08/10/2026) mudava os nomes da lista e não a média;
 *   - a média não leva o atestado (migração 49): quem teve atestado entra pela
 *     pontuação antes do desconto. Setembro/2026: a Rayssa, com 1 dia, entrou
 *     com ~6.533 e não com os 6.322 do resultado.
 *
 * `resultados` = o que a tela já tem do cálculo ao vivo, por pessoa.
 */
export async function resultadosNaMedia(
  db: Db, competencia: string, congelado: boolean, resultados: Map<string, number>,
): Promise<Map<string, NaMedia>> {
  return aplicarNaMedia(await ajustesDaMedia(db, competencia, congelado), resultados);
}

/** O que muda o resultado ao vivo para o valor da média: congelado e atestado. */
export type AjustesDaMedia = { congelados: Map<string, number>; atestado: Map<string, number> };

/**
 * A parte de `resultadosNaMedia` que vai ao banco. Não depende dos
 * resultados, então as telas buscam junto com eles (1.39.4) — antes era uma
 * espera a mais, de ~0,8 s, depois da lista.
 */
export async function ajustesDaMedia(db: Db, competencia: string, congelado: boolean): Promise<AjustesDaMedia> {
  const congelados = new Map<string, number>();
  const atestado = new Map<string, number>();

  if (congelado) {
    const { data: fechados } = await db.from('fechamentos_cota')
      .select('id, pessoa_id, resultado').eq('mes_competencia', competencia);
    const pessoaDo = new Map((fechados ?? []).map((f) => [f.id as string, f.pessoa_id as string]));
    for (const f of fechados ?? []) congelados.set(f.pessoa_id as string, Number(f.resultado));
    if (pessoaDo.size) {
      const { data: linhas } = await db.from('fechamento_linhas').select('fechamento_id, cota')
        .eq('regra', 'atestado').in('fechamento_id', [...pessoaDo.keys()]);
      for (const l of linhas ?? []) {
        const p = pessoaDo.get(l.fechamento_id as string);
        if (p) atestado.set(p, (atestado.get(p) ?? 0) + Number(l.cota));
      }
    }
  } else {
    const { data: linhas } = await db.from('vw_extrato_cota').select('pessoa_id, cota')
      .eq('mes_competencia', competencia).eq('regra', 'atestado');
    for (const l of linhas ?? []) {
      const p = l.pessoa_id as string;
      atestado.set(p, (atestado.get(p) ?? 0) + Number(l.cota));
    }
  }
  return { congelados, atestado };
}

/** Os ajustes sobre os resultados ao vivo de cada pessoa. */
export function aplicarNaMedia(
  { congelados, atestado }: AjustesDaMedia, resultados: Map<string, number>,
): Map<string, NaMedia> {
  const final = new Map(resultados);
  for (const [p, v] of congelados) final.set(p, v);
  return new Map([...final].map(([p, valor]) => {
    const desconto = atestado.get(p) ?? 0;
    // O desconto é negativo: o valor da média é o resultado sem ele.
    return [p, desconto ? { valor: valor - desconto, comAtestado: valor } : { valor, comAtestado: null }];
  }));
}
