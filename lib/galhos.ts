/**
 * Galhos das filas (4.14.0, migração 113): as filas de um setor agrupadas só
 * para a leitura — Expansão (Expansão, Diretores-Expansão, iGreen Mob) e
 * Marketing (Cruzeiro, Experience, Marketing, Store). Nenhum ponto muda.
 *
 * Também conserta o rótulo das filas que usam as regras de outra: o iGreen Mob
 * pontua com "huggy_atendimento", cujo rótulo é "Finalizado Expansão" — no
 * Início e no Extrato o Mob aparecia como se fosse a Expansão e "sumia".
 */

export type FilaComGalho = { apelido: string | null; nome: string; galho?: string | null; ordem?: number | null };

type Item = { origem: string | null; cota: number };

export type FilaNoGalho<T> = { apelido: string; nome: string; cota: number; itens: T[] };
export type Galho<T> = { nome: string; cota: number; filas: FilaNoGalho<T>[]; /** Uma fila só, com o mesmo nome do galho: sem subtítulo. */ simples: boolean };

/** Nome do galho de cada linha sem fila (monitoria, presencial, média). */
export const GALHO_GERAL = 'Geral';

/**
 * O rótulo da linha na fila dela: "Finalizado Expansão" lançado no iGreen Mob
 * vira "Finalizado iGreen Mob". Só troca quando a regra é o finalizado de
 * outra fila (o nome dela no fim do rótulo).
 */
export function rotuloNaFila(rotulo: string, origem: string | null, filas: FilaComGalho[]) {
  if (!origem) return rotulo;
  const daLinha = filas.find((f) => f.apelido === origem);
  const m = /^(Finalizado|Atendimento)\s+(.+)$/.exec(rotulo);
  if (!daLinha || !m) return rotulo;
  const deOutra = filas.some((f) => f.apelido !== origem && m[2] === f.nome);
  return deOutra ? `${m[1]} ${daLinha.nome}` : rotulo;
}

/**
 * Agrupa itens (com origem e cota) em galhos → filas, na ordem do cadastro.
 * O que não tem fila vai para o galho "Geral", no fim. Fila sem cadastro
 * (bypass antigo, outro setor) fica num galho com o próprio nome.
 */
export function montarGalhos<T extends Item>(itens: T[], filas: FilaComGalho[], nomeDaFila: (apelido: string) => string): Galho<T>[] {
  const ordemDaFila = (a: string) => {
    const i = filas.findIndex((f) => f.apelido === a);
    return i < 0 ? 999 : i;
  };
  const galhoDa = (origem: string | null) => {
    if (!origem) return GALHO_GERAL;
    const f = filas.find((x) => x.apelido === origem);
    return f?.galho?.trim() || f?.nome || nomeDaFila(origem);
  };
  const porGalho = new Map<string, Map<string, FilaNoGalho<T>>>();
  for (const item of itens) {
    const g = galhoDa(item.origem);
    const chave = item.origem ?? '';
    const filasDoGalho = porGalho.get(g) ?? new Map<string, FilaNoGalho<T>>();
    const fila = filasDoGalho.get(chave) ?? { apelido: chave, nome: item.origem ? nomeDaFila(item.origem) : GALHO_GERAL, cota: 0, itens: [] };
    fila.itens.push(item);
    fila.cota += Number(item.cota);
    filasDoGalho.set(chave, fila);
    porGalho.set(g, filasDoGalho);
  }
  const galhos = [...porGalho].map(([nome, mapa]) => {
    const filasDoGalho = [...mapa.values()].sort((a, b) => ordemDaFila(a.apelido) - ordemDaFila(b.apelido));
    return {
      nome,
      cota: filasDoGalho.reduce((a, f) => a + f.cota, 0),
      filas: filasDoGalho,
      simples: filasDoGalho.length === 1 && filasDoGalho[0].nome === nome,
    };
  });
  const primeira = (g: Galho<T>) => g.nome === GALHO_GERAL ? 10_000 : Math.min(...g.filas.map((f) => ordemDaFila(f.apelido)));
  return galhos.sort((a, b) => primeira(a) - primeira(b));
}

/** A opção do seletor de fila do Início (4.14.0): todas, um galho inteiro ou uma fila. */
export type OpcaoDeFila = { chave: string; rotulo: string; nivel: 0 | 1; detalhe?: string; filas: string[] };

/** Chave da opção "Todas as filas" — o resumo geral, que abre o Início do gestor. */
export const TODAS_AS_FILAS = 'todas';

/**
 * As opções do seletor, em árvore: "Todas as filas", depois cada galho (as
 * filas dele somadas) com as filas embaixo; fila sem galho fica sozinha.
 * Com uma fila só, só ela.
 */
export function opcoesDeFila(filas: { apelido: string; nome: string; galho?: string | null }[]): OpcaoDeFila[] {
  const sozinha = (f: { apelido: string; nome: string }, nivel: 0 | 1 = 0): OpcaoDeFila =>
    ({ chave: f.apelido, rotulo: f.nome, nivel, filas: [f.apelido] });
  if (filas.length < 2) return filas.map((f) => sozinha(f));
  const opcoes: OpcaoDeFila[] = [{
    chave: TODAS_AS_FILAS, rotulo: 'Todas as filas', nivel: 0, detalhe: `${filas.length} filas`, filas: filas.map((f) => f.apelido),
  }];
  const vistos = new Set<string>();
  for (const f of filas) {
    const g = f.galho?.trim();
    if (!g) { opcoes.push(sozinha(f)); continue; }
    if (vistos.has(g)) continue;
    vistos.add(g);
    const doGalho = filas.filter((x) => x.galho?.trim() === g);
    if (doGalho.length === 1) { opcoes.push(sozinha(f)); continue; }
    opcoes.push({ chave: `galho:${g}`, rotulo: g, nivel: 0, detalhe: `${doGalho.length} filas`, filas: doGalho.map((x) => x.apelido) });
    for (const x of doGalho) opcoes.push(sozinha(x, 1));
  }
  return opcoes;
}
