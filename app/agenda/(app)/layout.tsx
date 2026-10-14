import BarraDaAgenda from '@/componentes/agenda/BarraDaAgenda';
import ManterSessaoDaAgenda from '@/componentes/agenda/ManterSessaoDaAgenda';
import MenuLateralDaAgenda from '@/componentes/agenda/MenuLateralDaAgenda';
import RegistrarServiceWorker from '@/componentes/agenda/RegistrarServiceWorker';
import { exigirUsuario } from '@/lib/agenda/db-servidor';
import { VERSAO_AGENDA } from '@/lib/versoes';

/**
 * Moldura das telas da agenda — própria, separada da dos painéis: outro
 * banco, outro login, um perfil só. No celular o menu é a barra de baixo,
 * ao alcance do polegar, como num aplicativo.
 */
export default async function LayoutDaAgenda({ children }: { children: React.ReactNode }) {
  const usuario = await exigirUsuario();
  return (
    <div className="lg:grid lg:min-h-screen lg:grid-cols-[15rem_1fr]">
      <ManterSessaoDaAgenda />
      <RegistrarServiceWorker />
      <MenuLateralDaAgenda nome={usuario.nome} usuario={usuario.usuario} versao={VERSAO_AGENDA} />
      <div className="min-w-0 pb-24 lg:pb-0">
        <main className="max-w-[1100px] px-4 py-5 sm:px-6 lg:px-9 lg:py-8">{children}</main>
      </div>
      <BarraDaAgenda />
    </div>
  );
}
