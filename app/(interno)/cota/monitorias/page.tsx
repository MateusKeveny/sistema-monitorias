import Link from '@/componentes/Link';
import GraficoDeLinha, { type PontoDaLinha } from '@/componentes/GraficoDeLinha';
import CoberturaDoCiclo from '@/componentes/CoberturaDoCiclo';
import ListaDeMonitorias from '@/componentes/ListaDeMonitorias';
import OQueMaisSeRepete from '@/componentes/OQueMaisSeRepete';
import { EtiquetaNota, Painel, Quadro, Secao, Tabela, Td, Th, Vazio } from '@/componentes/ui';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { hojeNoBrasil, mesRotulo, percentual } from '@/lib/formatar';
import { ateOMesAberto, mesAbertoDasMonitorias } from '@/lib/mes-aberto';
import { foraDasMonitorias } from '@/lib/monitorados';
import { setorDoCookie } from '@/lib/setorEscolhido';
import { MONITORIAS_PADRAO, monitoriasPorSetor, setorDasPessoas, setorDaTela, textoDoPiso } from '@/lib/monitoriasDoSetor';
import { janelaDe, monitoriasPorMes, ocorrenciasDaPessoa, repeticoes, repeticoesDaEquipe } from '@/lib/repeticoes';
import type { LinhaCriterio, LinhaRanking } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

type Monitoria = {
  id: string; codigo: number; protocolo: string; data_atendimento: string; mes_referencia: string;
  semana_mes: number; nota_final: number; zerado: boolean; motivo_zeramento: string | null; parecer: string | null;
  canal: string | null; monitor: string | null;
};
type Apontamento = { monitoria_id: string; criterio: string; observacao: string | null };

const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const rotuloMes = (c: string) => `${NOMES_MES[Number(c.slice(5, 7)) - 1]}/${c.slice(2, 4)}`;
const media = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
/** Escala única do painel para a nota: o piso do setor (a Expansão: 85%) é onde a monitoria pontua. */
const tomDaNotaCom = (v: number, piso: number): 'bom' | 'atencao' | 'ruim' => (v >= piso ? 'bom' : v >= 0.70 ? 'atencao' : 'ruim');

/**
 * Monitorias do atendente, dentro do Performance (1.17.0).
 *
 * O link do Comparativo levava ao site de Monitorias, que pede outro login e
 * tira a pessoa do painel. As monitorias estão no mesmo banco — o Performance
 * já as usa na cota —, então a consulta é daqui mesmo: a nota mês a mês e
 * cada monitoria com os critérios reprovados e o parecer.
 *
 * O gestor escolhe a pessoa; o operador vê as próprias (a RLS garante).
 * Gestor e qualidade abrem antes na equipe toda (1.36.0) — o resumo da tela
 * inicial das Monitorias — e chegam à pessoa pelo seletor ou pelo ranking. A
 * regra do mês aberto vale aqui também: monitoria de mês ainda não liberado
 * (migração 30) não aparece.
 */
export default async function MonitoriasDoAtendente({
  searchParams,
}: {
  searchParams: Promise<{ pessoa?: string; mes?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { pessoa: pedida, mes: mesPedido } = await searchParams;
  const veOTime = perfil.papel !== 'operador';
  const db = await criarClienteServidor();

  const { data: pessoas } = veOTime
    ? await db.from('pessoas').select('id, nome').eq('avaliado', true).eq('ativo', true).order('nome')
    : { data: [{ id: perfil.id, nome: perfil.nome }] };
  // Setor com monitorias desligadas não entra na visão da equipe (etapa 4).
  const fora = veOTime ? await foraDasMonitorias(db) : new Set<string>();
  const lista = ((pessoas ?? []) as { id: string; nome: string }[]).filter((p) => !fora.has(p.id));
  if (veOTime && !(pedida && lista.some((p) => p.id === pedida))) return <Equipe lista={lista} mesPedido={mesPedido} />;
  const pessoaId = veOTime ? pedida! : perfil.id;
  const nome = lista.find((p) => p.id === pessoaId)?.nome ?? perfil.nome;

  const aberto = await mesAbertoDasMonitorias();
  // O piso da monitoria: o do setor da pessoa (Monitorias 6.0; a Expansão: 85%).
  const [porSetorMon, setorNoMes] = await Promise.all([monitoriasPorSetor(db), setorDasPessoas(db, aberto)]);
  const piso = porSetorMon.get(setorNoMes.get(pessoaId) ?? 1)?.piso ?? MONITORIAS_PADRAO.piso;
  const tomDaNota = (v: number) => tomDaNotaCom(v, piso);
  const { data } = await db.from('vw_monitorias')
    .select('id, codigo, protocolo, data_atendimento, mes_referencia, semana_mes, nota_final, zerado, motivo_zeramento, parecer, canal, monitor')
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
          {veOTime && (
            <Link href="/cota/monitorias" className="mb-1 inline-block text-sm text-sobre-fundo-suave hover:underline">
              ‹ Equipe toda
            </Link>
          )}
          <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">
            {veOTime ? `Monitorias de ${nome.split(/\s+/).slice(0, 2).join(' ')}` : 'Suas monitorias'}
          </h1>
          <p className="mt-1 text-sm text-sobre-fundo-suave">
            A nota mês a mês e cada monitoria, com os critérios a melhorar.
          </p>
        </div>
        {veOTime && <SeletorDePessoa lista={lista} pessoaId={pessoaId} />}
      </div>

      {monitorias.length === 0 ? (
        <Painel><Secao><Vazio>Nenhuma monitoria registrada.</Vazio></Secao></Painel>
      ) : (
        <>
          <div className="grid divide-y divide-slate-200 rounded-[20px] border border-slate-200 bg-superficie shadow-sm sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
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
              <Secao titulo="Nota média por mês" subtitulo={`Linha tracejada: ${textoDoPiso(piso)}, o piso para a monitoria pontuar.`}>
                <GraficoDeLinha largura={Math.max(1400, serie.length * 120)} rotulos={serie.map(rotuloMes)}
                                formatar={percentual} min={0.7} max={1}
                                referencia={{ valor: piso, rotulo: `piso ${textoDoPiso(piso)}` }}
                                pontos={serie.map((m): PontoDaLinha => {
                                  const v = notaDoMes(m); return v == null ? null : { valor: v, tom: tomDaNota(v) };
                                })} />
              </Secao>
            </Painel>
          )}

          <OQueMaisSeRepete linhas={repeticoes(ocorrenciasDaPessoa(monitorias, falhas), janelaDe(ultimo), monitoriasPorMes(monitorias.map((x) => x.mes_referencia), janelaDe(ultimo)))} janela={janelaDe(ultimo)} />

          {meses.map((m) => {
            const nota = notaDoMes(m);
            return (
              <Painel key={m}>
                <Secao titulo={mesRotulo(m)}
                       subtitulo={`${doMes(m).length} monitoria${doMes(m).length === 1 ? '' : 's'}${nota != null ? ` · nota média ${percentual(nota)}` : ''}`}>
                  <ListaDeMonitorias piso={piso} monitorias={doMes(m).map((x) => ({
                    ...x, nota_final: Number(x.nota_final),
                    reprovados: (falhas.get(x.id) ?? []).map(({ criterio, observacao }) => ({ criterio, observacao })),
                  }))} />
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

/** Atendente (ou a equipe toda) e, na equipe, o mês. Sem JavaScript: é uma navegação. */
function SeletorDePessoa({ lista, pessoaId = '', meses, mes }: {
  lista: { id: string; nome: string }[]; pessoaId?: string; meses?: string[]; mes?: string;
}) {
  const campo = 'rounded-md border border-slate-300 bg-superficie px-2 py-1.5 text-sm';
  return (
    <form className="flex flex-wrap items-end gap-2">
      <label>
        <span className="mb-1 block text-xs font-medium text-sobre-fundo-suave">Atendente</span>
        <select name="pessoa" defaultValue={pessoaId} className={campo}>
          <option value="">Equipe toda</option>
          {lista.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
        </select>
      </label>
      {meses && meses.length > 1 && (
        <label>
          <span className="mb-1 block text-xs font-medium text-sobre-fundo-suave">Mês</span>
          <select name="mes" defaultValue={mes} className={campo}>
            {meses.map((m) => <option key={m} value={m}>{mesRotulo(m)}</option>)}
          </select>
        </label>
      )}
      <button className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
        Abrir
      </button>
    </form>
  );
}

/**
 * A equipe toda (1.36.0): o mesmo resumo da tela inicial das Monitorias —
 * nota do mês, zeradas, quem está abaixo do piso, a linha mês a mês, o ranking,
 * os critérios que mais custaram e a cobertura do ciclo. Cada nome do ranking
 * abre as monitorias da pessoa.
 */
async function Equipe({ lista, mesPedido }: { lista: { id: string; nome: string }[]; mesPedido?: string }) {
  const db = await criarClienteServidor();
  const aberto = await mesAbertoDasMonitorias();
  // O piso e a quantidade por semana: os do setor (Monitorias 6.0; a Expansão: 85% e 4).
  const [porSetorMon, { setorId: setorDaEquipe }] = await Promise.all([monitoriasPorSetor(db), setorDaTela(db, await setorDoCookie())]);
  const doSetor = porSetorMon.get(setorDaEquipe) ?? MONITORIAS_PADRAO;
  const piso = doSetor.piso;
  const tomDaNota = (v: number) => tomDaNotaCom(v, piso);

  // O ranking é pequeno — uma linha por pessoa por mês — e dá de uma vez os
  // meses do seletor, os números do mês e a série da linha.
  const { data: todoRanking } = await db.from('vw_ranking_mensal').select('*');
  const ranking = (todoRanking ?? []) as LinhaRanking[];
  const meses = ateOMesAberto([...new Set(ranking.map((l) => l.mes_referencia))].sort().reverse(), aberto);

  const cabecalho = (mes?: string) => (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Monitorias da equipe</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">
          {mes ? `Referência: ${mesRotulo(mes)} · ` : ''}escolha um atendente para ver as monitorias dele.
        </p>
      </div>
      <SeletorDePessoa lista={lista} meses={meses} mes={mes} />
    </div>
  );

  if (meses.length === 0) {
    return <div className="space-y-6">{cabecalho()}<Painel><Secao><Vazio>Nenhuma monitoria registrada.</Vazio></Secao></Painel></div>;
  }

  const mes = mesPedido && meses.includes(mesPedido) ? mesPedido : meses[0];
  const anterior = meses[meses.indexOf(mes) + 1];

  const [{ data: criterios }, { data: porSemana }, repetidos] = await Promise.all([
    db.from('vw_criterios_reprovados').select('*').eq('mes_referencia', mes)
      .gt('reprovacoes', 0).order('pontos_perdidos', { ascending: false }).limit(6),
    db.from('vw_monitorias').select('operador_id, semana_mes').eq('mes_referencia', mes),
    repeticoesDaEquipe(db, janelaDe(mes)),
  ]);

  // Nota média do mês ponderada pelo número de monitorias de cada pessoa.
  const doMes = (m: string) => ranking.filter((l) => l.mes_referencia === m);
  const mediaDoMes = (m: string) => {
    const l = doMes(m);
    const qtd = l.reduce((s, x) => s + x.total_monitorias, 0);
    return qtd ? l.reduce((s, x) => s + Number(x.nota_media) * x.total_monitorias, 0) / qtd : null;
  };
  const linhas = doMes(mes).sort((a, b) => Number(b.nota_media) - Number(a.nota_media));
  const total = linhas.reduce((s, l) => s + l.total_monitorias, 0);
  const nota = mediaDoMes(mes);
  const notaAnterior = anterior ? mediaDoMes(anterior) : null;
  const d = nota != null && notaAnterior != null ? (nota - notaAnterior) * 100 : null;
  const zeradas = linhas.reduce((s, l) => s + l.zeradas, 0);
  const abaixo = linhas.filter((l) => Number(l.nota_media) < piso).length;
  const piores = (criterios ?? []) as LinhaCriterio[];
  const serie = meses.filter((m) => m <= mes).slice(0, 12).reverse();
  const naLista = new Set(lista.map((p) => p.id));

  // Cobertura: parte da lista de quem é avaliado, para quem não foi monitorado
  // nenhuma vez aparecer com zero — é esse o caso que passa despercebido.
  const contagem = new Map(lista.map((p) => [p.id, [0, 0, 0, 0]]));
  for (const m of (porSemana ?? []) as { operador_id: string; semana_mes: number }[]) {
    const linha = contagem.get(m.operador_id);
    if (linha && m.semana_mes >= 1 && m.semana_mes <= 4) linha[m.semana_mes - 1]++;
  }
  const cobertura = lista.map((p) => ({ operador_id: p.id, operador: p.nome, semanas: contagem.get(p.id) ?? [0, 0, 0, 0] }));
  // As semanas do ciclo fecham nos dias 02, 10, 18 e 25 do mês de competência.
  const hoje = hojeNoBrasil();
  const semanasEncerradas = [2, 10, 18, 25]
    .filter((dia) => `${mes.slice(0, 8)}${String(dia).padStart(2, '0')}` < hoje).length;

  return (
    <div className="space-y-6">
      {cabecalho(mes)}

      <div className="grid divide-y divide-slate-200 rounded-[20px] border border-slate-200 bg-superficie shadow-sm sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
        <Resumo rotulo="Nota média do mês" valor={nota != null ? percentual(nota) : '—'}
                tom={nota != null && tomDaNota(nota) !== 'bom' ? 'atencao' : undefined}
                detalhe={`${total} monitoria${total === 1 ? '' : 's'} avaliada${total === 1 ? '' : 's'}`} />
        <Resumo rotulo={anterior ? `Contra ${rotuloMes(anterior)}` : 'Contra o mês anterior'}
                valor={d == null ? '—' : `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pt`}
                tom={d == null ? undefined : d >= 0 ? 'melhor' : 'pior'}
                detalhe={anterior && notaAnterior != null ? `${rotuloMes(anterior)} fechou em ${percentual(notaAnterior)}` : undefined} />
        <Resumo rotulo="Falhas críticas" valor={String(zeradas)} tom={zeradas > 0 ? 'pior' : undefined}
                detalhe={total ? `${percentual(zeradas / total)} do total` : undefined} />
        <Resumo rotulo={`Atendentes abaixo de ${textoDoPiso(piso)}`} valor={String(abaixo)} tom={abaixo > 0 ? 'atencao' : undefined}
                detalhe={`de ${linhas.length} com monitoria no mês`} />
      </div>

      {serie.length > 1 && (
        <Quadro titulo="Nota média da equipe por mês" subtitulo={`Linha tracejada: ${textoDoPiso(piso)}, o piso para a monitoria pontuar.`}>
          <GraficoDeLinha largura={Math.max(1400, serie.length * 120)} rotulos={serie.map(rotuloMes)}
                          formatar={percentual} min={0.7} max={1}
                          referencia={{ valor: piso, rotulo: `piso ${textoDoPiso(piso)}` }}
                          pontos={serie.map((m): PontoDaLinha => {
                            const v = mediaDoMes(m); return v == null ? null : { valor: v, tom: tomDaNota(v) };
                          })} />
        </Quadro>
      )}

      <div className="grid gap-6 xl:grid-cols-5">
        <Quadro titulo="Ranking do mês" subtitulo="Clique num atendente para abrir as monitorias dele." className="xl:col-span-3">
          {linhas.length === 0 ? <Vazio>Nenhuma monitoria neste mês.</Vazio> : (
            <Tabela noQuadro>
              <thead>
                <tr>
                  <Th className="w-10">#</Th>
                  <Th>Atendente</Th>
                  <Th className="text-right">Monitorias</Th>
                  <Th className="text-right">Falhas críticas</Th>
                  <Th className="text-right">Nota média</Th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={l.operador_id} className="transition-colors hover:bg-slate-50">
                    <Td className="tabular-nums text-slate-400">
                      <span className={`inline-grid h-6 w-6 place-items-center rounded-full text-xs ${
                        i < 3 ? 'bg-emerald-500/10 font-semibold text-marca-700 dark:text-marca-400' : ''}`}>{i + 1}</span>
                    </Td>
                    <Td className="font-medium text-slate-900">
                      {naLista.has(l.operador_id) ? (
                        <Link href={`/cota/monitorias?pessoa=${l.operador_id}`}
                              className="hover:text-marca-700 hover:underline dark:hover:text-marca-400">
                          {l.operador}
                        </Link>
                      ) : l.operador}
                    </Td>
                    <Td className="text-right tabular-nums">{l.total_monitorias}</Td>
                    <Td className={`text-right tabular-nums ${l.zeradas ? 'font-semibold text-rose-700' : 'text-slate-400'}`}>
                      {l.zeradas || '—'}
                    </Td>
                    <Td className="text-right"><EtiquetaNota valor={Number(l.nota_media)} /></Td>
                  </tr>
                ))}
              </tbody>
            </Tabela>
          )}
        </Quadro>

        <Quadro titulo="Critérios de maior impacto na nota" subtitulo="Os que mais tiraram pontos da equipe no mês."
                className="xl:col-span-2">
          {piores.length === 0 ? <Vazio>Nenhum critério reprovado no mês.</Vazio> : (
            <ul className="space-y-3">
              {piores.map((c) => (
                <li key={c.criterio_id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-slate-800">{c.criterio}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">{c.reprovacoes}/{c.avaliacoes}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                    <div className="barra-semana h-full rounded-full bg-rose-500"
                         style={{ width: `${Math.max(3, Number(c.taxa_reprovacao) * 100)}%` }} />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {percentual(Number(c.taxa_reprovacao))} de reprovação · peso {percentual(Number(c.peso))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Quadro>
      </div>

      <OQueMaisSeRepete linhas={repetidos.linhas} janela={janelaDe(mes)} equipe={{ monitoradas: repetidos.monitoradas }} />

      <CoberturaDoCiclo linhas={cobertura} semanasEncerradas={semanasEncerradas} competencia={mes} porSemana={doSetor.porSemana} />
    </div>
  );
}

function Resumo({ rotulo, valor, tom, detalhe, pequeno = false }: {
  rotulo: string; valor: string; tom?: 'melhor' | 'pior' | 'atencao'; detalhe?: string; pequeno?: boolean;
}) {
  // Visual 3.0: uma célula da faixa de números; a cor de tom vai num selo suave.
  const selo = tom === 'melhor' ? 'bg-emerald-500/10 text-marca-700 dark:text-marca-400'
    : tom === 'pior' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300'
      : tom === 'atencao' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : null;
  return (
    <div className="px-6 py-5">
      <p className="text-sm text-slate-500">{rotulo}</p>
      {pequeno ? (
        <p className="mt-1 text-base font-semibold leading-snug text-slate-900">{valor}</p>
      ) : selo ? (
        <p className="mt-1.5">
          <span className={`inline-flex rounded-full px-3 py-1 text-xl font-semibold tracking-tight tabular-nums ${selo}`}>{valor}</span>
        </p>
      ) : (
        <p className="mt-1 text-[1.65rem] font-semibold tracking-tight tabular-nums text-slate-900">{valor}</p>
      )}
      {detalhe && <p className="mt-1 text-xs text-slate-500">{detalhe}</p>}
    </div>
  );
}
