import Link from 'next/link';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { Cartao, EtiquetaNota, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { mesExtenso, mesCurto, nota, percentual } from '@/lib/formatar';
import type { LinhaRanking } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export default async function RelatorioRanking({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  await exigirPerfil();
  const { mes: mesEscolhido } = await searchParams;
  const db = await criarClienteServidor();

  const { data: tudo } = await db
    .from('vw_ranking_mensal')
    .select('*')
    .order('mes_referencia', { ascending: false })
    .order('nota_media', { ascending: false });

  const linhas = (tudo ?? []) as LinhaRanking[];
  const meses = [...new Set(linhas.map((l) => l.mes_referencia))];
  const mes = mesEscolhido && meses.includes(mesEscolhido) ? mesEscolhido : meses[0];
  const doMes = linhas.filter((l) => l.mes_referencia === mes);

  // Comparação com o mês anterior, para mostrar quem subiu e quem caiu.
  const anterior = meses[meses.indexOf(mes) + 1];
  const notaAnterior = new Map(
    linhas.filter((l) => l.mes_referencia === anterior)
      .map((l) => [l.operador_id, Number(l.nota_media)]));

  const totalMonitorias = doMes.reduce((s, l) => s + l.total_monitorias, 0);
  const mediaGeral = totalMonitorias
    ? doMes.reduce((s, l) => s + Number(l.nota_media) * l.total_monitorias, 0) / totalMonitorias
    : null;

  if (!mes) {
    return <Cartao titulo="Ranking mensal"><Vazio>Ainda não há monitorias registradas.</Vazio></Cartao>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/relatorios" className="text-sm text-slate-500 hover:underline">
            ← Relatórios
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Ranking mensal por operador</h1>
          <p className="text-sm text-slate-500">
            {mesExtenso(mes)} · {totalMonitorias} monitorias · média geral {nota(mediaGeral)}
          </p>
        </div>

        <form className="flex items-center gap-2">
          <select name="mes" defaultValue={mes}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">
            {meses.map((m) => <option key={m} value={m}>{mesExtenso(m)}</option>)}
          </select>
          <button className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm
                             font-medium text-slate-700 hover:bg-slate-50">
            Ver
          </button>
          <Link href={`/api/exportar?formato=csv&relatorio=ranking&mes=${mes}`}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm
                       font-medium text-slate-700 hover:bg-slate-50">
            CSV
          </Link>
        </form>
      </div>

      <Cartao>
        {doMes.length === 0 ? (
          <Vazio>Nenhuma monitoria neste mês.</Vazio>
        ) : (
          <Tabela>
            <thead>
              <tr>
                <Th className="w-10">#</Th>
                <Th>Operador</Th>
                <Th className="text-right">Monitorias</Th>
                <Th className="text-right">Zeradas</Th>
                <Th className="text-right">100%</Th>
                <Th className="text-right">Menor nota</Th>
                <Th className="text-right">Nota média</Th>
                <Th className="text-right">vs. {anterior ? mesCurto(anterior) : '—'}</Th>
              </tr>
            </thead>
            <tbody>
              {doMes.map((l, i) => {
                const antes = notaAnterior.get(l.operador_id);
                const delta = antes == null ? null : Number(l.nota_media) - antes;
                return (
                  <tr key={l.operador_id} className="hover:bg-slate-50">
                    <Td className="tabular-nums text-slate-400">{i + 1}</Td>
                    <Td className="font-medium text-slate-900">
                      <Link href={`/relatorios/feedback?operador=${l.operador_id}&mes=${mes}`}
                        className="hover:text-marca-700 hover:underline">
                        {l.operador}
                      </Link>
                    </Td>
                    <Td className="text-right tabular-nums">{l.total_monitorias}</Td>
                    <Td className={`text-right tabular-nums ${
                      l.zeradas ? 'font-semibold text-rose-700' : 'text-slate-400'}`}>
                      {l.zeradas || '—'}
                    </Td>
                    <Td className="text-right tabular-nums text-slate-500">{l.impecaveis}</Td>
                    <Td className="text-right tabular-nums text-slate-500">
                      {nota(Number(l.nota_minima))}
                    </Td>
                    <Td className="text-right"><EtiquetaNota valor={Number(l.nota_media)} /></Td>
                    <Td className="text-right tabular-nums">
                      {delta == null ? (
                        <span className="text-slate-300">—</span>
                      ) : (
                        <span className={
                          Math.abs(delta) < 0.005 ? 'text-slate-400'
                            : delta > 0 ? 'text-emerald-700' : 'text-rose-700'}>
                          {delta > 0 ? '▲' : delta < 0 ? '▼' : '='} {percentual(Math.abs(delta))}
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Tabela>
        )}
      </Cartao>
    </div>
  );
}
