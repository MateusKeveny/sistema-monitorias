export const dynamic = 'force-dynamic';

/** A chave pública VAPID, para o navegador se inscrever (2.4.0). Não é segredo. */
export async function GET() {
  return Response.json({ chave: process.env.VAPID_PUBLICA ?? null });
}
