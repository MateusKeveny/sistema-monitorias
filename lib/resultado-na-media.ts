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
export async function ajustesDaMedia(
  db: Db, competencia: string, congelado: boolean,
  /** De onde vem o atestado do mês aberto: o resumo (migração 58) ou a view. */
  extrato: 'resumo_extrato' | 'vw_extrato_cota' = 'vw_extrato_cota',
): Promise<AjustesDaMedia> {
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
    const { data: linhas } = await db.from(extrato).select('pessoa_id, cota')
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

/** '2026-09-01' → '2026-08-26' (o primeiro dia do ciclo). */
const inicioDoCiclo = (mes: string) => {
  const d = new Date(`${mes}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.toISOString().slice(0, 8)}26`;
};

/**
 * Quem estava em cada cargo num mês fechado e se compôs a média — o que a
 * `vw_cota_mensal` dava, sem recalcular o mês (1.39.5). Pelas mesmas regras
 * da view: o resultado vem do fechamento (como já vinha, por ajustesDaMedia);
 * o cargo é o do cadastro na competência (`cargo_na_competencia`), não o
 * texto guardado no fechamento — agosto/2026, importado do cálculo externo,
 * traz o Matheus como Analista, cargo que no cadastro só vale de setembro; o
 * nome é o atual; "compõe a média" é `mes_inteiro_na_operacao` (migração
 * 23): na operação do dia 26 do mês anterior ao dia 25 da competência; e só
 * entra quem tem pontos do mês no sistema, como na view (agosto/2026 veio da
 * planilha externa: quem não tem ponto nenhum lá fica fora da lista, como
 * sempre ficou). Quem tem pontos sai da `vw_extrato_direto` (~0,4 s), sem a
 * média nem o atestado, que eram o peso do cálculo.
 */
export async function equipeCongelada(db: Db, competencia: string) {
  const [{ data: fechados }, { data: pessoas }, { data: historico }, { data: cargos }, { data: comPontos }] = await Promise.all([
    db.from('fechamentos_cota').select('pessoa_id, resultado').eq('mes_competencia', competencia),
    db.from('pessoas').select('id, nome, admitido_em, desligado_em'),
    db.from('cargos_da_pessoa').select('pessoa_id, cargo_id, desde').lte('desde', competencia),
    db.from('cargos').select('id, nome'),
    db.from('vw_extrato_direto').select('pessoa_id').eq('mes_competencia', competencia),
  ]);
  const pontuou = new Set(((comPontos ?? []) as { pessoa_id: string }[]).map((r) => r.pessoa_id));
  // O cargo mais recente com "desde" até a competência, por pessoa.
  const nomeDoCargo = new Map(((cargos ?? []) as { id: number; nome: string }[]).map((c) => [c.id, c.nome]));
  const cargoDe = new Map<string, { desde: string; cargo: string | null }>();
  for (const h of (historico ?? []) as { pessoa_id: string; cargo_id: number; desde: string }[]) {
    const atual = cargoDe.get(h.pessoa_id);
    if (!atual || h.desde > atual.desde) cargoDe.set(h.pessoa_id, { desde: h.desde, cargo: nomeDoCargo.get(h.cargo_id) ?? null });
  }
  const inicio = inicioDoCiclo(competencia);
  const fim = `${competencia.slice(0, 8)}25`;
  const pessoaDe = new Map(((pessoas ?? []) as
    { id: string; nome: string; admitido_em: string | null; desligado_em: string | null }[]).map((p) => [p.id, p]));
  return ((fechados ?? []) as { pessoa_id: string; resultado: number }[])
    .filter((f) => pessoaDe.has(f.pessoa_id) && cargoDe.has(f.pessoa_id) && pontuou.has(f.pessoa_id))
    .map((f) => {
      const p = pessoaDe.get(f.pessoa_id)!;
      return {
        pessoa_id: f.pessoa_id,
        pessoa: p.nome,
        cargo: cargoDe.get(f.pessoa_id)!.cargo,
        resultado: Number(f.resultado),
        compoe_media: (p.admitido_em == null || p.admitido_em <= inicio)
          && (p.desligado_em == null || p.desligado_em >= fim),
      };
    });
}
