/**
 * Setores e filas (2.10.0, migração 79) — a árvore do plano da 3.0.
 *
 * Na tela é "fila"; no banco a tabela continua `canais_do_setor`. O `apelido`
 * é o texto que volume, lançamentos e avaliações gravam: 'huggy' e
 * 'diretores' nas duas de sempre, 'fila_<id>' nas novas (migração 85). Desde
 * a etapa 3 (84) o cálculo lê as regras da própria fila.
 */

export type Setor = {
  id: number; nome: string; ativo: boolean; ordem: number;
  /** Monitorias ligadas no setor e a régua dele (migrações 86 e 87). */
  monitorias?: boolean; regra_monitoria?: string | null;
  /** Quantas monitorias por semana (Monitorias 6.0, migração 89). */
  monitorias_por_semana?: number;
};
export type Canal = {
  id: number; setor_id: number; nome: string; apelido: string | null;
  nomes_no_hub: string[]; ativo: boolean; ordem: number;
  /** Regras da fila (migração 84). Sem regra de finalizado = fila ainda sem regras. */
  regra_finalizado?: string | null; grupo_tme?: string | null;
  grupo_csat?: string; grupo_nota?: string;
  /** Copiou as métricas desta fila e acompanha as mudanças dela (85). */
  copia_de?: number | null;
};

/** "Diretores-Expansão " → "diretores-expansao": como o nome do Hub é comparado. */
export const normalizarSetor = (v: unknown) => String(v ?? '').normalize('NFD')
  .replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** O que valia antes do cadastro — e vale se a migração 79 ainda não rodou. */
export const CANAIS_PADRAO: Pick<Canal, 'apelido' | 'nomes_no_hub' | 'nome'>[] = [
  { nome: 'Expansão', apelido: 'huggy', nomes_no_hub: ['Expansão'] },
  { nome: 'Diretores-Expansão', apelido: 'diretores', nomes_no_hub: ['Diretores-Expansão'] },
];

/** Nome da fila na tela, pelo apelido gravado nos registros. */
export function nomeDaFila(filas: Pick<Canal, 'apelido' | 'nome'>[], apelido: string | null | undefined): string {
  if (!apelido) return '—';
  return filas.find((f) => f.apelido === apelido)?.nome
    ?? CANAIS_PADRAO.find((f) => f.apelido === apelido)?.nome ?? apelido;
}

/** Nome do setor no Hub (normalizado) → apelido da fila. Fila sem apelido fica de fora. */
export function mapaDoHub(canais: Pick<Canal, 'apelido' | 'nomes_no_hub'>[]): Record<string, string> {
  const m: Record<string, string> = {};
  for (const c of canais) {
    if (!c.apelido) continue;
    for (const n of c.nomes_no_hub) m[normalizarSetor(n)] = c.apelido;
  }
  return m;
}
