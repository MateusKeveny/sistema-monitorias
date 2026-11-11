/**
 * SLA dos chamados em faixas (4.3.0, migração 104).
 *
 * As faixas são as regras "chamados_sla_*", com faixa_min e faixa_max em
 * HORAS e a unidade de cada limite em unidade_max ('h' ou 'd'). Desde a 4.5.0
 * (migração 107) o relógio é a escala de quem tratou: limite em horas compara
 * horas úteis; limite em dias compara dias de expediente (1 dia = o expediente
 * da pessoa). Sem escala, vale o tempo do Elo (dias úteis de 24 h). O banco
 * guarda a faixa de cada chamado em chamados_elo.faixa_sla.
 *
 * A primeira faixa é sempre "chamados_sla_ate_2d" e a última, sem teto,
 * "chamados_sla_acima_2d" — o "fora do prazo", que vai para a fila de atrasos
 * e só conta com a decisão "manter". As do meio são chamados_sla_f2..f5.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export const SLA_PRIMEIRA = 'chamados_sla_ate_2d';
export const SLA_ULTIMA = 'chamados_sla_acima_2d';
export const SLA_PREFIXO = 'chamados_sla_';
/** Horas de um dia útil no relógio de hoje (o do Elo). */
export const HORAS_DO_DIA = 24;
/** O prazo de antes da 4.3.0, em dias úteis do Elo. */
export const PRAZO_PADRAO_DIAS = 3;
export const MAX_FAIXAS = 6;

export type UnidadeSla = 'h' | 'd';
export type RegraSla = { chave: string; rotulo: string; faixa_min: number | null; faixa_max: number | null; ativo: boolean; ordem: number; setor_id?: number | null; unidade_max?: UnidadeSla | null };

/** O que as telas leem de um chamado para o SLA (migração 107). */
export type ChamadoSla = { tempo_util: number | null; dias_escala?: number | null; horas_escala?: number | null; faixa_sla?: string | null };

/** Fora do prazo = caiu na última faixa. */
export const foraDoPrazo = (c: ChamadoSla) => c.faixa_sla === SLA_ULTIMA;

/** O tempo do chamado em dias úteis: pela escala de quem tratou, ou o do Elo. */
export const diasDoChamado = (c: ChamadoSla): number | null =>
  c.dias_escala != null ? Number(c.dias_escala) : c.tempo_util == null ? null : Number(c.tempo_util);

/** Quando há escala, a parte de quem trata e a do TI são proporcionais ao tempo do Elo. */
export function proporcaoDaEscala(c: ChamadoSla): number {
  if (c.dias_escala == null || !c.tempo_util) return 1;
  return Number(c.dias_escala) / Number(c.tempo_util);
}

export const ehSla = (chave: string) => chave.startsWith(SLA_PREFIXO);

/** As faixas ativas, da mais rápida à mais lenta. */
export function faixasDoSla<T extends RegraSla>(regras: T[]): T[] {
  return regras.filter((r) => r.ativo && ehSla(r.chave))
    .sort((a, b) => (a.faixa_min ?? 0) - (b.faixa_min ?? 0) || (a.faixa_max == null ? 1 : 0) - (b.faixa_max == null ? 1 : 0));
}

/** O prazo em dias úteis do Elo: onde começa a última faixa. Igual a sla_prazo_dias() no banco. */
export function prazoDoSlaEmDias(regras: RegraSla[]): number {
  const ultima = regras.find((r) => r.chave === SLA_ULTIMA && r.ativo);
  return ultima?.faixa_min != null ? Number(ultima.faixa_min) / HORAS_DO_DIA : PRAZO_PADRAO_DIAS;
}

/** Busca o prazo no banco (telas que não têm as regras em mãos). */
export async function lerPrazoDoSla(db: SupabaseClient): Promise<number> {
  const { data } = await db.from('regras').select('chave, faixa_min, ativo').eq('chave', SLA_ULTIMA).maybeSingle();
  return data ? prazoDoSlaEmDias([{ ...(data as RegraSla), rotulo: '', faixa_max: null, ordem: 0 }]) : PRAZO_PADRAO_DIAS;
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/** Horas → texto na unidade escolhida: "36 h" ou "1,5 dia útil". */
export function textoDoTempo(horas: number, u: UnidadeSla): string {
  if (u === 'h') return `${fmt(horas)} h`;
  const d = horas / HORAS_DO_DIA;
  return `${fmt(d)} ${d === 1 ? 'dia útil' : 'dias úteis'}`;
}

/**
 * Texto do prazo, para as telas: "1,5 dias úteis". Desde a 4.5.0 o dia útil é
 * o expediente de quem tratou (sem escala, 24 h do Elo), então as horas não
 * vão mais entre parênteses.
 */
export function textoDoPrazo(dias: number): string {
  return `${fmt(dias)} ${dias === 1 ? 'dia útil' : 'dias úteis'}`;
}

/**
 * Nome de cada faixa a partir dos limites (em horas). Cada limite tem a sua
 * unidade: dá para ter "SLA de 12 h a 2 dias úteis".
 */
export function rotuloDaFaixaSla(i: number, cortes: number[], unidades: UnidadeSla[]): string {
  const t = (j: number) => textoDoTempo(cortes[j], unidades[j] ?? 'h');
  if (i === 0) return `SLA até ${t(0)}`;
  if (i === cortes.length) return `SLA acima de ${t(i - 1)} (fora do prazo)`;
  return `SLA de ${t(i - 1)} a ${t(i)}`;
}

/**
 * A unidade em que cada limite foi escrito, lida do nome salvo das faixas
 * (o banco guarda só as horas). Sem pista no nome: dias úteis quando o limite
 * é dia inteiro, horas quando não é.
 */
export function unidadesSalvas(faixas: RegraSla[]): UnidadeSla[] {
  return faixas.slice(0, -1).map((f, i) => {
    if (f.unidade_max === 'h' || f.unidade_max === 'd') return f.unidade_max;
    const c = Number(f.faixa_max);
    const nomes = `${f.rotulo} ${faixas[i + 1]?.rotulo ?? ''}`;
    if (nomes.includes(textoDoTempo(c, 'h'))) return 'h';
    if (nomes.includes(textoDoTempo(c, 'd'))) return 'd';
    return c % HORAS_DO_DIA === 0 ? 'd' : 'h';
  });
}

/** Os limites precisam ser positivos e crescentes. */
export function problemasDosCortes(cortes: (number | null)[]): string | null {
  if (cortes.some((c) => c == null || !Number.isFinite(c) || c <= 0)) return 'Preencha todos os limites com um número maior que zero.';
  if (cortes.some((c, i) => i > 0 && c! <= cortes[i - 1]!)) return 'Os limites precisam crescer de uma faixa para a próxima.';
  return null;
}

/** A chave de cada posição: primeira, as do meio (f2..f5) e a última. */
export function chaveDaFaixa(i: number, total: number): string {
  if (i === 0) return SLA_PRIMEIRA;
  if (i === total - 1) return SLA_ULTIMA;
  return `${SLA_PREFIXO}f${i + 1}`;
}

/**
 * Grava as faixas: reaproveita as chaves que já existem (inclusive desligadas,
 * que voltam com os pesos de antes), cria as que faltam e desliga as do meio
 * que sobraram. A primeira e a última nunca são desligadas.
 */
export async function gravarSla(db: SupabaseClient, regras: RegraSla[], cortes: number[], u: UnidadeSla[]): Promise<string | null> {
  const total = cortes.length + 1;
  const existentes = new Map(regras.filter((r) => ehSla(r.chave)).map((r) => [r.chave, r]));
  const setorId = existentes.get(SLA_PRIMEIRA)?.setor_id ?? 1;
  const usadas = new Set<string>();
  for (let i = 0; i < total; i++) {
    const chave = chaveDaFaixa(i, total);
    usadas.add(chave);
    const dados = {
      rotulo: rotuloDaFaixaSla(i, cortes, u),
      faixa_min: i === 0 ? 0 : cortes[i - 1],
      faixa_max: i === total - 1 ? null : cortes[i],
      unidade_max: i === total - 1 ? null : (u[i] ?? 'h'),
      ordem: 91 + i,
      ativo: true,
    };
    const atual = existentes.get(chave);
    if (atual) {
      const igual = atual.rotulo === dados.rotulo && Number(atual.faixa_min ?? 0) === dados.faixa_min
        && (atual.faixa_max == null ? null : Number(atual.faixa_max)) === dados.faixa_max && atual.ordem === dados.ordem && atual.ativo
        && (atual.unidade_max ?? null) === dados.unidade_max;
      if (igual) continue;
      const { error } = await db.from('regras').update(dados).eq('chave', chave);
      if (error) return `${dados.rotulo}: ${error.message}`;
    } else {
      const { error } = await db.from('regras').insert({
        chave, grupo: 'manual', peso: 0, manual: true, valor_manual: false, setor_id: setorId, ...dados,
      });
      if (error) return `${dados.rotulo}: ${error.message}`;
    }
  }
  const sobra = [...existentes.values()].filter((r) => r.ativo && !usadas.has(r.chave)).map((r) => r.chave);
  if (sobra.length) {
    const { error } = await db.from('regras').update({ ativo: false }).in('chave', sobra);
    if (error) return `faixas que sobraram: ${error.message}`;
  }
  return null;
}
