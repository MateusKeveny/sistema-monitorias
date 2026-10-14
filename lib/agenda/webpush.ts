/**
 * Web Push com a Web Crypto — sem biblioteca, para rodar no Worker.
 *
 * Duas normas:
 *   - RFC 8291: a mensagem é cifrada para o navegador (aes128gcm), com uma
 *     chave combinada entre a chave do aparelho (p256dh) e uma chave
 *     descartável gerada a cada envio;
 *   - RFC 8292 (VAPID): o envio é assinado com a chave do site, e o serviço de
 *     notificação (Google, Microsoft, Mozilla) só entrega o que vem assinado
 *     pela mesma chave usada na inscrição.
 *
 * As chaves VAPID nascem em `scripts/chaves-da-agenda.js`.
 */

export type Inscricao = { endpoint: string; p256dh: string; auth: string };
export type ChavesVapid = { publica: string; privada: string; contato: string };

type Bytes = Uint8Array<ArrayBuffer>;

const sutil = () => globalThis.crypto.subtle;
const texto = new TextEncoder();

export function deBase64Url(s: string): Bytes {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export function paraBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const juntar = (...partes: Uint8Array[]): Bytes => {
  const r = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { r.set(p, i); i += p.length; }
  return r;
};

async function hmac(chave: Bytes, dados: Bytes): Promise<Bytes> {
  const k = await sutil().importKey('raw', chave, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await sutil().sign('HMAC', k, dados));
}

/** HKDF de um bloco só (até 32 bytes), como nas duas normas. */
async function hkdf(sal: Bytes, ikm: Bytes, info: Bytes, tamanho: number): Promise<Bytes> {
  const prk = await hmac(sal, ikm);
  return (await hmac(prk, juntar(info, new Uint8Array([1])))).slice(0, tamanho);
}

/** Cifra o conteúdo para um aparelho (RFC 8291). */
export async function cifrar(conteudo: Bytes, inscricao: Inscricao): Promise<Bytes> {
  const chaveDoAparelho = deBase64Url(inscricao.p256dh);   // 65 bytes, não comprimida
  const segredoDoAparelho = deBase64Url(inscricao.auth);   // 16 bytes

  const local = await sutil().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const publicaLocal = new Uint8Array(await sutil().exportKey('raw', local.publicKey));
  const doAparelho = await sutil().importKey('raw', chaveDoAparelho, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const compartilhado = new Uint8Array(await sutil().deriveBits({ name: 'ECDH', public: doAparelho }, local.privateKey, 256));

  const ikm = await hkdf(segredoDoAparelho, compartilhado,
    juntar(texto.encode('WebPush: info\0'), chaveDoAparelho, publicaLocal), 32);
  const sal = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(sal, ikm, texto.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(sal, ikm, texto.encode('Content-Encoding: nonce\0'), 12);

  // Um registro só: o conteúdo seguido do delimitador de último registro (2).
  const chave = await sutil().importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cifrado = new Uint8Array(await sutil().encrypt({ name: 'AES-GCM', iv: nonce }, chave,
    juntar(conteudo, new Uint8Array([2]))));

  // Cabeçalho: sal (16) · tamanho do registro (4) · tamanho da chave (1) · chave local (65).
  const cabecalho = new Uint8Array(16 + 4 + 1 + 65);
  cabecalho.set(sal, 0);
  new DataView(cabecalho.buffer).setUint32(16, 4096);
  cabecalho[20] = 65;
  cabecalho.set(publicaLocal, 21);
  return juntar(cabecalho, cifrado);
}

/** Assinatura VAPID (JWT ES256) para a origem do serviço de notificação. */
export async function assinarVapid(endpoint: string, chaves: ChavesVapid, validadeSeg = 12 * 3600): Promise<string> {
  const publica = deBase64Url(chaves.publica);
  const jwk: JsonWebKey = {
    kty: 'EC', crv: 'P-256', d: chaves.privada,
    x: paraBase64Url(publica.slice(1, 33)), y: paraBase64Url(publica.slice(33, 65)),
  };
  const chave = await sutil().importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const cabecalho = paraBase64Url(texto.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corpo = paraBase64Url(texto.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + validadeSeg,
    sub: chaves.contato,
  })));
  // A Web Crypto já devolve a assinatura no formato do JWS (r‖s, 64 bytes).
  const assinatura = await sutil().sign({ name: 'ECDSA', hash: 'SHA-256' }, chave, texto.encode(`${cabecalho}.${corpo}`));
  return `${cabecalho}.${corpo}.${paraBase64Url(assinatura)}`;
}

/**
 * Entrega uma notificação. Devolve o status do serviço: 201 entregue;
 * 404 e 410 querem dizer que a inscrição morreu e deve ser apagada.
 */
export async function enviarPush(inscricao: Inscricao, conteudo: object, chaves: ChavesVapid,
  opcoes: { ttl?: number; urgencia?: 'normal' | 'high'; topico?: string } = {}): Promise<number> {
  const corpo = await cifrar(texto.encode(JSON.stringify(conteudo)), inscricao);
  const jwt = await assinarVapid(inscricao.endpoint, chaves);
  const cabecalhos: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'Content-Encoding': 'aes128gcm',
    TTL: String(opcoes.ttl ?? 3600),
    Urgency: opcoes.urgencia ?? 'high',
    Authorization: `vapid t=${jwt}, k=${chaves.publica}`,
  };
  // Tópico: uma notificação nova do mesmo assunto substitui a que não chegou.
  if (opcoes.topico) cabecalhos.Topic = opcoes.topico.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const r = await fetch(inscricao.endpoint, { method: 'POST', headers: cabecalhos, body: corpo });
  return r.status;
}

/** Selo do botão da notificação: prova que o "Concluir" veio de um aviso nosso. */
export async function seloDoItem(itemId: string, segredo: string): Promise<string> {
  return paraBase64Url(await hmac(texto.encode(segredo), texto.encode(`agenda:${itemId}`)));
}

/** Comparação sem atalho, para não vazar o selo pelo tempo de resposta. */
export function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
