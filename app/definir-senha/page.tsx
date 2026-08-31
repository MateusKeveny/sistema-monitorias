import { redirect } from 'next/navigation';
import { obterPerfil } from '@/lib/supabase/servidor';
import FormularioNovaSenha from '@/componentes/FormularioNovaSenha';

export const dynamic = 'force-dynamic';

/**
 * Tela do primeiro acesso. Fica fora do grupo (interno) de propósito: não usa
 * exigirPerfil, senão o redirecionamento que traz a pessoa até aqui entraria em
 * laço. Também não mostra o menu — não há para onde navegar antes de trocar a
 * senha.
 */
export default async function DefinirSenha() {
  const perfil = await obterPerfil();

  if (!perfil) redirect('/login');
  if (!perfil.ativo) redirect('/login?erro=inativo');
  if (perfil.senha_definida) redirect('/');

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <FormularioNovaSenha nome={perfil.nome} />
    </main>
  );
}
