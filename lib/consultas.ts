/**
 * Falha do banco não pode virar "vazio" na tela (1.41.1).
 *
 * As telas liam só o `data` das consultas: quando o banco falhava ou estourava
 * o tempo (statement timeout, visto em 13/10/2026 com páginas pesadas ao mesmo
 * tempo), o `data` vinha nulo e a tela mostrava lista vazia ou "Sem
 * pontuação" — um zero falso, sem aviso. Nas telas de números, a falha agora
 * vira erro, e a tela de erro oferece "Tentar de novo".
 *
 * Falta de permissão (42501) fica de fora de propósito: para o atendente, a
 * regra de acesso devolve "nada" e a tela já trata isso; virar erro ali
 * quebraria a tela dele por uma consulta que nunca foi para ele.
 */
type Resultado = { error?: { message: string; code?: string } | null } | null | undefined;

const SEM_PERMISSAO = '42501';

const falhou = (r: Resultado) =>
  r != null && typeof r === 'object' && 'error' in r && r.error != null && r.error.code !== SEM_PERMISSAO;

/** Lança erro se alguma das consultas falhou no banco. */
export function semFalha(...resultados: Resultado[]): void {
  const r = resultados.find(falhou);
  if (r) throw new Error(`O banco não respondeu: ${r.error!.message}`);
}

/** O `data` de uma consulta, ou erro se ela falhou (para usar em `.then`). */
export function dados<T>(r: { data: T; error?: { message: string; code?: string } | null }): T {
  semFalha(r);
  return r.data;
}

/**
 * `Promise.all` que confere as falhas: devolve o mesmo que ele (as telas
 * continuam lendo `{ data }` como antes) e lança erro se alguma consulta
 * falhou no banco. Listas dentro da lista (várias consultas juntas) também
 * são conferidas.
 */
export async function todas<T extends readonly unknown[] | []>(
  valores: T,
): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }> {
  const r = await Promise.all(valores);
  semFalha(...(r as unknown[]).flatMap((x) => (Array.isArray(x) ? x : [x])) as Resultado[]);
  return r as { -readonly [P in keyof T]: Awaited<T[P]> };
}

/** Uma consulta só, conferida: `await conferida(db.from(…)…)`. */
export async function conferida<T>(consulta: PromiseLike<T>): Promise<T> {
  const r = await consulta;
  semFalha(r as Resultado);
  return r;
}
