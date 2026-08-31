import Link from 'next/link';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { Cartao, Vazio } from '@/componentes/ui';
import BotaoImprimir from '@/componentes/BotaoImprimir';
import { mesExtenso, data as formatarData, nota, percentual } from '@/lib/formatar';
import type { LinhaFeedback, Operador } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export default async function FolhaFeedback({
  searchParams,
}: {
  searchParams: Promise<{ operador?: string; mes?: string }>;
}) {
  const perfil = await exigirPerfil();
  const filtros = await searchParams;
  const db = await criarClienteServidor();

  const [{ data: operadores }, { data: mesesBrutos }] = await Promise.all([
    db.from('operadores').select('id, nome').eq('ativo', true).order('nome'),
    db.from('vw_monitorias').select('mes_referencia').order('mes_referencia', { ascending: false }),
  ]);

  const meses = [...new Set(((mesesBrutos ?? []) as { mes_referencia: string }[])
    .map((m) => m.mes_referencia))];

  // Operador só enxerga a si mesmo — a RLS já garante, isto é só a interface.
  const operadorId = perfil.papel === 'operador'
    ? perfil.operador_id ?? ''
    : filtros.operador ?? '';
  const mes = filtros.mes && meses.includes(filtros.mes) ? filtros.mes : meses[0];

  const seletor = (
    <form className="sem-impressao flex flex-wrap items-center gap-2">
      {perfil.papel !== 'operador' && (
        <select name="operador" defaultValue={operadorId}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">
          <option value="">Selecione o operador…</option>
          {((operadores ?? []) as Operador[]).map((o) => (
            <option key={o.id} value={o.id}>{o.nome}</option>
          ))}
        </select>
      )}
      <select name="mes" defaultValue={mes}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">
        {meses.map((m) => <option key={m} value={m}>{mesExtenso(m)}</option>)}
      </select>
      <button className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm
                         font-medium text-slate-700 hover:bg-slate-50">
        Gerar folha
      </button>
    </form>
  );

  if (!operadorId || !mes) {
    return (
      <div className="space-y-6">
        <div>
          <Link href="/relatorios" className="text-sm text-slate-500 hover:underline">
            ← Relatórios
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Folha de feedback individual</h1>
        </div>
        {seletor}
        <Cartao><Vazio>Escolha o operador e o mês para gerar a folha.</Vazio></Cartao>
      </div>
    );
  }

  const { data: bruto } = await db
    .from('vw_feedback_individual')
    .select('*')
    .eq('operador_id', operadorId)
    .eq('mes_referencia', mes)
    .order('data_atendimento')
    .order('criterio_ordem');

  const linhas = (bruto ?? []) as LinhaFeedback[];

  // Agrupa por monitoria: cada uma vira um bloco na folha impressa.
  const porMonitoria = new Map<string, { cabecalho: LinhaFeedback; itens: LinhaFeedback[] }>();
  for (const l of linhas) {
    if (!porMonitoria.has(l.monitoria_id)) porMonitoria.set(l.monitoria_id, { cabecalho: l, itens: [] });
    porMonitoria.get(l.monitoria_id)!.itens.push(l);
  }
  const monitorias = [...porMonitoria.values()];

  const nomeOperador = monitorias[0]?.cabecalho.operador
    ?? ((operadores ?? []) as Operador[]).find((o) => o.id === operadorId)?.nome
    ?? 'Operador';

  const media = monitorias.length
    ? monitorias.reduce((s, m) => s + Number(m.cabecalho.nota_final), 0) / monitorias.length
    : null;

  // Reincidência: quais critérios essa pessoa reprovou mais de uma vez no mês.
  const falhas = new Map<string, { qtd: number; peso: number }>();
  for (const l of linhas) {
    if (l.conforme) continue;
    const atual = falhas.get(l.criterio) ?? { qtd: 0, peso: Number(l.peso) };
    atual.qtd++;
    falhas.set(l.criterio, atual);
  }
  const recorrentes = [...falhas.entries()]
    .sort((a, b) => b[1].qtd * b[1].peso - a[1].qtd * a[1].peso);

  return (
    <div className="space-y-6">
      <div className="sem-impressao flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/relatorios" className="text-sm text-slate-500 hover:underline">
            ← Relatórios
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">Folha de feedback individual</h1>
        </div>
        <div className="flex items-center gap-2">
          {seletor}
          <BotaoImprimir />
        </div>
      </div>

      {monitorias.length === 0 ? (
        <Cartao><Vazio>Sem monitorias para {nomeOperador} em {mesExtenso(mes)}.</Vazio></Cartao>
      ) : (
        <article className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
          <header className="border-b border-slate-200 pb-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-marca-700">
              Monitoria de qualidade de atendimento · C-SAT
            </p>
            <h2 className="mt-1 text-2xl font-semibold text-slate-900">{nomeOperador}</h2>
            <p className="text-sm text-slate-500">{mesExtenso(mes)}</p>
          </header>

          <div className="grid gap-4 border-b border-slate-200 py-5 sm:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Nota média do mês</p>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">{nota(media)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Monitorias</p>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">{monitorias.length}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Zeradas</p>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">
                {monitorias.filter((m) => m.cabecalho.zerado).length}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Nota 100%</p>
              <p className="text-2xl font-semibold tabular-nums text-slate-900">
                {monitorias.filter((m) => Number(m.cabecalho.nota_final) === 1).length}
              </p>
            </div>
          </div>

          {recorrentes.length > 0 && (
            <section className="border-b border-slate-200 py-5">
              <h3 className="text-sm font-semibold text-slate-900">Pontos a desenvolver</h3>
              <ul className="mt-2 space-y-1">
                {recorrentes.map(([criterio, info]) => (
                  <li key={criterio} className="flex items-baseline justify-between gap-4 text-sm">
                    <span className="text-slate-700">{criterio}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">
                      {info.qtd}× · −{(info.qtd * info.peso).toFixed(2).replace('.', ',')} de nota
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="py-5">
            <h3 className="text-sm font-semibold text-slate-900">
              Detalhe das monitorias
            </h3>

            <div className="mt-3 space-y-5">
              {monitorias.map(({ cabecalho, itens }) => {
                const reprovados = itens.filter((i) => !i.conforme);
                return (
                  <div key={cabecalho.monitoria_id}
                    className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">
                        {formatarData(cabecalho.data_atendimento)} · protocolo {cabecalho.protocolo}
                        <span className="ml-2 font-normal text-slate-500">
                          {cabecalho.semana_mes}ª semana, {cabecalho.numero_monitoria}ª monitoria
                        </span>
                      </p>
                      <p className={`text-sm font-semibold tabular-nums ${
                        cabecalho.zerado ? 'text-rose-700' : 'text-slate-900'}`}>
                        {nota(Number(cabecalho.nota_final))}
                        {cabecalho.zerado && ' · zerada'}
                      </p>
                    </div>

                    {reprovados.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {reprovados.map((i) => (
                          <li key={i.criterio} className="text-sm text-slate-700">
                            <span className="mr-1.5 text-rose-600">✕</span>
                            {i.criterio}
                            <span className="ml-1 text-xs text-slate-500">
                              (−{percentual(Number(i.peso))})
                            </span>
                            {i.observacao && (
                              <span className="block pl-5 text-xs text-slate-500">{i.observacao}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-emerald-700">
                        ✓ Todos os {itens.length} critérios atendidos.
                      </p>
                    )}

                    {cabecalho.parecer && (
                      <p className="mt-3 whitespace-pre-wrap border-l-2 border-slate-200 pl-3
                                    text-sm leading-relaxed text-slate-600">
                        {cabecalho.parecer}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <footer className="grid gap-8 border-t border-slate-200 pt-8 sm:grid-cols-2">
            {['Assinatura do operador(a)', 'Assinatura da qualidade / gestor'].map((rotulo) => (
              <div key={rotulo}>
                <div className="h-10 border-b border-slate-400" />
                <p className="mt-1 text-xs text-slate-500">{rotulo}</p>
              </div>
            ))}
          </footer>
        </article>
      )}
    </div>
  );
}
