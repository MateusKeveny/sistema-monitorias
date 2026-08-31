import { cache } from 'react';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Perfil } from '@/lib/tipos';

/**
 * Cliente Supabase para Server Components, Route Handlers e Server Actions.
 *
 * Envolvido em cache() para que layout e página compartilhem a mesma instância
 * dentro de uma renderização, em vez de montar uma nova a cada chamada.
 */
export const criarClienteServidor = cache(async () => {
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
});

/**
 * Busca o perfil do usuário logado.
 *
 * O cache() aqui é o que mais pesa no desempenho: sem ele, o layout e a página
 * repetiam a mesma dupla de chamadas (getUser + consulta a perfis) na mesma
 * renderização — quatro idas à rede em série onde bastam duas. Com o cache, a
 * segunda chamada devolve o resultado da primeira, de graça.
 */
export const obterPerfil = cache(async (): Promise<Perfil | null> => {
  const db = await criarClienteServidor();

  const { data: { user } } = await db.auth.getUser();
  if (!user) return null;

  const { data } = await db
    .from('perfis')
    .select('id, nome, email, papel, operador_id, ativo, senha_definida')
    .eq('id', user.id)
    .maybeSingle();

  return (data as Perfil | null) ?? null;
});

/**
 * Perfil do usuário logado, exigido pelas telas internas.
 *
 * Sem sessão válida, manda para o login. Com a senha inicial ainda não trocada,
 * manda para a tela de definir senha — é o portão do primeiro acesso, e vale
 * para todas as páginas internas de uma vez.
 */
export async function exigirPerfil(): Promise<Perfil> {
  const perfil = await obterPerfil();
  if (!perfil) redirect('/login?erro=perfil-ausente');
  if (!perfil.ativo) redirect('/login?erro=inativo');
  if (!perfil.senha_definida) redirect('/definir-senha');
  return perfil;
}

/**
 * Administração — pesos, cadastros e acessos. Só gestor.
 */
export async function exigirGestor(): Promise<Perfil> {
  const perfil = await exigirPerfil();
  if (perfil.papel !== 'gestor') redirect('/?erro=sem-permissao');
  return perfil;
}

/**
 * Lançar e editar monitoria: gestor e qualidade.
 */
export async function exigirMonitor(): Promise<Perfil> {
  const perfil = await exigirPerfil();
  if (perfil.papel === 'operador') redirect('/?erro=sem-permissao');
  return perfil;
}

/**
 * Telas de relatório: são recortes do time inteiro, então ficam com quem
 * enxerga o time. Esconder o item no menu não basta — sem esta checagem, quem
 * digitasse a URL entraria assim mesmo.
 */
export async function exigirVisaoDoTime(): Promise<Perfil> {
  const perfil = await exigirPerfil();
  if (perfil.papel === 'operador') redirect('/');
  return perfil;
}
