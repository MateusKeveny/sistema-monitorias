import Link from '@/componentes/Link';
import { Quadro, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { diaMes, hojeNoBrasil, periodoDaSemana } from '@/lib/formatar';

export type LinhaCobertura = {
  operador_id: string;
  operador: string;
  /** Quantas monitorias em cada semana do ciclo, índices 0 a 3. */
  semanas: number[];
};

const POR_SEMANA = 4;

/**
 * Quem está com semanas incompletas no ciclo.
 *
 * O teto de 4 por semana o formulário já garante; o que passava despercebido era
 * o contrário — uma pessoa monitorada 1 vez enquanto o restante do time foi 4.
 * Isso distorce a média dela sem que ninguém perceba, porque poucas avaliações
 * fazem qualquer erro pesar muito mais.
 *
 * A semana em andamento aparece destacada, com o andamento de cada pessoa
 * ("2 de 4"), sem entrar na cobrança (5.3.0).
 */
export default function CoberturaDoCiclo({
  linhas, semanasEncerradas, competencia, comLink = false,
}: {
  linhas: LinhaCobertura[];
  /** Quantas semanas do ciclo já terminaram (0 a 4). */
  semanasEncerradas: number;
  /** Mês de competência exibido ('2026-10-01'), para as datas de cada semana. */
  competencia: string;
  /**
   * Nome vira link para a Nova monitoria com a pessoa escolhida. Só no
   * Monitorias: no Performance a tela é de consulta.
   */
  comLink?: boolean;
}) {
  // Só cobra o que já venceu: num ciclo em andamento, semana que ainda não
  // aconteceu não é lacuna. Sem isso o quadro apontaria falha em todo mês novo.
  const meta = POR_SEMANA * semanasEncerradas;
  const totalEncerrado = (l: LinhaCobertura) =>
    l.semanas.slice(0, semanasEncerradas).reduce((s, n) => s + n, 0);
  const incompletos = meta === 0
    ? 0
    : linhas.filter((l) => totalEncerrado(l) < meta).length;

  const periodos = [1, 2, 3, 4].map((s) => periodoDaSemana(competencia, s));
  // Semana em andamento: a primeira não encerrada, desde que já tenha começado.
  const atual = semanasEncerradas < 4 && periodos[semanasEncerradas][0] <= hojeNoBrasil()
    ? semanasEncerradas : null;
  const completosNaAtual = atual == null ? 0
    : linhas.filter((l) => l.semanas[atual] >= POR_SEMANA).length;
  const destaque = 'bg-emerald-500/[0.06]';

  const cor = (n: number, encerrada: boolean) =>
    !encerrada ? 'bg-slate-100 text-slate-400'
      : n === 0 ? 'bg-rose-100 text-rose-800'
        : n < POR_SEMANA ? 'bg-amber-100 text-amber-900'
          : 'bg-emerald-100 text-emerald-800';

  const resumoAnteriores = semanasEncerradas === 0
    ? 'ciclo recém-começado'
    : incompletos === 0
      ? 'semanas anteriores em dia'
      : `${incompletos} com semana anterior incompleta`;

  return (
    <Quadro
      titulo="Cobertura do ciclo"
      acao={
        <span className="text-xs text-slate-500">
          {atual != null && (
            <>
              semana atual:{' '}
              <strong className="font-semibold text-marca-700 dark:text-marca-400">
                {completosNaAtual} de {linhas.length}
              </strong>{' '}
              completos ·{' '}
            </>
          )}
          {atual == null && semanasEncerradas === 4
            ? (incompletos === 0 ? 'todos em dia'
              : `${incompletos} operador${incompletos === 1 ? '' : 'es'} com semana incompleta`)
            : resumoAnteriores}
        </span>
      }
    >
      {linhas.length === 0 ? (
        <Vazio>Nenhum operador ativo cadastrado.</Vazio>
      ) : (
        <>
          <Tabela noQuadro>
            <thead>
              <tr>
                <Th>Operador</Th>
                {periodos.map(([de, ate], i) => (
                  <Th key={i} className={`text-center ${i === atual
                    ? `w-28 ${destaque} font-semibold text-marca-700 dark:text-marca-400` : 'w-24'}`}>
                    {i + 1}ª sem
                    <span className="block text-[10px] font-normal normal-case">
                      {i === atual ? 'semana atual' : `${diaMes(de)}–${diaMes(ate)}`}
                    </span>
                  </Th>
                ))}
                <Th className="w-24 text-right">No prazo</Th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const total = totalEncerrado(l);
                return (
                  <tr key={l.operador_id} className="hover:bg-slate-50">
                    <Td className="font-medium text-slate-900">
                      {comLink && atual != null ? (
                        <Link href={`/monitorias/nova?operador=${l.operador_id}`}
                              title={`Nova monitoria para ${l.operador}`}
                              className="hover:text-marca-700 hover:underline dark:hover:text-marca-400">
                          {l.operador}
                        </Link>
                      ) : l.operador}
                    </Td>
                    {l.semanas.map((n, i) => {
                      const encerrada = i < semanasEncerradas;
                      return (
                        <Td key={i} className={`text-center ${i === atual ? destaque : ''}`}>
                          {i === atual ? (
                            <span className={`inline-flex h-6 items-center justify-center rounded-md
                                              px-2 text-xs tabular-nums ${n >= POR_SEMANA
                              ? 'bg-emerald-100 font-semibold text-emerald-800'
                              : 'font-medium text-slate-700 ring-1 ring-inset ring-slate-300'}`}>
                              {n >= POR_SEMANA ? `${POR_SEMANA} de ${POR_SEMANA} ✓` : `${n} de ${POR_SEMANA}`}
                            </span>
                          ) : (
                            <span className={`inline-flex h-6 w-6 items-center justify-center
                                              rounded-md text-xs font-semibold tabular-nums
                                              ${cor(n, encerrada)}`}>
                              {!encerrada && n === 0 ? '–' : n}
                            </span>
                          )}
                        </Td>
                      );
                    })}
                    <Td className={`text-right tabular-nums ${
                      meta > 0 && total < meta ? 'font-semibold text-amber-700' : 'text-slate-500'}`}>
                      {total}/{meta}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabela>

          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            A meta é {POR_SEMANA} monitorias por semana. A coluna <strong>No prazo</strong>
            {' '}considera apenas as semanas já encerradas; a semana atual mostra o andamento,
            sem cobrar.{comLink && atual != null
              && ' Clique no nome para abrir a Nova monitoria já com a pessoa escolhida.'}
            {' '}Semana incompleta não é só cobertura em falta: com menos avaliações, uma nota
            baixa pesa muito mais na média da pessoa do que pesaria com o ciclo cheio.
          </p>
        </>
      )}
    </Quadro>
  );
}
