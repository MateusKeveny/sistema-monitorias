import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import PainelReportes, { type Reporte } from '@/componentes/PainelReportes';

export const dynamic = 'force-dynamic';

/**
 * Reports de problemas (1.33.0), nos dois sites.
 *
 * O gestor vê todos; os demais, só os próprios — a RLS da migração 44 decide.
 * O print fica em bucket privado: cada um sai daqui com um endereço assinado
 * de uma hora, que o próprio Storage só entrega a quem pode ler o arquivo.
 */
export default async function Reportes({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { id } = await searchParams;
  const ehGestor = perfil.papel === 'gestor';
  const db = await criarClienteServidor();

  const [{ data: reportes }, { data: pessoas }] = await Promise.all([
    db.from('reportes').select('*').order('criado_em', { ascending: false }).limit(300),
    db.rpc('nomes_das_pessoas'),
  ]);
  const lista = (reportes ?? []) as Reporte[];

  const comPrint = lista.filter((r) => r.print_path);
  if (comPrint.length) {
    const { data: urls } = await db.storage.from('reportes')
      .createSignedUrls(comPrint.map((r) => r.print_path!), 3600);
    const porCaminho = new Map((urls ?? []).map((u) => [u.path, u.signedUrl]));
    for (const r of comPrint) r.print_url = porCaminho.get(r.print_path!) ?? null;
  }

  // Quem abre os próprios reports já viu as respostas: apaga o aviso do botão.
  if (!ehGestor && lista.some((r) => r.resposta)) await db.rpc('marcar_reportes_lidos');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">
          {ehGestor ? 'Reports de problemas' : 'Meus reports'}
        </h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">
          {ehGestor
            ? 'Todos os problemas reportados nos dois sites. Responda e marque como resolvido quando corrigir.'
            : 'Os problemas que você reportou e o que a gestão respondeu. Só você e o gestor veem.'}
        </p>
      </div>
      <PainelReportes reportes={lista} ehGestor={ehGestor} inicial={id ? Number(id) : undefined}
                      nomes={Object.fromEntries((pessoas ?? []).map((p: { id: string; nome: string }) => [p.id, p.nome]))} />
    </div>
  );
}
