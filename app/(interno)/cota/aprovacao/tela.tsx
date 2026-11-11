import { faixasDeCsat, filasDoSetor, metaDoCsat, textoDaMeta } from '@/lib/filasDoSetor';
import { redirect } from 'next/navigation';
import Link from '@/componentes/Link';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { Painel, Secao, Vazio } from '@/componentes/ui';
import { dataHora, mesRotulo, percentual } from '@/lib/formatar';
import GraficoBarrasELinha, { type SerieDoGrafico } from '@/componentes/GraficoBarrasELinha';
import AprovacaoDasCotas, { type PessoaParaAprovar } from '@/componentes/AprovacaoDasCotas';
import { aguarda } from '@/lib/aprovacao';
import { SERIES } from '@/lib/cores';

type Mes = { mes_competencia: string; pessoas: number; pendentes: number; aprovadas: number };
/** O submenu da CEO (4.0.0): Aguardando aprovação e Aprovadas. */
export type ModoDaAprovacao = 'aguardando' | 'aprovadas';
const aprovada = (p: { decisao: string | null }) => p.decisao === 'aprovado';
type NumerosDoMes = {
  mes: string; fechado: boolean; atendimentos: number; avaliacoes: number; positivas: number;
  pontos: number; pessoas: number; bateram: number;
  csat_canal: { canal: string; avaliacoes: number; positivas: number }[];
};
type SetorDoPainel = {
  id: number; nome: string; fechado: boolean; fechado_em: string | null; fechado_por: string | null; gestores: string | null;
  atendimentos: number; avaliacoes: number; positivas: number;
  tres_meses: NumerosDoMes[];
  csat_semanal: { canal: string; semana: number; avaliacoes: number; positivas: number }[];
  pessoas: PessoaParaAprovar[];
};
type Linha = { semana: number | null; rotulo: string; grupo: string | null; quantidade: number | null; peso: number | null; pontos: number };
type MesDaPessoa = { mes: string; fechamento_id: string | null; pontos: number | null; situacao_meta: string | null; atendimentos: number; avaliacoes: number; positivas: number };
type Extrato = {
  fechamento_id: string; nome: string; cargo: string | null; mes: string; pontos: number; fechado_em: string; setor: string | null;
  decisao: { situacao: 'aprovado' | 'recusado' | 'respondido'; motivo: string | null; em: string } | null;
  conversa: { situacao: 'recusado' | 'respondido'; texto: string | null; em: string; por: string | null }[] | null;
  historico: { situacao: string; motivo: string | null; em: string; pontos: number }[];
  meses: MesDaPessoa[] | null;
  linhas: Linha[];
};

const inteiro = (v: number) => Math.round(v).toLocaleString('pt-BR');
const pts = (v: number | null) => v == null ? '—'
  : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const CORES = SERIES;
const nomeDoMes = (iso: string) => mesRotulo(iso).split(' ')[0];
const razao = (av: number, pos: number) => (Number(av) ? Number(pos) / Number(av) : null);
const SITUACAO: Record<string, [string, string]> = {
  atingida: ['Atingida', 'bg-marca-50 text-marca-800 dark:bg-marca-500/15 dark:text-marca-300'],
  proxima: ['Próxima', 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'],
  abaixo: ['Abaixo', 'bg-rose-50 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300'],
};

/** "▲ 4,2% vs set" — em pontos percentuais quando o número já é %. */
function Variacao({ atual, antes, mes, emPp = false }: { atual: number | null; antes: number | null | undefined; mes: string; emPp?: boolean }) {
  if (atual == null || antes == null || (!emPp && !antes)) return null;
  const d = emPp ? (atual - antes) * 100 : (atual / antes - 1) * 100;
  const rotulo = nomeDoMes(mes).slice(0, 3).toLowerCase();
  if (Math.abs(d) < 0.05) return <p className="text-xs text-slate-500">= {rotulo}</p>;
  return (
    <p className={`text-xs font-semibold ${d > 0 ? 'text-marca-700 dark:text-marca-300' : 'text-rose-700 dark:text-rose-300'}`}>
      {d > 0 ? '▲' : '▼'} {Math.abs(d).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}{emPp ? ' p.p.' : '%'} vs {rotulo}
    </p>
  );
}

function selo(s: SetorDoPainel, modo: ModoDaAprovacao): [string, string] {
  if (!s.fechado) return ['Aguardando o fechamento', 'bg-slate-100 text-slate-600 dark:bg-white/5'];
  if (modo === 'aprovadas') {
    const ap = s.pessoas.filter(aprovada).length;
    return [`${ap} de ${s.pessoas.length} aprovada${ap === 1 ? '' : 's'}`, 'bg-marca-50 text-marca-800 dark:bg-marca-500/15 dark:text-marca-300'];
  }
  const pend = s.pessoas.filter(aguarda).length;
  const rec = s.pessoas.filter((p) => p.decisao === 'recusado').length;
  if (pend) return [`${pend} de ${s.pessoas.length} aguardando`, 'bg-amber-50 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300'];
  if (rec) return [`${rec} recusada${rec > 1 ? 's' : ''}, com o gestor`, 'bg-rose-50 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300'];
  return ['Tudo aprovado', 'bg-marca-50 text-marca-800 dark:bg-marca-500/15 dark:text-marca-300'];
}

/**
 * Aprovação das cotas (4.0.0, migração 98): a tela da diretoria. Depois que o
 * gestor fecha o mês, a CEO vê um cartão por setor e, no setor escolhido, o
 * resumo — só pontos —, os últimos 3 meses e a lista para aprovar ou recusar
 * pessoa a pessoa; a recusa leva o motivo ao gestor. Clicar no nome abre o
 * extrato congelado do fechamento.
 *
 * Tudo vem de funções do banco que conferem o papel (painel_da_diretoria,
 * extrato_para_diretoria): a diretoria não lê as tabelas. O administrador
 * também entra, para conferir, mas sem decidir.
 */
export async function TelaDeAprovacao({ searchParams, modo }: {
  searchParams: Promise<{ mes?: string; f?: string; setor?: string }>;
  modo: ModoDaAprovacao;
}) {
  const perfil = await exigirPerfil();
  const diretoria = perfil.papel === 'diretoria';
  if (!diretoria && !perfil.administrador) redirect('/cota');
  const { mes: pedido, f, setor: setorPedido } = await searchParams;
  const db = await criarClienteServidor();
  const base = modo === 'aprovadas' ? '/cota/aprovacao/aprovadas' : '/cota/aprovacao';

  if (f) return <ExtratoDaPessoa f={f} diretoria={diretoria} base={base} />;

  // Aguardando: meses com alguém ainda não aprovado (sem decisão, respondida ou
  // recusada com o gestor). Aprovadas: meses com alguma cota aprovada.
  const { data: mesesDb } = await db.rpc('meses_para_aprovar');
  const meses = ((mesesDb ?? []) as Mes[])
    .filter((m) => (modo === 'aprovadas' ? m.aprovadas > 0 : m.pessoas - m.aprovadas > 0));
  if (!meses.length) {
    return (
      <div className="space-y-6">
        <Cabecalho modo={modo} />
        <Painel><Secao><Vazio>{modo === 'aprovadas'
          ? 'Nenhuma cota aprovada ainda. As que você aprovar ficam aqui, para consultar.'
          : 'Nada aguardando a sua aprovação. Quando um gestor fechar o mês, as cotas aparecem aqui; as que você já aprovou ficam em Aprovadas.'}</Vazio></Secao></Painel>
      </div>
    );
  }
  const mes = meses.find((m) => m.mes_competencia.slice(0, 7) === pedido)?.mes_competencia
    ?? (modo === 'aguardando' ? meses.find((m) => m.pendentes > 0)?.mes_competencia : undefined)
    ?? meses[0].mes_competencia;
  const mesCurto = mes.slice(0, 7);

  // ----------------------------------------------------- O resumo do mês
  const { data: painelDb, error } = await db.rpc('painel_da_diretoria', { p_mes: mes });
  // Em Aprovadas, só os setores com alguma cota aprovada no mês.
  const setores = ((painelDb ?? []) as SetorDoPainel[])
    .filter((s) => modo === 'aguardando' || s.pessoas.some(aprovada));
  const escolhido = setores.find((s) => String(s.id) === setorPedido)
    ?? (modo === 'aguardando' ? setores.find((s) => s.pessoas.some(aguarda)) : undefined)
    ?? setores.find((s) => s.fechado) ?? setores[0];
  const pendentesDoMes = setores.reduce((t, s) => t + s.pessoas.filter(aguarda).length, 0);
  const aprovadasDoMes = setores.reduce((t, s) => t + s.pessoas.filter(aprovada).length, 0);

  return (
    <div className="space-y-6">
      <Cabecalho modo={modo} />

      {/* Os meses da aba, do mais novo; o número é quantos faltam (ou foram aprovadas). */}
      <div className="flex flex-wrap gap-2">
        {meses.map((m) => {
          const atual = m.mes_competencia === mes;
          return (
            <Link key={m.mes_competencia} href={`${base}?mes=${m.mes_competencia.slice(0, 7)}`}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ring-1 ${atual
                    ? 'bg-marca-600 text-white ring-marca-600'
                    : 'bg-superficie text-slate-700 ring-slate-200 hover:ring-marca-600/50'}`}>
              {mesRotulo(m.mes_competencia)}
              {modo === 'aprovadas'
                ? <span className={`ml-1.5 text-xs ${atual ? '' : 'text-marca-700 dark:text-marca-400'}`}>✓ {m.aprovadas}</span>
                : <span className={`ml-2 rounded-full px-1.5 text-xs ${atual ? 'bg-white/25' : 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'}`}>{m.pessoas - m.aprovadas}</span>}
            </Link>
          );
        })}
      </div>

      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">Não foi possível carregar o mês: {error.message}</p>}

      <p className="text-sm text-slate-500">
        {modo === 'aprovadas'
          ? `${aprovadasDoMes} cota${aprovadasDoMes === 1 ? '' : 's'} aprovada${aprovadasDoMes === 1 ? '' : 's'} em ${nomeDoMes(mes).toLowerCase()}, somando os setores. Aprovadas, ficam finalizadas.`
          : pendentesDoMes
            ? `${pendentesDoMes} pessoa${pendentesDoMes > 1 ? 's' : ''} aguardando a sua aprovação em ${nomeDoMes(mes).toLowerCase()}, somando os setores.`
            : `Nada aguardando a sua decisão em ${nomeDoMes(mes).toLowerCase()}: o que falta está com o gestor.`}
      </p>

      {/* Um cartão por setor; o escolhido abre embaixo. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {setores.map((s, i) => {
          const [texto, cor] = selo(s, modo);
          const ativo = s.id === escolhido?.id;
          const atual = s.tres_meses.at(-1);
          return (
            <Link key={s.id} href={`${base}?mes=${mesCurto}&setor=${s.id}`} aria-current={ativo ? 'true' : undefined}
                  style={{ animationDelay: `${i * 60}ms` }}
                  className={`sobe rounded-2xl border bg-superficie px-4 py-3.5 shadow-sm transition hover:-translate-y-0.5 ${ativo
                    ? 'border-marca-600 ring-2 ring-marca-600/25' : 'border-slate-200 hover:border-slate-300'}`}>
              <b className="block truncate text-slate-900">{s.nome}</b>
              <dl className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                <div className="flex justify-between"><dt>Pessoas</dt><dd className="font-semibold tabular-nums text-slate-800">{s.fechado ? s.pessoas.length : '—'}</dd></div>
                <div className="flex justify-between"><dt>C-SAT</dt><dd className="font-semibold tabular-nums text-slate-800">{s.fechado ? percentual(razao(s.avaliacoes, s.positivas)) : '—'}</dd></div>
                <div className="flex justify-between"><dt>Pontos</dt><dd className="font-semibold tabular-nums text-slate-800">{s.fechado && atual ? inteiro(Number(atual.pontos)) : '—'}</dd></div>
              </dl>
              <span className={`mt-2.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${cor}`}>{texto}</span>
            </Link>
          );
        })}
      </div>

      {escolhido && <SetorDoMes key={escolhido.id} s={escolhido} mes={mes} podeDecidir={diretoria} modo={modo} base={base}
                                metaCsat={await metaDoSetor(db, escolhido.id)} />}
    </div>
  );
}

/** A meta de C-SAT de um setor: a faixa mais alta da primeira fila dele. */
async function metaDoSetor(db: Awaited<ReturnType<typeof criarClienteServidor>>, setorId: number) {
  const filas = await filasDoSetor(db, setorId);
  const faixas = await faixasDeCsat(db, filas.map((f) => f.grupoCsat));
  return metaDoCsat(faixas[filas[0]?.grupoCsat ?? '']);
}
function Cabecalho({ modo }: { modo: ModoDaAprovacao }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[.08em] text-slate-500">Aprovação das cotas</p>
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{modo === 'aprovadas' ? 'Aprovadas' : 'Aguardando aprovação'}</h1>
      <p className="text-sm text-slate-500">{modo === 'aprovadas'
        ? 'As cotas que você já aprovou, por mês e setor, em pontos. Aprovadas, ficam finalizadas; clique no nome para ver o extrato.'
        : 'O fechamento de cada mês, por setor e em pontos. Aprove ou recuse cada pessoa; clique no nome para ver o extrato completo.'}</p>
    </div>
  );
}

function SetorDoMes({ s, mes, podeDecidir, modo, base, metaCsat = 0.95 }: {
  /** A meta de C-SAT do setor, pela faixa mais alta (4.4.0): Expansão 95%, Telecom 94%. */
  metaCsat?: number;
  s: SetorDoPainel; mes: string; podeDecidir: boolean; modo: ModoDaAprovacao; base: string;
}) {
  const mesCurto = mes.slice(0, 7);
  if (!s.fechado) {
    return (
      <section className="surgir space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">{s.nome}</h2>
        <Painel><Secao>
          <p className="text-sm text-slate-600">
            {s.gestores ? `${s.gestores} ainda não fechou` : 'O setor ainda não fechou'} {nomeDoMes(mes).toLowerCase()}.
            As cotas aparecem aqui, com aviso no sino, assim que o mês for fechado.
          </p>
        </Secao></Painel>
      </section>
    );
  }

  const meses = s.tres_meses.filter((m) => m.fechado || m.mes === mes);
  const atual = s.tres_meses.at(-1)!;
  const anterior = s.tres_meses.length > 1 && s.tres_meses.at(-2)!.fechado ? s.tres_meses.at(-2)! : null;
  const pontosEquipe = s.pessoas.reduce((t, p) => t + Number(p.pontos), 0);
  const csat = razao(s.avaliacoes, s.positivas);

  // C-SAT por semana: uma linha por canal e a de todos os canais.
  const semanas = [...new Set(s.csat_semanal.map((c) => c.semana))].sort((a, b) => a - b);
  const canais = [...new Set(s.csat_semanal.map((c) => c.canal))];
  const linhasSemana: SerieDoGrafico[] = [
    ...canais.map((c, k) => ({
      nome: c, cor: CORES[k % CORES.length],
      valores: semanas.map((w) => {
        const x = s.csat_semanal.find((v) => v.canal === c && v.semana === w);
        return x ? razao(x.avaliacoes, x.positivas) : null;
      }),
    })),
    ...(canais.length > 1 ? [{
      nome: 'Todos os canais', cor: 'var(--color-slate-400)',
      valores: semanas.map((w) => {
        const xs = s.csat_semanal.filter((v) => v.semana === w);
        return razao(xs.reduce((t, v) => t + Number(v.avaliacoes), 0), xs.reduce((t, v) => t + Number(v.positivas), 0));
      }),
    }] : []),
  ];
  // C-SAT mês a mês, por canal.
  const canaisMes = [...new Set(meses.flatMap((m) => m.csat_canal.map((c) => c.canal)))];
  const linhasMes: SerieDoGrafico[] = [
    ...canaisMes.map((c, k) => ({
      nome: c, cor: CORES[k % CORES.length],
      valores: meses.map((m) => { const x = m.csat_canal.find((v) => v.canal === c); return x ? razao(x.avaliacoes, x.positivas) : null; }),
    })),
    ...(canaisMes.length > 1 ? [{ nome: 'Todos os canais', cor: 'var(--color-slate-400)', valores: meses.map((m) => razao(m.avaliacoes, m.positivas)) }] : []),
  ];
  const piso = (vs: (number | null)[]) => {
    const v = vs.filter((x): x is number => x != null);
    return Math.max(0, Math.min(0.9, Math.floor((Math.min(...v, 0.95) - 0.02) * 20) / 20));
  };

  const tiles = [
    { rotulo: 'Atendimentos', valor: inteiro(s.atendimentos), detalhe: 'todos os lançamentos do mês',
      v: <Variacao atual={Number(s.atendimentos)} antes={anterior ? Number(anterior.atendimentos) : null} mes={anterior?.mes ?? mes} /> },
    { rotulo: 'C-SAT médio', valor: percentual(csat), detalhe: `todas as avaliações, ${canais.length > 1 ? 'todos os canais' : 'do canal'}`,
      v: <Variacao atual={csat} antes={anterior ? razao(anterior.avaliacoes, anterior.positivas) : null} mes={anterior?.mes ?? mes} emPp /> },
    { rotulo: 'Avaliações', valor: inteiro(s.avaliacoes), detalhe: s.atendimentos ? `${percentual(s.avaliacoes / s.atendimentos)} dos atendimentos` : '',
      v: <Variacao atual={Number(s.avaliacoes)} antes={anterior ? Number(anterior.avaliacoes) : null} mes={anterior?.mes ?? mes} /> },
    { rotulo: 'Pontos da equipe', valor: `${inteiro(pontosEquipe)} pts`, detalhe: `${s.pessoas.length} pessoas no fechamento`,
      v: <Variacao atual={pontosEquipe} antes={anterior ? Number(anterior.pontos) : null} mes={anterior?.mes ?? mes} /> },
  ];
  const [texto, cor] = selo(s, modo);
  // A lista da aba: as que faltam aprovar, ou as aprovadas. Os números acima são do setor todo.
  const daLista = s.pessoas.filter((p) => (modo === 'aprovadas' ? aprovada(p) : !aprovada(p)));
  const linhaTabela = (rotulo: string, f: (m: NumerosDoMes) => string) => (
    <tr>
      <td className="py-1.5 pr-3 text-slate-500">{rotulo}</td>
      {meses.map((m) => (
        <td key={m.mes} className={`px-3 py-1.5 text-right ${m.mes === mes ? 'font-semibold text-slate-900' : 'text-slate-500'}`}>{f(m)}</td>
      ))}
    </tr>
  );
  const anteriores = s.tres_meses.slice(0, -1).map((m) => nomeDoMes(m.mes));

  return (
    <section className="surgir space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{s.nome}</h2>
          <p className="text-xs text-slate-500">Fechado{s.fechado_por ? ` por ${s.fechado_por}` : ''} em {dataHora(s.fechado_em)}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${cor}`}>{texto}</span>
      </div>

      <div className="grid divide-y divide-slate-200 rounded-[20px] border border-slate-200 bg-superficie shadow-sm sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
        {tiles.map((t) => (
          <div key={t.rotulo} className="px-5 py-4">
            <p className="text-sm text-slate-500">{t.rotulo}</p>
            <p className="mt-1 text-[1.5rem] font-semibold tracking-tight tabular-nums text-slate-900">{t.valor}</p>
            <p className="text-xs text-slate-500">{t.detalhe}</p>
            {t.v}
          </div>
        ))}
      </div>

      <Painel>
        <Secao titulo="C-SAT por semana" subtitulo={`${canais.length > 1 ? 'Uma linha por canal, com todas as avaliações.' : 'Todas as avaliações do canal.'} Tracejada: a meta de ${textoDaMeta(metaCsat)}.`}>
          {semanas.length
            ? <GraficoBarrasELinha largura={1400} rotulos={semanas.map((w) => `${w}ª semana`)} formatar={percentual}
                                   min={piso(linhasSemana.flatMap((l) => l.valores))} max={1} referencia={{ valor: metaCsat, rotulo: `meta ${textoDaMeta(metaCsat)}` }} linhas={linhasSemana} />
            : <Vazio>Sem avaliações importadas neste mês.</Vazio>}
        </Secao>
      </Painel>

      {meses.length > 1 && (
        <Painel>
          <Secao titulo="Últimos 3 meses" subtitulo={`${s.nome} de ${nomeDoMes(meses[0].mes).toLowerCase()} a ${nomeDoMes(mes).toLowerCase()}; o mês em análise em destaque.`}>
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
              <table className="w-full text-sm tabular-nums">
                <thead>
                  <tr className="border-b border-slate-200 text-xs text-slate-500">
                    <th className="py-1.5 pr-3 text-left font-medium" />
                    {meses.map((m) => <th key={m.mes} className={`px-3 py-1.5 text-right ${m.mes === mes ? 'font-semibold text-slate-800' : 'font-medium'}`}>{nomeDoMes(m.mes)}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {linhaTabela('Atendimentos', (m) => inteiro(Number(m.atendimentos)))}
                  {linhaTabela('Avaliações', (m) => inteiro(Number(m.avaliacoes)))}
                  {linhaTabela('Taxa de avaliação', (m) => percentual(Number(m.atendimentos) ? Number(m.avaliacoes) / Number(m.atendimentos) : null))}
                  {linhaTabela('C-SAT', (m) => percentual(razao(m.avaliacoes, m.positivas)))}
                  {linhaTabela('Pontos da equipe', (m) => inteiro(Number(m.pontos)))}
                  {linhaTabela('Média por pessoa', (m) => (Number(m.pessoas) ? inteiro(Number(m.pontos) / Number(m.pessoas)) : '—'))}
                  {linhaTabela('Bateram a meta', (m) => `${m.bateram} de ${m.pessoas}`)}
                </tbody>
              </table>
              <div>
                <p className="mb-1 text-xs text-slate-500">C-SAT mês a mês{canaisMes.length > 1 ? ', por canal' : ''}</p>
                <GraficoBarrasELinha largura={720} rotulos={meses.map((m) => nomeDoMes(m.mes))} formatar={percentual}
                                     min={piso(linhasMes.flatMap((l) => l.valores))} max={1} referencia={{ valor: metaCsat, rotulo: `meta ${textoDaMeta(metaCsat)}` }} linhas={linhasMes} />
              </div>
            </div>
          </Secao>
        </Painel>
      )}

      <Painel>
        <Secao titulo="Pontuação por colaborador" subtitulo={`Clique no nome para ver o extrato completo. Para recusar, informe o motivo: ele vai para o gestor do setor.${anteriores.length ? ' Em cinza, os pontos dos meses anteriores.' : ''}`}>
          {daLista.length === 0 && modo === 'aguardando' ? (
            <Vazio>Todas as cotas deste setor já foram aprovadas: estão em Aprovadas.</Vazio>
          ) : (
            <AprovacaoDasCotas pessoas={daLista} mes={mesCurto} podeDecidir={podeDecidir} caminho={base}
                               mesesAnteriores={anteriores} rotuloDoMes={nomeDoMes(mes).toLowerCase()} />
          )}
        </Secao>
      </Painel>
    </section>
  );
}

// ------------------------------------------------ O extrato de uma pessoa
async function ExtratoDaPessoa({ f, diretoria, base }: { f: string; diretoria: boolean; base: string }) {
  const db = await criarClienteServidor();
  const { data } = await db.rpc('extrato_para_diretoria', { p_fechamento: f });
  const e = data as Extrato | null;
  if (!e) redirect(base);
  const semanas = [...new Set(e.linhas.map((l) => l.semana))].sort((a, b) => (a ?? 99) - (b ?? 99));
  const [{ data: painel }, { data: inicioDb }] = await Promise.all([
    db.rpc('painel_da_diretoria', { p_mes: e.mes }), db.rpc('inicio_da_aprovacao'),
  ]);
  // Mês antes do início da aprovação (aberto pelos 3 meses): só o extrato, sem decidir.
  const comAprovacao = typeof inicioDb === 'string' && e.mes >= inicioDb;
  const setor = ((painel ?? []) as SetorDoPainel[]).find((s) => s.pessoas.some((p) => p.fechamento_id === e.fechamento_id));
  const pessoa = setor?.pessoas.find((p) => p.fechamento_id === e.fechamento_id);
  const meses = (e.meses ?? []).filter((m) => m.pontos != null || m.mes === e.mes);
  const doMes = meses.find((m) => m.mes === e.mes);

  return (
    <div className="space-y-6">
      <div>
        <Link href={`${base}?mes=${e.mes.slice(0, 7)}${setor ? `&setor=${setor.id}` : ''}`} className="text-sm text-marca-700 hover:underline dark:text-marca-400">
          ← Voltar para {mesRotulo(e.mes)}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{e.nome}</h1>
        <p className="text-sm text-slate-500">
          {[e.cargo, e.setor, mesRotulo(e.mes)].filter(Boolean).join(' · ')} · fechado em {dataHora(e.fechado_em)}
        </p>
      </div>

      <div className="grid divide-y divide-slate-200 rounded-[20px] border border-slate-200 bg-superficie shadow-sm sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
        <div className="px-5 py-4"><p className="text-sm text-slate-500">Pontos no mês</p><p className="mt-1 text-[1.5rem] font-semibold tabular-nums text-slate-900">{inteiro(e.pontos)} <span className="text-sm font-normal text-slate-500">pts</span></p></div>
        <div className="px-5 py-4"><p className="text-sm text-slate-500">Atendimentos</p><p className="mt-1 text-[1.5rem] font-semibold tabular-nums text-slate-900">{doMes ? inteiro(Number(doMes.atendimentos)) : '—'}</p></div>
        <div className="px-5 py-4"><p className="text-sm text-slate-500">C-SAT</p><p className="mt-1 text-[1.5rem] font-semibold tabular-nums text-slate-900">{doMes ? percentual(razao(doMes.avaliacoes, doMes.positivas)) : '—'}</p><p className="text-xs text-slate-500">{doMes ? `${inteiro(Number(doMes.avaliacoes))} avaliações` : ''}</p></div>
        <div className="px-5 py-4"><p className="text-sm text-slate-500">Situação</p><p className="mt-2">{pessoa?.situacao_meta ? <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${SITUACAO[pessoa.situacao_meta][1]}`}>{SITUACAO[pessoa.situacao_meta][0]}</span> : '—'}</p></div>
      </div>

      {meses.length > 1 && (
        <Painel>
          <Secao titulo="Últimos 3 meses" subtitulo={`${e.nome.split(' ')[0]} mês a mês; o mês em destaque. Clique num mês para abrir o extrato dele.`}>
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500">
                  <th className="py-1.5 pr-3 text-left font-medium">Mês</th>
                  <th className="px-3 py-1.5 text-right font-medium">Pontos</th>
                  <th className="px-3 py-1.5 text-right font-medium">Atendimentos</th>
                  <th className="px-3 py-1.5 text-right font-medium">C-SAT</th>
                  <th className="px-3 py-1.5 text-right font-medium">Avaliações</th>
                  <th className="py-1.5 pl-3 text-center font-medium">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {meses.map((m) => (
                  <tr key={m.mes} className={m.mes === e.mes ? 'bg-marca-50/60 dark:bg-marca-500/10' : ''}>
                    <td className={`py-1.5 pr-3 ${m.mes === e.mes ? 'font-semibold' : ''}`}>
                      {m.mes !== e.mes && m.fechamento_id
                        ? <Link href={`${base}?mes=${e.mes.slice(0, 7)}&f=${m.fechamento_id}`} className="font-medium text-marca-700 hover:underline dark:text-marca-400">{nomeDoMes(m.mes)} ›</Link>
                        : nomeDoMes(m.mes)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-semibold text-slate-900">{m.pontos == null ? '—' : inteiro(Number(m.pontos))}</td>
                    <td className="px-3 py-1.5 text-right">{inteiro(Number(m.atendimentos))}</td>
                    <td className="px-3 py-1.5 text-right">{percentual(razao(m.avaliacoes, m.positivas))}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500">{inteiro(Number(m.avaliacoes))}</td>
                    <td className="py-1.5 pl-3 text-center">{m.situacao_meta ? <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${SITUACAO[m.situacao_meta][1]}`}>{SITUACAO[m.situacao_meta][0]}</span> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Secao>
        </Painel>
      )}

      {pessoa && comAprovacao && (
        <Painel>
          <Secao titulo="Aprovação">
            <AprovacaoDasCotas pessoas={[pessoa]} mes={e.mes.slice(0, 7)} podeDecidir={diretoria} caminho={base} />
          </Secao>
          {(e.conversa ?? []).length > 0 && (
            <Secao titulo="Recusa e resposta" subtitulo="O que foi conversado sobre este fechamento, do mais antigo.">
              <ul className="space-y-1.5 text-sm">
                {(e.conversa ?? []).map((c, i) => (
                  <li key={i} className="text-slate-600">
                    {dataHora(c.em)} · <b className={c.situacao === 'recusado' ? 'text-rose-700 dark:text-rose-300' : 'text-sky-700 dark:text-sky-300'}>
                      {c.situacao === 'recusado' ? `Recusada${c.por ? ` por ${c.por}` : ''}` : `Respondida${c.por ? ` por ${c.por}` : ''}`}</b>
                    {c.texto ? ` — ${c.texto}` : ''}
                  </li>
                ))}
              </ul>
            </Secao>
          )}
        </Painel>
      )}

      <Painel>
        <Secao titulo="Extrato do fechamento" subtitulo="Como foi fechado pelo gestor: cada item com a quantidade, o peso e os pontos.">
          <div className="space-y-6">
            {semanas.map((w) => {
              const linhas = e.linhas.filter((l) => l.semana === w);
              const total = linhas.reduce((t, l) => t + Number(l.pontos), 0);
              return (
                <div key={w ?? 'mes'}>
                  <div className="mb-1 flex items-baseline justify-between">
                    <h3 className="text-sm font-semibold text-slate-800">{w == null ? 'No mês' : `${w}ª semana`}</h3>
                    <span className="text-sm font-semibold tabular-nums text-slate-900">{pts(total)} pts</span>
                  </div>
                  <table className="w-full text-sm tabular-nums">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs text-slate-500">
                        <th className="py-1.5 pr-3 text-left font-medium">Item</th>
                        <th className="w-28 px-3 py-1.5 text-right font-medium">Quantidade</th>
                        <th className="w-24 px-3 py-1.5 text-right font-medium">Peso</th>
                        <th className="w-28 py-1.5 pl-3 text-right font-medium">Pontos</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {linhas.map((l, i) => (
                        <tr key={i}>
                          <td className="py-1.5 pr-3 text-slate-700">{l.rotulo}</td>
                          <td className="px-3 py-1.5 text-right text-slate-600">{pts(l.quantidade)}</td>
                          <td className="px-3 py-1.5 text-right text-slate-600">{pts(l.peso)}</td>
                          <td className={`py-1.5 pl-3 text-right font-medium ${Number(l.pontos) < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-slate-900'}`}>{pts(l.pontos)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
            {!e.linhas.length && <Vazio>Sem itens no extrato deste fechamento.</Vazio>}
          </div>
        </Secao>
        {e.historico.length > 0 && (
          <Secao titulo="Decisões anteriores" subtitulo="Sobre versões deste fechamento que o gestor refez.">
            <ul className="space-y-1 text-sm">
              {e.historico.map((h, i) => (
                <li key={i} className="text-slate-600">
                  {dataHora(h.em)} · <b className={h.situacao === 'recusado' ? 'text-rose-700 dark:text-rose-300' : 'text-marca-700 dark:text-marca-300'}>{h.situacao === 'recusado' ? 'Recusado' : h.situacao === 'respondido' ? 'Respondido pelo gestor' : 'Aprovado'}</b>
                  {' '}com {inteiro(Number(h.pontos))} pts{h.motivo ? ` — ${h.motivo}` : ''}
                </li>
              ))}
            </ul>
          </Secao>
        )}
      </Painel>
    </div>
  );
}
