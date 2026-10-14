import { cache } from 'react';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Usuario } from '@/lib/agenda/usuario';

/**
 * Cliente do banco da agenda para as telas (Server Components). Mesmo padrão
 * de lib/supabase/servidor.ts, apontando para o projeto da agenda: o site da
 * agenda só tem o cookie de sessão desse projeto.
 */
export const criarServidorDaAgenda = cache(async () => {
  const armazem = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_AGENDA_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_AGENDA_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => armazem.getAll(),
        setAll: (lista) => {
          try {
            lista.forEach(({ name, value, options }) => armazem.set(name, value, options));
          } catch {
            // Server Components não escrevem cookie; quem renova é o navegador.
          }
        },
      },
    },
  );
});

export const obterUsuario = cache(async (): Promise<Usuario | null> => {
  const db = await criarServidorDaAgenda();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;
  const { data } = await db.from('usuarios').select('id, usuario, nome, ve_pendencias').eq('id', user.id).maybeSingle();
  return (data as Usuario | null) ?? null;
});

/** Usuário logado, exigido pelas telas da agenda. */
export async function exigirUsuario(): Promise<Usuario> {
  const usuario = await obterUsuario();
  if (!usuario) redirect('/agenda/entrar?erro=sessao');
  return usuario;
}
