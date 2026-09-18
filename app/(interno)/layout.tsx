import Navegacao from '@/componentes/Navegacao';
import { VERSAO_COTA, VERSAO_MONITORIAS } from '@/lib/versoes';
import { sistemaAtual } from '@/lib/sistema-servidor';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';

export default async function LayoutInterno({ children }: { children: React.ReactNode }) {
  const [perfil, sistema] = await Promise.all([exigirPerfil(), sistemaAtual()]);

  // Exclusões esperando decisão aparecem no Painel, mas o quadro só existe
  // quando há alguma — o gestor não teria como saber que chegou pedido sem
  // abrir a tela por acaso. O contador no menu resolve isso: ele aparece em
  // qualquer página, e some sozinho quando a fila zera. Só existe nas
  // monitorias: no site de cota não há onde decidir.
  let pendentes = 0;
  if (sistema === 'monitorias' && perfil.papel === 'gestor') {
    const db = await criarClienteServidor();
    const { count } = await db
      .from('solicitacoes_exclusao')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pendente');
    pendentes = count ?? 0;
  }

  return (
    <>
      <Navegacao
        perfil={perfil}
        pendentes={pendentes}
        sistema={sistema}
        versao={sistema === 'cota' ? VERSAO_COTA : VERSAO_MONITORIAS}
      />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </>
  );
}
