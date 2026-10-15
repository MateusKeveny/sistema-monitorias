import { chavesVapid, dbSemSessao, segredoDaAgenda } from '@/lib/agenda/envio';
import { feriasDoPerformance, pendenciasDoPerformance } from '@/lib/agenda/ponte';
import { hoje as hojeNoBrasil } from '@/lib/agenda/tempo';
import { avisosDeFerias, type PeriodoDeFerias } from '@/lib/ferias';
import { chamarTelegram, mensagemDoAviso, tokenDoTelegram } from '@/lib/agenda/telegram';
import { enviarPush, iguais, seloDoItem } from '@/lib/agenda/webpush';
import { ENDERECO_PERFORMANCE, sistemaDoHost } from '@/lib/sistema';

export const dynamic = 'force-dynamic';

type Envio = {
  /** Aparelho inscrito (Web Push)… */
  endpoint?: string; p256dh?: string; auth?: string;
  /** …ou conversa do Telegram (supabase/agenda/02-telegram.sql). */
  telegram?: number;
  titulo: string; corpo: string; url: string; tag: string; item_id?: string;
  usuario_id?: string;
  /** Resumo de quem vê as pendências do Performance. */
  pendencias?: boolean;
};

/**
 * Entrega as notificações que o banco da agenda juntou (agenda_disparar,
 * supabase/agenda/01-agenda.sql e 02-telegram.sql) e o lembrete dos
 * relatórios do ciclo (agenda_disparar_ciclo, 03-lembrete-do-ciclo.sql).
 *
 * Quem chama é o pg_net, a cada minuto em que há algo vencendo, com o segredo
 * no cabeçalho. Sem sessão: por isso fica fora do middleware.
 *
 * O trabalho aqui é só cifrar e entregar; cada envio custa alguns
 * milissegundos de CPU, e a lista de um minuto é curta. Destinos que o
 * serviço recusar saem do banco na mesma hora: aparelho com 404/410 (app
 * desinstalado, permissão retirada) e conversa do Telegram com 403 (bot
 * bloqueado).
 */
export async function POST(requisicao: Request) {
  if (sistemaDoHost(requisicao.headers.get('host')) !== 'agenda' && process.env.NODE_ENV === 'production') {
    return new Response(null, { status: 404 });
  }
  const segredo = segredoDaAgenda();
  const chaves = chavesVapid();
  const token = tokenDoTelegram();
  if (!segredo || (!chaves && !token)) return Response.json({ erro: 'Envio não configurado' }, { status: 503 });
  if (!iguais(requisicao.headers.get('x-agenda-segredo') ?? '', segredo)) {
    return Response.json({ erro: 'Não autorizado' }, { status: 401 });
  }

  const { envios = [] } = await requisicao.json().catch(() => ({})) as { envios?: Envio[] };
  const mortos: string[] = [];
  const conversasMortas: number[] = [];
  let entregues = 0;

  // Resumo do dia e lembrete do ciclo: o banco da agenda não conhece as
  // pendências do Performance, então elas entram aqui, pela ponte — uma
  // consulta só para o lote todo.
  const lista = envios.some((e) => e.pendencias) ? (await pendenciasDoPerformance()).lista : [];
  const pendencias = lista.length;
  // Relatórios do ciclo (supabase/agenda/03-lembrete-do-ciclo.sql): semanas
  // sem atendimentos (sem volume) ou sem chamados importados.
  const relatorios = lista.filter((p) => /^sem_(volume|chamados):/.test(p.chave));
  // Férias no resumo (61 e agenda/04): as da equipe pela ponte, para quem vê
  // as pendências; as de cada usuário, do banco da agenda.
  const resumos = envios.filter((e) => e.tag?.startsWith('resumo-'));
  const hoje = hojeNoBrasil();
  const [equipe, minhas] = resumos.length ? await Promise.all([
    resumos.some((e) => e.pendencias) ? feriasDoPerformance() : Promise.resolve(null),
    dbSemSessao().rpc('agenda_minhas_ferias_resumo', {
      p_segredo: segredo,
      p_usuarios: [...new Set(resumos.map((e) => e.usuario_id).filter(Boolean))],
    }).then((r) => (r.data ?? []) as { usuario_id: string; inicio: string; fim: string }[]),
  ]) : [null, []];
  const feriasDe = (e: Envio) => {
    const meus: PeriodoDeFerias[] = minhas.filter((m) => m.usuario_id === e.usuario_id)
      .map((m, i) => ({ id: `minha-${i}`, pessoa: 'você', inicio: m.inicio, fim: m.fim, minha: true }));
    const daEquipe = e.pendencias && equipe ? equipe : null;
    return avisosDeFerias([...meus, ...(daEquipe?.ferias ?? [])], daEquipe?.prazos ?? [], hoje, 'resumo').map((a) => a.texto);
  };

  const corpoDe = (e: Envio) => {
    if (!e.tag?.startsWith('resumo-')) return e.corpo;
    const partes = [e.corpo || null,
      e.pendencias && pendencias ? `${pendencias} pendência${pendencias > 1 ? 's' : ''} do sistema` : null].filter(Boolean);
    const ferias = feriasDe(e);
    const linha = partes.length ? partes.join(' · ') : ferias.length ? null : 'Nada marcado para hoje. Bom trabalho!';
    return [linha, ...ferias.map((t) => `🏖 ${t}`)].filter(Boolean).join('\n');
  };

  await Promise.all(envios.slice(0, 200).map(async (e) => {
    // Lembrete do ciclo: com tudo em dia, não há o que avisar.
    if (e.tag?.startsWith('ciclo-')) {
      if (!relatorios.length) return;
      e = {
        ...e,
        titulo: 'Relatórios do ciclo para subir',
        corpo: relatorios.map((p) => p.texto).join('\n'),
        url: `${ENDERECO_PERFORMANCE}${relatorios.every((p) => p.href === relatorios[0].href) ? relatorios[0].href : '/cota/importar'}`,
      };
    }
    try {
      if (e.telegram != null) {
        if (!token) return;
        const { status, json } = await chamarTelegram(token, 'sendMessage', {
          chat_id: e.telegram,
          ...mensagemDoAviso({ titulo: e.titulo, corpo: corpoDe(e), url: e.url || '/agenda', item: e.item_id }),
        });
        if (status === 403) conversasMortas.push(e.telegram);
        else if (status < 300) entregues++;
        else console.warn('agenda: telegram recusou', status, json?.description);
        return;
      }
      if (!chaves || !e.endpoint || !e.p256dh || !e.auth) return;
      const conteudo = {
        titulo: e.titulo, corpo: corpoDe(e), url: e.url || '/agenda', tag: e.tag,
        item: e.item_id ?? null,
        selo: e.item_id ? await seloDoItem(e.item_id, segredo) : null,
      };
      const inscricao = { endpoint: e.endpoint, p256dh: e.p256dh, auth: e.auth };
      const status = await enviarPush(inscricao, conteudo, chaves, { topico: e.tag });
      if (status === 404 || status === 410) mortos.push(e.endpoint);
      else if (status < 300) entregues++;
      else console.warn('agenda: push recusado', status, new URL(e.endpoint).host);
    } catch (erro) {
      console.warn('agenda: falha no envio', String(erro));
    }
  }));

  const db = dbSemSessao();
  if (mortos.length) {
    await db.rpc('agenda_remover_inscricoes', { p_segredo: segredo, p_endpoints: mortos });
  }
  if (conversasMortas.length) {
    await db.rpc('agenda_telegram_remover', { p_segredo: segredo, p_chats: conversasMortas });
  }
  return Response.json({ entregues, removidos: mortos.length + conversasMortas.length, total: envios.length });
}
