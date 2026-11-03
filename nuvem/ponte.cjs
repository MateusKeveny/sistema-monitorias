/**
 * Porta de entrada do painel no Google Cloud Run (hospedagem nova, 11/2026).
 *
 * Os endereços continuam os da Cloudflare (painel-performance, painel-monitorias,
 * painel-agenda .expansao.workers.dev): lá, um Worker mínimo só repassa cada
 * acesso para cá (nuvem/repasse-worker.js) — repassar gasta menos de 1 ms e não
 * esbarra no limite de 10 ms do plano gratuito, que derrubava as telas (1102).
 *
 * O Cloud Run só aceita o pedido com o endereço dele (…run.app); o endereço de
 * verdade vem no cabeçalho x-painel-host. Esta porta devolve esse endereço ao
 * cabeçalho host antes de entregar ao Next, que escolhe o sistema por ele
 * (lib/sistema.ts) e monta os redirecionamentos com ele. Sem a chave do
 * repasse (CHAVE_DA_PONTE), o pedido é recusado: o endereço run.app não vira
 * uma segunda entrada do sistema.
 *
 * O Next (saída standalone) roda por dentro, numa porta local.
 */
const http = require('node:http');

const PORTA = Number(process.env.PORT || 8080);
const PORTA_DO_NEXT = 3000;
const CHAVE = process.env.CHAVE_DA_PONTE;

// O server.js do standalone lê PORT e HOSTNAME ao carregar.
process.env.PORT = String(PORTA_DO_NEXT);
process.env.HOSTNAME = '127.0.0.1';
require('./server.js');

const porta = http.createServer((pedido, resposta) => {
  if (!CHAVE || pedido.headers['x-painel-chave'] !== CHAVE) {
    resposta.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    resposta.end('Acesse pelo endereço do painel.');
    return;
  }
  const cabecalhos = { ...pedido.headers };
  if (cabecalhos['x-painel-host']) cabecalhos.host = cabecalhos['x-painel-host'];
  delete cabecalhos['x-painel-host'];
  delete cabecalhos['x-painel-chave'];
  cabecalhos['x-forwarded-proto'] = 'https';
  cabecalhos['x-forwarded-host'] = cabecalhos.host;

  const interno = http.request(
    { host: '127.0.0.1', port: PORTA_DO_NEXT, method: pedido.method, path: pedido.url, headers: cabecalhos },
    (r) => { resposta.writeHead(r.statusCode || 502, r.rawHeaders); r.pipe(resposta); },
  );
  interno.on('error', () => {
    // O Next ainda subindo (primeiros segundos de uma instância nova).
    if (!resposta.headersSent) resposta.writeHead(503, { 'retry-after': '2' });
    resposta.end();
  });
  pedido.pipe(interno);
});

// Só abre a porta quando o Next já responde: o Cloud Run considera a
// instância pronta ao conseguir conectar, e o primeiro acesso não leva 503.
(function esperarONext() {
  const teste = http.get({ host: '127.0.0.1', port: PORTA_DO_NEXT, path: '/api/saude' }, (r) => {
    r.resume();
    porta.listen(PORTA, () => console.log(`ponte na porta ${PORTA}, Next na ${PORTA_DO_NEXT}`));
  });
  teste.on('error', () => setTimeout(esperarONext, 100));
})();
