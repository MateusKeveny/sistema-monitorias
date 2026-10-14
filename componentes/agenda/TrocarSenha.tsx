'use client';

import { useState } from 'react';
import { criarClienteDaAgenda } from '@/lib/agenda/db-cliente';

/** Troca da senha da agenda — o usuário nasce com a senha posta no painel do Supabase. */
export default function TrocarSenha() {
  const [aberto, setAberto] = useState(false);
  const [senha, setSenha] = useState('');
  const [repetir, setRepetir] = useState('');
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function trocar(e: React.FormEvent) {
    e.preventDefault();
    if (senha.length < 8) { setMensagem('Use ao menos 8 caracteres.'); return; }
    if (senha !== repetir) { setMensagem('As duas senhas não são iguais.'); return; }
    setOcupado(true);
    const { error } = await criarClienteDaAgenda().auth.updateUser({ password: senha });
    setOcupado(false);
    if (error) { setMensagem(`Não foi possível trocar: ${error.message}`); return; }
    setSenha(''); setRepetir(''); setAberto(false);
    setMensagem('Senha trocada.');
  }

  const campo = 'w-full rounded-lg border border-slate-300 bg-superficie px-3 py-2 text-sm text-slate-900';

  return (
    <div className="mt-4">
      {!aberto ? (
        <button onClick={() => { setAberto(true); setMensagem(null); }}
                className="text-sm font-medium text-slate-600 underline-offset-2 hover:text-slate-900 hover:underline">
          Trocar senha
        </button>
      ) : (
        <form onSubmit={trocar} className="grid max-w-sm gap-2">
          <input type="password" autoComplete="new-password" placeholder="Nova senha" className={campo}
                 value={senha} onChange={(e) => setSenha(e.target.value)} />
          <input type="password" autoComplete="new-password" placeholder="Repita a nova senha" className={campo}
                 value={repetir} onChange={(e) => setRepetir(e.target.value)} />
          <div className="flex gap-2">
            <button type="submit" disabled={ocupado}
                    className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-60">
              {ocupado ? 'Trocando…' : 'Trocar'}
            </button>
            <button type="button" onClick={() => setAberto(false)}
                    className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
          </div>
        </form>
      )}
      {mensagem && <p role="status" className="mt-2 text-sm text-slate-600">{mensagem}</p>}
    </div>
  );
}
