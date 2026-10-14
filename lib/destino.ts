/**
 * Para onde voltar depois do login ou da renovação da sessão (1.41.1).
 *
 * Só vale endereço do próprio site. Antes bastava começar com "/", e
 * "//outro-site.com" (ou "/\outro-site.com", que o navegador lê igual) passava:
 * um link verdadeiro do painel levaria a pessoa, logo depois de digitar a
 * senha, para uma página de fora. Aqui o endereço é interpretado como o
 * navegador faria, e só segue se continuar no mesmo site.
 */
export function destinoInterno(pedido: string | null | undefined, padrao = '/'): string {
  if (!pedido || !pedido.startsWith('/')) return padrao;
  try {
    const base = 'http://mesmo-site.invalid';
    const url = new URL(pedido, base);
    if (url.origin !== base) return padrao;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return padrao;
  }
}
