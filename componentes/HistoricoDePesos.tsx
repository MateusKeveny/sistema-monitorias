import { Quadro, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { dataHora, mesRotulo } from '@/lib/formatar';

export type AlteracaoDePeso = {
  id: number;
  cargo_nome: string | null;
  regra: string;
  regra_rotulo: string | null;
  peso_antes: number | null;
  peso_depois: number | null;
  ativo_antes: boolean | null;
  ativo_depois: boolean | null;
  motivo: string | null;
  vale_para: string;
  alterado_por_nome: string | null;
  alterado_em: string;
};

const num = (v: number | null) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 4 }));

/** O que mudou, em palavras: 5 → 3, ligada, desligada. */
function Mudanca({ a }: { a: AlteracaoDePeso }) {
  if (a.ativo_antes == null) {
    return <span>criada com <b className="font-semibold">{num(a.peso_depois)}</b>{a.ativo_depois ? '' : ' (desligada)'}</span>;
  }
  if (a.ativo_antes !== a.ativo_depois) {
    return <span>{a.ativo_depois ? <>ligada com <b className="font-semibold">{num(a.peso_depois)}</b></> : 'desligada'}</span>;
  }
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="text-slate-400 line-through">{num(a.peso_antes)}</span>
      <span className="mx-1.5 text-slate-400">→</span>
      <b className="font-semibold text-slate-900">{num(a.peso_depois)}</b>
    </span>
  );
}

/**
 * Histórico de alteração de pesos (migração 56): cada mudança em pesos,
 * meta, multiplicador da média ou métrica ligada/desligada, com quem, quando,
 * para qual mês e o motivo. Só o gestor vê; nada disso aparece no extrato.
 */
export default function HistoricoDePesos({ alteracoes }: { alteracoes: AlteracaoDePeso[] }) {
  return (
    <Quadro titulo="Histórico de alterações"
            subtitulo="Pesos, meta, multiplicador da média e métricas ligadas ou desligadas — do mais recente ao mais antigo. Começa na versão 1.39.0.">
      {alteracoes.length === 0 ? (
        <Vazio>Nenhuma alteração registrada ainda.</Vazio>
      ) : (
        <Tabela noQuadro>
          <thead>
            <tr><Th>Quando</Th><Th>Cargo · métrica</Th><Th>Alteração</Th><Th>Motivo</Th><Th>Quem</Th></tr>
          </thead>
          <tbody>
            {alteracoes.map((a) => (
              <tr key={a.id} className="align-top">
                <Td className="whitespace-nowrap text-sm tabular-nums">
                  {dataHora(a.alterado_em)}
                  <span className="block text-xs text-slate-500">vale para {mesRotulo(a.vale_para)}</span>
                </Td>
                <Td>
                  {a.cargo_nome ?? '—'}
                  <span className="block text-xs text-slate-500">{a.regra_rotulo ?? a.regra}</span>
                </Td>
                <Td><Mudanca a={a} /></Td>
                <Td className="max-w-[22rem] text-sm text-slate-700">
                  {a.motivo ?? <span className="text-slate-400">sem motivo</span>}
                </Td>
                <Td className="whitespace-nowrap text-sm">{a.alterado_por_nome ?? '—'}</Td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
    </Quadro>
  );
}
