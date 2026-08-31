import { Cartao, Tabela, Th, Td, Vazio } from '@/componentes/ui';

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
 */
export default function CoberturaDoCiclo({
  linhas, semanasEncerradas,
}: {
  linhas: LinhaCobertura[];
  /** Quantas semanas do ciclo já terminaram (0 a 4). */
  semanasEncerradas: number;
}) {
  // Só cobra o que já venceu: num ciclo em andamento, semana que ainda não
  // aconteceu não é lacuna. Sem isso o quadro apontaria falha em todo mês novo.
  const meta = POR_SEMANA * semanasEncerradas;
  const totalEncerrado = (l: LinhaCobertura) =>
    l.semanas.slice(0, semanasEncerradas).reduce((s, n) => s + n, 0);
  const incompletos = meta === 0
    ? 0
    : linhas.filter((l) => totalEncerrado(l) < meta).length;

  const cor = (n: number, encerrada: boolean) =>
    !encerrada ? 'bg-slate-100 text-slate-400'
      : n === 0 ? 'bg-rose-100 text-rose-800'
        : n < POR_SEMANA ? 'bg-amber-100 text-amber-900'
          : 'bg-emerald-100 text-emerald-800';

  return (
    <Cartao
      titulo="Cobertura do ciclo"
      acao={
        <span className="text-xs text-slate-500">
          {semanasEncerradas === 0
            ? 'ciclo recém-começado'
            : incompletos === 0
              ? 'todos em dia'
              : `${incompletos} operador${incompletos === 1 ? '' : 'es'} com semana incompleta`}
        </span>
      }
    >
      {linhas.length === 0 ? (
        <Vazio>Nenhum operador ativo cadastrado.</Vazio>
      ) : (
        <>
          <Tabela>
            <thead>
              <tr>
                <Th>Operador</Th>
                {[1, 2, 3, 4].map((s) => (
                  <Th key={s} className="w-20 text-center">
                    {s}ª sem
                    {s > semanasEncerradas && (
                      <span className="block text-[10px] font-normal normal-case">em aberto</span>
                    )}
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
                    <Td className="font-medium text-slate-900">{l.operador}</Td>
                    {l.semanas.map((n, i) => {
                      const encerrada = i < semanasEncerradas;
                      return (
                        <Td key={i} className="text-center">
                          <span className={`inline-flex h-6 w-6 items-center justify-center
                                            rounded-md text-xs font-semibold tabular-nums
                                            ${cor(n, encerrada)}`}>
                            {!encerrada && n === 0 ? '–' : n}
                          </span>
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
            {' '}considera apenas as semanas já encerradas — semana em aberto não é lacuna.
            Semana incompleta não é só cobertura em falta: com menos avaliações, uma nota
            baixa pesa muito mais na média da pessoa do que pesaria com o ciclo cheio.
          </p>
        </>
      )}
    </Cartao>
  );
}
