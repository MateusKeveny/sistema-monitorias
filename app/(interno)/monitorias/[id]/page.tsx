import Link from 'next/link';
import { notFound } from 'next/navigation';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { Cartao, EtiquetaNota, Vazio } from '@/componentes/ui';
import { data as formatarData, dataHora, duracao, percentual, nota } from '@/lib/formatar';
import type { Monitoria } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

type Item = {
  conforme: boolean;
  observacao: string | null;
  criterios: { nome: string; ordem: number; peso: number } | null;
};

type Alteracao = {
  id: string;
  autor_nome: string | null;
  alterado_em: string;
  campo: string;
  valor_anterior: string | null;
  valor_novo: string | null;
};

export default async function DetalheMonitoria({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const perfil = await exigirPerfil();
  const { id } = await params;
  const db = await criarClienteServidor();

  const [{ data: monitoria }, { data: itens }, { data: historico }] = await Promise.all([
    db.from('vw_monitorias').select('*').eq('id', id).maybeSingle(),
    db.from('monitoria_itens')
      .select('conforme, observacao, criterios(nome, ordem, peso)')
      .eq('monitoria_id', id),
    db.from('monitoria_alteracoes')
      .select('id, autor_nome, alterado_em, campo, valor_anterior, valor_novo')
      .eq('monitoria_id', id)
      .order('alterado_em', { ascending: false }),
  ]);

  if (!monitoria) notFound();
  const m = monitoria as Monitoria;

  const alteracoes = (historico ?? []) as Alteracao[];

  const avaliados = ((itens ?? []) as unknown as Item[])
    .filter((i) => i.criterios)
    .sort((a, b) => a.criterios!.ordem - b.criterios!.ordem);
  const reprovados = avaliados.filter((i) => !i.conforme);

  const ficha: [string, string][] = [
    ['Protocolo', m.protocolo],
    ['Data do atendimento', formatarData(m.data_atendimento)],
    ['Operador(a)', m.operador],
    ['Canal', m.canal ?? '—'],
    ['Semana / nº', `${m.semana_mes}ª semana · ${m.numero_monitoria}ª monitoria`],
    ['Tempo de atendimento', duracao(m.tempo_atendimento_seg)],
    ['Monitor responsável', m.monitor ?? '—'],
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/monitorias" className="text-sm text-slate-500 hover:underline">
            ← Monitorias
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">
            Monitoria {m.protocolo}
          </h1>
          <p className="text-sm text-slate-500">
            {m.operador} · {formatarData(m.data_atendimento)}
          </p>
        </div>

        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-slate-500">Nota final</p>
          <p className="text-3xl font-semibold tabular-nums text-slate-900">
            {nota(Number(m.nota_final))}
          </p>
          {m.zerado && (
            <p className="mt-1 text-xs font-semibold text-rose-700">
              Zerada por falha crítica
            </p>
          )}
        </div>
      </div>

      {m.zerado && m.motivo_zeramento && (
        <div className="rounded-xl bg-rose-50 px-5 py-4 ring-1 ring-rose-600/20">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-800">
            Motivo do zeramento
          </p>
          <p className="mt-1 text-sm text-rose-900">{m.motivo_zeramento}</p>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Cartao titulo="Identificação">
          <dl className="space-y-3">
            {ficha.map(([rotulo, valor]) => (
              <div key={rotulo}>
                <dt className="text-xs uppercase tracking-wide text-slate-500">{rotulo}</dt>
                <dd className="text-sm font-medium text-slate-800">{valor}</dd>
              </div>
            ))}
          </dl>
        </Cartao>

        <Cartao titulo={`Critérios avaliados (${avaliados.length})`} className="lg:col-span-2">
          {avaliados.length === 0 ? (
            <Vazio>
              Esta monitoria veio da planilha sem o detalhe por critério — só a nota final.
            </Vazio>
          ) : (
            <ul className="divide-y divide-slate-100">
              {avaliados.map((i) => (
                <li key={i.criterios!.ordem} className="flex items-start gap-3 py-2.5 first:pt-0">
                  <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center
                                    rounded-full text-xs font-bold text-white ${
                    i.conforme ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                    {i.conforme ? '✓' : '✕'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${i.conforme ? 'text-slate-700' : 'font-medium text-slate-900'}`}>
                      {i.criterios!.nome}
                    </p>
                    {!i.conforme && (
                      <p className="text-xs text-rose-700">
                        −{percentual(Number(i.criterios!.peso))} na nota
                        {i.observacao && ` · ${i.observacao}`}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>

      {(m.parecer || reprovados.length > 0) && (
        <Cartao titulo="Parecer geral">
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
            {m.parecer || 'Sem parecer registrado.'}
          </p>
        </Cartao>
      )}

      {alteracoes.length > 0 && (
        <Cartao titulo={`Histórico de alterações (${alteracoes.length})`}>
          <ul className="divide-y divide-slate-100">
            {alteracoes.map((a) => (
              <li key={a.id} className="py-2.5 first:pt-0 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium text-slate-800">{a.campo}</span>
                  <span className="text-xs text-slate-500">
                    {a.autor_nome ?? 'autor removido'} · {dataHora(a.alterado_em)}
                  </span>
                </div>
                <p className="text-slate-600">
                  <span className="text-rose-700 line-through decoration-rose-300">
                    {a.valor_anterior ?? '(vazio)'}
                  </span>
                  <span className="mx-2 text-slate-400">→</span>
                  <span className="text-emerald-700">{a.valor_novo ?? '(vazio)'}</span>
                </p>
              </li>
            ))}
          </ul>
        </Cartao>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/relatorios/feedback?operador=${m.operador_id}&mes=${m.mes_referencia}`}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm
                     font-medium text-slate-700 hover:bg-slate-50"
        >
          Folha de feedback do mês
        </Link>
        {perfil.papel === 'admin' && (
          <Link
            href={`/monitorias/${m.id}/editar`}
            className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white
                       hover:bg-marca-700"
          >
            Editar monitoria
          </Link>
        )}
      </div>
    </div>
  );
}
