import FormularioLogin from '@/componentes/FormularioLogin';

const MENSAGENS: Record<string, string> = {
  'perfil-ausente': 'Seu usuário existe, mas ainda não tem perfil liberado. Fale com a Qualidade.',
  inativo: 'Seu acesso está inativo. Fale com a Qualidade.',
};

/**
 * Página de entrada. É um Server Component para o formulário vir pronto no
 * HTML — sem tela em branco esperando o JavaScript. Os parâmetros da URL
 * chegam como propriedade, o que dispensa o useSearchParams do cliente.
 */
export default async function PaginaLogin({
  searchParams,
}: {
  searchParams: Promise<{ erro?: string; proximo?: string }>;
}) {
  const { erro, proximo } = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <FormularioLogin
        aviso={erro ? MENSAGENS[erro] ?? null : null}
        proximo={proximo && proximo.startsWith('/') ? proximo : '/'}
      />
    </main>
  );
}
