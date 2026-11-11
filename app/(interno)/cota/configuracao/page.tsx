import { redirect } from 'next/navigation';
import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import AvisosTeams, { type SituacaoAviso } from '@/componentes/AvisosTeams';
import SubcategoriasDiario from '@/componentes/SubcategoriasDiario';
import QuemVeODiario, { type VisibilidadeDoDiario } from '@/componentes/QuemVeODiario';
import type { Subcategoria } from '@/lib/diario';

export const dynamic = 'force-dynamic';

/**
 * As abas de antes da 4.4.0 e para onde foram: os links antigos (e os
 * favoritos) continuam chegando ao lugar certo.
 */
const MUDOU_PARA: Record<string, string> = {
  pesos: '/cota/metas',
  filas: '/cota/metas',
  metricas: '/cota/metricas-e-faixas',
  faixas: '/cota/metricas-e-faixas',
  historico: '/cota/alteracoes',
};

/**
 * Configuração (4.4.0): o que é do sistema e quase não se mexe — os avisos no
 * Teams e as regras do diário de bordo. As regras da cota (pesos, métricas,
 * faixas, SLA e o histórico) saíram daqui para o grupo "Metas e métricas" do
 * menu, cada uma na sua tela.
 */
export default async function ConfiguracaoDaCota({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string; setor?: string }>;
}) {
  await exigirGestor();
  const { cat, setor } = await searchParams;
  if (cat && MUDOU_PARA[cat]) redirect(`${MUDOU_PARA[cat]}${setor ? `?setor=${setor}` : ''}`);

  const db = await criarClienteServidor();
  const [{ data: avisos }, { data: subcategorias }, { data: usosSub }, { data: visibilidade }] = await Promise.all([
    // Avisos no Teams (migração 40).
    db.rpc('situacao_dos_avisos'),
    // Subcategorias de problema operacional e quantos registros usam cada uma (migração 46).
    db.from('diario_subcategorias').select('*').order('ordem'),
    db.from('diario_registros').select('subcategoria_id').not('subcategoria_id', 'is', null),
    // Quem vê cada tipo de registro do diário (migração 67).
    db.from('diario_visibilidade').select('*'),
  ]);
  const usos: Record<number, number> = {};
  for (const u of (usosSub ?? []) as { subcategoria_id: number }[]) usos[u.subcategoria_id] = (usos[u.subcategoria_id] ?? 0) + 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Configuração</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">
          Os avisos no Teams e as regras do diário de bordo. Pesos, métricas e faixas ficam em Metas e métricas, no menu.
        </p>
      </div>
      <AvisosTeams situacao={(avisos ?? []) as SituacaoAviso[]} />
      <QuemVeODiario configuracao={(visibilidade ?? []) as VisibilidadeDoDiario[]} />
      <SubcategoriasDiario subcategorias={(subcategorias ?? []) as Subcategoria[]} usos={usos} />
    </div>
  );
}
