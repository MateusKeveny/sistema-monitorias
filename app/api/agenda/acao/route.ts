import { dbSemSessao, segredoDaAgenda } from '@/lib/agenda/envio';
import { iguais, seloDoItem } from '@/lib/agenda/webpush';

export const dynamic = 'force-dynamic';

/**
 * Botões da notificação — "Concluir" e "Adiar 15 min" (service worker).
 *
 * O toque vem do service worker, que pode estar sem sessão válida (o passe de
 * login expira e quem renova é a tela aberta). Por isso a prova não é o
 * login, e sim o selo que acompanhou a notificação: assinado com o segredo da
 * agenda para aquele item, só quem recebeu o aviso o tem.
 */
export async function POST(requisicao: Request) {
  const segredo = segredoDaAgenda();
  if (!segredo) return Response.json({ erro: 'Não configurado' }, { status: 503 });

  const { item, acao, selo } = await requisicao.json().catch(() => ({})) as
    { item?: string; acao?: string; selo?: string };
  if (!item || !selo || (acao !== 'concluir' && acao !== 'adiar')) {
    return Response.json({ erro: 'Pedido inválido' }, { status: 400 });
  }
  if (!iguais(selo, await seloDoItem(item, segredo))) {
    return Response.json({ erro: 'Não autorizado' }, { status: 401 });
  }

  const { error } = await dbSemSessao().rpc('agenda_acao_do_aviso', { p_segredo: segredo, p_item: item, p_acao: acao });
  if (error) return Response.json({ erro: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
