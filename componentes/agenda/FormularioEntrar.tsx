'use client';

import { useState } from 'react';
import { criarClienteDaAgenda } from '@/lib/agenda/db-cliente';
import { USUARIO_VALIDO, emailDoUsuario, normalizarUsuario } from '@/lib/agenda/usuario';

const campo = `w-full rounded-lg border border-slate-300 bg-superficie px-3 py-2 text-sm text-slate-900 outline-none
               focus:border-marca-600 focus:ring-2 focus:ring-marca-100`;

/** Entrada da agenda: nome de usuário e senha (lib/agenda/usuario.ts). */
export default function FormularioEntrar({ aviso, proximo }: { aviso: string | null; proximo: string }) {
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(aviso);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    const nome = normalizarUsuario(usuario);
    if (!USUARIO_VALIDO.test(nome)) { setErro('Usuário inválido: use letras minúsculas, números, ponto ou traço.'); return; }
    setEnviando(true);
    setErro(null);
    const { error } = await criarClienteDaAgenda().auth.signInWithPassword({ email: emailDoUsuario(nome), password: senha });
    if (error) {
      setErro(error.message === 'Invalid login credentials' ? 'Usuário ou senha incorretos.' : error.message);
      setEnviando(false);
      return;
    }
    // Navegação inteira: o servidor precisa ler o cookie recém-gravado.
    window.location.replace(proximo);
  }

  return (
    <form onSubmit={entrar} className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-200 bg-superficie p-8 shadow-xl">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Agenda da Gestão</h1>
        <p className="mt-1 text-sm text-slate-500">Entre com o seu usuário da agenda.</p>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Usuário</span>
        <input name="usuario" required autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
               value={usuario} onChange={(e) => setUsuario(e.target.value)} className={campo} />
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Senha</span>
        <input type="password" name="senha" required autoComplete="current-password" value={senha}
               onChange={(e) => setSenha(e.target.value)} className={campo} />
      </label>

      {erro && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}

      <button type="submit" disabled={enviando}
              className="w-full rounded-lg bg-marca-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-60">
        {enviando ? 'Entrando…' : 'Entrar'}
      </button>

      <p className="text-center text-xs text-slate-500">
        Login separado dos painéis: a agenda tem banco próprio.
      </p>
    </form>
  );
}
