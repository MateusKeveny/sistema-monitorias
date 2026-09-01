import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Renova o cookie de sessão a cada navegação e barra o acesso
 * às páginas internas de quem não está logado.
 */
export async function middleware(requisicao: NextRequest) {
  let resposta = NextResponse.next({ request: requisicao });

  const db = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => requisicao.cookies.getAll(),
        setAll: (lista) => {
          lista.forEach(({ name, value }) => requisicao.cookies.set(name, value));
          resposta = NextResponse.next({ request: requisicao });
          lista.forEach(({ name, value, options }) => resposta.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await db.auth.getUser();
  const caminho = requisicao.nextUrl.pathname;
  const publica = caminho.startsWith('/login') || caminho.startsWith('/auth');

  if (!user && !publica) {
    const destino = requisicao.nextUrl.clone();
    destino.pathname = '/login';
    destino.searchParams.set('proximo', caminho);
    return NextResponse.redirect(destino);
  }

  if (user && caminho === '/login') {
    const destino = requisicao.nextUrl.clone();
    destino.pathname = '/';
    destino.search = '';
    return NextResponse.redirect(destino);
  }

  return resposta;
}

export const config = {
  // `api/saude` fica de fora de propósito. É o endereço que o monitoramento
  // externo consulta, e ele precisa responder sem sessão: passando por aqui,
  // seria redirecionado ao login e devolveria 200 mesmo com o sistema fora do
  // ar — o monitor diria que está tudo bem durante a pane. De quebra, evita
  // uma ida ao Supabase para conferir sessão a cada verificação.
  // O Next lê este valor no build, sem executar o arquivo: precisa ser um
  // texto literal. Quebrar a linha com `+` faz a regra inteira ser ignorada.
  // eslint-disable-next-line max-len
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/saude|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
