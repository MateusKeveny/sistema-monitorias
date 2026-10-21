/**
 * "Colar do Hub" (2.1.0): a tabela de analistas do Hub copiada da tela (Ctrl+C)
 * e colada no volume da semana.
 *
 * O Hub não exporta: o texto copiado vem um valor por linha. Depois do
 * cabeçalho (que termina em "Devolvidos à Sol"), cada analista é um bloco:
 *
 *   nome · total · em atendimento · finalizados · [+N CSAT] · resolvidos · TMA ·
 *   TME · TME útil · maior gap · tratamento · CSAT · % rechamada · devolvidos · [%]
 *
 * "+N CSAT" e o percentual dos devolvidos só aparecem às vezes. O volume que
 * conta é o de **resolvidos** (no Hub, os resolvidos é que entram nos
 * finalizados) e o tempo de espera é o **TME útil** — decisão do gestor,
 * 21/10/2026.
 */

export type LinhaDoHub = { nome: string; resolvidos: number; tmaSeg: number | null; tmeUtilSeg: number | null };

/** "2h 30m", "33m 41s", "47m", "—" → segundos (null quando vazio). */
export function tempoDoHub(texto: string): number | null {
  const t = texto.trim();
  if (!t || t === '—' || t === '-') return null;
  const m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/i.exec(t);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

const ehValor = (x: string) =>
  /^-?[\d.,]+%?$/.test(x) || x === '—' || x === '-' || /^\+\d+\s*CSAT$/i.test(x) || tempoDoHub(x) != null;

const numero = (x: string | undefined) => {
  if (x == null || x === '—' || x === '-') return null;
  const n = Number(x.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export function lerColagemDoHub(texto: string): LinhaDoHub[] {
  const linhas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Começa depois do cabeçalho; sem cabeçalho (colou só as linhas), do começo.
  const fimDoCabecalho = linhas.findIndex((l) => /^Devolvidos/i.test(l));
  let i = fimDoCabecalho + 1;
  const saida: LinhaDoHub[] = [];
  while (i < linhas.length) {
    const nome = linhas[i++];
    if (ehValor(nome)) continue; // linha solta: não é nome
    const valores: string[] = [];
    while (i < linhas.length && ehValor(linhas[i])) valores.push(linhas[i++]);
    const v = valores.filter((x) => !/CSAT$/i.test(x));
    // total, em atendimento, finalizados, resolvidos, TMA, TME, TME útil, …
    if (v.length < 7) continue;
    saida.push({
      nome,
      resolvidos: numero(v[3]) ?? 0,
      tmaSeg: tempoDoHub(v[4]),
      tmeUtilSeg: tempoDoHub(v[6]),
    });
  }
  return saida;
}
