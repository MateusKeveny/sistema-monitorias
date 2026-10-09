import { criarClienteServidor } from '@/lib/supabase/servidor';
import { Indicador, Quadro, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import { BarraDoTempo, LegendaDoTempo } from '@/componentes/FilaDeAtrasos';
import JustificarAtraso from '@/componentes/JustificarAtraso';
import { dataHora, diaMes, periodoDaSemana, tempoUtil } from '@/lib/formatar';

type Chamado = {
  protocolo: number; titulo: string | null; status: string; semana: number;
  aberto_em: string; concluido_em: string | null;
  tempo_util: number | null; tempo_interno: number | null; tempo_ti: number | null;
  motivo_atraso: string | null; observacao: string | null;
  justificativa: string | null; justificado_em: string | null;
  decisao: 'manter' | 'retirar' | null; decidido_por_nome: string | null;
};

/** O prazo: menos de 3,0 dias úteis (2 dias úteis completos). */
const LIMITE = 3;
const media = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * A aba Chamados do extrato (migração 53): onde o tempo de cada chamado ficou
 * — com quem trata até o repasse ao ClickUp, ou com o TI depois dele —, os
 * atrasos com a justificativa e a decisão da gestão, e a lista do ciclo.
 */
export default async function ChamadosDaPessoa({ pessoaId, competencia, podeJustificar }: {
  pessoaId: string; competencia: string; podeJustificar: boolean;
}) {
  const db = await criarClienteServidor();
  const { data } = await db.from('chamados_elo')
    .select('protocolo, titulo, status, semana, aberto_em, concluido_em, tempo_util, tempo_interno, tempo_ti, motivo_atraso, observacao, justificativa, justificado_em, decisao, decidido_por_nome')
    .eq('pessoa_id', pessoaId).eq('mes_competencia', competencia).order('aberto_em', { ascending: false });
  const chamados = ((data ?? []) as Chamado[]).map((c) => ({
    ...c, tempo_util: c.tempo_util == null ? null : Number(c.tempo_util),
    tempo_interno: c.tempo_interno == null ? null : Number(c.tempo_interno),
    tempo_ti: c.tempo_ti == null ? null : Number(c.tempo_ti),
  }));

  const resolvidos = chamados.filter((c) => c.concluido_em && c.status !== 'Cancelado');
  // Parte de quem trata: até o ClickUp; sem ClickUp, o tempo todo.
  const doAnalista = (c: Chamado) => c.tempo_interno ?? (c.tempo_ti == null ? c.tempo_util ?? 0 : 0);
  const comRepasse = resolvidos.filter((c) => c.tempo_ti != null);
  const atrasados = resolvidos.filter((c) => (c.tempo_util ?? 0) >= LIMITE);
  const repassesLentos = resolvidos.filter((c) => doAnalista(c) >= 1).length;

  const situacao = (c: Chamado) => {
    if (c.status === 'Cancelado') return 'Cancelado · não conta';
    if (!c.concluido_em) return 'Em aberto · conta quando resolver';
    if ((c.tempo_util ?? 0) < LIMITE) return 'No prazo';
    return c.decisao === 'manter' ? 'Fora do prazo · desconto mantido'
      : c.decisao === 'retirar' ? 'Fora do prazo · desconto retirado' : 'Fora do prazo · com a gestão';
  };

  if (chamados.length === 0) {
    return <Quadro titulo="Chamados"><Vazio>Nenhum chamado importado neste mês.</Vazio></Quadro>;
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Tempo médio total" valor={tempoUtil(media(resolvidos.map((c) => c.tempo_util ?? 0)))}
                   detalhe={`da abertura à conclusão · ${resolvidos.length} resolvidos`} />
        <Indicador rotulo="Parte de quem trata" valor={tempoUtil(media(resolvidos.map(doAnalista)))}
                   tom="bom" detalhe="da abertura ao repasse ao ClickUp" />
        <Indicador rotulo="Parte do TI" valor={tempoUtil(media(comRepasse.map((c) => c.tempo_ti ?? 0)))}
                   detalhe="do ClickUp à conclusão" />
        <Indicador rotulo="Repasses lentos" valor={String(repassesLentos)} tom={repassesLentos ? 'alerta' : 'neutro'}
                   detalhe="1 dia útil ou mais até o ClickUp" />
      </div>

      <Quadro titulo="Por semana do ciclo" acao={<LegendaDoTempo />}>
        <Tabela noQuadro>
          <thead><tr><Th>Semana</Th><Th className="text-right">Resolvidos</Th><Th>Tempo médio</Th><Th className="text-right">Fora do prazo</Th></tr></thead>
          <tbody>
            {[1, 2, 3, 4].map((s) => {
              const daSemana = resolvidos.filter((c) => c.semana === s);
              const [de, ate] = periodoDaSemana(competencia, s);
              const interno = media(daSemana.map(doAnalista));
              const ti = media(daSemana.map((c) => c.tempo_ti ?? 0));
              return (
                <tr key={s}>
                  <Td>{s}ª · {diaMes(de)} a {diaMes(ate)}</Td>
                  <Td className="text-right tabular-nums">{daSemana.length || '—'}</Td>
                  <Td>
                    {daSemana.length ? (
                      <>
                        <BarraDoTempo total={(interno ?? 0) + (ti ?? 0)} interno={interno} ti={ti} />
                        <span className="mt-1 block text-xs tabular-nums text-slate-500">
                          {tempoUtil(interno)} de quem trata · {tempoUtil(ti)} do TI
                        </span>
                      </>
                    ) : <span className="text-slate-400">—</span>}
                  </Td>
                  <Td className="text-right tabular-nums">
                    {daSemana.length ? daSemana.filter((c) => (c.tempo_util ?? 0) >= LIMITE).length : '—'}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Tabela>
      </Quadro>

      <Quadro titulo={`Atrasos · ${atrasados.length}`}
              subtitulo="Resolvidos depois de 2 dias úteis completos. A justificativa vai para a gestão na hora, sem esperar a próxima importação.">
        {atrasados.length === 0 ? (
          <Vazio>Nenhum chamado fora do prazo neste mês.</Vazio>
        ) : (
          <ul className="divide-y divide-slate-100">
            {atrasados.map((c) => (
              <li key={c.protocolo} className="grid gap-3 py-3 md:grid-cols-[minmax(0,1fr)_16rem_minmax(0,1.2fr)]">
                <div>
                  <p className="text-sm"><b className="font-semibold">{c.protocolo}</b>{c.titulo && ` · ${c.titulo}`}</p>
                  <p className="text-xs text-slate-500">aberto {dataHora(c.aberto_em)} · concluído {dataHora(c.concluido_em)}</p>
                  <p className="mt-1 text-xs font-medium text-slate-700">{situacao(c)}</p>
                </div>
                <div>
                  <BarraDoTempo total={c.tempo_util ?? 0} interno={c.tempo_interno} ti={c.tempo_ti} />
                  <p className="mt-1 text-xs tabular-nums text-slate-500">
                    {tempoUtil(c.tempo_util)} no total · {tempoUtil(doAnalista(c))} de quem trata
                    {c.tempo_ti != null && ` · ${tempoUtil(c.tempo_ti)} do TI`}
                  </p>
                </div>
                <div className="space-y-2 text-xs text-slate-600">
                  {(c.motivo_atraso || c.observacao) && (
                    <p>ELO: {c.motivo_atraso}{c.motivo_atraso && c.observacao && ' · '}{c.observacao}</p>
                  )}
                  {c.justificativa && (
                    <p className="rounded-md bg-amber-500/10 px-2 py-1 text-slate-800">
                      <b className="font-semibold">Justificativa:</b> {c.justificativa}
                      <span className="block text-[11px] text-slate-500">{dataHora(c.justificado_em)}</span>
                    </p>
                  )}
                  {c.decisao
                    ? <p className="text-slate-500">Decidido por {c.decidido_por_nome}.</p>
                    : podeJustificar && <JustificarAtraso protocolo={c.protocolo} atual={c.justificativa} />}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Quadro>

      <Quadro titulo={`Chamados do mês · ${chamados.length}`}>
        <details>
          <summary className="cursor-pointer text-sm text-slate-600">Ver a lista</summary>
          <div className="mt-3">
            <Tabela noQuadro>
              <thead><tr><Th>Protocolo</Th><Th>Título</Th><Th>Aberto</Th><Th>Tempo</Th><Th>Na cota</Th></tr></thead>
              <tbody>
                {chamados.map((c) => (
                  <tr key={c.protocolo}>
                    <Td className="font-semibold tabular-nums">{c.protocolo}</Td>
                    <Td>{c.titulo ?? '—'}<span className="block text-xs text-slate-500">{c.status}</span></Td>
                    <Td className="whitespace-nowrap text-xs tabular-nums">{dataHora(c.aberto_em)}</Td>
                    <Td className="whitespace-nowrap tabular-nums">{c.concluido_em ? tempoUtil(c.tempo_util) : '—'}</Td>
                    <Td className="text-xs text-slate-600">{situacao(c)}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          </div>
        </details>
      </Quadro>
    </div>
  );
}
