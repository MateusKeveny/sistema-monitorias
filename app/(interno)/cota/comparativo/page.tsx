import TelaComparativo from './tela';
import { exigirPerfil } from '@/lib/supabase/servidor';
import { resolverCompetencia } from '@/lib/competencia';
import { situacaoDoResumo } from '@/lib/resumo';
import { setorDoCookie } from '@/lib/setorEscolhido';
import { todas } from '@/lib/consultas';

export const dynamic = 'force-dynamic';

/**
 * Comparativo entre meses (1.17.0): cada categoria mês a mês.
 *
 * O resto do painel compara com o mês anterior; aqui aparecem vários meses
 * lado a lado — a pergunta é "estamos melhorando?". Para cada categoria
 * (Pontuação, C-SAT, Volume, TME, Monitoria): um resumo do período, a linha
 * dos meses com a referência e, para quem vê o time, a tabela por atendente
 * com os meses nas colunas.
 *
 * O operador vê a própria evolução: as consultas respeitam a RLS, então os
 * dados já chegam só dele, e a tabela por atendente nem é montada. O Pleno,
 * por enquanto, também — ver a equipe aqui depende da migração 31.
 *
 * Pontuação de mês fechado sai do fechamento (o que foi entregue); de mês
 * aberto, do cálculo ao vivo — a mesma regra do extrato.
 *
 * 4.1.0 (erro 1102): o servidor só confere quem é e qual o mês; as consultas e
 * o desenho ficam no navegador (tela.tsx), fora do limite da Cloudflare.
 */
export default async function Comparativo({
  searchParams,
}: {
  searchParams: Promise<{ n?: string; cat?: string }>;
}) {
  const { n, cat } = await searchParams;
  const [perfil, { competencia: fim }, situacoes, setorPedido] = await todas([
    exigirPerfil(), resolverCompetencia(), situacaoDoResumo(), setorDoCookie(),
  ]);
  return (
    <TelaComparativo n={n} cat={cat} perfil={{ id: perfil.id, papel: perfil.papel }} fim={fim}
                     situacoes={situacoes} setorPedido={setorPedido} />
  );
}
