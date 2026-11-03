/**
 * Repasse da Cloudflare para o Cloud Run (hospedagem nova, 11/2026).
 *
 * O endereço continua o mesmo; este Worker só entrega o pedido ao servidor do
 * Google e devolve a resposta. Não monta página nenhuma, por isso fica muito
 * abaixo do limite de 10 ms do plano gratuito (o erro 1102).
 *
 *   DESTINO          endereço do Cloud Run (…run.app)
 *   CHAVE_DA_PONTE   segredo combinado com o Cloud Run (nuvem/ponte.cjs)
 *   HOST_DO_SISTEMA  opcional: o endereço que o painel deve "ver" — na cópia de
 *                    teste, o do Performance oficial; sem ele, o do próprio Worker.
 */
export default {
  async fetch(pedido, env) {
    const url = new URL(pedido.url);
    const destino = new URL(url.pathname + url.search, env.DESTINO);
    const cabecalhos = new Headers(pedido.headers);
    cabecalhos.set('x-painel-host', env.HOST_DO_SISTEMA || url.host);
    cabecalhos.set('x-painel-chave', env.CHAVE_DA_PONTE);
    const ip = pedido.headers.get('cf-connecting-ip');
    if (ip) cabecalhos.set('x-forwarded-for', ip);
    return fetch(destino, {
      method: pedido.method,
      headers: cabecalhos,
      body: pedido.method === 'GET' || pedido.method === 'HEAD' ? undefined : pedido.body,
      redirect: 'manual',
    });
  },
};
