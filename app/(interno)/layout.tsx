import Navegacao from '@/componentes/Navegacao';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';

export default async function LayoutInterno({ children }: { children: React.ReactNode }) {
  const perfil = await exigirPerfil();

  // Exclusões esperando decisão aparecem no Painel, mas o quadro só existe
  // quando há alguma — o gestor não teria como saber que chegou pedido sem
  // abrir a tela por acaso. O contador no menu resolve isso: ele aparece em
  // qualquer página, e some sozinho quando a fila zera.
  let pendentes = 0;
  if (perfil.papel === 'gestor') {
    const db = await criarClienteServidor();
    const { count } = await db
      .from('solicitacoes_exclusao')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pendente');
    pendentes = count ?? 0;
  }

  return (
    <>
      <Navegacao perfil={perfil} pendentes={pendentes} />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </>
  );
}
