/**
 * Pontuação única nos atendimentos (4.12.0, migração 112).
 *
 * Com a chave do setor ligada (setores.pontuacao_unica_atendimento), tudo o
 * que é atendimento tem um valor só, igual em todos os cargos que atendem. O
 * cálculo não muda: continua lendo o peso de cada cargo em pesos_por_cargo.
 *
 * É atendimento:
 *   - o que vem das filas: finalizado, TME, TMA, C-SAT e notas;
 *   - o atendimento de outro setor lançado à mão (chaves "outro_setor_…",
 *     como o C-SAT, as notas e os finalizados do iGreen Mob);
 *   - transferências;
 *   - os atendimentos lançados à mão: "Atendimento presencial", "Atendimento
 *     Chatwoot", "Atendimento 3C"… (nome começando por "Atendimento"), menos
 *     os analíticos ("Atendimento a demandas analíticas", que é tarefa).
 */
import type { Cargo, RegraCota } from '@/lib/tipos';

/** Os grupos de regra que vêm das filas (sem o sufixo _sN do setor). */
const GRUPOS_DE_ATENDIMENTO = ['atendimento', 'tme', 'tme_diretores', 'tma', 'csat', 'nota'];

const semAcento = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function ehMetricaDeAtendimento(r: Pick<RegraCota, 'grupo' | 'chave' | 'rotulo'>) {
  if (GRUPOS_DE_ATENDIMENTO.includes(r.grupo.replace(/_s\d+$/, ''))) return true;
  if (r.chave.startsWith('outro_setor_')) return true;
  if (r.chave.replace(/_s\d+$/, '') === 'transferencias') return true;
  const nome = semAcento(r.rotulo.trim());
  return /^atendimento\b/.test(nome) && !nome.includes('analit');
}

/** Os cargos que recebem o valor único: todos os do setor que recebem cota. */
export const cargosDaPontuacaoUnica = (cargos: Cargo[]) => cargos.filter((c) => c.recebe_cota !== false);

/** O cargo de onde vem o valor ao ligar a chave: o Júnior, ou o primeiro. */
export const cargoDeReferencia = (cargos: Cargo[]) =>
  cargos.find((c) => c.nome === 'Atendente Júnior') ?? cargosDaPontuacaoUnica(cargos)[0] ?? cargos[0];
