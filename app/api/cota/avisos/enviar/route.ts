import { criarClienteServidor } from '@/lib/supabase/servidor';
import { enviarPush } from '@/lib/agenda/webpush';
import { ENDERECO_PERFORMANCE } from '@/lib/sistema';

export const dynamic = 'force-dynamic';

type Pendente = {
  aviso_id: number; titulo: string; texto: string | null; link: string | null;
  inscricao_id: number; endpoint: string; p256dh: string; auth: string;
};

/**
 * Aviso no computador (2.4.0, migração 75): entrega no canto da tela os
 * avisos do sino ainda não enviados, para quem ativou.
 *
 * Quem chama é a tela do gestor, logo depois de salvar o volume da semana ou
 * os valores do RH — com a sessão dele; as funções do banco conferem que é o
 * gestor. A chave VAPID é a mesma da Agenda (VAPID_PUBLICA / VAPID_PRIVADA).
 * Inscrição que o serviço recusar (404/410: permissão retirada, navegador
 * limpo) sai do banco.
 */
export async function POST() {
  const publica = process.env.VAPID_PUBLICA;
  const privada = process.env.VAPID_PRIVADA;
  if (!publica || !privada) return Response.json({ enviados: 0, configurado: false });

  const db = await criarClienteServidor();
  const { data, error } = await db.rpc('avisos_para_enviar');
  if (error) return Response.json({ erro: error.message }, { status: error.code === '42501' ? 403 : 500 });

  const pendentes = (data ?? []) as Pendente[];
  const chaves = { publica, privada, contato: ENDERECO_PERFORMANCE };
  const avisos = new Set<number>();
  const mortas: number[] = [];
  let enviados = 0;

  await Promise.all(pendentes.map(async (p) => {
    avisos.add(p.aviso_id);
    try {
      const status = await enviarPush({ endpoint: p.endpoint, p256dh: p.p256dh, auth: p.auth },
        { titulo: p.titulo, corpo: p.texto ?? '', url: p.link ?? '/cota', tag: `aviso-${p.aviso_id}` },
        chaves, { ttl: 86400, urgencia: 'normal' });
      if (status === 404 || status === 410) mortas.push(p.inscricao_id);
      else if (status < 300) enviados++;
    } catch {
      // Uma falha de rede num aparelho não impede os outros.
    }
  }));

  if (avisos.size || mortas.length) {
    await db.rpc('avisos_enviados', { p_avisos: [...avisos], p_inscricoes_mortas: mortas });
  }
  return Response.json({ enviados, pessoas: new Set(pendentes.map((p) => p.endpoint)).size });
}
