import Link from '@/componentes/Link';
import GraficoDeLinha, { type PontoDaLinha } from '@/componentes/GraficoDeLinha';
import { EtiquetaNota, Painel, Secao, Vazio } from '@/componentes/ui';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { codigoMonitoria, data as formatarData, mesRotulo, percentual } from '@/lib/formatar';
import { mesAbertoDasMonitorias } from '@/lib/mes-aberto';

export const dynamic = 'force-dynamic';

type Monitoria = {
  id: string; codigo: number; protocolo: string; data_atendimento: string; mes_referencia: string;
  semana_mes: number; nota_final: number; zerado: boolean; parecer: string | null;
  canal: string | null; monitor: string | null;
};
type Apontamento = { monitoria_id: string; criterio: string; observacao: string | null };

const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const rotuloMes = (c: string) => `${NOMES_MES[Number(c.slice(5, 7)) - 1]}/${c.slice(2, 4)}`;
const media = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
/** Escala única do painel para a nota: 85% é o piso para a monitoria pontuar. */
const tomDaNota = (v: number): 'bom' | 'atencao' | 'ruim' => (v >= 0.85 ? 'bom' : v >= 0.70 ? 'atencao' : 'ruim');

/**
 * Monitorias do atendente, dentro do Performance (1.17.0).
 *
 * O link do Comparativo levava ao site de Monitorias, que pede outro login e
 * tira a pessoa do painel. As monitorias estão no mesmo banco — o Performance
 * já as usa na cota —, então a consulta é daqui mesmo: a nota mês a mês e
 * cada monitoria com os critérios reprovados e o parecer.
 *
 * O gestor escolhe a pessoa; o operador vê as próprias (a RLS garante). A
 * regra do mês aberto vale aqui também: monitoria de mês ainda não liberado
 * (migração 30) não aparece.
 */
export default async function MonitoriasDoAtendente({
  searchParams,
}: {
  searchParams: Promise<{ pessoa?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { pessoa: pedida } = await searchParams;
  const veOTime = perfil.papel !== 'operador';
  const db = await criarClienteServidor();

  const { data: pessoas } = veOTime
    ? await db.from('pessoas').select('id, nome').eq('avaliado', true).eq('ativo', true).order('nome')
    : { data: [{ id: perfil.id, nome: perfil.nome }] };
  const lista = (pessoas ?? []) as { id: string; nome: string }[];
  const pessoaId = veOTime && pedida && lista.some((p) => p.id === pedida) ? pedida : veOTime ? (lista[0]?.id ?? perfil.id) : perfil.id;
  const nome = lista.find((p) => p.id === pessoaId)?.nome ?? perfil.nome;

  const aberto = await mesAbertoDasMonitorias();
  const { data } = await db.from('vw_monitorias')
    .select('id, codigo, protocolo, data_atendimento, mes_referencia, semana_mes, nota_final, zerado, parecer, canal, monitor')
    .eq('operador_id', pessoaId).lte('mes_referencia', aberto)
    .order('data_atendimento', { ascending: false }).order('codigo', { ascending: false })
    .limit(300);
  const monitorias = (data ?? []) as Monitoria[];

  const { data: itens } = monitorias.length
    ? await db.from('vw_feedback_individual').select('monitoria_id, criterio, observacao')
      .in('monitoria_id', monitorias.map((m) => m.id)).eq('conforme', false).order('criterio_ordem')
    : { data: [] };
  const falhas = new Map<string, Apontamento[]>();
  for (const a of (itens ?? []) as Apontamento[]) falhas.set(a.monitoria_id, [...(falhas.get(a.monitoria_id) ?? []), a]);

  // Por mês, do mais recente ao mais antigo.
  const meses = [...new Set(monitorias.map((m) => m.mes_referencia))].sort().reverse();
  const doMes = (m: string) => monitorias.filter((x) => x.mes_referencia === m);
  const notaDoMes = (m: string) => media(doMes(m).map((x) => Number(x.nota_final)));
  const ultimo = meses[0];
  const penultimo = meses[1];
  const notaUltimo = ultimo ? notaDoMes(ultimo) : null;
  const notaPenultimo = penultimo ? notaDoMes(penultimo) : null;
  const d = notaUltimo != null && notaPenultimo != null ? (notaUltimo - notaPenultimo) * 100 : null;
  const recorrente = [...monitorias.filter((m) => m.mes_referencia === ultimo)
    .flatMap((m) => (falhas.get(m.id) ?? []).map((a) => a.criterio))
    .reduce((mapa, c) => mapa.set(c, (mapa.get(c) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1])[0];

  // A linha: até 12 meses, do mais antigo ao mais recente.
  const serie = meses.slice(0, 12).reverse();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">
            {veOTime ? `Monitorias de ${nome.split(/\s+/).slice(0, 2).join(' ')}` : 'Suas monitorias'}
          </h1>
          <p className="mt-1 text-sm text-sobre-fundo-suave">
            A nota mês a mês e cada monitoria, com os critérios a melhorar.
          </p>
        </div>
        {veOTime && (
          <form className="flex items-end gap-2">
            <label>
              <span className="mb-1 block text-xs font-medium text-sobre-fundo-suave">Atendente</span>
              <select name="pessoa" defaultValue={pessoaId}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {lista.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </label>
            <button className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Abrir
            </button>
          </form>
        )}
      </div>

      {monitorias.length === 0 ? (
        <Painel><Secao><Vazio>Nenhuma monitoria registrada.</Vazio></Secao></Painel>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Resumo rotulo={`Nota média em ${rotuloMes(ultimo)}`} valor={notaUltimo != null ? percentual(notaUltimo) : '—'}
                    tom={notaUltimo != null && tomDaNota(notaUltimo) !== 'bom' ? 'atencao' : undefined} />
            <Resumo rotulo={penultimo ? `Contra ${rotuloMes(penultimo)}` : 'Contra o mês anterior'}
                    valor={d == null ? '—' : `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pt`}
                    tom={d == null ? undefined : d >= 0 ? 'melhor' : 'pior'} />
            <Resumo rotulo={`Monitorias em ${rotuloMes(ultimo)}`} valor={String(doMes(ultimo).length)} />
            <Resumo rotulo="O que mais aparece no mês" valor={recorrente ? recorrente[0] : 'Nada reprovado'}
                    detalhe={recorrente ? `${recorrente[1]} ${recorrente[1] === 1 ? 'vez' : 'vezes'}` : undefined} pequeno />
          </div>

          {serie.length > 1 && (
            <Painel>
              <Secao titulo="Nota média por mês" subtitulo="Linha tracejada: 85%, o piso para a monitoria pontuar.">
                <GraficoDeLinha largura={Math.max(640, serie.length * 90)} rotulos={serie.map(rotuloMes)}
                                formatar={percentual} min={0.7} max={1}
                                referencia={{ valor: 0.85, rotulo: 'piso 85%' }}
                                pontos={serie.map((m): PontoDaLinha => {
                                  const v = notaDoMes(m); return v == null ? null : { valor: v, tom: tomDaNota(v) };
                                })} />
              </Secao>
            </Painel>
          )}

          {meses.map((m) => {
            const nota = notaDoMes(m);
            return (
              <Painel key={m}>
                <Secao titulo={mesRotulo(m)}
                       subtitulo={`${doMes(m).length} monitoria${doMes(m).length === 1 ? '' : 's'}${nota != null ? ` · nota média ${percentual(nota)}` : ''}`}>
                  <ul className="-my-2 divide-y divide-slate-100">
                    {doMes(m).map((x) => {
                      const reprovados = falhas.get(x.id) ?? [];
                      return (
                        <li key={x.id} className="py-3">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                            <span className="font-semibold tabular-nums text-slate-800">{x.protocolo}</span>
                            <span className="tabular-nums text-slate-400/70">{codigoMonitoria(x.codigo)}</span>
                            <span className="tabular-nums text-slate-500">{formatarData(x.data_atendimento)} · {x.semana_mes}ª semana</span>
                            {x.canal && <span className="text-slate-500">{x.canal}</span>}
                            {x.monitor && <span className="text-xs text-slate-400">por {x.monitor}</span>}
                            <span className="ml-auto"><EtiquetaNota valor={Number(x.nota_final)} zerado={x.zerado} /></span>
                          </div>
                          {reprovados.length > 0 ? (
                            <ul className="mt-1.5 space-y-0.5 text-sm text-slate-600">
                              {reprovados.map((f) => (
                                <li key={f.criterio}>
                                  <span className="text-rose-600">✕</span> {f.criterio}
                                  {f.observacao && <span className="text-slate-500"> — {f.observacao}</span>}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-1.5 text-sm text-marca-700 dark:text-marca-400">Todos os critérios atendidos.</p>
                          )}
                          {x.parecer && <p className="mt-1 text-xs italic text-slate-500">{x.parecer}</p>}
                        </li>
                      );
                    })}
                  </ul>
                </Secao>
              </Painel>
            );
          })}
        </>
      )}

      <p className="text-xs text-sobre-fundo-suave">
        <Link href="/cota/comparativo?cat=mon" className="underline">Comparativo de monitoria da equipe ›</Link>
      </p>
    </div>
  );
}

function Resumo({ rotulo, valor, tom, detalhe, pequeno = false }: {
  rotulo: string; valor: string; tom?: 'melhor' | 'pior' | 'atencao'; detalhe?: string; pequeno?: boolean;
}) {
  const cor = tom === 'melhor' ? 'text-marca-700 dark:text-marca-400' : tom === 'pior' ? 'text-rose-700'
    : tom === 'atencao' ? 'text-amber-700' : 'text-slate-900';
  return (
    <div className="rounded-2xl bg-superficie px-5 py-4 shadow-sm">
      <p className="text-sm text-slate-500">{rotulo}</p>
      <p className={`${pequeno ? 'text-base leading-snug' : 'text-2xl tracking-tight'} font-semibold tabular-nums ${cor}`}>{valor}</p>
      {detalhe && <p className="text-xs text-slate-500">{detalhe}</p>}
    </div>
  );
}
