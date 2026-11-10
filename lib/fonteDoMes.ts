/**
 * De onde ler o cálculo de uma competência (migração 58) — a regra pura, sem
 * nada do servidor, para valer igual no servidor (lib/resumo.ts) e nas telas
 * que buscam os dados no navegador (4.1.0: Comparativo).
 *
 * Mês com fechamento (migração 102, 4.1.0): as views "vigente", em que quem
 * fechou vem do fechamento (os pesos da época) e quem não fechou, do cálculo
 * ao vivo. O resumo e as views ao vivo calculam com os pesos de hoje — um peso
 * trocado para o mês seguinte mudava os pontos de um mês já fechado na tela.
 */
export type SituacaoDoResumo = { mes_competencia: string; atualizado_em: string | null; pendente: boolean };

export type FonteDoMes = {
  extrato: 'resumo_extrato' | 'vw_extrato_cota' | 'vw_extrato_vigente';
  mensal: 'resumo_cota_mensal' | 'vw_cota_mensal' | 'vw_cota_mensal_vigente';
  semCargo: 'resumo_sem_cargo' | 'vw_sem_cargo';
  /** Quando o resumo foi calculado e se há mudança pendente; null = cálculo ao vivo ou fechamento. */
  resumo: { atualizadoEm: string; pendente: boolean } | null;
  /** O mês tem fechamento: os pontos de quem fechou são os do fechamento. */
  fechado?: boolean;
};

const VALIDADE_MS = 40 * 60 * 1000;

export const FONTE_DO_FECHAMENTO: FonteDoMes = {
  extrato: 'vw_extrato_vigente', mensal: 'vw_cota_mensal_vigente', semCargo: 'vw_sem_cargo', resumo: null, fechado: true,
};

export function fonteDaSituacao(situacoes: SituacaoDoResumo[], competencia: string, fechado = false): FonteDoMes {
  if (fechado) return FONTE_DO_FECHAMENTO;
  const s = situacoes.find((r) => r.mes_competencia === competencia);
  const valido = s?.atualizado_em && Date.now() - Date.parse(s.atualizado_em) < VALIDADE_MS;
  return valido
    ? { extrato: 'resumo_extrato', mensal: 'resumo_cota_mensal', semCargo: 'resumo_sem_cargo',
        resumo: { atualizadoEm: s.atualizado_em!, pendente: s.pendente } }
    : { extrato: 'vw_extrato_cota', mensal: 'vw_cota_mensal', semCargo: 'vw_sem_cargo', resumo: null };
}
