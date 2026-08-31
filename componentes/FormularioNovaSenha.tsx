'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

const MINIMO = 8;

const campo = `w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none
               focus:border-marca-600 focus:ring-2 focus:ring-marca-100`;

export default function FormularioNovaSenha({ nome }: { nome: string }) {
  const router = useRouter();
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const curta = senha.length > 0 && senha.length < MINIMO;
  const diferente = confirmacao.length > 0 && senha !== confirmacao;
  const valida = senha.length >= MINIMO && senha === confirmacao;

  async function definir(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);

    const db = criarClienteNavegador();

    const { error } = await db.auth.updateUser({ password: senha });
    if (error) {
      setErro(error.message.includes('should be different')
        ? 'A nova senha precisa ser diferente da atual.'
        : error.message);
      setEnviando(false);
      return;
    }

    // Só depois de a senha ser trocada de fato é que o perfil é marcado.
    // A função no banco só altera esta coluna, e só na linha de quem chamou.
    const { error: erroMarca } = await db.rpc('marcar_senha_definida');
    if (erroMarca) {
      setErro(`Senha alterada, mas o registro falhou: ${erroMarca.message}. `
        + 'Recarregue a página — se a tela reaparecer, avise a Qualidade.');
      setEnviando(false);
      return;
    }

    router.push('/');
    router.refresh();
  }

  return (
    <form onSubmit={definir} className="w-full max-w-sm space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Defina sua senha</h1>
        <p className="mt-1 text-sm text-slate-500">
          Olá, {nome.split(' ')[0]}. Este é seu primeiro acesso: escolha uma senha
          pessoal antes de continuar.
        </p>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Nova senha</span>
        <input
          type="password" required autoComplete="new-password" value={senha}
          onChange={(e) => setSenha(e.target.value)} className={campo}
        />
        <span className={`mt-1 block text-xs ${curta ? 'text-rose-700' : 'text-slate-500'}`}>
          Mínimo de {MINIMO} caracteres.
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">Repita a senha</span>
        <input
          type="password" required autoComplete="new-password" value={confirmacao}
          onChange={(e) => setConfirmacao(e.target.value)} className={campo}
        />
        {diferente && (
          <span className="mt-1 block text-xs text-rose-700">As senhas não coincidem.</span>
        )}
      </label>

      {erro && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">
          {erro}
        </p>
      )}

      <button
        type="submit" disabled={!valida || enviando}
        className="w-full rounded-lg bg-marca-600 px-4 py-2.5 text-sm font-semibold text-white
                   hover:bg-marca-700 disabled:opacity-50"
      >
        {enviando ? 'Salvando…' : 'Salvar e entrar'}
      </button>

      <p className="text-xs leading-relaxed text-slate-500">
        Esta senha vale para o seu login corporativo no Supabase, que é o mesmo usado
        pelos outros sistemas internos — não apenas por este.
      </p>
    </form>
  );
}
