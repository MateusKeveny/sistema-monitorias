import { NextResponse, type NextRequest } from 'next/server';
import { INICIO_COTA, caminhoForaDoSistema, sistemaDoHost } from '@/lib/sistema';
import { temCookieDeSessao, validadeDaSessao } from '@/lib/sessao-cookie';

/**
 * Barra as páginas internas para quem não está logado e manda renovar a
 * sessão vencida — sem ir ao Supabase (1.39.2, ver lib/sessao-cookie.ts).
 */
export async function middleware(requisicao: NextRequest) {
  const caminho = requisicao.nextUrl.pathname;

  // Cada site mostra só o seu sistema. Vem antes da sessão: é só comparação de
  // texto, e poupa uma ida ao Supabase para quem caiu no endereço errado.
  const sistema = sistemaDoHost(requisicao.headers.get('host'));
  if (caminhoForaDoSistema(sistema, caminho)) {
    const destino = requisicao.nextUrl.clone();
    destino.pathname = sistema === 'cota' ? INICIO_COTA : '/';
    destino.search = '';
    return NextResponse.redirect(destino);
  }

  const publica = caminho.startsWith('/login') || caminho.startsWith('/auth');
  const cookies = requisicao.cookies.getAll();

  // Sem cookie de sessão não há ninguém logado: vai ao login (1.35.4).
  if (!temCookieDeSessao(cookies)) {
    if (publica) return NextResponse.next();
    // Com os parâmetros (1.41.1): o link do extrato de setembro de uma pessoa
    // voltava, depois do login, no mês e na pessoa padrão.
    return irPara(requisicao, '/login', caminho + requisicao.nextUrl.search);
  }

  // Com cookie, só a validade é lida — sem ir ao Supabase e sem renovar aqui
  // (1.39.2). Renovar no servidor troca o passe e devolve o novo na resposta;
  // com o erro 1102 cortando a resposta, o passe novo se perdia, o antigo já
  // estava invalidado, e a pessoa caía no login. Quem renova é o navegador,
  // direto com o Supabase: o ManterSessao enquanto a tela está aberta e
  // /auth/renovar quando a pessoa volta com o passe vencido. Quem confere a
  // pessoa de verdade continua sendo cada tela (getUser em exigirPerfil).
  // O login não manda mais quem "já está logado" para o início: pelo cookie
  // não dá para saber se a sessão ainda vale no Supabase (encerrada pelo
  // gestor, por exemplo), e a tela mandaria de volta ao login — um laço.
  if (publica) return NextResponse.next();
  const validade = validadeDaSessao(cookies);
  if (validade == null || validade <= Date.now() / 1000 + MARGEM_SEG) {
    return irPara(requisicao, '/auth/renovar', caminho + requisicao.nextUrl.search);
  }
  return NextResponse.next();
}

/** Renova um pouco antes de vencer, para a tela não pegar o passe no limite. */
const MARGEM_SEG = 60;

function irPara(requisicao: NextRequest, caminho: string, proximo?: string) {
  const destino = requisicao.nextUrl.clone();
  destino.pathname = caminho;
  destino.search = '';
  if (proximo) destino.searchParams.set('proximo', proximo);
  return NextResponse.redirect(destino);
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
