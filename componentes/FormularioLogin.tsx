'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

const campo = `w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none
               focus:border-marca-600 focus:ring-2 focus:ring-marca-100`;

export default function FormularioLogin({
  titulo, aviso, proximo,
}: {
  /** Nome do sistema deste endereço (monitorias ou performance). */
  titulo: string;
  aviso: string | null;
  proximo: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(aviso);
  const [enviando, setEnviando] = useState(false);
  const [esqueci, setEsqueci] = useState(false);
  // 4.11.0: depois de um erro, a verificação; com 5 erros, bloqueio de 15 min.
  const [desafio, setDesafio] = useState<{ id: string; pergunta: string } | null>(null);
  const [resposta, setResposta] = useState('');
  const [bloqueado, setBloqueado] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setErro(null);

    // Pelo servidor (/auth/entrar): ele conta as tentativas e grava a sessão.
    // Nome de usuário ("admin") vira o endereço interno lá dentro (3.0).
    let r: { ok?: boolean; erro?: string; desafio?: { id: string; pergunta: string } | null; bloqueado?: boolean };
    try {
      const resp = await fetch('/auth/entrar', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ usuario: email, senha, desafio: desafio?.id, resposta }),
      });
      r = await resp.json();
    } catch {
      r = { erro: 'Não foi possível falar com o servidor. Confira a internet e tente de novo.' };
    }

    if (!r.ok) {
      setErro(r.erro ?? 'Não foi possível entrar.');
      setBloqueado(!!r.bloqueado);
      if (r.desafio !== undefined) { setDesafio(r.desafio); setResposta(''); }
      setEnviando(false);
      return;
    }

    // A sessão chegou pelos cookies da resposta; o cliente do navegador a lê de lá.
    await criarClienteNavegador().auth.getSession();
    router.push(proximo);
    router.refresh();
  }

  return (
    <form onSubmit={entrar} className="w-full max-w-sm space-y-5 rounded-2xl border border-slate-200 bg-superficie p-8 shadow-xl">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{titulo}</h1>
        <p className="mt-1 text-sm text-slate-500">Entre com seu e-mail corporativo ou nome de usuário.</p>
      </div>

      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">E-mail ou usuário</span>
        <input
          type="text" name="email" required autoComplete="username" autoCapitalize="none" spellCheck={false} value={email}
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

      {desafio && !bloqueado && (
        <label className="block rounded-lg bg-slate-50 px-3 py-2.5 ring-1 ring-slate-200">
          <span className="mb-1 block text-sm font-medium text-slate-700">Verificação: {desafio.pergunta}</span>
          <input
            type="text" inputMode="numeric" required autoComplete="off" value={resposta}
            onChange={(e) => setResposta(e.target.value.replace(/\D/g, ''))} className={campo}
            aria-label={`Verificação: ${desafio.pergunta}`}
          />
        </label>
      )}

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

      {/* Não há recuperação por e-mail: quem redefine é o gestor, pela ficha da
          pessoa em Atendentes, com uma senha temporária (migração 32). */}
      <div className="text-center">
        <button type="button" onClick={() => setEsqueci((v) => !v)} aria-expanded={esqueci}
                className="text-sm text-slate-500 hover:text-marca-700 hover:underline">
          Esqueci minha senha
        </button>
        {esqueci && (
          <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-left text-sm text-slate-600 ring-1 ring-slate-200">
            Procure o seu <strong>gestor</strong>: ele redefine a sua senha e passa uma senha temporária.
            No primeiro acesso com ela, o sistema pede que você crie uma nova.
          </p>
        )}
      </div>
    </form>
  );
}
