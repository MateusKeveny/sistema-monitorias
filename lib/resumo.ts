import { cache } from 'react';
import { criarClienteServidor } from '@/lib/supabase/servidor';

/**
 * Resumo do mês aberto (migração 58): o cálculo da cota guardado pronto.
 *
 * As telas leem as tabelas de resumo em vez das views quando o mês está no
 * resumo e foi calculado há menos de 40 minutos (a tarefa roda a cada minuto
 * havendo mudança, e a cada 30 sem mudança). Fora disso — mês fora da janela,
 * resumo nunca calculado ou tarefa parada — voltam às views, como antes.
 *
 * As tabelas têm as mesmas colunas das views, então trocar a fonte é trocar
 * o nome em `.from()`. O fechamento e a exportação continuam nas views.
 */
export type SituacaoDoResumo = { mes_competencia: string; atualizado_em: string | null; pendente: boolean };

export type FonteDoMes = {
  extrato: 'resumo_extrato' | 'vw_extrato_cota';
  mensal: 'resumo_cota_mensal' | 'vw_cota_mensal';
  semCargo: 'resumo_sem_cargo' | 'vw_sem_cargo';
  /** Quando o resumo foi calculado e se há mudança pendente; null = cálculo ao vivo. */
  resumo: { atualizadoEm: string; pendente: boolean } | null;
};

const VALIDADE_MS = 40 * 60 * 1000;

/** Uma consulta por renderização, dividida por todas as telas e componentes. */
export const situacaoDoResumo = cache(async (): Promise<SituacaoDoResumo[]> => {
  const db = await criarClienteServidor();
  const { data } = await db.rpc('situacao_do_resumo');
  return (data ?? []) as SituacaoDoResumo[];
});

/** De onde ler o cálculo de uma competência. */
export async function fonteDoMes(competencia: string): Promise<FonteDoMes> {
  const s = (await situacaoDoResumo()).find((r) => r.mes_competencia === competencia);
  const valido = s?.atualizado_em && Date.now() - Date.parse(s.atualizado_em) < VALIDADE_MS;
  return valido
    ? { extrato: 'resumo_extrato', mensal: 'resumo_cota_mensal', semCargo: 'resumo_sem_cargo',
        resumo: { atualizadoEm: s.atualizado_em!, pendente: s.pendente } }
    : { extrato: 'vw_extrato_cota', mensal: 'vw_cota_mensal', semCargo: 'vw_sem_cargo', resumo: null };
}
