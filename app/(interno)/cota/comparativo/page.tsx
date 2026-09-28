import Link from '@/componentes/Link';
import Abas from '@/componentes/Abas';
import { AbasDeCanal, NoCanal, ProvedorDeCanal, type Canal } from '@/componentes/Canal';
import GraficoDeLinha, { type PontoDaLinha } from '@/componentes/GraficoDeLinha';
import { Painel, Secao, Vazio } from '@/componentes/ui';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { percentual } from '@/lib/formatar';
import { resolverCompetencia } from '@/lib/competencia';

export const dynamic = 'force-dynamic';

type Tom = 'bom' | 'atencao' | 'ruim' | 'neutro';
type Categoria = 'pts' | 'csat' | 'vol' | 'tme' | 'mon';
/** Uma pessoa numa categoria: o valor de cada mês do período (null = sem dado). */
type Serie = { id: string; nome: string; valores: (number | null)[] };

const PERIODOS = [3, 6, 12];
const NOMES_MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const CANAIS: Canal[] = ['huggy', 'diretores'];

const inteiro = (v: number) => Math.round(v).toLocaleString('pt-BR');
const nomeCurto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');
const media = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
const semNulos = (l: (number | null)[]) => l.filter((v): v is number => v != null);

/** Segundos → "12:34" ou "1h02". */
function tempo(seg: number) {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = Math.round(seg % 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** '2026-09-01' → 'Set/26'. */
const rotuloMes = (c: string) => `${NOMES_MES[Number(c.slice(5, 7)) - 1]}/${c.slice(2, 4)}`;

/** Os `n` meses até `fim`, do mais antigo ao mais recente. */
function mesesAte(fim: string, n: number) {
  const ano = Number(fim.slice(0, 4)), mes = Number(fim.slice(5, 7)) - 1;
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(ano, mes - (n - 1 - i), 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  });
}

const COR_CELULA: Record<Tom, string> = {
  bom: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  atencao: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  ruim: 'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  neutro: 'text-slate-700',
};

/**
 * Comparativo entre meses (1.17.0): cada categoria mês a mês.
 *
 * O resto do painel compara com o mês anterior; aqui aparecem vários meses
 * lado a lado — a pergunta é "estamos melhorando?". Para cada categoria
 * (Pontuação, C-SAT, Volume, TME, Monitoria): um resumo do período, a linha
 * dos meses com a referência e, para quem vê o time, a tabela por atendente
 * com os meses nas colunas.
 *
 * O operador vê a própria evolução: as consultas respeitam a RLS, então os
 * dados já chegam só dele, e a tabela por atendente nem é montada. O Pleno,
 * por enquanto, também — ver a equipe aqui depende da migração 31.
 *
 * Pontuação de mês fechado sai do fechamento (o que foi entregue); de mês
 * aberto, do cálculo ao vivo — a mesma regra do extrato.
 */
export default async function Comparativo({
  searchParams,
}: {
  searchParams: Promise<{ n?: string; cat?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { n, cat } = await searchParams;
  const periodo = PERIODOS.includes(Number(n)) ? Number(n) : 6;
  const veOTime = perfil.papel !== 'operador';
  const { competencia: fim } = await resolverCompetencia();
  const meses = mesesAte(fim, periodo);
  const de = meses[0];

  const db = await criarClienteServidor();
  const [pessoas, fechados, csat, volume, monitorias] = await Promise.all([
    db.from('pessoas').select('id, nome, exibir_no_painel, conta_nas_medias'),
    db.from('fechamentos_cota').select('pessoa_id, mes_competencia, resultado, meta')
      .gte('mes_competencia', de).lte('mes_competencia', fim),
    db.from('vw_csat_semanal').select('pessoa_id, origem, mes_competencia, avaliacoes, positivas')
      .gte('mes_competencia', de).lte('mes_competencia', fim),
    db.from('volume_semanal').select('pessoa_id, canal, mes_competencia, finalizados, tme_seg')
      .gte('mes_competencia', de).lte('mes_competencia', fim),
    db.from('vw_monitorias').select('operador_id, mes_referencia, nota_final')
      .gte('mes_referencia', de).lte('mes_referencia', fim),
  ]);

  // Meses sem fechamento nenhum: a pontuação vem do cálculo ao vivo.
  type Ponto = { pessoa_id: string; mes_competencia: string; resultado: number; meta: number | null };
  const doFechamento = (fechados.data ?? []) as Ponto[];
  const abertos = meses.filter((m) => !doFechamento.some((f) => f.mes_competencia === m));
  const { data: aoVivo } = abertos.length
    ? await db.from('vw_cota_mensal').select('pessoa_id, mes_competencia, resultado, meta').in('mes_competencia', abertos)
    : { data: [] };
  const pontuacoes = [...doFechamento, ...((aoVivo ?? []) as Ponto[])];

  const nome = new Map((pessoas.data ?? []).map((p) => [p.id as string, nomeCurto(p.nome as string)]));
  // As mesmas duas decisões da tela inicial: aparecer na lista e entrar na média.
  const naoExibe = new Set((pessoas.data ?? []).filter((p) => p.exibir_no_painel === false).map((p) => p.id as string));
  const naoConta = new Set((pessoas.data ?? []).filter((p) => p.conta_nas_medias === false).map((p) => p.id as string));
  const exibe = (id: string) => !naoExibe.has(id);
  const conta = (id: string) => !naoConta.has(id);

  const todoCsat = (csat.data ?? []) as { pessoa_id: string; origem: Canal; mes_competencia: string; avaliacoes: number; positivas: number }[];
  const todoVolume = (volume.data ?? []) as { pessoa_id: string; canal: Canal; mes_competencia: string; finalizados: number; tme_seg: number | null }[];
  const todasNotas = ((monitorias.data ?? []) as { operador_id: string; mes_referencia: string; nota_final: number }[])
    .filter((m) => m.nota_final != null);

  /** Uma série por pessoa, a partir de uma função que dá o valor dela num mês. */
  const series = (ids: string[], valor: (id: string, m: string) => number | null): Serie[] =>
    [...new Set(ids)].filter(exibe).map((id) => ({ id, nome: nome.get(id) ?? '—', valores: meses.map((m) => valor(id, m)) }))
      .filter((s) => s.valores.some((v) => v != null))
      .sort((a, b) => (b.valores.at(-1) ?? -Infinity) - (a.valores.at(-1) ?? -Infinity));

  // ------------------------------------------------------------ Pontuação
  const pontoDe = (id: string, m: string) => pontuacoes.find((p) => p.pessoa_id === id && p.mes_competencia === m);
  const seriesPts = series(pontuacoes.map((p) => p.pessoa_id), (id, m) => {
    const p = pontoDe(id, m); return p ? Number(p.resultado) : null;
  });
  const equipePts = meses.map((m) => media(pontuacoes.filter((p) => p.mes_competencia === m && p.meta && conta(p.pessoa_id))
    .map((p) => Number(p.resultado))));
  const metaDe = (id: string, m: string) => { const p = pontoDe(id, m); return p?.meta ? Number(p.meta) : null; };
  const metaGeral = pontuacoes.find((p) => p.meta)?.meta ?? null;
  const naMetaNoFim = pontuacoes.filter((p) => p.mes_competencia === fim && p.meta && conta(p.pessoa_id));

  // Os dados são indexados uma vez, por pessoa e mês (e canal), e a equipe
  // somada junto. Filtrar a lista inteira para cada pessoa e mês estourava o
  // limite de processamento do Worker em 12 meses.
  const EQUIPE = '*';
  type Acumulado = { positivas: number; avaliacoes: number; finalizados: number; volumes: number; tmes: number[]; notas: number[] };
  const indice = new Map<string, Acumulado>();
  const acumular = (chave: string) => {
    let a = indice.get(chave);
    if (!a) { a = { positivas: 0, avaliacoes: 0, finalizados: 0, volumes: 0, tmes: [], notas: [] }; indice.set(chave, a); }
    return a;
  };
  const em = (quem: string, c: string, m: string) => `${quem}|${c}|${m}`;
  for (const x of todoCsat) {
    for (const quem of conta(x.pessoa_id) ? [x.pessoa_id, EQUIPE] : [x.pessoa_id]) {
      const a = acumular(em(quem, x.origem, x.mes_competencia));
      a.positivas += x.positivas; a.avaliacoes += x.avaliacoes;
    }
  }
  for (const x of todoVolume) {
    for (const quem of conta(x.pessoa_id) ? [x.pessoa_id, EQUIPE] : [x.pessoa_id]) {
      const a = acumular(em(quem, x.canal, x.mes_competencia));
      a.finalizados += x.finalizados; a.volumes += 1;
      if ((x.tme_seg ?? 0) > 0) a.tmes.push(Number(x.tme_seg));
    }
  }
  for (const x of todasNotas) {
    for (const quem of conta(x.operador_id) ? [x.operador_id, EQUIPE] : [x.operador_id]) {
      acumular(em(quem, '-', x.mes_referencia)).notas.push(Number(x.nota_final));
    }
  }
  const csatDe = (c: Canal, quem: string, m: string) => {
    const a = indice.get(em(quem, c, m)); return a?.avaliacoes ? a.positivas / a.avaliacoes : null;
  };
  const volDe = (c: Canal, quem: string, m: string) => {
    const a = indice.get(em(quem, c, m)); return a?.volumes ? a.finalizados : null;
  };
  // TME como a regra usa: média simples dos TMEs lançados.
  const tmeDe = (c: Canal, quem: string, m: string) => media(indice.get(em(quem, c, m))?.tmes ?? []);
  const notaDe = (quem: string, m: string) => media(indice.get(em(quem, '-', m))?.notas ?? []);

  // ------------------------------------------------------------- montagem
  const tomDoCsat = (v: number): Tom => (v >= 0.90 ? 'bom' : v >= 0.85 ? 'atencao' : 'ruim');
  const tomDaNota = (v: number): Tom => (v >= 0.85 ? 'bom' : v >= 0.70 ? 'atencao' : 'ruim');
  const TOM_LINHA = { bom: 'bom', atencao: 'atencao', ruim: 'ruim', neutro: 'bom' } as const;

  /** Variação do último mês contra o anterior, no formato de cada categoria. */
  const variacao = (k: Categoria, atual: number | null, antes: number | null) => {
    if (atual == null || antes == null) return null;
    const d = atual - antes;
    const s = d >= 0 ? '▲' : '▼';
    const texto = k === 'csat' || k === 'mon' ? `${s} ${(Math.abs(d) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pt`
      : k === 'tme' ? `${s} ${tempo(Math.abs(d))}`
        : `${s} ${antes ? (Math.abs(d / antes) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) : '—'}%`;
    // TME: subir é piorar.
    return { texto, melhor: k === 'tme' ? d <= 0 : d >= 0 };
  };

  const Vista = ({ k, equipe, pessoas: lista, formatar, tom, referencia, min, max, titulo, subtitulo, resumoExtra }: {
    k: Categoria;
    equipe: (number | null)[];
    pessoas: Serie[];
    formatar: (v: number) => string;
    tom: (v: number, i: number, id?: string) => Tom;
    referencia?: { valor: number; rotulo: string };
    min?: number; max?: number;
    titulo: string; subtitulo: string;
    resumoExtra?: { rotulo: string; valor: string };
  }) => {
    const valores = semNulos(equipe);
    if (!valores.length) return <Painel><Secao><Vazio>Sem dados neste período.</Vazio></Secao></Painel>;
    const ultimo = equipe.at(-1) ?? null;
    const v = variacao(k, ultimo, equipe.at(-2) ?? null);
    const maiorMelhor = k !== 'tme';
    const iMelhor = equipe.reduce<number>((m, x, i) => x != null && (equipe[m] == null
      || (maiorMelhor ? x > equipe[m]! : x < equipe[m]!)) ? i : m, 0);
    const quem = veOTime ? (k === 'vol' ? 'Equipe' : 'Média da equipe') : 'Você';
    const resumo = [
      ...(resumoExtra ? [resumoExtra] : []),
      { rotulo: `${quem} em ${rotuloMes(fim)}`, valor: ultimo != null ? formatar(ultimo) : '—' },
      { rotulo: `Contra ${rotuloMes(meses.at(-2)!)}`, valor: v?.texto ?? '—', tom: v ? (v.melhor ? 'melhor' : 'pior') : undefined },
      { rotulo: `Média dos ${periodo} meses`, valor: formatar(media(valores)!) },
      { rotulo: 'Melhor mês do período', valor: `${rotuloMes(meses[iMelhor])} · ${formatar(equipe[iMelhor]!)}` },
    ].slice(0, 4);

    return (
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {resumo.map((r) => (
            <div key={r.rotulo} className="rounded-2xl bg-superficie px-5 py-4 shadow-sm">
              <p className="text-sm text-slate-500">{r.rotulo}</p>
              <p className={`text-2xl font-semibold tracking-tight tabular-nums ${
                'tom' in r && r.tom === 'melhor' ? 'text-marca-700 dark:text-marca-400'
                  : 'tom' in r && r.tom === 'pior' ? 'text-rose-700' : 'text-slate-900'}`}>{r.valor}</p>
            </div>
          ))}
        </div>

        <Painel>
          <Secao titulo={veOTime ? titulo : titulo.replace('da equipe', 'sua')} subtitulo={subtitulo}>
            <GraficoDeLinha largura={Math.max(640, meses.length * 90)} rotulos={meses.map(rotuloMes)}
                            formatar={formatar} referencia={referencia} min={min} max={max}
                            pontos={equipe.map((x, i): PontoDaLinha => x == null ? null : { valor: x, tom: TOM_LINHA[tom(x, i)] })} />
          </Secao>
        </Painel>

        {veOTime && (
          <Painel>
            <Secao titulo="Por atendente"
                   subtitulo="Os meses nas colunas; a variação compara o mês mais recente com o anterior. O link no fim da linha abre o detalhe da pessoa nesta categoria.">
              {lista.length === 0 ? <Vazio>Ninguém com dado neste período.</Vazio> : (
                <div className="-mx-6 overflow-x-auto sm:-mx-7">
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="text-xs text-slate-500">
                        <th className="py-2.5 pl-6 pr-3 text-left font-medium sm:pl-7">Pessoa</th>
                        {meses.map((m) => <th key={m} className="px-2 py-2.5 text-right font-medium">{rotuloMes(m)}</th>)}
                        <th className="px-3 py-2.5 text-right font-medium">Variação</th>
                        <th className="py-2.5 pl-3 pr-6 sm:pr-7"><span className="sr-only">Histórico</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((p) => {
                        const vp = variacao(k, p.valores.at(-1) ?? null, p.valores.at(-2) ?? null);
                        return (
                          <tr key={p.id} className="border-t border-slate-100">
                            <td className="whitespace-nowrap py-2 pl-6 pr-3 font-medium text-slate-800 sm:pl-7">{p.nome}</td>
                            {p.valores.map((x, i) => (
                              <td key={i} className="px-2 py-2 text-right">
                                {x == null ? <span className="text-slate-300">—</span> : (
                                  <span className={`inline-block min-w-16 rounded-md px-2 py-0.5 ${COR_CELULA[tom(x, i, p.id)]}`}>{formatar(x)}</span>
                                )}
                              </td>
                            ))}
                            <td className={`whitespace-nowrap px-3 py-2 text-right font-semibold ${
                              !vp ? 'text-slate-300' : vp.melhor ? 'text-marca-700 dark:text-marca-400' : 'text-rose-700'}`}>
                              {vp?.texto ?? '—'}
                            </td>
                            <td className="whitespace-nowrap py-2 pl-3 pr-6 text-right sm:pr-7">
                              {/* O link leva ao detalhe da própria categoria: as
                                  monitorias do atendente, o extrato (semana a
                                  semana) ou o histórico da cota. */}
                              {k === 'mon' ? (
                                <Link href={`/cota/monitorias?pessoa=${p.id}`}
                                      className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:border-marca-600">
                                  monitorias ›
                                </Link>
                              ) : (
                                <Link href={k === 'pts' ? `/cota/historico?pessoa=${p.id}` : `/cota/extrato?pessoa=${p.id}&mes=${fim.slice(0, 7)}`}
                                      className="rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:border-marca-600">
                                  {k === 'pts' ? 'histórico ›' : 'extrato ›'}
                                </Link>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="border-t-2 border-slate-200 font-semibold text-slate-900">
                        <td className="py-2 pl-6 pr-3 sm:pl-7">{k === 'vol' ? 'Equipe (soma)' : 'Equipe (média)'}</td>
                        {equipe.map((x, i) => <td key={i} className="px-2 py-2 text-right">{x == null ? '—' : formatar(x)}</td>)}
                        <td colSpan={2} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Secao>
          </Painel>
        )}
      </div>
    );
  };

  /** Categoria por canal: as abas de canal ficam dentro dela, onde fazem sentido. */
  const porCanal = (conteudo: (c: Canal) => React.ReactNode) => (
    <div className="space-y-4">
      <AbasDeCanal naSuperficie />
      {CANAIS.map((c) => <NoCanal key={c} canal={c}>{conteudo(c)}</NoCanal>)}
    </div>
  );

  const ids = (l: { pessoa_id: string }[]) => l.map((x) => x.pessoa_id);

  const itens = [
    {
      chave: 'pts', rotulo: 'Pontuação',
      conteudo: (
        <Vista k="pts" equipe={equipePts} pessoas={seriesPts} formatar={inteiro}
               titulo="Pontuação média da equipe por mês"
               subtitulo={`Média dos pontos de quem tem meta.${metaGeral ? ` Linha tracejada: a meta de ${inteiro(Number(metaGeral))}.` : ''} Mês fechado vem do fechamento; mês aberto, do cálculo de hoje.`}
               referencia={metaGeral ? { valor: Number(metaGeral), rotulo: `meta ${inteiro(Number(metaGeral))}` } : undefined}
               tom={(v, i, id) => {
                 const meta = id ? metaDe(id, meses[i]) : metaGeral ? Number(metaGeral) : null;
                 if (!meta) return 'neutro';
                 return v >= meta ? 'bom' : v >= meta * 0.9 ? 'atencao' : 'ruim';
               }}
               resumoExtra={veOTime && naMetaNoFim.length
                 ? { rotulo: `Na meta em ${rotuloMes(fim)}`, valor: `${naMetaNoFim.filter((p) => Number(p.resultado) >= Number(p.meta)).length} de ${naMetaNoFim.length}` }
                 : undefined} />
      ),
    },
    {
      chave: 'csat', rotulo: 'C-SAT',
      conteudo: porCanal((c) => (
        <Vista k="csat" formatar={percentual} min={0.75} max={1} tom={(v) => tomDoCsat(v)}
               titulo="C-SAT da equipe por mês" subtitulo="Positivas sobre avaliações. Linha tracejada: a meta de 95%."
               referencia={{ valor: 0.95, rotulo: 'meta 95%' }}
               equipe={meses.map((m) => csatDe(c, EQUIPE, m))}
               pessoas={series(ids(todoCsat.filter((x) => x.origem === c)), (id, m) => csatDe(c, id, m))} />
      )),
    },
    {
      chave: 'vol', rotulo: 'Volume',
      conteudo: porCanal((c) => {
        const equipe = meses.map((m) => volDe(c, EQUIPE, m));
        const med = media(semNulos(equipe));
        return (
          <Vista k="vol" formatar={inteiro} tom={() => 'neutro'} equipe={equipe}
                 titulo="Finalizados da equipe por mês" subtitulo="Total do canal. Linha tracejada: a média do período."
                 referencia={med != null ? { valor: med, rotulo: `média ${inteiro(med)}` } : undefined}
                 pessoas={series(ids(todoVolume.filter((x) => x.canal === c)), (id, m) => volDe(c, id, m))} />
        );
      }),
    },
    {
      chave: 'tme', rotulo: 'TME',
      conteudo: porCanal((c) => {
        const equipe = meses.map((m) => tmeDe(c, EQUIPE, m));
        const med = media(semNulos(equipe));
        return (
          <Vista k="tme" formatar={tempo} equipe={equipe}
                 // Por atendente: âmbar acima da média da equipe no mês. Na linha
                 // da equipe: âmbar acima da média do período.
                 tom={(v, i, id) => {
                   const ref = id ? equipe[i] : med;
                   return ref != null && v > ref ? 'atencao' : 'bom';
                 }}
                 titulo="TME médio da equipe por mês" subtitulo="Linha tracejada: a média do período. Subir é piorar."
                 referencia={med != null ? { valor: med, rotulo: `média ${tempo(med)}` } : undefined}
                 pessoas={series(ids(todoVolume.filter((x) => x.canal === c && (x.tme_seg ?? 0) > 0)), (id, m) => tmeDe(c, id, m))} />
        );
      }),
    },
    {
      chave: 'mon', rotulo: 'Monitoria',
      conteudo: (
        <Vista k="mon" formatar={percentual} min={0.7} max={1} tom={(v) => tomDaNota(v)}
               titulo="Nota média de monitoria da equipe por mês" subtitulo="Linha tracejada: 85%, o piso para a monitoria pontuar."
               referencia={{ valor: 0.85, rotulo: 'piso 85%' }}
               equipe={meses.map((m) => notaDe(EQUIPE, m))}
               pessoas={series(todasNotas.map((x) => x.operador_id), (id, m) => notaDe(id, m))} />
      ),
    },
  ];

  return (
    <ProvedorDeCanal inicial="huggy">
      <div className="space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Comparativo entre meses</h1>
            <p className="mt-1 text-sm text-sobre-fundo-suave">
              {veOTime ? 'A equipe mês a mês, em cada categoria.' : 'A sua evolução mês a mês, em cada categoria.'}
              {' '}De {rotuloMes(de)} a {rotuloMes(fim)}.
            </p>
          </div>
          {/* Período: navegação, porque muda o que se consulta. */}
          <div className="inline-flex gap-1 rounded-full bg-black/25 p-1">
            {PERIODOS.map((p) => (
              <Link key={p} href={`/cota/comparativo?n=${p}${cat ? `&cat=${cat}` : ''}`}
                    aria-current={p === periodo ? 'true' : undefined}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                      p === periodo ? 'bg-superficie text-slate-900 shadow-sm' : 'text-sobre-fundo-suave hover:text-sobre-fundo'}`}>
                {p} meses
              </Link>
            ))}
          </div>
        </div>

        <Abas itens={itens} inicial={cat} />
      </div>
    </ProvedorDeCanal>
  );
}
