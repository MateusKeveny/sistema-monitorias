'use client';

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Link from '@/componentes/Link';
import { NoCanal, type Canal } from '@/componentes/Canal';
import GraficoDeLinha, { type PontoDaLinha } from '@/componentes/GraficoDeLinha';
import SeletorDeDetalhe, { type Destaque } from '@/componentes/SeletorDeDetalhe';
import { BarraDeMeta, Painel, Secao, Vazio } from '@/componentes/ui';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { lerPrazoDoSla } from '@/lib/sla';
import { corDoCsat, hojeNoBrasil, mesRotulo, percentual, semanaDoCiclo, numeroBR } from '@/lib/formatar';
import type { FonteDoMes } from '@/lib/fonteDoMes';
import ProjecaoDaCota from '@/componentes/ProjecaoDaCota';
import { limiteDeRenovacao, pessoasComLeituraPendente, type LeituraDiario } from '@/lib/diario';
import { todas } from '@/lib/consultas';
import { conferirNumerosDoMes, pendentesDaConferencia } from '@/lib/conferenciaDoMes';
import { MONITORIAS_PADRAO, monitoriasPorSetor, setorDasPessoas, textoDoPiso } from '@/lib/monitoriasDoSetor';
import { faixasDeCsat, filasDoSetor, metaDoCsat, setorDoPerformance, textoDaMeta } from '@/lib/filasDoSetor';

/** O mês anterior de '2026-09-01' → '2026-08-01' (o de lib/competencia, que é só do servidor). */
function mesAnterior(c: string): string {
  const [a, m] = c.split('-').map(Number);
  return m === 1 ? `${a - 1}-12-01` : `${a}-${String(m - 1).padStart(2, '0')}-01`;
}


type Csat = { pessoa_id: string; origem: Canal; semana: number; avaliacoes: number; positivas: number; mes_competencia: string };
type Volume = { pessoa_id: string; canal: Canal; semana: number; finalizados: number; tme_seg: number | null; mes_competencia: string };
type Criterio = { criterio: string; avaliacoes: number; reprovacoes: number; taxa_reprovacao: number };
type Cota = {
  pessoa_id: string; pessoa: string; cargo: string | null; resultado: number; meta: number | null;
  compoe_media: boolean | null;
};
type Fechado = { pessoa_id: string; mes_competencia: string; resultado: number; meta: number | null; cargo: string | null };
type Monitoria = { operador_id: string; nota_final: number; mes_referencia: string };

const inteiro = (v: number) => numeroBR(v, 0);
const nomeCurto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');
const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0];
const media = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);
const pct = (v: number, max: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;

/** Segundos → "12:34" ou "1h02". */
function tempo(seg: number) {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = Math.round(seg % 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** '2026-08-01' → 'agosto'. */
const nomeDoMes = (c: string) =>
  new Date(`${c}T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', timeZone: 'UTC' });
const maiusculo = (t: string) => t.replace(/^./, (l) => l.toUpperCase());

/** Escala única do painel para a nota de monitoria: verde a partir do piso do setor (a Expansão: 85%). */
const tomDaNotaCom = (v: number, piso: number): 'bom' | 'atencao' | 'ruim' => (v >= piso ? 'bom' : v >= 0.70 ? 'atencao' : 'ruim');
const tomDoCsat = (v: number): 'bom' | 'atencao' | 'ruim' => (v >= 0.90 ? 'bom' : v >= 0.85 ? 'atencao' : 'ruim');

/** Tons das 4 semanas no volume por atendente, do mais claro ao mais escuro. */
const TONS_SEMANA = ['bg-emerald-300', 'bg-emerald-500', 'bg-emerald-700', 'bg-emerald-900'];

/**
 * Tela inicial do gestor (1.15.0): um painel de acompanhamento.
 *
 * Responde três perguntas, nesta ordem:
 *   - o que precisa de mim agora? — as pendências do mês, cada uma levando à
 *     tela onde se resolve;
 *   - está melhor ou pior? — cada destaque compara com o mês anterior;
 *   - para onde está indo? — com o ciclo correndo, a projeção da pontuação.
 *
 * Os destaques (Na meta, C-SAT, Volume, TME, Monitoria) são as abas: cada um
 * abre o próprio detalhe logo abaixo da faixa. C-SAT, volume e TME respeitam o
 * canal das abas do topo (ProvedorDeCanal, na página).
 *
 * Tudo é SVG ou barra de CSS montado no servidor — nada de biblioteca de
 * gráfico no navegador.
 */
type Props = {
  competencia: string;
  atual: string;
  /** A faixa "Precisa de você" leva a telas só do gestor; o Pleno vê o painel sem ela. */
  comPendencias?: boolean;
  /** De onde ler o cálculo do mês (resumo ou ao vivo), decidido pela página. */
  fonte: FonteDoMes;
  /** O setor escolhido no menu (cookie), lido pela página no servidor. */
  setorPedido?: string;
  /**
   * Abertura do Início (4.4.0, no jeito da criação de setores): com ela, o
   * painel desenha a faixa de cima — saudação, a frase da meta em verde e o
   * "Precisa de você" como passos — no lugar da faixa da página. `cabecalho`
   * é o mês com as setas e o selo; `abas`, os canais.
   */
  abertura?: { saudacao: string; cabecalho: React.ReactNode; abas?: React.ReactNode };
};

/**
 * Os dados vêm direto do banco, pelo navegador (4.1.0, erro 1102): montar este
 * painel no servidor da Cloudflare era a tela mais pesada do plano gratuito.
 * As mesmas consultas, com a mesma regra de acesso (RLS) — o navegador entra
 * com a sessão de quem está logado, como o servidor entrava.
 */
async function carregar(db: SupabaseClient, { competencia, atual, comPendencias = true, fonte, setorPedido }: Props) {
  const anterior = mesAnterior(competencia);
  const meses = [competencia, anterior];
  // O piso da monitoria: o do setor da equipe (Monitorias 6.0).
  // 4.3.0: o prazo do SLA vem das faixas (migração 104).
  // 4.4.0: o setor do menu sem depender de ter monitoria (o Telecom não tem),
  // as filas dele e quem está nele no mês — a tela mostra só esse setor.
  const [porSetorMon, { setorId: setorDaEquipe }, prazoSla, setorDe] = await Promise.all([
    monitoriasPorSetor(db), setorDoPerformance(db, setorPedido), lerPrazoDoSla(db), setorDasPessoas(db, competencia)]);
  const piso = porSetorMon.get(setorDaEquipe)?.piso ?? MONITORIAS_PADRAO.piso;
  const filas = await filasDoSetor(db, setorDaEquipe);
  const faixas = await faixasDeCsat(db, filas.map((f) => f.grupoCsat));
  const metaCsat = Object.fromEntries(filas.map((f) => [f.apelido, metaDoCsat(faixas[f.grupoCsat ?? ''])])) as Record<string, number>;
  const doSetor = (id: string) => (setorDe.get(id) ?? 1) === setorDaEquipe;

  const [pessoas, csat, volume, criterios, cota, cargos, fechados, monitorias, valores, semCargo, conferir, diario, vencendo, leituras, privados, reportes, atrasos,
    { data: semanasDeChamados }, { data: mesesComRh }, { data: conferencia }, { data: recusas }]
    = await todas([
    db.from('pessoas').select('id, nome, exibir_no_painel, conta_nas_medias'),
    db.from('vw_csat_semanal').select('pessoa_id, origem, semana, avaliacoes, positivas, mes_competencia')
      .in('mes_competencia', meses),
    db.from('volume_semanal').select('pessoa_id, canal, semana, finalizados, tme_seg, mes_competencia')
      .in('mes_competencia', meses),
    db.from('vw_criterios_reprovados').select('criterio, avaliacoes, reprovacoes, taxa_reprovacao')
      .eq('mes_referencia', competencia).gt('reprovacoes', 0)
      .order('reprovacoes', { ascending: false }).limit(8),
    db.from(fonte.mensal).select('pessoa_id, pessoa, cargo, resultado, meta, compoe_media')
      .eq('mes_competencia', competencia).order('resultado', { ascending: false }),
    db.from('cargos').select('nome, recebe_bonus'),
    db.from('fechamentos_cota').select('pessoa_id, mes_competencia, resultado, meta, cargo')
      .in('mes_competencia', meses),
    db.from('vw_monitorias').select('operador_id, nota_final, mes_referencia').in('mes_referencia', meses),
    db.from('valores_da_cota').select('mes_competencia').in('mes_competencia', meses),
    db.from(fonte.semCargo).select('nome').eq('mes_competencia', competencia),
    db.from('vw_lancamentos_a_conferir').select('bloco').eq('mes_competencia', competencia),
    db.from('diario_registros').select('id', { count: 'exact', head: true }).eq('situacao', 'aguardando'),
    // Validade nos próximos 7 dias: dá para renovar (migração 37).
    db.from('diario_registros').select('id', { count: 'exact', head: true })
      .gte('valido_ate', hojeNoBrasil()).lte('valido_ate', limiteDeRenovacao(hojeNoBrasil())),
    // Leitura obrigatória do diário (migração 38).
    db.rpc('leituras_do_diario'),
    // Registros dos atendentes com a gestão, aguardando (migração 43).
    db.from('diario_privados').select('id', { count: 'exact', head: true }).eq('situacao', 'aguardando'),
    // Problemas reportados ainda não vistos (migração 44).
    db.from('reportes').select('id', { count: 'exact', head: true }).eq('situacao', 'novo'),
    // Chamados fora do prazo esperando decisão da gestão (migração 53).
    db.from('chamados_elo').select('protocolo', { count: 'exact', head: true })
      .gte('tempo_util', prazoSla).not('concluido_em', 'is', null).neq('status', 'Cancelado')
      .not('pessoa_id', 'is', null).is('decisao', null),
    // Estas quatro saíam uma atrás da outra no servidor; aqui vão juntas.
    // Sem a migração de cada uma, o erro é ignorado e a pendência não aparece
    // (como antes): por isso não passam pela conferência do todas().
    (comPendencias ? db.rpc('chamados_por_semana', { p_mes: competencia }) : Promise.resolve({ data: null }))
      .then((r) => ({ data: r.data })),
    db.from('valores_rh').select('mes_competencia').in('mes_competencia', meses).then((r) => ({ data: r.data })),
    db.from('conferencias_calculo').select('falhas').order('rodada_em', { ascending: false }).limit(1).maybeSingle()
      .then((r) => ({ data: r.data })),
    db.from('vw_aprovacao_atual').select('mes_competencia').eq('situacao', 'recusado').then((r) => ({ data: r.data })),
  ]);

  // Conferência dos números (3.5.0): a mesma do Fechamento, enquanto o mês não fecha.
  const semanasEsperadas = competencia < atual ? 4 : Math.max(0, semanaDoCiclo(hojeNoBrasil()) - 1);
  const fechado = ((fechados.data ?? []) as Fechado[]).some((f) => f.mes_competencia === competencia);
  const alertas = fechado ? [] : pendentesDaConferencia(await conferirNumerosDoMes(db, {
    competencia, semanasEncerradas: semanasEsperadas,
    pessoas: ((cota.data ?? []) as Cota[]).map((c) => ({ pessoa_id: c.pessoa_id, pessoa: c.pessoa })),
    volumes: ((volume.data ?? []) as Volume[]).filter((v) => v.mes_competencia === competencia),
    csats: ((csat.data ?? []) as Csat[]).filter((c) => c.mes_competencia === competencia),
  }));

  // Só o setor da tela (4.4.0): antes vinham as pessoas de todos os setores que o gestor enxerga.
  const soDoSetor = <T extends { data: unknown }>(r: T, campo: string): T =>
    ({ ...r, data: ((r.data ?? []) as Record<string, unknown>[]).filter((x) => doSetor(String(x[campo]))) });
  return { piso, filas, metaCsat,
    pessoas: soDoSetor(pessoas, 'id'), csat: soDoSetor(csat, 'pessoa_id'), volume: soDoSetor(volume, 'pessoa_id'),
    criterios, cota: soDoSetor(cota, 'pessoa_id'), cargos, fechados: soDoSetor(fechados, 'pessoa_id'),
    monitorias: soDoSetor(monitorias, 'operador_id'), valores, semCargo, conferir, diario,
    vencendo, leituras, privados, reportes, atrasos, semanasDeChamados, mesesComRh, conferencia, recusas, alertas };
}

type Dados = Awaited<ReturnType<typeof carregar>>;

export default function PainelGestor(props: Props) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const { competencia, atual, comPendencias = true, fonte, setorPedido } = props;

  useEffect(() => {
    let vivo = true;
    const db = criarClienteNavegador();
    const ler = () => carregar(db, { competencia, atual, comPendencias, fonte, setorPedido })
      .then((d) => { if (vivo) { setDados(d); setErro(null); } })
      .catch((e: Error) => { if (vivo) setErro(e.message); });
    ler();
    // A atualização automática (4.0.0) avisa quando algo mudou no banco.
    window.addEventListener('dados-mudaram', ler);
    return () => { vivo = false; window.removeEventListener('dados-mudaram', ler); };
  }, [competencia, atual, comPendencias, fonte.mensal, fonte.semCargo, fonte.extrato, setorPedido]); // eslint-disable-line react-hooks/exhaustive-deps

  if (erro && !dados) {
    return (
      <Painel>
        <p className="text-sm text-rose-700">Não foi possível carregar o painel: {erro}</p>
        <button type="button" onClick={() => location.reload()}
                className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:border-marca-600">
          Tentar de novo
        </button>
      </Painel>
    );
  }
  if (!dados) return <Carregando abertura={props.abertura} />;
  return <Visao {...props} dados={dados} />;
}

/**
 * A faixa de abertura do Início (4.4.0): à esquerda o mês, a saudação e a
 * frase em verde; à direita os passos do que precisa do gestor, numerados como
 * os passos da criação de setores. Sem passos, um visto de "tudo em dia".
 */
function Abertura({ saudacao, cabecalho, frase, detalhe, passos }: {
  saudacao: string;
  cabecalho: React.ReactNode;
  frase?: string | null;
  detalhe?: string | null;
  /** null = carregando. */
  passos: { texto: string; acao: string; href: string; grave?: boolean }[] | null;
}) {
  const MAX = 5;
  return (
    <section className="abertura sobe relative grid gap-8 overflow-hidden rounded-[26px] bg-superficie px-7 py-8 shadow-sm ring-1 ring-slate-200
                        sm:px-9 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-center">
      <div>
        <div className="text-sm">{cabecalho}</div>
        <h1 className="mt-3 text-[2.15rem] font-semibold leading-[1.08] tracking-[-.035em] text-slate-900 sm:text-[2.5rem]">
          {saudacao}.
          {frase !== undefined && (
            <>
              <br />
              {frase == null
                ? <span className="inline-block h-[0.9em] w-72 max-w-full animate-pulse rounded-lg bg-slate-200/70 align-middle" />
                : <span className="text-marca-700 dark:text-marca-400">{frase}</span>}
            </>
          )}
        </h1>
        {detalhe && <p className="mt-3 max-w-xl text-base text-slate-600">{detalhe}</p>}
      </div>

      <div className="rounded-2xl bg-slate-50 p-5 ring-1 ring-slate-200/70">
        <p className="text-xs font-bold uppercase tracking-[.08em] text-marca-700 dark:text-marca-400">Precisa de você</p>
        {passos == null ? (
          <div className="mt-3 space-y-2.5">
            {[0, 1, 2].map((i) => <div key={i} className="h-6 animate-pulse rounded-lg bg-slate-200/70" />)}
          </div>
        ) : passos.length === 0 ? (
          <p className="mt-3 flex items-center gap-2.5 text-sm text-slate-700">
            <span className="estala grid h-7 w-7 place-items-center rounded-lg bg-marca-600 text-white" aria-hidden>
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" pathLength={1} strokeDasharray={1} strokeDashoffset={1} className="traco" />
              </svg>
            </span>
            Tudo em dia neste mês.
          </p>
        ) : (
          <ol className="mt-3 space-y-1.5">
            {passos.slice(0, MAX).map((p, i) => (
              <li key={p.texto} className="sobe" style={{ animationDelay: `${120 + i * 60}ms` }}>
                <Link href={p.href}
                      className="group flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm text-slate-700 transition hover:bg-superficie hover:shadow-sm">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg text-xs font-bold ${p.grave
                    ? 'bg-rose-500/15 text-rose-700' : 'bg-marca-600/15 text-marca-700 dark:text-marca-400'}`}>{i + 1}</span>
                  <span className="min-w-0 flex-1">{p.texto}</span>
                  <span className="shrink-0 text-xs font-semibold text-marca-700 opacity-70 transition group-hover:opacity-100 dark:text-marca-400">
                    {p.acao} ›
                  </span>
                </Link>
              </li>
            ))}
            {passos.length > MAX && (
              <li className="px-2 pt-1 text-xs text-slate-500">e mais {passos.length - MAX}</li>
            )}
          </ol>
        )}
      </div>
    </section>
  );
}

/** Enquanto os dados chegam: o contorno da faixa de destaques. */
function Carregando({ abertura }: { abertura?: Props['abertura'] }) {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Carregando o painel">
      {abertura && <Abertura saudacao={abertura.saudacao} cabecalho={abertura.cabecalho} frase={null} passos={null} />}
      <div className="h-8 w-72 animate-pulse rounded-xl bg-slate-200/60" />
      <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-36 animate-pulse rounded-2xl bg-slate-200/60" />)}
      </div>
      <div className="h-72 animate-pulse rounded-2xl bg-slate-200/60" />
    </div>
  );
}

function Visao({ competencia, atual, comPendencias = true, fonte, dados, abertura }: Props & { dados: Dados }) {
  const anterior = mesAnterior(competencia);
  const meses = [competencia, anterior];
  const { piso, filas, metaCsat, pessoas, csat, volume, criterios, cota, cargos, fechados, monitorias, valores, semCargo, conferir, diario,
    vencendo, leituras, privados, reportes, atrasos, semanasDeChamados, mesesComRh, conferencia, recusas } = dados;
  const tomDaNota = (v: number) => tomDaNotaCom(v, piso);

  const nome = new Map((pessoas.data ?? []).map((p) => [p.id as string, nomeCurto(p.nome as string)]));

  // Duas decisões separadas, configuradas em Configuração → Exibição e
  // contagem: aparecer nas listas e entrar nas médias. Nenhuma delas muda
  // pontuação, extrato ou pagamento — só o que esta tela mostra e soma.
  const exibe = new Set((pessoas.data ?? [])
    .filter((p) => p.exibir_no_painel !== false).map((p) => p.id as string));
  const conta = new Set((pessoas.data ?? [])
    .filter((p) => p.conta_nas_medias !== false).map((p) => p.id as string));

  const todoCsat = (csat.data ?? []) as Csat[];
  const todoVolume = (volume.data ?? []) as Volume[];
  const todosFechados = (fechados.data ?? []) as Fechado[];
  const todasMonitorias = ((monitorias.data ?? []) as Monitoria[]).filter((m) => m.nota_final != null);
  const fechadoEm = (m: string) => todosFechados.some((f) => f.mes_competencia === m);
  const temValor = (m: string) => (valores.data ?? []).some((v) => v.mes_competencia === m);
  const vs = `vs ${nomeDoMes(anterior)}`;

  // ---------- Cota e bônus ----------
  const lista = (criterios.data ?? []) as Criterio[];
  const todasAsCotas = (cota.data ?? []) as Cota[];
  const cotas = todasAsCotas.filter((c) => exibe.has(c.pessoa_id));
  const escalaCota = Math.max(1.25, ...cotas.map((c) => (c.meta ? Number(c.resultado) / Number(c.meta) : 0)));

  // Bônus de equipe: mesma regra do pagamento (bonus_da_competencia) — cargo
  // com direito e mês inteiro na operação. Conta todo mundo, não só quem
  // aparece na lista: esconder alguém da tela não muda o bônus.
  const comBonus = new Set((cargos.data ?? []).filter((c) => c.recebe_bonus).map((c) => c.nome as string));
  const comDireito = todasAsCotas.filter((c) =>
    c.cargo != null && comBonus.has(c.cargo) && c.compoe_media !== false && c.meta);
  const abaixo = comDireito.filter((c) => Number(c.resultado) < Number(c.meta));
  const naMeta = comDireito.length - abaixo.length;

  // No mês anterior, pelo que foi fechado (entregue), quando houver.
  const fechadosAntes = todosFechados.filter((f) => f.mes_competencia === anterior
    && f.cargo != null && comBonus.has(f.cargo) && f.meta);
  const naMetaAntes = fechadosAntes.length
    ? fechadosAntes.filter((f) => Number(f.resultado) >= Number(f.meta)).length : null;

  // ---------- Projeção ----------
  // Só com o ciclo correndo. O ritmo vem das semanas com volume lançado, e não
  // do calendário: volume e avaliações chegam por importação semanal, e contar
  // pelo dia de hoje projetaria para baixo no começo de cada semana.
  const semanasLancadas = new Set(todoVolume.filter((v) => v.mes_competencia === competencia).map((v) => v.semana)).size;
  const projetar = competencia === atual && semanasLancadas > 0 && semanasLancadas < 4;
  const projecao = (resultado: number) => (resultado * 4) / semanasLancadas;

  // ---------- Pendências ----------
  // O que precisa do gestor, cada uma com o caminho de onde se resolve.
  const mes = competencia.slice(0, 7);
  const pendencias: { texto: string; acao: string; href: string; grave?: boolean }[] = [];
  const semanasEsperadas = competencia < atual ? 4 : Math.max(0, semanaDoCiclo(hojeNoBrasil()) - 1);
  const semVolume = [1, 2, 3, 4].slice(0, semanasEsperadas).filter((s) =>
    !todoVolume.some((v) => v.mes_competencia === competencia && v.canal === 'huggy' && v.semana === s));
  if (semVolume.length) {
    pendencias.push({
      texto: semVolume.length === 1 ? `Semana ${semVolume[0]} sem volume lançado`
        : `Semanas ${semVolume.join(', ').replace(/, (\d)$/, ' e $1')} sem volume lançado`,
      acao: 'Importar', href: '/cota/importar',
    });
  }
  // Semanas sem chamados importados (migração 60). Sem a migração, a função
  // não existe, e a tela segue sem esta pendência.
  const semChamados = ((semanasDeChamados ?? []) as { semana: number; quantidade: number; encerrada: boolean; marcada: boolean }[])
    .filter((s) => s.encerrada && s.quantidade === 0 && !s.marcada).map((s) => s.semana);
  if (semChamados.length) {
    pendencias.push({
      texto: semChamados.length === 1 ? `Semana ${semChamados[0]} sem chamados importados`
        : `Semanas ${semChamados.join(', ').replace(/, (\d)$/, ' e $1')} sem chamados importados`,
      acao: 'Importar', href: '/cota/importar?cat=chamados',
    });
  }
  if (competencia < atual && !fechadoEm(competencia)) {
    pendencias.push({
      texto: `${nomeDoMes(competencia).replace(/^./, (l) => l.toUpperCase())} aguardando fechamento`,
      acao: 'Fechar', href: `/cota/fechamento?mes=${mes}`,
    });
  }
  // Com o valor do RH informado (migração 73), o valor por ponto é só para
  // conferir: não vira pendência (2.3.1).
  const temRh = (m: string) => (mesesComRh ?? []).some((v) => v.mes_competencia === m);
  for (const m of meses) {
    if (fechadoEm(m) && !temValor(m) && !temRh(m)) {
      pendencias.push({
        texto: `Valor por ponto de ${nomeDoMes(m)} não informado`, grave: true,
        acao: 'Informar', href: `/cota/fechamento?mes=${m.slice(0, 7)}`,
      });
    }
  }
  // Conferência do cálculo (migração 72): divergência na última rodada. Sem a
  // migração, a tabela não existe e a tela segue.
  if (conferencia?.falhas) {
    pendencias.push({
      texto: `Conferência do cálculo: ${conferencia.falhas} divergência${conferencia.falhas > 1 ? 's' : ''}`,
      acao: 'Ver', href: '/cota/conferencia', grave: true,
    });
  }
  // Cota recusada pela diretoria (4.0.0, migração 98), em qualquer mês: fica
  // aqui até o gestor reabrir e fechar de novo. Sem a migração, a view não
  // existe e não há pendência.
  for (const m of [...new Set((recusas ?? []).map((r) => r.mes_competencia as string))].sort()) {
    const n = (recusas ?? []).filter((r) => r.mes_competencia === m).length;
    pendencias.push({
      texto: `A CEO recusou ${n} cota${n > 1 ? 's' : ''} de ${mesRotulo(m)}`,
      acao: 'Ver o motivo', href: `/cota/fechamento?mes=${m.slice(0, 7)}`, grave: true,
    });
  }
  // Conferência dos números (3.5.0): a mesma do Fechamento, todo dia, enquanto
  // o mês não fecha — o volume de 3 no lugar de 197 (out/2026) só apareceu no
  // fim do mês.
  if (!fechadoEm(competencia)) {
    const { alertas } = dados;
    const graves = alertas.filter((a) => a.grave).length;
    if (alertas.length) {
      pendencias.push({
        texto: `Conferência dos números: ${alertas.length} fora do padrão`
          + (graves ? ` (${graves} com cara de erro de importação)` : ''),
        acao: 'Conferir', href: `/cota/fechamento?mes=${mes}`, grave: graves > 0,
      });
    }
  }
  if ((semCargo.data ?? []).length) {
    const n = (semCargo.data ?? []).length;
    pendencias.push({ texto: `${n} pessoa${n > 1 ? 's' : ''} sem cargo no mês`, acao: 'Definir', href: '/cota/usuarios', grave: true });
  }
  if (diario.count) {
    pendencias.push({
      texto: `${diario.count} registro${diario.count > 1 ? 's' : ''} do diário aguardando aprovação`,
      acao: 'Revisar', href: '/cota/diario?filtro=aguardando',
    });
  }
  if (reportes.count) {
    pendencias.push({
      texto: `${reportes.count} problema${reportes.count > 1 ? 's' : ''} reportado${reportes.count > 1 ? 's' : ''} sem resposta`,
      acao: 'Ver', href: '/reportes', grave: true,
    });
  }
  if (privados.count) {
    pendencias.push({
      texto: `${privados.count} registro${privados.count > 1 ? 's' : ''} de atendente${privados.count > 1 ? 's' : ''} aguardando aprovação`,
      acao: 'Revisar', href: '/cota/diario?cat=gestao',
    });
  }
  const semLer = pessoasComLeituraPendente((leituras.data ?? []) as LeituraDiario[]);
  if (semLer) {
    pendencias.push({
      texto: `${semLer} pessoa${semLer > 1 ? 's' : ''} com leitura pendente no diário`,
      acao: 'Ver', href: '/cota/diario?filtro=leitura',
    });
  }
  if (vencendo.count) {
    pendencias.push({
      texto: `${vencendo.count} registro${vencendo.count > 1 ? 's' : ''} do diário vence${vencendo.count > 1 ? 'm' : ''} em até 7 dias`,
      acao: 'Renovar', href: '/cota/diario?filtro=vencendo',
    });
  }
  if (atrasos.count) {
    pendencias.push({
      texto: `${atrasos.count} chamado${atrasos.count > 1 ? 's' : ''} fora do prazo esperando decisão`,
      acao: 'Decidir', href: '/cota/importar?cat=chamados',
    });
  }
  if ((conferir.data ?? []).length) {
    pendencias.push({ texto: 'Lançamento com faixas que não fecham com o total', acao: 'Conferir', href: `/cota/lancamentos?mes=${mes}` });
  }

  // ---------- Por canal ----------
  const canal = (c: Canal, m: string) => {
    const csatCanal = todoCsat.filter((x) => x.origem === c && x.mes_competencia === m);
    const csatSomado = csatCanal.filter((x) => conta.has(x.pessoa_id));
    const soma = (l: Csat[]) => l.reduce((a, x) => [a[0] + x.positivas, a[1] + x.avaliacoes], [0, 0]);
    const [pos, tot] = soma(csatSomado);
    const csatSemanas = [1, 2, 3, 4].map((s) => {
      const [p, t] = soma(csatSomado.filter((x) => x.semana === s));
      return t ? { valor: p / t, positivas: p, avaliacoes: t } : null;
    });

    const volTodos = todoVolume.filter((v) => v.canal === c && v.mes_competencia === m);
    const volCanal = volTodos.filter((v) => conta.has(v.pessoa_id));
    const volSemanas = [1, 2, 3, 4].map((s) =>
      volCanal.filter((v) => v.semana === s).reduce((a, v) => a + v.finalizados, 0) || null);
    const volTotal = volSemanas.reduce<number>((a, v) => a + (v ?? 0), 0);

    // TME da equipe como a regra usa: média simples dos TMEs lançados.
    const tmes = (l: Volume[]) => l.map((v) => v.tme_seg ?? 0).filter((t) => t > 0);
    const tmeEquipe = media(tmes(volCanal));
    const tmeSemanas = [1, 2, 3, 4].map((s) => media(tmes(volCanal.filter((v) => v.semana === s))));

    return { csatCanal, soma, csatMes: tot ? pos / tot : null, csatSemanas, volTodos, volSemanas, volTotal, tmeEquipe, tmeSemanas };
  };

  /** "▲ 7% vs agosto", verde quando melhora e rosa quando piora. */
  const Comparacao = ({ texto, melhor }: { texto: string | null; melhor: boolean }) => texto ? (
    <p className="mt-0.5 text-xs text-slate-500">
      <b className={`font-semibold ${melhor ? 'text-marca-700 dark:text-marca-400' : 'text-rose-700'}`}>{texto}</b> {texto === 'igual' ? `a ${nomeDoMes(anterior)}` : vs}
    </p>
  ) : null;
  const seta = (d: number) => (d >= 0 ? '▲' : '▼');

  /** Rótulo, valor grande e as quatro semanas em barras pequenas. */
  const Bloco = ({ rotulo, valor, nota, comparacao, barras, min = 0, max }: {
    rotulo: string; valor: string; nota?: string; comparacao?: React.ReactNode;
    barras?: ({ v: number; cor: string } | null)[]; min?: number; max?: number;
  }) => {
    const teto = max ?? Math.max(1, ...(barras ?? []).map((b) => b?.v ?? 0));
    const fracao = (v: number) => Math.max(0.04, Math.min(1, (v - min) / (teto - min)));
    return (
      <>
        <p className="text-sm text-slate-500">{rotulo}</p>
        <p className="text-[1.65rem] font-semibold leading-tight tracking-tight tabular-nums text-slate-900">
          {valor}{nota && <span className="ml-1.5 text-xs font-normal tracking-normal text-slate-500">{nota}</span>}
        </p>
        {comparacao}
        {barras && (() => {
          // A semana mais recente em cor cheia; as anteriores mais suaves (visual 3.0).
          const ultima = barras.reduce((u, b, i) => (b ? i : u), -1);
          return (
            <div className="mt-3">
              <div className="grid h-10 grid-cols-4 items-end gap-1.5">
                {barras.map((b, i) => (
                  <span key={i} className={`barra-semana crescer-y block origin-bottom rounded-[5px] ${b ? b.cor : 'bg-slate-100'} ${b && i !== ultima ? 'opacity-40' : ''}`}
                        style={{ height: `${(b ? fracao(b.v) : 0.06) * 100}%` }} />
                ))}
              </div>
              <div className="mt-1 grid grid-cols-4 gap-1.5 text-center text-[10px] text-slate-400">
                {barras.map((_, i) => <span key={i} className={i === ultima ? 'font-semibold text-slate-600' : ''}>{i + 1}ª sem</span>)}
              </div>
            </div>
          );
        })()}
      </>
    );
  };

  // As filas do setor da tela (4.4.0); a meta de C-SAT é a da faixa de cada uma.
  const CANAIS: Canal[] = filas.map((f) => f.apelido);
  const porCanal = Object.fromEntries(CANAIS.map((c) => {
    const metaDaFila = metaCsat[c] ?? 0.95;
    const agora = canal(c, competencia);
    const antes = canal(c, anterior);
    // Nomes da legenda dos gráficos semanais (1.41.0): o mês da tela e o anterior.
    const nomes = { rotuloAtual: maiusculo(nomeDoMes(competencia)), rotulo: maiusculo(nomeDoMes(anterior)) };

    const dCsat = agora.csatMes != null && antes.csatMes != null ? (agora.csatMes - antes.csatMes) * 100 : null;
    const dVol = agora.volTotal && antes.volTotal ? (agora.volTotal - antes.volTotal) / antes.volTotal : null;
    const dTme = agora.tmeEquipe != null && antes.tmeEquipe != null ? agora.tmeEquipe - antes.tmeEquipe : null;

    // ----- Detalhe do C-SAT -----
    const csatListado = agora.csatCanal.filter((x) => exibe.has(x.pessoa_id));
    const csatPorPessoa = [...new Set(csatListado.map((x) => x.pessoa_id))].map((id) => {
      const [p, t] = agora.soma(csatListado.filter((x) => x.pessoa_id === id));
      return { id, csat: p / t, avaliacoes: t };
    }).sort((a, b) => b.csat - a.csat);

    // ----- Detalhe do volume e do TME -----
    const volListado = agora.volTodos.filter((v) => exibe.has(v.pessoa_id));
    const volumePorPessoa = [...new Set(volListado.map((v) => v.pessoa_id))].map((id) => {
      const semanas = [1, 2, 3, 4].map((s) => agora.volTodos.find((v) => v.pessoa_id === id && v.semana === s)?.finalizados ?? 0);
      return { id, semanas, total: semanas.reduce((a, b) => a + b, 0) };
    }).sort((a, b) => b.total - a.total);
    const maiorVolume = Math.max(1, ...volumePorPessoa.map((v) => v.total));
    const mediaVolume = media(volumePorPessoa.map((v) => v.total)) ?? 0;

    const tmePorPessoa = [...new Set(volListado.map((v) => v.pessoa_id))].map((id) => {
      // Média das semanas ponderada pelos finalizados.
      const linhas = agora.volTodos.filter((v) => v.pessoa_id === id && (v.tme_seg ?? 0) > 0);
      const peso = linhas.reduce((a, v) => a + Math.max(1, v.finalizados), 0);
      const tme = peso ? linhas.reduce((a, v) => a + (v.tme_seg ?? 0) * Math.max(1, v.finalizados), 0) / peso : null;
      return { id, tme };
    }).filter((x): x is { id: string; tme: number } => x.tme != null).sort((a, b) => a.tme - b.tme);
    const maiorTme = Math.max(1, agora.tmeEquipe ?? 0, ...tmePorPessoa.map((t) => t.tme));
    const mediaVolSemanal = media(agora.volSemanas.filter((v): v is number => v != null));

    return [c, {
      blocoCsat: <Bloco rotulo="C-SAT" nota={`meta ${textoDaMeta(metaDaFila)}`} min={0.7} max={1}
                        valor={agora.csatMes != null ? percentual(agora.csatMes) : '—'}
                        comparacao={<Comparacao melhor={(dCsat ?? 0) >= 0}
                          texto={dCsat == null ? null : `${seta(dCsat)} ${numeroBR(Math.abs(dCsat), 1)} pt`} />}
                        barras={agora.csatSemanas.map((s) => s && {
                          v: s.valor, cor: { bom: 'bg-marca-600', atencao: 'bg-amber-500', ruim: 'bg-rose-500' }[tomDoCsat(s.valor)] })} />,
      blocoVol: <Bloco rotulo="Volume" nota="finalizados"
                       valor={agora.volTotal ? inteiro(agora.volTotal) : '—'}
                       comparacao={<Comparacao melhor={(dVol ?? 0) >= 0}
                         texto={dVol == null ? null : `${seta(dVol)} ${numeroBR(Math.abs(dVol * 100), 1)}%`} />}
                       barras={agora.volSemanas.map((v) => v == null ? null : { v, cor: 'bg-marca-600' })} />,
      // TME: subir é piorar.
      blocoTme: <Bloco rotulo="TME" nota="média da equipe"
                       valor={agora.tmeEquipe != null ? tempo(agora.tmeEquipe) : '—'}
                       comparacao={<Comparacao melhor={(dTme ?? 0) <= 0}
                         texto={dTme == null ? null : `${seta(dTme)} ${tempo(Math.abs(dTme))}`} />}
                       barras={agora.tmeSemanas.map((v) => v == null ? null : {
                         v, cor: agora.tmeEquipe != null && v > agora.tmeEquipe ? 'bg-amber-500' : 'bg-marca-600' })} />,

      detalheCsat: (
        <div className="grid items-start gap-4 xl:grid-cols-[1.3fr_1fr]">
          <Painel>
            <Secao titulo="C-SAT por semana" acao={<Link href="/cota/comparativo?cat=csat" className="whitespace-nowrap rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:border-marca-600">comparar meses ›</Link>} subtitulo="Positivas sobre avaliações. Escala de 75% a 100%.">
              {agora.csatMes == null ? <Vazio>Sem avaliações nesta fila.</Vazio> : (
                <>
                  <GraficoDeLinha min={0.75} max={1} formatar={percentual}
                                  referencia={{ valor: metaDaFila, rotulo: `meta ${textoDaMeta(metaDaFila)}` }}
                                  comparacao={{ pontos: antes.csatSemanas.map((s) => s?.valor ?? null), ...nomes }}
                                  pontos={agora.csatSemanas.map((s): PontoDaLinha => s && { valor: s.valor, tom: tomDoCsat(s.valor) })} />
                  {/* O tamanho da amostra: 100% de duas avaliações não é 100% de duzentas. */}
                  <p className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                    {agora.csatSemanas.map((s, i) => (
                      <span key={i}>{i + 1}ª: {s ? `${inteiro(s.positivas)} de ${inteiro(s.avaliacoes)}` : '—'}</span>
                    ))}
                  </p>
                </>
              )}
            </Secao>
          </Painel>
          <Painel>
            <Secao titulo="C-SAT por atendente" subtitulo="Semana a semana e no mês. Passe o mouse para ver a amostra.">
              {csatPorPessoa.length === 0 ? <Vazio>Sem avaliações nesta fila.</Vazio> : (
                <div className="text-sm">
                  <div className="flex items-center gap-2 pb-1 text-xs text-slate-400">
                    <span className="flex-1" />
                    {[1, 2, 3, 4].map((s) => <span key={s} className="w-12 text-center">{s}ª</span>)}
                    <span className="w-14 text-right">Mês</span>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {csatPorPessoa.map((p) => {
                      const semanas = [1, 2, 3, 4].map((s) => {
                        const [pos, tot] = agora.soma(agora.csatCanal.filter((x) => x.pessoa_id === p.id && x.semana === s));
                        return { valor: tot ? pos / tot : null, pos, tot };
                      });
                      return (
                        <li key={p.id} className="flex items-center gap-2 py-2">
                          <span className="flex-1 truncate text-slate-700">{nome.get(p.id)}</span>
                          {semanas.map((s, i) => (
                            <span key={i}
                                  title={s.tot ? `${i + 1}ª semana: ${s.pos} de ${s.tot} ${s.tot === 1 ? 'avaliação' : 'avaliações'}`
                                    : `${i + 1}ª semana: sem avaliação`}
                                  className={`w-12 cursor-help rounded px-1 py-0.5 text-center text-xs tabular-nums ${corDoCsat(s.valor, true)}`}>
                              {s.valor == null ? '·' : percentual(s.valor)}
                            </span>
                          ))}
                          <span title={`No mês: ${p.avaliacoes} ${p.avaliacoes === 1 ? 'avaliação' : 'avaliações'}`}
                                className={`w-14 cursor-help text-right font-semibold tabular-nums ${corDoCsat(p.csat)}`}>
                            {percentual(p.csat)}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </Secao>
          </Painel>
        </div>
      ),

      detalheVol: (
        <div className="grid items-start gap-4 xl:grid-cols-[1.3fr_1fr]">
          <Painel>
            <Secao titulo="Volume por semana" acao={<Link href="/cota/comparativo?cat=vol" className="whitespace-nowrap rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:border-marca-600">comparar meses ›</Link>} subtitulo="Finalizados de cada semana do ciclo.">
              {!agora.volTotal ? <Vazio>Nenhum volume lançado nesta fila.</Vazio> : (
                <GraficoDeLinha formatar={inteiro}
                                referencia={mediaVolSemanal != null ? { valor: mediaVolSemanal, rotulo: `média ${inteiro(mediaVolSemanal)}` } : undefined}
                                comparacao={{ pontos: antes.volSemanas, ...nomes }}
                                pontos={agora.volSemanas.map((v): PontoDaLinha => v == null ? null : { valor: v })} />
              )}
            </Secao>
          </Painel>
          <Painel>
            <Secao titulo="Volume por atendente" subtitulo="No mês, com a média da equipe como referência.">
              {volumePorPessoa.length === 0 ? <Vazio>Nenhum volume lançado nesta fila.</Vazio> : (
                <div className="space-y-3">
                  <ul className="space-y-3 text-sm">
                    {volumePorPessoa.map((p) => (
                      <li key={p.id} className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-slate-700">{nome.get(p.id)}</span>
                          <span className="font-semibold tabular-nums text-slate-800">{inteiro(p.total)}</span>
                        </div>
                        <div className="relative flex h-2.5 overflow-hidden rounded bg-slate-100">
                          {p.semanas.map((q, i) => q > 0 && (
                            <span key={i} className={TONS_SEMANA[i]} style={{ width: pct(q, maiorVolume) }}
                                  title={`${i + 1}ª semana: ${q}`} />
                          ))}
                          <span className="absolute inset-y-0 w-px bg-slate-900/50" style={{ left: pct(mediaVolume, maiorVolume) }}
                                title={`Média da equipe: ${inteiro(mediaVolume)}`} />
                        </div>
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                    {TONS_SEMANA.map((t, i) => (
                      <span key={t} className="flex items-center gap-1"><span className={`inline-block h-2 w-3 rounded-sm ${t}`} />{i + 1}ª</span>
                    ))}
                    <span className="flex items-center gap-1"><span className="inline-block h-3 w-px bg-slate-900/50" />média {inteiro(mediaVolume)}</span>
                  </div>
                </div>
              )}
            </Secao>
          </Painel>
        </div>
      ),

      detalheTme: (
        <div className="grid items-start gap-4 xl:grid-cols-[1.3fr_1fr]">
          <Painel>
            <Secao titulo="TME por semana" acao={<Link href="/cota/comparativo?cat=tme" className="whitespace-nowrap rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:border-marca-600">comparar meses ›</Link>} subtitulo="Âmbar nas semanas acima da média da equipe.">
              {agora.tmeEquipe == null ? <Vazio>Nenhum TME lançado nesta fila.</Vazio> : (
                <GraficoDeLinha formatar={tempo}
                                referencia={{ valor: agora.tmeEquipe, rotulo: `média ${tempo(agora.tmeEquipe)}` }}
                                comparacao={{ pontos: antes.tmeSemanas, ...nomes }}
                                pontos={agora.tmeSemanas.map((v): PontoDaLinha => v == null ? null
                                  : { valor: v, tom: v > agora.tmeEquipe! ? 'atencao' : 'bom' })} />
              )}
            </Secao>
          </Painel>
          <Painel>
            <Secao titulo="TME por atendente" subtitulo="Âmbar para quem está acima da média da equipe.">
              {tmePorPessoa.length === 0 ? <Vazio>Nenhum TME lançado nesta fila.</Vazio> : (
                <ul className="space-y-3 text-sm">
                  {tmePorPessoa.map((p) => {
                    const acima = agora.tmeEquipe != null && p.tme > agora.tmeEquipe;
                    return (
                      <li key={p.id} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-3">
                        <span className={acima ? 'font-medium text-amber-700' : 'text-slate-700'}>{nome.get(p.id)}</span>
                        <span className="relative h-2.5 overflow-hidden rounded bg-slate-100">
                          <span className={`crescer-x absolute inset-0 origin-left rounded ${acima ? 'bg-amber-500' : 'bg-marca-600'}`}
                                style={{ transform: `scaleX(${p.tme / maiorTme})` }} />
                          {agora.tmeEquipe != null && (
                            <span className="absolute inset-y-0 w-0.5 bg-slate-900/60" style={{ left: pct(agora.tmeEquipe, maiorTme) }} />
                          )}
                        </span>
                        <span className={`text-right font-semibold tabular-nums ${acima ? 'text-amber-700' : 'text-slate-800'}`}>{tempo(p.tme)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Secao>
          </Painel>
        </div>
      ),
    }];
  })) as unknown as Record<Canal, Record<string, React.ReactNode>>;

  /** Mostra a versão do canal escolhido nas abas do topo. */
  const doCanal = (chave: string) => CANAIS.map((c) => <NoCanal key={c} canal={c}>{porCanal[c][chave]}</NoCanal>);

  // ---------- Monitoria ----------
  const notasDe = (m: string) => todasMonitorias.filter((x) => x.mes_referencia === m).map((x) => Number(x.nota_final));
  const notaMes = media(notasDe(competencia));
  const notaAntes = media(notasDe(anterior));
  const dNota = notaMes != null && notaAntes != null ? (notaMes - notaAntes) * 100 : null;
  const notaPorPessoa = [...new Set(todasMonitorias.filter((x) => x.mes_referencia === competencia && exibe.has(x.operador_id))
    .map((x) => x.operador_id))].map((id) => {
    const notas = todasMonitorias.filter((x) => x.mes_referencia === competencia && x.operador_id === id).map((x) => Number(x.nota_final));
    return { id, nota: media(notas)!, quantidade: notas.length };
  }).sort((a, b) => b.nota - a.nota);
  const totalMonitorias = notasDe(competencia).length;

  const destaques: Destaque[] = [
    {
      chave: 'meta',
      tom: abaixo.length ? 'atencao' : 'normal',
      bloco: (
        <>
          <p className="text-sm text-slate-500">Na meta</p>
          <p className={`text-[1.65rem] font-semibold leading-tight tracking-tight tabular-nums ${
            abaixo.length ? 'text-amber-700' : 'text-marca-700 dark:text-marca-400'}`}>
            {comDireito.length === 0 ? '—' : abaixo.length ? `${naMeta} de ${comDireito.length}` : 'Todos'}
          </p>
          <Comparacao melhor={naMeta - (naMetaAntes ?? naMeta) >= 0}
                      texto={naMetaAntes == null || comDireito.length === 0 ? null
                        : naMeta === naMetaAntes ? 'igual' : `${seta(naMeta - naMetaAntes)} ${Math.abs(naMeta - naMetaAntes)}`} />
          {abaixo.length > 0 && (
            <p className="mt-1 text-xs text-slate-600">{abaixo.map((c) => primeiroNome(c.pessoa)).join(', ')} abaixo</p>
          )}
        </>
      ),
      detalhe: (
        <Painel>
          <Secao titulo="Pontuação de cota" acao={<Link href="/cota/comparativo?cat=pts" className="whitespace-nowrap rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:border-marca-600">comparar meses ›</Link>}
                 subtitulo={`${cotas[0]?.meta ? `Meta de ${inteiro(Number(cotas[0].meta))} pontos. ` : ''}Basta um com direito abaixo da meta para o bônus de equipe não sair.`}>
            {cotas.length === 0 ? <Vazio>Sem pontuação nesta competência.</Vazio> : competencia === atual ? (
              // Mês aberto (2.1.0): quem bate a meta no ritmo atual, com a mesma
              // conta da Simulação. A cota do cargo Gestor não aparece.
              <ProjecaoDaCota competencia={competencia} fonte={{ extrato: fonte.extrato, mensal: fonte.mensal }}
                              modo="equipe" ocultarCargos={['Gestor']} />
            ) : (
              <div className="-mx-6 overflow-x-auto sm:-mx-7">
                <table className="w-full text-[15px]">
                  <thead>
                    <tr className="text-left text-xs text-slate-500">
                      <th className="py-2.5 pl-6 pr-4 font-medium sm:pl-7">Pessoa</th>
                      <th className="px-4 py-2.5 font-medium">Cargo</th>
                      <th className="px-4 py-2.5 text-right font-medium">Pontos</th>
                      <th className="w-2/5 px-4 py-2.5 font-medium">Atingimento da meta</th>
                      <th className="px-4 py-2.5 text-right font-medium">Falta / sobra</th>
                      {projetar && (
                        <th className="px-4 py-2.5 text-right font-medium"
                            title={`No ritmo das ${semanasLancadas} semana(s) com volume lançado, até o fim do ciclo`}>
                          Projeção
                        </th>
                      )}
                      <th className="py-2.5 pl-4 pr-6 sm:pr-7"><span className="sr-only">Extrato</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {cotas.map((c) => {
                      const ating = c.meta ? Number(c.resultado) / Number(c.meta) : null;
                      const diferenca = c.meta ? Number(c.resultado) - Number(c.meta) : null;
                      const proj = projecao(Number(c.resultado));
                      return (
                        <tr key={`${c.pessoa_id}-${c.cargo}`} className="border-t border-slate-100">
                          <td className="py-3 pl-6 pr-4 font-medium text-slate-800 sm:pl-7">{nomeCurto(c.pessoa)}</td>
                          <td className="px-4 py-3 text-xs text-slate-500">{c.cargo ?? '—'}</td>
                          <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-800">{inteiro(Number(c.resultado))}</td>
                          <td className="px-4 py-3">
                            {ating == null
                              ? <span className="text-xs text-slate-400">sem meta</span>
                              : <BarraDeMeta atingimento={ating} escala={escalaCota} />}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {diferenca == null ? '—' : diferenca < 0
                              ? <span className="font-semibold text-amber-700">faltam {inteiro(-diferenca)}</span>
                              : <span className="text-slate-500">+{inteiro(diferenca)}</span>}
                          </td>
                          {projetar && (
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                              {!c.meta ? '—' : proj >= Number(c.meta)
                                ? <span className="font-semibold text-marca-700 dark:text-marca-400">{inteiro(proj)} ✓</span>
                                : <span className="font-semibold text-amber-700">{inteiro(proj)} · faltariam {inteiro(Number(c.meta) - proj)}</span>}
                            </td>
                          )}
                          <td className="py-3 pl-4 pr-6 text-right sm:pr-7">
                            <Link href={`/cota/extrato?pessoa=${c.pessoa_id}&mes=${mes}`}
                                  className="whitespace-nowrap rounded-full border border-slate-200 px-2.5 py-0.5 text-xs
                                             text-slate-600 hover:border-marca-600 hover:text-marca-700 dark:hover:text-marca-400">
                              extrato ›
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Secao>
        </Painel>
      ),
    },
    { chave: 'csat', bloco: doCanal('blocoCsat'), detalhe: doCanal('detalheCsat') },
    { chave: 'vol', bloco: doCanal('blocoVol'), detalhe: doCanal('detalheVol') },
    { chave: 'tme', bloco: doCanal('blocoTme'), detalhe: doCanal('detalheTme') },
    {
      chave: 'monitoria',
      bloco: (
        <Bloco rotulo="Monitoria" nota="nota média"
               valor={notaMes != null ? percentual(notaMes) : '—'}
               comparacao={<>
                 <Comparacao melhor={(dNota ?? 0) >= 0}
                             texto={dNota == null ? null : `${seta(dNota)} ${numeroBR(Math.abs(dNota), 1)} pt`} />
                 <p className="mt-0.5 text-xs text-slate-500">{totalMonitorias} monitoria{totalMonitorias === 1 ? '' : 's'} no mês</p>
               </>} />
      ),
      detalhe: (
        <div className="grid items-start gap-4 xl:grid-cols-[1.3fr_1fr]">
          {/* Critérios: cinza, porque não é bom nem ruim por si; a barra é a
              fatia das monitorias do mês, não do critério mais reprovado. */}
          <Painel>
            <Secao titulo="Critérios mais reprovados" acao={<Link href="/cota/comparativo?cat=mon" className="whitespace-nowrap rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:border-marca-600">comparar meses ›</Link>}
                   subtitulo={totalMonitorias ? `Em ${totalMonitorias} monitorias no mês.` : undefined}>
              {lista.length === 0 ? <Vazio>Nenhuma reprovação nesta competência.</Vazio> : (
                <ul className="grid gap-3 text-sm">
                  {lista.map((c) => (
                    <li key={c.criterio}>
                      <div className="flex justify-between gap-3">
                        <span className="text-slate-700">{c.criterio}</span>
                        <span className="shrink-0 tabular-nums text-slate-500">
                          <strong className="font-semibold text-slate-800">{c.reprovacoes}</strong> · {percentual(Number(c.taxa_reprovacao))}
                        </span>
                      </div>
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-100">
                        <span className="crescer-x block h-full origin-left rounded-full bg-slate-400"
                              style={{ width: `${Math.min(100, Number(c.taxa_reprovacao) * 100)}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          </Painel>
          <Painel>
            <Secao titulo="Nota média por atendente" subtitulo={`Monitorias do mês. Verde a partir de ${textoDoPiso(piso)}, o piso para pontuar.`}>
              {notaPorPessoa.length === 0 ? <Vazio>Nenhuma monitoria nesta competência.</Vazio> : (
                <ul className="space-y-3 text-sm">
                  {notaPorPessoa.map((p) => {
                    const tom = tomDaNota(p.nota);
                    const cor = { bom: 'bg-marca-600', atencao: 'bg-amber-500', ruim: 'bg-rose-500' }[tom];
                    const texto = { bom: 'text-slate-800', atencao: 'text-amber-700', ruim: 'text-rose-700' }[tom];
                    return (
                      <li key={p.id} className="grid grid-cols-[7rem_1fr_3.5rem] items-center gap-3"
                          title={`${p.quantidade} monitoria${p.quantidade === 1 ? '' : 's'}`}>
                        <span className="text-slate-700">{nome.get(p.id)}</span>
                        <span className="relative h-2.5 overflow-hidden rounded bg-slate-100">
                          <span className={`crescer-x absolute inset-0 origin-left rounded ${cor}`}
                                style={{ transform: `scaleX(${Math.max(0, Math.min(1, p.nota))})` }} />
                        </span>
                        <span className={`text-right font-semibold tabular-nums ${texto}`}>{percentual(p.nota)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Secao>
          </Painel>
        </div>
      ),
    },
  ];

  // Abertura (4.4.0): a frase da meta e quem está abaixo dela.
  if (abertura) {
    const frase = comDireito.length === 0 ? null
      : abaixo.length === 0 ? 'Todos com direito estão na meta.'
        : `${naMeta} de ${comDireito.length} estão na meta.`;
    const detalhe = !comPendencias ? null : pendencias.length === 0
      ? 'Nenhuma pendência: é só acompanhar a equipe.'
      : `${pendencias.length === 1 ? 'Falta 1 coisa' : `Faltam ${pendencias.length} coisas`} para o mês ficar sem pendência.`;
    const atencao = abaixo.filter((c) => exibe.has(c.pessoa_id))
      .map((c) => ({ ...c, ating: Number(c.resultado) / Number(c.meta) }))
      .sort((a, b) => a.ating - b.ating);
    const iniciais = (n: string) => nomeCurto(n).split(' ').map((p) => p[0]).join('').toUpperCase();
    return (
      <div className="space-y-5">
        <Abertura saudacao={abertura.saudacao} cabecalho={abertura.cabecalho}
                  frase={frase ?? 'Acompanhe a equipe do mês.'} detalhe={detalhe}
                  passos={comPendencias ? pendencias : []} />

        {atencao.length > 0 && (
          <section className="sobe rounded-[22px] bg-superficie px-6 py-5 shadow-sm ring-1 ring-slate-200" style={{ animationDelay: '80ms' }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold text-slate-900">Quem está abaixo da meta</h2>
              <span className="text-xs text-slate-500">
                {competencia === atual ? 'até agora, no mês em andamento' : 'no mês'} · basta um abaixo para o bônus de equipe não sair
              </span>
            </div>
            <ul className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2">
              {atencao.map((c, i) => (
                <li key={c.pessoa_id} className="sobe grid grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3"
                    style={{ animationDelay: `${140 + i * 50}ms` }}>
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-marca-600/15 text-xs font-bold text-marca-700 dark:text-marca-400">
                    {iniciais(c.pessoa)}
                  </span>
                  {/* Nome à esquerda; % da meta e o que falta juntos à direita,
                      numa linha só; a barra embaixo vai até a meta (cheia = 100%). */}
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <Link href={`/cota/extrato?pessoa=${c.pessoa_id}&mes=${mes}`}
                            className="truncate font-medium text-slate-800 hover:text-marca-700 dark:hover:text-marca-400">
                        {nomeCurto(c.pessoa)}
                      </Link>
                      <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-slate-500">
                        <b className="font-semibold text-amber-700">{percentual(c.ating)}</b> da meta
                        <span className="mx-1.5 text-slate-300">·</span>
                        faltam <b className="font-semibold text-slate-700">{inteiro(Number(c.meta) - Number(c.resultado))}</b> pts
                      </span>
                    </div>
                    <span className="mt-1.5 block h-2 overflow-hidden rounded-full bg-slate-100">
                      <span className="crescer-x block h-full origin-left rounded-full bg-amber-500"
                            style={{ transform: `scaleX(${Math.max(0.01, Math.min(1, c.ating))})` }} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {abertura.abas && <div className="flex justify-end">{abertura.abas}</div>}
        <SeletorDeDetalhe destaques={destaques} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* O que precisa do gestor agora — cada item leva à tela onde se resolve. */}
      {!comPendencias ? null : pendencias.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm font-semibold text-sobre-fundo">Precisa de você</span>
          {pendencias.map((p) => (
            <Link key={p.texto} href={p.href}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-superficie py-1.5 pl-3 pr-1.5 text-sm text-slate-800
                             shadow-sm transition hover:ring-2 hover:ring-marca-600/40">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${p.grave ? 'bg-rose-500' : 'bg-amber-500'}`} />
              {p.texto}
              <span className="rounded-md bg-marca-50 px-2 py-0.5 text-xs font-semibold text-marca-700 dark:text-marca-400">
                {p.acao} ›
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <p className="text-sm text-sobre-fundo-suave">Nada pendente neste mês.</p>
      )}

      <SeletorDeDetalhe destaques={destaques} />
    </div>
  );
}
