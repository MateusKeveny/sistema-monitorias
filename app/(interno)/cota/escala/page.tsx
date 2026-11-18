import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Escala e feriados (4.6.0) virou parte de Regras da cota (4.13.0), na aba Chamados, junto do SLA. */
export default async function Antiga({ searchParams }: { searchParams: Promise<{ setor?: string }> }) {
  const { setor } = await searchParams;
  redirect(`/cota/metas?cat=chamados${setor ? `&setor=${setor}` : ''}`);
}