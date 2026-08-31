import Link from 'next/link';

export default function NaoEncontrada() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="text-sm font-semibold text-marca-700 dark:text-marca-400">404</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">Página não encontrada</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">
          O endereço não existe, ou a monitoria que você procurava foi removida.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-lg bg-marca-600 px-4 py-2 text-sm
                     font-semibold text-white hover:bg-marca-700"
        >
          Ir para o painel
        </Link>
      </div>
    </main>
  );
}
