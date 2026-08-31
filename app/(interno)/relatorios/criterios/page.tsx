import Link from 'next/link';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { Cartao, Tabela, Th, Td, Vazio, Indicador } from '@/componentes/ui';
import { mesExtenso, percentual, nota } from '@/lib/formatar';
import type { LinhaCriterio } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export default async function RelatorioCriterios({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  await exigirPerfil();
  const { mes: mesEscolhido } = await searchParams;
  const db = await criarClienteServidor();

  const { data } = await db
    .from('vw_criterios_reprovados')
    .select('*')
    .order('mes_referencia', { ascending: false });

  const todas = (data ?? []) as LinhaCriterio[];
  const meses = [...new Set(todas.map((l) => l.mes_referencia))];
  const mes = mesEscolhido === 'todos'
    ? 'todos'
    : (mesEscolhido && meses.includes(mesEscolhido) ? mesEscolhido : meses[0]);

  if (!mes) {
    return (
      <Cartao titulo="Critérios mais reprovados">
        <Vazio>
          Ainda não há monitorias com detalhe por critério. Lance uma monitoria no sistema
          para este relatório começar a existir.
        </Vazio>
      </Cartao>
    );
  }

  // Quando "todos", consolida os meses somando avaliações e reprovações.
  const base = mes === 'todos' ? todas : todas.filter((l) => l.mes_referencia === mes);
  const consolidado = new Map<string, LinhaCriterio>();
  for (const l of base) {
    const atual = consolidado.get(l.criterio_id);
    if (!atual) { consolidado.set(l.criterio_id, { ...l }); continue; }
    atual.avaliacoes += l.avaliacoes;
    atual.reprovacoes += l.reprovacoes;
    atual.pontos_perdidos = Number(atual.pontos_perdidos) + Number(l.pontos_perdidos);
    atual.taxa_reprovacao = atual.reprovacoes / atual.avaliacoes;
  }

  const linhas = [...consolidado.values()]
    .sort((a, b) => Number(b.pontos_perdidos) - Number(a.pontos_perdidos));
  const comFalha = linhas.filter((l) => l.reprovacoes > 0);
  const totalPerdido = linhas.reduce((s, l) => s + Number(l.pontos_perdidos), 0);
  const avaliacoes = linhas[0]?.avaliacoes ?? 0;
  const maiorImpacto = comFalha[0];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/relatorios" className="text-sm text-slate-500 hover:underline">
            ← Relatórios
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Critérios mais reprovados</h1>
          <p className="text-sm text-slate-500">
            {mes === 'todos' ? 'Todo o período' : mesExtenso(mes)} ·
            {' '}{avaliacoes} atendimentos avaliados por critério
          </p>
        </div>

        <form className="flex items-center gap-2">
          <select name="mes" defaultValue={mes}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">
            <option value="todos">Todo o período</option>
            {meses.map((m) => <option key={m} value={m}>{mesExtenso(m)}</option>)}
          </select>
          <button className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm
                             font-medium text-slate-700 hover:bg-slate-50">
            Ver
          </button>
        </form>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Indicador
          rotulo="Critérios com reprovação" valor={`${comFalha.length} de ${linhas.length}`}
          detalhe="pelo menos uma falha no período"
        />
        <Indicador
          rotulo="Nota perdida acumulada" valor={totalPerdido.toFixed(2).replace('.', ',')}
          tom={totalPerdido > 0 ? 'alerta' : 'bom'}
          detalhe="soma dos pesos descontados em todas as monitorias"
        />
        <Indicador
          rotulo="Maior ofensor"
          valor={maiorImpacto ? percentual(Number(maiorImpacto.taxa_reprovacao)) : '—'}
          tom={maiorImpacto ? 'ruim' : 'bom'}
          detalhe={maiorImpacto?.criterio ?? 'nenhuma reprovação no período'}
        />
      </div>

      <Cartao>
        {linhas.length === 0 ? (
          <Vazio>Sem dados de critérios neste período.</Vazio>
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th>Critério</Th>
                <Th className="text-right">Peso</Th>
                <Th className="text-right">Avaliações</Th>
                <Th className="text-right">Reprovações</Th>
                <Th className="w-48">Taxa de reprovação</Th>
                <Th className="text-right">Nota perdida</Th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => (
                <tr key={l.criterio_id} className={l.reprovacoes ? 'hover:bg-slate-50' : 'text-slate-400'}>
                  <Td className={l.reprovacoes ? 'font-medium text-slate-900' : ''}>{l.criterio}</Td>
                  <Td className="text-right tabular-nums">{percentual(Number(l.peso))}</Td>
                  <Td className="text-right tabular-nums">{l.avaliacoes}</Td>
                  <Td className={`text-right tabular-nums ${
                    l.reprovacoes ? 'font-semibold text-rose-700' : ''}`}>
                    {l.reprovacoes || '—'}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-rose-500"
                          style={{ width: `${Number(l.taxa_reprovacao) * 100}%` }} />
                      </div>
                      <span className="w-12 shrink-0 text-right text-xs tabular-nums">
                        {percentual(Number(l.taxa_reprovacao))}
                      </span>
                    </div>
                  </Td>
                  <Td className="text-right tabular-nums">
                    {Number(l.pontos_perdidos) > 0
                      ? `−${Number(l.pontos_perdidos).toFixed(2).replace('.', ',')}`
                      : '—'}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </Cartao>

      <p className="text-xs leading-relaxed text-slate-500">
        <strong>Nota perdida</strong> multiplica cada reprovação pelo peso do critério: é o
        impacto real na média do time. Um critério com taxa alta mas peso baixo custa menos que
        um com taxa média e peso alto — por isso a ordenação usa esta coluna, e não a taxa.
      </p>
    </div>
  );
}
