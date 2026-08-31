import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Perfil } from '@/lib/tipos';

/** Cliente Supabase para Server Components, Route Handlers e Server Actions. */
export async function criarClienteServidor() {
  const armazem = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => armazem.getAll(),
        setAll: (lista) => {
          try {
            lista.forEach(({ name, value, options }) => armazem.set(name, value, options));
          } catch {
            // Server Components não podem escrever cookies; o middleware cuida da renovação.
          }
        },
      },
    },
  );
}

/**
 * Devolve o perfil do usuário logado. Se não houver sessão, manda para o login.
 * Todas as páginas internas começam por aqui.
 */
export async function exigirPerfil(): Promise<Perfil> {
  const db = await criarClienteServidor();
  const { data: { user } } = await db.auth.getUser();
  if (!user) redirect('/login');

  const { data: perfil } = await db
    .from('perfis')
    .select('id, nome, email, papel, operador_id, ativo')
    .eq('id', user.id)
    .maybeSingle();

  if (!perfil) redirect('/login?erro=perfil-ausente');
  if (!perfil.ativo) redirect('/login?erro=inativo');

  return perfil as Perfil;
}

/** Igual a exigirPerfil, mas bloqueia quem não for admin (qualidade). */
export async function exigirAdmin(): Promise<Perfil> {
  const perfil = await exigirPerfil();
  if (perfil.papel !== 'admin') redirect('/?erro=sem-permissao');
  return perfil;
}
