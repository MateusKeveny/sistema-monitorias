import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Histórico de alterações (4.4.0) virou a aba Histórico de Regras da cota (4.13.0). */
export default async function Antiga({ searchParams }: { searchParams: Promise<{ setor?: string }> }) {
  const { setor } = await searchParams;
  redirect(`/cota/metas?cat=historico${setor ? `&setor=${setor}` : ''}`);
}