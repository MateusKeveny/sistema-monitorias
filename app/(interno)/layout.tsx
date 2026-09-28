import Navegacao from '@/componentes/Navegacao';
import MenuLateral from '@/componentes/MenuLateral';
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

  // Performance (1.15.0): menu lateral em tela larga e conteúdo na largura
  // toda — limitado a 7xl, sobrava meia tela vazia em monitor grande. Em
  // janela estreita volta o cabeçalho do topo. As Monitorias seguem como
  // estavam.
  if (sistema === 'cota') {
    return (
      <div className="lg:grid lg:min-h-screen lg:grid-cols-[15rem_1fr]">
        <MenuLateral perfil={perfil} versao={VERSAO_COTA} />
        <div className="min-w-0">
          <div className="lg:hidden">
            <Navegacao perfil={perfil} pendentes={pendentes} sistema={sistema} versao={VERSAO_COTA} />
          </div>
          <main className="max-w-[1680px] px-6 py-8 lg:px-9">{children}</main>
        </div>
      </div>
    );
  }

  return (
    <>
      <Navegacao
        perfil={perfil}
        pendentes={pendentes}
        sistema={sistema}
        versao={VERSAO_MONITORIAS}
      />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </>
  );
}
