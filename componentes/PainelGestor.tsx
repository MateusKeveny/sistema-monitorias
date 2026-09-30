import Link from '@/componentes/Link';
import { NoCanal, type Canal } from '@/componentes/Canal';
import GraficoDeLinha, { type PontoDaLinha } from '@/componentes/GraficoDeLinha';
import SeletorDeDetalhe, { type Destaque } from '@/componentes/SeletorDeDetalhe';
import { BarraDeMeta, Painel, Secao, Vazio } from '@/componentes/ui';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { corDoCsat, hojeNoBrasil, percentual, semanaDoCiclo } from '@/lib/formatar';
import { mesAnterior } from '@/lib/competencia';
import { limiteDeRenovacao } from '@/lib/diario';

const CANAIS: Canal[] = ['huggy', 'diretores'];
const META_CSAT = 0.95;

type Csat = { pessoa_id: string; origem: Canal; semana: number; avaliacoes: number; positivas: number; mes_competencia: string };
type Volume = { pessoa_id: string; canal: Canal; semana: number; finalizados: number; tme_seg: number | null; mes_competencia: string };
type Criterio = { criterio: string; avaliacoes: number; reprovacoes: number; taxa_reprovacao: number };
type Cota = {
  pessoa_id: string; pessoa: string; cargo: string | null; resultado: number; meta: number | null;
  compoe_media: boolean | null;
};
type Fechado = { pessoa_id: string; mes_competencia: string; resultado: number; meta: number | null; cargo: string | null };
type Monitoria = { operador_id: string; nota_final: number; mes_referencia: string };

const inteiro = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
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

/** Escala única do painel para a nota de monitoria: 85% é o piso para pontuar. */
const tomDaNota = (v: number): 'bom' | 'atencao' | 'ruim' => (v >= 0.85 ? 'bom' : v >= 0.70 ? 'atencao' : 'ruim');
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
export default async function PainelGestor({
  competencia, atual, comPendencias = true,
}: {
  competencia: string;
  atual: string;
  /** A faixa "Precisa de você" leva a telas só do gestor; o Pleno vê o painel sem ela. */
  comPendencias?: boolean;
}) {
  const anterior = mesAnterior(competencia);
  const meses = [competencia, anterior];
  const db = await criarClienteServidor();

  const [pessoas, csat, volume, criterios, cota, cargos, fechados, monitorias, valores, semCargo, conferir, diario, vencendo]
    = await Promise.all([
    db.from('pessoas').select('id, nome, exibir_no_painel, conta_nas_medias'),
    db.from('vw_csat_semanal').select('pessoa_id, origem, semana, avaliacoes, positivas, mes_competencia')
      .in('mes_competencia', meses),
    db.from('volume_semanal').select('pessoa_id, canal, semana, finalizados, tme_seg, mes_competencia')
      .in('mes_competencia', meses),
    db.from('vw_criterios_reprovados').select('criterio, avaliacoes, reprovacoes, taxa_reprovacao')
      .eq('mes_referencia', competencia).gt('reprovacoes', 0)
      .order('reprovacoes', { ascending: false }).limit(8),
    db.from('vw_cota_mensal').select('pessoa_id, pessoa, cargo, resultado, meta, compoe_media')
      .eq('mes_competencia', competencia).order('resultado', { ascending: false }),
    db.from('cargos').select('nome, recebe_bonus'),
    db.from('fechamentos_cota').select('pessoa_id, mes_competencia, resultado, meta, cargo')
      .in('mes_competencia', meses),
    db.from('vw_monitorias').select('operador_id, nota_final, mes_referencia').in('mes_referencia', meses),
    db.from('valores_da_cota').select('mes_competencia').in('mes_competencia', meses),
    db.from('vw_sem_cargo').select('nome').eq('mes_competencia', competencia),
    db.from('vw_lancamentos_a_conferir').select('bloco').eq('mes_competencia', competencia),
    db.from('diario_registros').select('id', { count: 'exact', head: true }).eq('situacao', 'aguardando'),
    // Validade nos próximos 7 dias: dá para renovar (migração 37).
    db.from('diario_registros').select('id', { count: 'exact', head: true })
      .gte('valido_ate', hojeNoBrasil()).lte('valido_ate', limiteDeRenovacao(hojeNoBrasil())),
  ]);

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
  const naMetaProjetado = comDireito.filter((c) => projecao(Number(c.resultado)) >= Number(c.meta)).length;

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
  if (competencia < atual && !fechadoEm(competencia)) {
    pendencias.push({
      texto: `${nomeDoMes(competencia).replace(/^./, (l) => l.toUpperCase())} aguardando fechamento`,
      acao: 'Fechar', href: `/cota/fechamento?mes=${mes}`,
    });
  }
  for (const m of meses) {
    if (fechadoEm(m) && !temValor(m)) {
      pendencias.push({
        texto: `Valor por ponto de ${nomeDoMes(m)} não informado`, grave: true,
        acao: 'Informar', href: `/cota/fechamento?mes=${m.slice(0, 7)}`,
      });
    }
  }
  if ((semCargo.data ?? []).length) {
    const n = (semCargo.data ?? []).length;
    pendencias.push({ texto: `${n} pessoa${n > 1 ? 's' : ''} sem cargo no mês`, acao: 'Definir', href: '/cota/atendentes', grave: true });
  }
  if (diario.count) {
    pendencias.push({
      texto: `${diario.count} registro${diario.count > 1 ? 's' : ''} do diário aguardando aprovação`,
      acao: 'Revisar', href: '/cota/diario?filtro=aguardando',
    });
  }
  if (vencendo.count) {
    pendencias.push({
      texto: `${vencendo.count} registro${vencendo.count > 1 ? 's' : ''} do diário vence${vencendo.count > 1 ? 'm' : ''} em até 7 dias`,
      acao: 'Renovar', href: '/cota/diario?filtro=vencendo',
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
        {barras && (
          <div className="mt-2.5 grid h-8 grid-cols-4 items-end gap-1.5">
            {barras.map((b, i) => (
              <span key={i} className={`crescer-y block h-full origin-bottom rounded-t ${b ? b.cor : 'bg-slate-100'}`}
                    style={{ transform: `scaleY(${b ? fracao(b.v) : 0.04})` }} />
            ))}
          </div>
        )}
      </>
    );
  };

  const porCanal = Object.fromEntries(CANAIS.map((c) => {
    const agora = canal(c, competencia);
    const antes = canal(c, anterior);

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
      blocoCsat: <Bloco rotulo="C-SAT" nota="meta 95%" min={0.7} max={1}
                        valor={agora.csatMes != null ? percentual(agora.csatMes) : '—'}
                        comparacao={<Comparacao melhor={(dCsat ?? 0) >= 0}
                          texto={dCsat == null ? null : `${seta(dCsat)} ${Math.abs(dCsat).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pt`} />}
                        barras={agora.csatSemanas.map((s) => s && {
                          v: s.valor, cor: { bom: 'bg-marca-600', atencao: 'bg-amber-500', ruim: 'bg-rose-500' }[tomDoCsat(s.valor)] })} />,
      blocoVol: <Bloco rotulo="Volume" nota="finalizados"
                       valor={agora.volTotal ? inteiro(agora.volTotal) : '—'}
                       comparacao={<Comparacao melhor={(dVol ?? 0) >= 0}
                         texto={dVol == null ? null : `${seta(dVol)} ${Math.abs(dVol * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`} />}
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
              {agora.csatMes == null ? <Vazio>Sem avaliações neste canal.</Vazio> : (
                <>
                  <GraficoDeLinha min={0.75} max={1} formatar={percentual}
                                  referencia={{ valor: META_CSAT, rotulo: 'meta 95%' }}
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
              {csatPorPessoa.length === 0 ? <Vazio>Sem avaliações neste canal.</Vazio> : (
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
              {!agora.volTotal ? <Vazio>Nenhum volume lançado neste canal.</Vazio> : (
                <GraficoDeLinha formatar={inteiro}
                                referencia={mediaVolSemanal != null ? { valor: mediaVolSemanal, rotulo: `média ${inteiro(mediaVolSemanal)}` } : undefined}
                                pontos={agora.volSemanas.map((v): PontoDaLinha => v == null ? null : { valor: v })} />
              )}
            </Secao>
          </Painel>
          <Painel>
            <Secao titulo="Volume por atendente" subtitulo="No mês, com a média da equipe como referência.">
              {volumePorPessoa.length === 0 ? <Vazio>Nenhum volume lançado neste canal.</Vazio> : (
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
              {agora.tmeEquipe == null ? <Vazio>Nenhum TME lançado neste canal.</Vazio> : (
                <GraficoDeLinha formatar={tempo}
                                referencia={{ valor: agora.tmeEquipe, rotulo: `média ${tempo(agora.tmeEquipe)}` }}
                                pontos={agora.tmeSemanas.map((v): PontoDaLinha => v == null ? null
                                  : { valor: v, tom: v > agora.tmeEquipe! ? 'atencao' : 'bom' })} />
              )}
            </Secao>
          </Painel>
          <Painel>
            <Secao titulo="TME por atendente" subtitulo="Âmbar para quem está acima da média da equipe.">
              {tmePorPessoa.length === 0 ? <Vazio>Nenhum TME lançado neste canal.</Vazio> : (
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
          {projetar && comDireito.length > 0 && (
            <p className="mt-0.5 text-xs text-slate-600">
              Projeção: <b className={naMetaProjetado === comDireito.length ? 'text-marca-700 dark:text-marca-400' : 'text-amber-700'}>
                {naMetaProjetado} de {comDireito.length}</b> no fim do ciclo
            </p>
          )}
          {abaixo.length > 0 && (
            <p className="mt-1 text-xs text-slate-600">{abaixo.map((c) => primeiroNome(c.pessoa)).join(', ')} abaixo</p>
          )}
        </>
      ),
      detalhe: (
        <Painel>
          <Secao titulo="Pontuação de cota" acao={<Link href="/cota/comparativo?cat=pts" className="whitespace-nowrap rounded-full border border-slate-200 px-2.5 py-0.5 text-xs text-slate-600 hover:border-marca-600">comparar meses ›</Link>}
                 subtitulo={`${cotas[0]?.meta ? `Meta de ${inteiro(Number(cotas[0].meta))} pontos. ` : ''}Basta um com direito abaixo da meta para o bônus de equipe não sair.`}>
            {cotas.length === 0 ? <Vazio>Sem pontuação nesta competência.</Vazio> : (
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
                             texto={dNota == null ? null : `${seta(dNota)} ${Math.abs(dNota).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} pt`} />
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
            <Secao titulo="Nota média por atendente" subtitulo="Monitorias do mês. Verde a partir de 85%, o piso para pontuar.">
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

  return (
    <div className="space-y-4">
      {/* O que precisa do gestor agora — cada item leva à tela onde se resolve. */}
      {!comPendencias ? null : pendencias.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-sm font-semibold text-sobre-fundo">Precisa de você</span>
          {pendencias.map((p) => (
            <Link key={p.texto} href={p.href}
                  className="inline-flex items-center gap-2 rounded-xl bg-superficie py-1.5 pl-3 pr-1.5 text-sm text-slate-800
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
