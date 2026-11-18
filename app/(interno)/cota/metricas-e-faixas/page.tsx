import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** Métricas e faixas (4.4.0) virou parte de Regras da cota (4.13.0): as faixas ficam junto dos pontos, na aba Atendimento. */
export default async function Antiga({ searchParams }: { searchParams: Promise<{ setor?: string }> }) {
  const { setor } = await searchParams;
  redirect(`/cota/metas?cat=atendimento${setor ? `&setor=${setor}` : ''}`);
}