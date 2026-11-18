import { redirect } from 'next/navigation';
import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import AvisosTeams, { type SituacaoAviso } from '@/componentes/AvisosTeams';

export const dynamic = 'force-dynamic';

/**
 * As abas de antes da 4.4.0 e para onde foram: os links antigos (e os
 * favoritos) continuam chegando ao lugar certo. 4.13.0: as regras da cota
 * numa tela só (Regras da cota) e as do diário dentro do Diário de bordo.
 */
const MUDOU_PARA: Record<string, string> = {
  pesos: '/cota/metas?cat=demandas',
  filas: '/cota/metas?cat=atendimento',
  metricas: '/cota/metas?cat=atendimento',
  faixas: '/cota/metas?cat=atendimento',
  historico: '/cota/metas?cat=historico',
  diario: '/cota/diario?cat=configurar',
};

/**
 * Configuração (4.4.0): o que é do sistema e quase não se mexe. Desde a 4.13.0
 * só os avisos no Teams — as regras do diário (quem vê, subcategorias) foram
 * para a aba "Configurar" do Diário de bordo, onde elas são usadas.
 */
export default async function ConfiguracaoDaCota({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; setor?: string }>;
}) {
  await exigirGestor();
  const { cat, setor } = await searchParams;
  if (cat && MUDOU_PARA[cat]) redirect(`${MUDOU_PARA[cat]}${setor ? `&setor=${setor}` : ''}`);

  const db = await criarClienteServidor();
  // Avisos no Teams (migração 40).
  const { data: avisos } = await db.rpc('situacao_dos_avisos');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Configuração</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">
          Os avisos no Teams. As regras da cota ficam em Regras da cota; as do diário, no próprio Diário de bordo (aba Configurar).
        </p>
      </div>
      <AvisosTeams situacao={(avisos ?? []) as SituacaoAviso[]} />
    </div>
  );
}
