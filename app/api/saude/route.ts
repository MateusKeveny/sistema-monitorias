import { createClient } from '@supabase/supabase-js';
import pacote from '@/package.json';

export const dynamic = 'force-dynamic';

/**
 * Ponto de verificação para monitoramento externo.
 *
 * Existe porque a queda de 01/09/2026 não teria sido detectada por um monitor
 * comum: a tela de login seguiu respondendo 200 durante toda a pane, e só as
 * páginas de dentro falhavam. Olhar a porta da frente não diz se a casa está
 * de pé.
 *
 * Por isso aqui se faz uma consulta de verdade ao banco. Não é uma checagem de
 * permissão — a RLS devolve lista vazia para quem não está logado, e é isso
 * mesmo que se espera. O que se verifica é o caminho inteiro: o Worker
 * executou, alcançou o Supabase e recebeu resposta. Se qualquer elo quebrar,
 * a resposta vem 503 e o monitor avisa.
 *
 * Deliberadamente não devolve nenhum dado do sistema: só estado, versão e
 * tempo de resposta, que são inofensivos para quem estiver olhando de fora.
 */
export async function GET() {
  const inicio = Date.now();

  try {
    // Cliente simples, sem cookie de sessão: a verificação não pode depender
    // de ninguém estar logado.
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } },
    );

    const { error } = await db.from('criterios').select('id').limit(1);
    if (error) throw new Error(error.message);

    return Response.json(
      { estado: 'ok', versao: pacote.version, ms: Date.now() - inicio },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (erro) {
    return Response.json(
      {
        estado: 'falha',
        versao: pacote.version,
        ms: Date.now() - inicio,
        detalhe: erro instanceof Error ? erro.message : 'erro desconhecido',
      },
      { status: 503, headers: { 'cache-control': 'no-store' } },
    );
  }
}
