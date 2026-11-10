import { cache } from 'react';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { fonteDaSituacao, type FonteDoMes, type SituacaoDoResumo } from '@/lib/fonteDoMes';

/**
 * Resumo do mês aberto (migração 58): o cálculo da cota guardado pronto.
 *
 * As telas leem as tabelas de resumo em vez das views quando o mês está no
 * resumo e foi calculado há menos de 40 minutos (a tarefa roda a cada minuto
 * havendo mudança, e a cada 30 sem mudança). Fora disso — mês fora da janela,
 * resumo nunca calculado ou tarefa parada — voltam às views, como antes.
 *
 * As tabelas têm as mesmas colunas das views, então trocar a fonte é trocar
 * o nome em `.from()`. A exportação continua nas views; o Fechamento usa o
 * resumo para a prévia (2.8.1) — fechar calcula no banco.
 *
 * A regra da escolha está em lib/fonteDoMes.ts (4.1.0), que o navegador também usa.
 */
export type { FonteDoMes, SituacaoDoResumo };

/** Uma consulta por renderização, dividida por todas as telas e componentes. */
export const situacaoDoResumo = cache(async (): Promise<SituacaoDoResumo[]> => {
  const db = await criarClienteServidor();
  const { data } = await db.rpc('situacao_do_resumo');
  return (data ?? []) as SituacaoDoResumo[];
});

/**
 * O mês tem fechamento que quem está logado enxerga (102, 4.1.0)? Uma
 * consulta leve por mês e por renderização.
 */
const mesTemFechamento = cache(async (competencia: string): Promise<boolean> => {
  const db = await criarClienteServidor();
  const { count } = await db.from('fechamentos_cota').select('id', { count: 'exact', head: true })
    .eq('mes_competencia', competencia);
  return (count ?? 0) > 0;
});

/** De onde ler o cálculo de uma competência. */
export async function fonteDoMes(competencia: string): Promise<FonteDoMes> {
  const [situacoes, fechado] = await Promise.all([situacaoDoResumo(), mesTemFechamento(competencia)]);
  return fonteDaSituacao(situacoes, competencia, fechado);
}
