import { criarClienteServidor } from '@/lib/supabase/servidor';
import { emailDoLogin } from '@/lib/usuario';

export const dynamic = 'force-dynamic';

/**
 * Login pelo servidor (4.11.0, migração 110). Antes a tela falava direto com
 * o Supabase; agora passa por aqui, que conta as tentativas erradas por
 * usuário + endereço de rede:
 *   · depois de 1 erro, pede a verificação ("Quanto é 4 + 7?");
 *   · na 5ª tentativa errada, bloqueia 15 minutos;
 *   · acertar a senha zera a contagem.
 * A sessão é gravada nos cookies pelo próprio cliente do servidor, como no
 * login de antes.
 */
type Pedido = { usuario?: string; senha?: string; desafio?: string; resposta?: string };
type Situacao = { falhas: number; bloqueado_ate: string | null };

const minutos = (ate: string) => Math.max(1, Math.round((Date.parse(ate) - Date.now()) / 60_000));
const bloqueio = (ate: string) => Response.json({
  erro: `Muitas tentativas erradas. Acesso bloqueado por ${minutos(ate)} minuto${minutos(ate) > 1 ? 's' : ''}; tente depois ou procure o seu gestor.`,
  bloqueado: true,
}, { status: 429 });

export async function POST(requisicao: Request) {
  const { usuario = '', senha = '', desafio, resposta }: Pedido = await requisicao.json().catch(() => ({}));
  if (!usuario.trim() || !senha) return Response.json({ erro: 'Informe usuário e senha.' }, { status: 400 });

  const email = emailDoLogin(usuario);
  // O endereço de quem chama, como a Cloudflare entrega; em localhost, o do proxy.
  const ip = requisicao.headers.get('cf-connecting-ip')
    ?? requisicao.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'local';
  const db = await criarClienteServidor();

  const novoDesafio = async () => {
    const { data } = await db.rpc('login_novo_desafio');
    const d = (data as { id: string; pergunta: string }[] | null)?.[0];
    return d ? { id: d.id, pergunta: d.pergunta } : null;
  };

  // 1. Bloqueado? Não chega nem a conferir a senha.
  const { data: sit, error: e1 } = await db.rpc('login_situacao', { p_chave: email, p_ip: ip });
  if (e1) return Response.json({ erro: 'Não foi possível entrar agora. Tente de novo em instantes.' }, { status: 503 });
  const antes = ((sit as Situacao[] | null)?.[0]) ?? { falhas: 0, bloqueado_ate: null };
  if (antes.bloqueado_ate) return bloqueio(antes.bloqueado_ate);

  // 2. Depois de um erro, a verificação vem antes da senha.
  if (antes.falhas >= 1) {
    const ok = desafio && resposta != null && /^\d+$/.test(String(resposta).trim())
      ? (await db.rpc('login_confere_desafio', { p_id: desafio, p_resposta: Number(String(resposta).trim()) })).data === true
      : false;
    if (!ok) {
      return Response.json({
        erro: desafio ? 'A resposta da verificação não confere. Tente esta.' : 'Responda a verificação para continuar.',
        desafio: await novoDesafio(),
      }, { status: 400 });
    }
  }

  // 3. A senha.
  const { error } = await db.auth.signInWithPassword({ email, password: senha });
  if (error) {
    const credencial = error.message === 'Invalid login credentials';
    if (!credencial) return Response.json({ erro: error.message }, { status: 400 });
    const { data: depois } = await db.rpc('login_falhou', { p_chave: email, p_ip: ip });
    const s = ((depois as Situacao[] | null)?.[0]) ?? { falhas: antes.falhas + 1, bloqueado_ate: null };
    if (s.bloqueado_ate) return bloqueio(s.bloqueado_ate);
    const restam = 5 - s.falhas;
    return Response.json({
      erro: `Usuário ou senha incorretos.${restam <= 3 ? ` Mais ${restam} tentativa${restam > 1 ? 's' : ''} e o acesso fica bloqueado por 15 minutos.` : ''}`,
      desafio: await novoDesafio(),
    }, { status: 401 });
  }

  // 4. Entrou: zera a contagem (com a sessão que acabou de nascer).
  await db.rpc('login_ok', { p_ip: ip });
  return Response.json({ ok: true });
}
