/**
 * Login da agenda por nome de usuário.
 *
 * O Supabase só autentica por e-mail (ou telefone), então o usuário "mateus"
 * vira `mateus@agenda.local` por baixo. `.local` não recebe e-mail: o usuário
 * é criado já confirmado no painel do Supabase, e a senha se troca nos
 * Ajustes da própria agenda.
 */
export const DOMINIO_DO_USUARIO = 'agenda.local';

export const USUARIO_VALIDO = /^[a-z0-9._-]{2,40}$/;

/** "Mateus " → "mateus"; aceita também quem digitar o e-mail inteiro. */
export const normalizarUsuario = (u: string) => u.trim().toLowerCase().replace(new RegExp(`@${DOMINIO_DO_USUARIO}$`), '');

export const emailDoUsuario = (u: string) => `${normalizarUsuario(u)}@${DOMINIO_DO_USUARIO}`;

export type Usuario = {
  id: string;
  usuario: string;
  nome: string;
  /** Liberado para ver as pendências do Performance (pela ponte). */
  ve_pendencias: boolean;
};
