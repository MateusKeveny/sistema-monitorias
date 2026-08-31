import Navegacao from '@/componentes/Navegacao';
import { exigirPerfil } from '@/lib/supabase/servidor';

export default async function LayoutInterno({ children }: { children: React.ReactNode }) {
  const perfil = await exigirPerfil();

  return (
    <>
      <Navegacao perfil={perfil} />
      <main className="mx-auto max-w-7xl px-6 py-8">{children}</main>
    </>
  );
}
