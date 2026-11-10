/**
 * De onde ler o cálculo de uma competência (migração 58) — a regra pura, sem
 * nada do servidor, para valer igual no servidor (lib/resumo.ts) e nas telas
 * que buscam os dados no navegador (4.1.0: Comparativo).
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

export function fonteDaSituacao(situacoes: SituacaoDoResumo[], competencia: string): FonteDoMes {
  const s = situacoes.find((r) => r.mes_competencia === competencia);
  const valido = s?.atualizado_em && Date.now() - Date.parse(s.atualizado_em) < VALIDADE_MS;
  return valido
    ? { extrato: 'resumo_extrato', mensal: 'resumo_cota_mensal', semCargo: 'resumo_sem_cargo',
        resumo: { atualizadoEm: s.atualizado_em!, pendente: s.pendente } }
    : { extrato: 'vw_extrato_cota', mensal: 'vw_cota_mensal', semCargo: 'vw_sem_cargo', resumo: null };
}
