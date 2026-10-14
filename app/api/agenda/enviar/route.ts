import { chavesVapid, dbSemSessao, segredoDaAgenda } from '@/lib/agenda/envio';
import { pendenciasDoPerformance } from '@/lib/agenda/ponte';
import { enviarPush, iguais, seloDoItem } from '@/lib/agenda/webpush';
import { sistemaDoHost } from '@/lib/sistema';

export const dynamic = 'force-dynamic';

type Envio = {
  endpoint: string; p256dh: string; auth: string;
  titulo: string; corpo: string; url: string; tag: string; item_id?: string;
  /** Resumo de quem vê as pendências do Performance. */
  pendencias?: boolean;
};

/**
 * Entrega as notificações que o banco da agenda juntou (agenda_disparar,
 * supabase/agenda/01-agenda.sql).
 *
 * Quem chama é o pg_net, a cada minuto em que há algo vencendo, com o segredo
 * no cabeçalho. Sem sessão: por isso fica fora do middleware.
 *
 * O trabalho aqui é só cifrar e entregar; cada envio custa alguns
 * milissegundos de CPU, e a lista de um minuto é curta. Aparelhos que o
 * serviço recusar (404/410: app desinstalado, permissão retirada) saem do
 * banco na mesma hora.
 */
export async function POST(requisicao: Request) {
  if (sistemaDoHost(requisicao.headers.get('host')) !== 'agenda' && process.env.NODE_ENV === 'production') {
    return new Response(null, { status: 404 });
  }
  const segredo = segredoDaAgenda();
  const chaves = chavesVapid();
  if (!segredo || !chaves) return Response.json({ erro: 'Envio não configurado' }, { status: 503 });
  if (!iguais(requisicao.headers.get('x-agenda-segredo') ?? '', segredo)) {
    return Response.json({ erro: 'Não autorizado' }, { status: 401 });
  }

  const { envios = [] } = await requisicao.json().catch(() => ({})) as { envios?: Envio[] };
  const mortos: string[] = [];
  let entregues = 0;

  // Resumo do dia: o banco da agenda não conhece as pendências do Performance,
  // então a conta entra aqui, pela ponte — uma consulta só para o lote todo.
  const pendencias = envios.some((e) => e.pendencias) ? (await pendenciasDoPerformance()).lista.length : 0;
  const corpoDe = (e: Envio) => {
    if (!e.tag?.startsWith('resumo-')) return e.corpo;
    const partes = [e.corpo || null,
      e.pendencias && pendencias ? `${pendencias} pendência${pendencias > 1 ? 's' : ''} do sistema` : null].filter(Boolean);
    return partes.length ? partes.join(' · ') : 'Nada marcado para hoje. Bom trabalho!';
  };

  await Promise.all(envios.slice(0, 200).map(async (e) => {
    try {
      const conteudo = {
        titulo: e.titulo, corpo: corpoDe(e), url: e.url || '/agenda', tag: e.tag,
        item: e.item_id ?? null,
        selo: e.item_id ? await seloDoItem(e.item_id, segredo) : null,
      };
      const status = await enviarPush(e, conteudo, chaves, { topico: e.tag });
      if (status === 404 || status === 410) mortos.push(e.endpoint);
      else if (status < 300) entregues++;
      else console.warn('agenda: push recusado', status, new URL(e.endpoint).host);
    } catch (erro) {
      console.warn('agenda: falha no push', String(erro));
    }
  }));

  if (mortos.length) {
    await dbSemSessao().rpc('agenda_remover_inscricoes', { p_segredo: segredo, p_endpoints: mortos });
  }
  return Response.json({ entregues, removidos: mortos.length, total: envios.length });
}
