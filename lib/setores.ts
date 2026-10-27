/**
 * Setores e canais (2.10.0, migração 79) — a árvore do plano da 3.0.
 *
 * Nesta etapa o cadastro só decide, na importação do Hub, para qual canal vai
 * cada linha. O canal que o cálculo conhece continua sendo o `apelido`
 * ('huggy' / 'diretores').
 */

export type Setor = { id: number; nome: string; ativo: boolean; ordem: number };
export type Canal = {
  id: number; setor_id: number; nome: string; apelido: 'huggy' | 'diretores' | null;
  nomes_no_hub: string[]; ativo: boolean; ordem: number;
};

/** "Diretores-Expansão " → "diretores-expansao": como o nome do Hub é comparado. */
export const normalizarSetor = (v: unknown) => String(v ?? '').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** O que valia antes do cadastro — e vale se a migração 79 ainda não rodou. */
export const CANAIS_PADRAO: Pick<Canal, 'apelido' | 'nomes_no_hub' | 'nome'>[] = [
  { nome: 'Expansão', apelido: 'huggy', nomes_no_hub: ['Expansão'] },
  { nome: 'Diretores-Expansão', apelido: 'diretores', nomes_no_hub: ['Diretores-Expansão'] },
];

/** Nome do setor no Hub (normalizado) → canal do cálculo. Canal sem apelido fica de fora. */
export function mapaDoHub(canais: Pick<Canal, 'apelido' | 'nomes_no_hub'>[]): Record<string, 'huggy' | 'diretores'> {
  const m: Record<string, 'huggy' | 'diretores'> = {};
  for (const c of canais) {
    if (!c.apelido) continue;
    for (const n of c.nomes_no_hub) m[normalizarSetor(n)] = c.apelido;
  }
  return m;
}
