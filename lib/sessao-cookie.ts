/**
 * Lê a sessão do Supabase direto do cookie, sem ir à rede (middleware).
 *
 * O cookie do @supabase/ssr é `sb-<projeto>-auth-token`, às vezes partido em
 * pedaços (`.0`, `.1`…) quando passa do tamanho de um cookie; o valor é
 * "base64-" + o JSON da sessão em base64url. Daqui só sai a validade
 * (`expires_at`, em segundos): quem confere a pessoa de verdade é cada tela,
 * com `getUser` no Supabase.
 *
 * Por que não renovar no middleware (1.39.2): renovar troca o passe antigo
 * por um novo, e o novo volta ao navegador na resposta. Com o erro 1102
 * cortando a resposta, o passe novo se perdia e o antigo já estava
 * invalidado — a pessoa caía no login. A renovação agora é do navegador,
 * direto com o Supabase (ver /auth/renovar e ManterSessao).
 */
type Cookie = { name: string; value: string };

// `projeto` restringe ao cookie de um projeto Supabase só — a agenda tem o
// dela (supabase/agenda/), e o de um painel não pode valer como sessão lá.
const ehDaSessao = (nome: string, projeto?: string) =>
  nome.startsWith(projeto ? `sb-${projeto}-` : 'sb-') && /-auth-token(\.\d+)?$/.test(nome);

export function temCookieDeSessao(cookies: Cookie[], projeto?: string): boolean {
  return cookies.some((c) => ehDaSessao(c.name, projeto));
}

/** Validade da sessão em segundos (época Unix), ou null se não der para ler. */
export function validadeDaSessao(cookies: Cookie[], projeto?: string): number | null {
  const partes = cookies.filter((c) => ehDaSessao(c.name, projeto));
  if (!partes.length) return null;
  // Inteiro, ou os pedaços .0, .1… na ordem.
  const inteiro = partes.find((c) => !/\.\d+$/.test(c.name));
  const valor = inteiro
    ? inteiro.value
    : partes
      .map((c) => ({ i: Number(c.name.split('.').pop()), v: c.value }))
      .sort((a, b) => a.i - b.i)
      .map((p) => p.v)
      .join('');
  try {
    let json = valor;
    if (json.startsWith('base64-')) {
      const b64 = json.slice(7).replace(/-/g, '+').replace(/_/g, '/');
      const binario = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
      json = new TextDecoder().decode(Uint8Array.from(binario, (ch) => ch.charCodeAt(0)));
    }
    const sessao = JSON.parse(json) as { expires_at?: number };
    return typeof sessao.expires_at === 'number' ? sessao.expires_at : null;
  } catch {
    return null;
  }
}
