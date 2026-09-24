/**
 * Qual sistema este endereço serve.
 *
 * O mesmo código é publicado em dois Workers — `painel-monitorias` e
 * `painel-performance` — e cada um mostra só o seu sistema. A escolha é pelo
 * endereço, e não por variável de ambiente, porque o middleware do Next pode
 * ter o `process.env` congelado no build: com o endereço não há como os dois
 * sites saírem iguais por engano.
 *
 * Para juntar os sistemas de novo, basta este arquivo devolver sempre o mesmo
 * valor e remover a separação do middleware.
 *
 * Arquivo puro (sem `next/headers`): é usado também no middleware e no
 * navegador.
 */
export type Sistema = 'monitorias' | 'cota';

export const NOME_SISTEMA: Record<Sistema, string> = {
  monitorias: 'Monitorias de Qualidade',
  cota: 'Painel de Performance',
};

/** Links do Performance para uma monitoria abrem no site das monitorias. */
export const ENDERECO_MONITORIAS = 'https://painel-monitorias.expansao.workers.dev';

/** Página inicial do site de cota. */
export const INICIO_COTA = '/cota';

/**
 * Caminhos que só existem no site de cota: as telas e as rotas de API delas.
 *
 * `/api/cota` precisa estar aqui. Sem ele, o download da exportação era
 * redirecionado para a tela inicial e o arquivo nunca chegava a ser gerado —
 * a rota é de API, mas mora no mesmo sistema das telas.
 */
const EXCLUSIVOS_DA_COTA = ['/cota', '/api/cota'];

/** Caminhos que o site de cota atende; todo o resto é das monitorias. */
const CAMINHOS_COTA = [...EXCLUSIVOS_DA_COTA, '/login', '/auth', '/definir-senha'];

export function sistemaDoHost(host: string | null | undefined): Sistema {
  if (host?.toLowerCase().startsWith('painel-performance.')) return 'cota';
  // Só para desenvolvimento local, onde o endereço é localhost.
  return process.env.SISTEMA === 'cota' ? 'cota' : 'monitorias';
}

const dentro = (caminho: string, base: string) =>
  caminho === base || caminho.startsWith(`${base}/`);

/** O caminho pertence a outro sistema e deve ser redirecionado. */
export function caminhoForaDoSistema(sistema: Sistema, caminho: string): boolean {
  return sistema === 'cota'
    ? !CAMINHOS_COTA.some((base) => dentro(caminho, base))
    : EXCLUSIVOS_DA_COTA.some((base) => dentro(caminho, base));
}
