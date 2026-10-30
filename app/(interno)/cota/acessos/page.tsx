import { redirect } from 'next/navigation';

/** A tela Acessos virou a aba "Uso dos acessos" de "Usuários e setores" (3.0). */
export default async function Acessos({ searchParams }: { searchParams: Promise<{ sistema?: string }> }) {
  const { sistema } = await searchParams;
  redirect(`/cota/usuarios?cat=acessos${sistema === 'monitorias' ? '&sistema=monitorias' : ''}`);
}
