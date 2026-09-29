import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import FormularioLancamentos from '@/componentes/FormularioLancamentos';
import VolumeSemanal, { type LinhaVolume } from '@/componentes/VolumeSemanal';
import SeletorDeDetalhe, { type Destaque } from '@/componentes/SeletorDeDetalhe';
import SetasDeCompetencia from '@/componentes/SetasDeCompetencia';
import { Quadro, Tabela, Th, Td } from '@/componentes/ui';
import Link from '@/componentes/Link';
import { diaMes, hojeNoBrasil, mesDeCompetencia, periodoDaSemana } from '@/lib/formatar';
import { mesAnterior } from '@/lib/competencia';
import type {
  CargoDaPessoa, ConferenciaLancamento, Lancamento, PesoCargo, Pessoa, RegraCota,
} from '@/lib/tipos';

export const dynamic = 'force-dynamic';

const SEMANAS = [1, 2, 3, 4];
const numero = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });

/**
 * Lançamentos (1.19.0): o topo diz o que falta no mês.
 *
 * Um cartão por semana com quantas pessoas já têm volume lançado — o clique
 * abre o volume daquela semana logo abaixo — e um cartão "A conferir" com as
 * faixas que não fecham com o total. Antes eram abas de semana dentro do
 * quadro de volume, e o aviso de conferência ficava solto no meio da tela.
 */
export default async function LancamentosDeCota({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; canal?: string }>;
}) {
  await exigirGestor();
  const { mes, canal: canalPedido } = await searchParams;
  // Tudo o que é lançado nesta página pertence ao canal escolhido.
  const canal = canalPedido === 'diretores' ? 'diretores' : 'huggy';

  const atual = mesDeCompetencia(hojeNoBrasil());
  const competencia = /^\d{4}-\d{2}$/.test(mes ?? '') ? `${mes}-01` : atual;
  const [inicio] = periodoDaSemana(competencia, 1);
  const [, fim] = periodoDaSemana(competencia, 4);

  const db = await criarClienteServidor();

  // Avaliações do canal por semana, contadas com `head` (a view passa de mil
  // linhas), e a última importação: a semana só está completa com o volume
  // digitado E as avaliações importadas até o fim dela.
  const avaliacoesNa = (s: number) => db.from('vw_avaliacoes_validas')
    .select('id', { count: 'exact', head: true })
    .eq('mes_competencia', competencia).eq('origem', canal).eq('semana', s)
    .then(({ count }) => count ?? 0);
  const [ultimaImportacao, ...avaliacoesPorSemana] = await Promise.all([
    db.from('avaliacoes').select('importado_em').not('importado_em', 'is', null)
      .order('importado_em', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => (data?.importado_em as string | undefined)?.slice(0, 10) ?? null),
    ...SEMANAS.map(avaliacoesNa),
  ]);
  const hoje = hojeNoBrasil();

  const [pessoas, regras, pesos, historico, lancamentos, conferencia, volumes, anterior] = await Promise.all([
    db.from('pessoas').select('*').order('nome'),
    db.from('regras').select('*').eq('manual', true).eq('ativo', true).order('ordem'),
    db.from('pesos_por_cargo').select('cargo_id, regra, peso, ativo').eq('ativo', true),
    db.from('cargos_da_pessoa').select('*'),
    db.from('lancamentos').select('*').eq('mes_competencia', competencia).eq('canal', canal)
      .order('criado_em', { ascending: false }),
    db.from('vw_lancamentos_a_conferir').select('*').eq('mes_competencia', competencia),
    db.from('volume_semanal').select('pessoa_id, semana, finalizados, tma_seg, tme_seg')
      .eq('mes_competencia', competencia).eq('canal', canal),
    // A última semana do mês anterior: base de quem se espera na 1ª semana.
    db.from('volume_semanal').select('pessoa_id, semana')
      .eq('mes_competencia', mesAnterior(competencia)).eq('canal', canal),
  ]);

  const listaVolumes = (volumes.data ?? []) as LinhaVolume[];
  const listaConferencia = (conferencia.data ?? []) as ConferenciaLancamento[];

  // Quem foi desligado some da lista — menos no mês em que ainda tem dado.
  // Sem isso não há como corrigir o volume nem lançar o acerto de quem saiu no
  // meio da competência, que é justamente quando o acerto é necessário.
  const comDadoNoMes = new Set([
    ...((lancamentos.data ?? []) as Lancamento[]).map((l) => l.pessoa_id),
    ...listaVolumes.map((v) => v.pessoa_id),
  ]);
  const listaPessoas = ((pessoas.data ?? []) as Pessoa[])
    .filter((p) => p.ativo || comDadoNoMes.has(p.id));
  const nomePessoa = new Map(((pessoas.data ?? []) as Pessoa[]).map((p) => [p.id, p.nome]));

  // Volume só para quem pontua por finalizado neste canal, no cargo vigente.
  const listaHistorico = (historico.data ?? []) as CargoDaPessoa[];
  const cargoDe = (id: string) => listaHistorico
    .filter((h) => h.pessoa_id === id && h.desde <= competencia)
    .sort((a, b) => b.desde.localeCompare(a.desde))[0]?.cargo_id;
  const cargosComAtendimento = new Set(((pesos.data ?? []) as PesoCargo[])
    .filter((p) => p.regra === (canal === 'huggy' ? 'huggy_atendimento' : 'diretores_atendimento')).map((p) => p.cargo_id));
  const pessoasDoVolume = listaPessoas
    .filter((p) => { const c = cargoDe(p.id); return c != null && cargosComAtendimento.has(c); });
  const doVolume = new Set(pessoasDoVolume.map((p) => p.id));
  const lancadosNa = (s: number) =>
    new Set(listaVolumes.filter((v) => v.semana === s && doVolume.has(v.pessoa_id)).map((v) => v.pessoa_id));

  // Quem se espera em cada semana: quem teve volume na última semana lançada
  // antes dela (na 1ª, a última do mês anterior). No Diretores-Expansão nem
  // todo atendente atende, e contar todos os cargos deixava a semana sempre
  // "faltando". Sem histórico nenhum, vale todo mundo que pontua no canal.
  const doMesAnterior = (anterior.data ?? []) as { pessoa_id: string; semana: number }[];
  const ultimaDoAnterior = Math.max(0, ...doMesAnterior.map((v) => v.semana));
  const esperadosNa = (s: number): Set<string> => {
    for (let x = s - 1; x >= 1; x--) {
      const la = lancadosNa(x);
      if (la.size) return la;
    }
    const base = new Set(doMesAnterior.filter((v) => v.semana === ultimaDoAnterior && doVolume.has(v.pessoa_id))
      .map((v) => v.pessoa_id));
    return base.size ? base : doVolume;
  };
  // A semana conta os esperados e quem mais lançou nela.
  const situacaoDa = (s: number) => {
    const lancados = lancadosNa(s);
    const esperados = new Set([...esperadosNa(s), ...lancados]);
    return { q: lancados.size, total: esperados.size, esperados };
  };

  const destaques: Destaque[] = SEMANAS.map((s) => {
    const { q, total, esperados } = situacaoDa(s);
    const [de, ate] = periodoDaSemana(competencia, s);
    const periodo = `${diaMes(de)} a ${diaMes(ate)}`;
    const completo = total > 0 && q >= total;

    // Avaliações importadas: mesma regra da tela de Importar.
    const av = avaliacoesPorSemana[s - 1] as number;
    const correndo = hoje >= de && hoje <= ate;
    const [tomAv, textoAv] = hoje < de ? ['neutro', 'ainda não começou']
      : correndo ? ['neutro', av ? `${av} · em andamento` : 'em andamento']
        : av === 0 ? ['atencao', 'nada importado']
          : ultimaImportacao && ultimaImportacao <= ate ? ['atencao', `${av} · parcial`]
            : ['bom', `✓ ${av}`];
    const etiqueta = (tom: string) => `rounded-md px-1.5 py-px font-semibold ${tom === 'bom'
      ? 'bg-marca-600/15 text-marca-700 dark:text-marca-400'
      : tom === 'neutro' ? 'bg-slate-100 text-slate-600'
        : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`;

    return {
      chave: `s${s}`,
      bloco: (
        <>
          <p className="text-[13px] text-slate-500">{s}ª semana · {periodo}</p>
          <p className="text-2xl font-semibold tabular-nums text-slate-900">{q} de {total}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
            <span className={etiqueta(completo ? 'bom' : q === 0 ? 'neutro' : 'atencao')}>
              {completo ? '✓ completo' : q === 0 ? 'nada lançado' : `faltam ${total - q}`}
            </span>
            volume lançado
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
            <span className={etiqueta(tomAv)}>{textoAv}</span>
            avaliações importadas
          </p>
          <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100">
            <span className="crescer-x block h-full origin-left rounded-full bg-marca-600"
                  style={{ transform: `scaleX(${total ? q / total : 0})` }} />
          </span>
        </>
      ),
      detalhe: (
        <VolumeSemanal
          key={`${competencia}-${canal}-${s}`}
          canal={canal} competencia={competencia} semana={s} periodo={periodo}
          pessoas={pessoasDoVolume} volumes={listaVolumes} esperados={[...esperados]}
        />
      ),
    };
  });

  const aConferir = listaConferencia.length;
  destaques.push({
    chave: 'conferir',
    tom: aConferir ? 'atencao' : 'normal',
    bloco: (
      <>
        <p className="text-[13px] text-slate-500">A conferir</p>
        <p className={`text-2xl font-semibold tabular-nums ${aConferir
          ? 'text-amber-700 dark:text-amber-300' : 'text-marca-700 dark:text-marca-400'}`}>
          {aConferir || '✓'}
        </p>
        <p className="mt-1 text-xs text-slate-600">
          {aConferir ? 'faixas que não fecham com o total' : 'nada a conferir'}
        </p>
      </>
    ),
    detalhe: (
      <Quadro titulo="Faixas que não fecham com o total"
              subtitulo="É só um aviso: confira se falta lançar alguma faixa.">
        {aConferir === 0 ? (
          <p className="text-sm text-slate-600">Todas as faixas fecham com o total neste mês.</p>
        ) : (
          <Tabela noQuadro>
            <thead>
              <tr>
                <Th>Pessoa</Th><Th>Bloco</Th><Th className="text-right">Total</Th>
                <Th className="text-right">Nas faixas</Th><Th className="text-right">Diferença</Th>
              </tr>
            </thead>
            <tbody>
              {listaConferencia.map((c) => (
                <tr key={`${c.pessoa_id}-${c.bloco}`}>
                  <Td className="font-medium text-slate-800">{nomePessoa.get(c.pessoa_id) ?? 'Pessoa'}</Td>
                  <Td>{c.bloco}</Td>
                  <Td className="text-right tabular-nums">{numero(Number(c.atendimentos))}</Td>
                  <Td className="text-right tabular-nums">{numero(Number(c.soma_das_faixas))}</Td>
                  <Td className="text-right font-semibold tabular-nums text-amber-700 dark:text-amber-300">
                    {Number(c.diferenca) > 0 ? '+' : ''}{numero(Number(c.diferenca))}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        )}
      </Quadro>
    ),
  });

  // Abre a primeira semana que ainda falta; com tudo lançado, começa fechado.
  const primeiraIncompleta = SEMANAS.find((s) => { const x = situacaoDa(s); return x.q < x.total; });
  const inicial = primeiraIncompleta && competencia <= atual ? `s${primeiraIncompleta}` : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Lançamentos</h1>
          <div className="mt-1.5">
            <SetasDeCompetencia competencia={competencia} atual={atual} caminho="/cota/lancamentos" compacto
                                manter={{ canal }} />
          </div>
          <p className="mt-2 text-xs text-sobre-fundo-suave">
            Ciclo de {inicio.split('-').reverse().join('/')} a {fim.split('-').reverse().join('/')}
          </p>
        </div>

        <div className="inline-flex rounded-xl bg-black/25 p-1" role="tablist" aria-label="Canal">
          {([['huggy', 'Expansão'], ['diretores', 'Diretores-Expansão']] as const).map(([chave, rotulo]) => (
            <Link
              key={chave} role="tab" aria-selected={canal === chave}
              href={`/cota/lancamentos?mes=${competencia.slice(0, 7)}&canal=${chave}`}
              className={`rounded-lg px-4 py-1.5 text-sm transition ${canal === chave
                ? 'bg-superficie font-semibold text-slate-900 shadow-sm'
                : 'text-sobre-fundo-suave hover:text-sobre-fundo'}`}
            >
              {rotulo}
            </Link>
          ))}
        </div>
      </div>

      <SeletorDeDetalhe key={`${competencia}-${canal}`} destaques={destaques} inicial={inicial} alternar
                        rotulo="Situação do mês" grade="sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5" />

      <FormularioLancamentos
        canal={canal}
        competencia={competencia}
        pessoas={(pessoas.data ?? []) as Pessoa[]}
        regras={(regras.data ?? []) as RegraCota[]}
        pesos={(pesos.data ?? []) as PesoCargo[]}
        historico={listaHistorico}
        lancamentos={(lancamentos.data ?? []) as Lancamento[]}
      />
    </div>
  );
}
