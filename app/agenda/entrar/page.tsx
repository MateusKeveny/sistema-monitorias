import FormularioEntrar from '@/componentes/agenda/FormularioEntrar';
import { destinoInterno } from '@/lib/destino';

const MENSAGENS: Record<string, string> = {
  sessao: 'Sua sessão terminou. Entre de novo.',
};

/** Entrada da agenda — login próprio, por nome de usuário. */
export default async function Entrar({ searchParams }: { searchParams: Promise<{ erro?: string; proximo?: string }> }) {
  const { erro, proximo } = await searchParams;
  const destino = destinoInterno(proximo, '/agenda');
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <FormularioEntrar aviso={erro ? MENSAGENS[erro] ?? null : null}
                        proximo={destino.startsWith('/agenda') ? destino : '/agenda'} />
    </main>
  );
}
