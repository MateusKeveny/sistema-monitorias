'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

const campo = `w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none
               focus:border-marca-600 focus:ring-2 focus:ring-marca-100`;

export default function FormularioLogin({
  aviso, proximo,
}: {
  aviso: string | null;
  proximo: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(aviso);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);

    const { error } = await criarClienteNavegador().auth
      .signInWithPassword({ email, password: senha });

    if (error) {
      setErro(error.message === 'Invalid login credentials'
        ? 'E-mail ou senha incorretos.'
        : error.message);
      setEnviando(false);
      return;
    }

    router.push(proximo);
    router.refresh();
  }

  return (
    <form onSubmit={entrar} className="w-full max-w-sm space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Monitorias de Qualidade</h1>
        <p className="mt-1 text-sm text-slate-500">Entre com seu e-mail corporativo.</p>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">E-mail</span>
        <input
          type="email" name="email" required autoComplete="email" value={email}
          onChange={(e) => setEmail(e.target.value)} className={campo}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Senha</span>
        <input
          type="password" name="senha" required autoComplete="current-password" value={senha}
          onChange={(e) => setSenha(e.target.value)} className={campo}
        />
      </label>

      {erro && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">
          {erro}
        </p>
      )}

      <button
        type="submit" disabled={enviando}
        className="w-full rounded-lg bg-marca-600 px-4 py-2.5 text-sm font-semibold text-white
                   hover:bg-marca-700 disabled:opacity-60"
      >
        {enviando ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  );
}
