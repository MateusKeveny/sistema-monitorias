import Link from '@/componentes/Link';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { Quadro, Vazio } from '@/componentes/ui';
import GraficoDeLinha, { type PontoDaLinha } from '@/componentes/GraficoDeLinha';
import { mesRotulo, percentual } from '@/lib/formatar';
import type { PagamentoMensal, Pessoa } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

type Fechamento = {
  id: string;
  mes_competencia: string;
  cargo: string | null;
  resultado: number;
  meta: number | null;
};

type LinhaFechada = {
  fechamento_id: string;
  semana: number | null;
  origem: string | null;
  regra: string;
  rotulo: string;
  grupo: string;
  ordem: number;
  quantidade: number;
  peso: number;
  cota: number;
};

const NOME_CANAL: Record<string, string> = {
  huggy: 'Expansão',
  diretores: 'Diretores-Expansão',
  geral: 'Monitoria e lançamentos',
};

const num = (v: number, casas = 2) =>
  Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas });
const reais = (v: number | null | undefined) =>
  v == null ? null : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Histórico: cada competência fechada, no mesmo resumo do extrato.
 *
 * Só aparece mês fechado, e de propósito: mês aberto ainda muda, e mostrar
 * valor que vai mudar é pior do que não mostrar valor nenhum. As linhas vêm da
 * cópia congelada no fechamento, não do cálculo de hoje — é o que foi
 * entregue.
 */
export default async function Historico({
  searchParams,
}: {
  searchParams: Promise<{ pessoa?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { pessoa: pessoaPedida } = await searchParams;
  const veOTime = perfil.papel !== 'operador';

  const db = await criarClienteServidor();

  const { data: pessoas } = veOTime
    ? await db.from('pessoas').select('id, nome').order('nome')
    : { data: [{ id: perfil.id, nome: perfil.nome }] };

  const lista = (pessoas ?? []) as Pick<Pessoa, 'id' | 'nome'>[];
  const pessoaId = veOTime && pessoaPedida && lista.some((p) => p.id === pessoaPedida)
    ? pessoaPedida : perfil.id;

  const [{ data: fechados }, { data: pagamentos }] = await Promise.all([
    db.from('fechamentos_cota').select('id, mes_competencia, cargo, resultado, meta')
      .eq('pessoa_id', pessoaId).order('mes_competencia', { ascending: false }),
    db.from('vw_pagamento_mensal').select('*').eq('pessoa_id', pessoaId),
  ]);

  const meses = (fechados ?? []) as Fechamento[];
  const pagamento = new Map(((pagamentos ?? []) as PagamentoMensal[])
    .map((p) => [p.mes_competencia, p]));

  const { data: detalhe } = meses.length
    ? await db.from('fechamento_linhas')
      .select('fechamento_id, semana, origem, regra, rotulo, grupo, ordem, quantidade, peso, cota')
      .in('fechamento_id', meses.map((m) => m.id)).order('ordem')
    : { data: [] };

  const linhas = (detalhe ?? []) as LinhaFechada[];
  const totalPago = meses.reduce(
    (a, m) => a + Number(pagamento.get(m.mes_competencia)?.valor ?? 0), 0);

  // Os meses do mais antigo ao mais recente, para a linha.
  const serie = [...meses].reverse();
  const naMeta = meses.filter((m) => m.meta && Number(m.resultado) >= Number(m.meta)).length;
  const melhor = meses.reduce<Fechamento | null>((a, m) => (!a || Number(m.resultado) > Number(a.resultado) ? m : a), null);
  const metaRef = meses.find((m) => m.meta)?.meta ?? null;
  const nomePessoa = lista.find((p) => p.id === pessoaId)?.nome ?? perfil.nome;
  const tomDe = (m: Fechamento) => {
    if (!m.meta) return 'bom' as const;
    const a = Number(m.resultado) / Number(m.meta);
    return a >= 1 ? 'bom' as const : a >= 0.9 ? 'atencao' as const : 'ruim' as const;
  };
  const rotuloCurto = (c: string) => `${['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'][Number(c.slice(5, 7)) - 1]}/${c.slice(2, 4)}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">
            {veOTime ? `Histórico de ${nomePessoa.split(/\s+/).slice(0, 2).join(' ')}` : 'Seu histórico'}
          </h1>
          <p className="mt-1 text-sm text-sobre-fundo-suave">
            Competências fechadas: o que foi entregue e pago em cada mês.
          </p>
        </div>

        {veOTime && (
          <form className="flex items-end gap-2">
            <label>
              <span className="mb-1 block text-xs font-medium text-sobre-fundo-suave">Pessoa</span>
              <select name="pessoa" defaultValue={pessoaId}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {lista.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </label>
            <button className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5
                               text-sm font-medium text-slate-700 hover:bg-slate-50">
              Abrir
            </button>
          </form>
        )}
      </div>

      {!meses.length ? <Quadro><Vazio>Nenhuma competência fechada ainda.</Vazio></Quadro> : (
        <>
          {/* O histórico inteiro de uma olhada, antes do detalhe de cada mês. */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { rotulo: 'Meses fechados', valor: String(meses.length) },
              { rotulo: 'Total recebido', valor: totalPago > 0 ? reais(totalPago)! : '—', verde: totalPago > 0 },
              { rotulo: 'Na meta', valor: `${naMeta} de ${meses.length}` },
              { rotulo: 'Melhor mês', valor: melhor ? `${rotuloCurto(melhor.mes_competencia)} · ${num(Number(melhor.resultado), 0)} pts` : '—' },
            ].map((r) => (
              <div key={r.rotulo} className="rounded-2xl bg-superficie px-5 py-4 shadow-sm">
                <p className="text-sm text-slate-500">{r.rotulo}</p>
                <p className={`text-2xl font-semibold tracking-tight tabular-nums ${
                  r.verde ? 'text-marca-700 dark:text-marca-400' : 'text-slate-900'}`}>{r.valor}</p>
              </div>
            ))}
          </div>

          {serie.length > 1 && (
            <Quadro titulo="Pontos por mês"
                    subtitulo={`Verde na meta, âmbar até 10% abaixo, rosa mais abaixo.${metaRef ? ` Linha tracejada: a meta de ${num(Number(metaRef), 0)}.` : ''}`}>
              <GraficoDeLinha largura={Math.max(640, serie.length * 90)} rotulos={serie.map((m) => rotuloCurto(m.mes_competencia))}
                              formatar={(v) => num(v, 0)}
                              referencia={metaRef ? { valor: Number(metaRef), rotulo: `meta ${num(Number(metaRef), 0)}` } : undefined}
                              pontos={serie.map((m): PontoDaLinha => ({ valor: Number(m.resultado), tom: tomDe(m) }))} />
            </Quadro>
          )}
        </>
      )}

      {meses.map((m, indice) => {

        const doMes = linhas.filter((l) => l.fechamento_id === m.id);
        const pago = pagamento.get(m.mes_competencia);
        const canais = [...new Set(doMes.map((l) => l.origem ?? 'geral'))]
          .sort((a, b) => (a === 'geral' ? 1 : 0) - (b === 'geral' ? 1 : 0));

        return (
          <Quadro
            key={m.id}
            titulo={mesRotulo(m.mes_competencia)}
            acao={
              <span className="flex flex-col items-end gap-0.5 text-sm">
                <span className="flex flex-wrap items-baseline justify-end gap-x-3">
                  <span className="font-semibold tabular-nums text-slate-900">
                    {num(Number(m.resultado), 0)} pts
                  </span>
                  {m.meta && (
                    <span className="text-xs text-slate-500">
                      {percentual(Number(m.resultado) / Number(m.meta))} da meta
                    </span>
                  )}
                  {pago && !pago.atingiu_meta && (
                    <span className="text-xs text-slate-500">abaixo da meta</span>
                  )}
                  {pago?.atingiu_meta && pago.valor != null && (
                    <span className="font-semibold tabular-nums text-marca-700 dark:text-marca-400">
                      {reais(pago.valor)}
                    </span>
                  )}
                </span>
                {pago?.atingiu_meta && pago.valor != null && (
                  <span className="text-right text-[11px] text-slate-500 opacity-60">
                    *Valores aproximados. Os valores reais são encaminhados via Teams.
                  </span>
                )}
              </span>
            }
          >
            <p className="mb-4 text-xs text-slate-500">
              {m.cargo ?? 'sem cargo'}
              {pago && Number(pago.bonus) > 0 && (
                <> · bônus de equipe <strong>+{num(Number(pago.bonus))}</strong> pts</>
              )}
              {pago?.atingiu_meta && pago.valor == null && <> · valor por ponto ainda não informado</>}
            </p>

            {/* O detalhe fica recolhido: aberto, o histórico virava uma página
                interminável. Só o mês mais recente vem aberto. */}
            <details open={indice === 0} className="group">
              <summary className="cursor-pointer select-none text-sm font-medium text-marca-700 marker:text-slate-400 dark:text-marca-400">
                Detalhe do mês
              </summary>
            <div className="mt-3 space-y-4">
              {canais.map((canal) => {
                const doCanal = doMes.filter((l) => (l.origem ?? 'geral') === canal);
                const soma = doCanal.reduce((a, l) => a + Number(l.cota), 0);

                // Cada categoria somada no mês, como no resumo do extrato.
                const categorias = [...new Map(doCanal.map((l) => [l.regra, l])).values()]
                  .sort((a, b) => a.ordem - b.ordem)
                  .map((base) => {
                    const iguais = doCanal.filter((l) => l.regra === base.regra);
                    return {
                      ...base,
                      quantidade: iguais.reduce((a, l) => a + Number(l.quantidade), 0),
                      cota: iguais.reduce((a, l) => a + Number(l.cota), 0),
                    };
                  });

                return (
                  <section key={canal}>
                    <h3 className="mb-1 flex items-baseline justify-between gap-2 rounded bg-slate-100
                                   px-2 py-1 text-xs font-semibold text-slate-600">
                      {NOME_CANAL[canal] ?? canal}
                      <span className="tabular-nums">{num(soma)} pts</span>
                    </h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[11px] text-slate-500">
                          <th className="pb-1 pr-2 font-semibold">Categoria</th>
                          <th className="px-2 pb-1 text-right font-semibold">Feito</th>
                          <th className="px-2 pb-1 text-right font-semibold">Pontuação</th>
                          <th className="pb-1 pl-2 text-right font-semibold">Cota</th>
                        </tr>
                      </thead>
                      <tbody>
                        {categorias.map((c) => (
                          <tr key={c.regra} className="border-t border-slate-100">
                            <td className="py-1.5 pr-2 text-slate-800">{c.rotulo}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
                              {c.grupo === 'csat' || c.grupo === 'monitoria'
                                ? num(Number(c.quantidade), 4) : num(Number(c.quantidade))}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">
                              {num(Number(c.peso))}
                            </td>
                            <td className={`py-1.5 pl-2 text-right font-semibold tabular-nums ${
                              Number(c.cota) < 0 ? 'text-rose-700' : 'text-slate-800'}`}>
                              {num(Number(c.cota))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                );
              })}
            </div>

            </details>

            <p className="mt-4 text-xs text-slate-500">
              Valores congelados no fechamento.{' '}
              <Link href={`/cota/extrato?pessoa=${pessoaId}&mes=${m.mes_competencia.slice(0, 7)}`}
                    className="text-marca-700 hover:underline dark:text-marca-400">
                Ver o extrato semana a semana
              </Link>
            </p>
          </Quadro>
        );
      })}
    </div>
  );
}
