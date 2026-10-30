/**
 * Login por nome de usuário (3.0). O Supabase só aceita e-mail; quem entra
 * com um nome simples — "admin" — usa por dentro um endereço do domínio
 * interno, que não recebe e-mail (senha esquecida: um gestor redefine).
 */
export const DOMINIO_INTERNO = 'painel.interno';

/** "admin" → "admin@painel.interno"; e-mail de verdade fica como está. */
export const emailDoLogin = (texto: string) => {
  const t = texto.trim().toLowerCase();
  return t.includes('@') ? t : `${t}@${DOMINIO_INTERNO}`;
};
