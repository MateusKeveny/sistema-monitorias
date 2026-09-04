import Link from '@/componentes/Link';
import { criarClienteServidor, exigirVisaoDoTime } from '@/lib/supabase/servidor';
import { Cartao, EtiquetaNota, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { data as formatarData, dataHora, codigoMonitoria } from '@/lib/formatar';

export const dynamic = 'force-dynamic';

type Excluida = {
  id: string;
  codigo: number | null;
  protocolo: string | null;
  data_atendimento: string | null;
  operador_nome: string | null;
  nota_final: number | null;
  zerado: boolean | null;
  motivo: string;
  excluida_por_nome: string | null;
  excluida_em: string;
  itens: { criterio: string; conforme: boolean; observacao: string | null }[] | null;
};

/**
 * O que foi apagado, por quem e por quê.
 *
 * Aprovar uma exclusão remove a monitoria e, junto, o pedido que a originou —
 * a solicitação aponta para a monitoria em cascata. Sem esta tela, uma
 * avaliação aprovada para exclusão sumiria sem deixar nada visível, que é o
 * oposto do que o registro foi criado para garantir.
 */
export default async function MonitoriasExcluidas() {
  await exigirVisaoDoTime();
  const db = await criarClienteServidor();

  const { data, error } = await db
    .from('monitorias_excluidas')
    .select('*')
    .order('excluida_em', { ascending: false });

  const excluidas = (data ?? []) as Excluida[];

  return (
    <div className="space-y-6">
      <div>
        <Link href="/monitorias" className="text-sm text-sobre-fundo-suave hover:underline">
          ← Monitorias
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-sobre-fundo">Monitorias excluídas</h1>
        <p className="text-sm text-sobre-fundo-suave">
          {excluidas.length} registro{excluidas.length === 1 ? '' : 's'} · o que foi apagado,
          por quem e por quê
        </p>
      </div>

      {error ? (
        <Cartao>
          <p className="text-sm text-rose-800">Não foi possível carregar: {error.message}</p>
        </Cartao>
      ) : excluidas.length === 0 ? (
        <Cartao>
          <Vazio>Nenhuma monitoria foi excluída até agora.</Vazio>
        </Cartao>
      ) : (
        <>
          <Cartao>
            <Tabela>
              <thead>
                <tr>
                  <Th>Código</Th>
                  <Th>Excluída em</Th>
                  <Th className="text-center">Protocolo</Th>
                  <Th>Operador</Th>
                  <Th>Data do atendimento</Th>
                  <Th className="text-right">Nota</Th>
                  <Th>Excluída por</Th>
                  <Th>Motivo</Th>
                </tr>
              </thead>
              <tbody>
                {excluidas.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <Td className="whitespace-nowrap font-mono tabular-nums text-slate-500">
                      {codigoMonitoria(e.codigo)}
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">{dataHora(e.excluida_em)}</Td>
                    <Td className="whitespace-nowrap text-center font-mono text-xs">
                      {e.protocolo ?? '—'}
                    </Td>
                    <Td className="whitespace-nowrap font-medium text-slate-900">
                      {e.operador_nome ?? '—'}
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {formatarData(e.data_atendimento)}
                    </Td>
                    <Td className="text-right">
                      <EtiquetaNota valor={e.nota_final} zerado={!!e.zerado} />
                    </Td>
                    <Td className="whitespace-nowrap text-slate-500">
                      {e.excluida_por_nome ?? '—'}
                    </Td>
                    <Td className="max-w-md text-slate-600">{e.motivo}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          </Cartao>

          <p className="text-xs leading-relaxed text-slate-500">
            O registro guarda também as respostas dos {19} critérios de cada monitoria apagada,
            porque sem elas não haveria como refazer a nota de uma exclusão feita por engano.
            Quando a exclusão passa por aprovação, o motivo traz quem pediu e quem aprovou.
          </p>
        </>
      )}
    </div>
  );
}
