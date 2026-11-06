/**
 * Aprovação da CEO (4.0.0): regras usadas no servidor e no navegador. Fica
 * fora de componentes 'use client': o servidor não chama função de lá.
 */

/** Aguarda a CEO: sem decisão, ou recusada e já respondida pelo gestor. */
export const aguarda = (p: { decisao: string | null }) => !p.decisao || p.decisao === 'respondido';
