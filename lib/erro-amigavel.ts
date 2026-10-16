'use client';

import { criarClienteNavegador } from '@/lib/supabase/cliente';

type ErroDoBanco = { message: string; code?: string | null };

/** Recusa de permissão ou de sessão, como o banco (RLS) e o login a devolvem. */
const ehRecusa = (e: ErroDoBanco) =>
  e.code === '42501' || e.code === 'PGRST301' || e.code === 'PGRST303'
  || /row-level security|permission denied|jwt|not authenticated|invalid claim/i.test(e.message);

/**
 * O erro do banco em português, para a tela (1.51.1).
 *
 * A recusa do banco chega igual em dois casos bem diferentes, e a mensagem
 * técnica ("new row violates row-level security policy…") não ajudava em
 * nenhum:
 *   - a conta não vale mais (apagada, encerrada pelo gestor, sessão vencida):
 *     avisa e leva ao login;
 *   - a pessoa existe, mas a ação não é dela: "Você não tem permissão".
 * O que separa um do outro é perguntar ao banco quem está logado agora. Os
 * demais erros passam como vieram — são mensagens das próprias funções do
 * banco, já em português.
 */
export async function mensagemDoErro(erro: ErroDoBanco): Promise<string> {
  if (!ehRecusa(erro)) return erro.message;
  let valida = false;
  try {
    const db = criarClienteNavegador();
    const { data: { user } } = await db.auth.getUser();
    if (user) {
      const { data: papel } = await db.rpc('papel_atual');
      valida = !!papel;
    }
  } catch {
    valida = false;
  }
  if (!valida) {
    setTimeout(() => window.location.assign('/login?erro=sessao-encerrada'), 2500);
    return 'Sua sessão não vale mais. Levando você para entrar de novo…';
  }
  return 'Você não tem permissão para fazer isso. Se precisar, fale com a gestão.';
}
