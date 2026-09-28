import Link from '@/componentes/Link';
import { NoCanal, ProvedorDeCanal, type Canal } from '@/componentes/Canal';
import GraficoDeLinha, { type PontoDaLinha } from '@/componentes/GraficoDeLinha';
import SeletorDeDetalhe, { type Destaque } from '@/componentes/SeletorDeDetalhe';
import { BarraDeMeta, EtiquetaNota, Painel, Secao, Vazio } from '@/componentes/ui';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { codigoMonitoria, data as formatarData, percentual } from '@/lib/formatar';
import { mesAnterior } from '@/lib/competencia';
import { ENDERECO_MONITORIAS } from '@/lib/sistema';

const CANAIS: { chave: Canal; rotulo: string }[] = [
  { chave: 'huggy', rotulo: 'Expansão' },
  { chave: 'diretores', rotulo: 'Diretores-Expansão' },
];
const META_CSAT = 0.95;
/** Faixas de C-SAT na ordem em que se sobe. */
const DEGRAUS_CSAT = [0.80, 0.85, 0.90, 0.95];

type CsatSemana = { origem: Canal; semana: number; avaliacoes: number; positivas: number; mes_competencia: string };
type Volume = { canal: Canal; semana: number; finalizados: number; tme_seg: number | null; mes_competencia: string };
type LinhaExtrato = {
  semana: number | null; origem: Canal | null; regra: string; rotulo: string;
  grupo: string; cargo_id: number; quantidade: number; peso: number; cota: number;
};
type Pagamento = {
  mes_competencia: string; resultado: number; meta: number | null;
  atingiu_meta: boolean; valor: number | null;
};
type Regra = { chave: string; rotulo: string; grupo: string; faixa_min: number | null; ordem: number };
type Monitoria = {
  id: string; codigo: number; protocolo: string; data_atendimento: string; mes_referencia: string;
  semana_mes: number; nota_final: number; zerado: boolean; parecer: string | null;
};
type Apontamento = { monitoria_id: string; criterio: string; observacao: string | null };

const num = (v: number, casas = 0) =>
  Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas });
const reais = (v: number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const media = (l: number[]) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : null);

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
const nomeDoMesMaiusculo = (c: string) => nomeDoMes(c).replace(/^./, (l) => l.toUpperCase());

const tomDoCsat = (v: number): 'bom' | 'atencao' | 'ruim' => (v >= 0.90 ? 'bom' : v >= 0.85 ? 'atencao' : 'ruim');
const tomDaNota = (v: number): 'bom' | 'atencao' | 'ruim' => (v >= 0.85 ? 'bom' : v >= 0.70 ? 'atencao' : 'ruim');
const BARRA = { bom: 'bg-marca-600', atencao: 'bg-amber-500', ruim: 'bg-rose-500' };

/**
 * Tela inicial do operador (1.16.0): o mesmo painel de acompanhamento do
 * gestor, sobre a própria competência.
 *
 * Responde, nesta ordem: como chego à meta (os passos concretos, no topo);
 * como estou (os destaques, comparados comigo mesmo no mês anterior); e de
 * onde veio cada coisa (o detalhe de cada destaque, logo abaixo da faixa).
 *
 * Nada aqui mostra colega nem fechamento. Da equipe, só as médias agregadas
 * que o banco entrega ao operador: o C-SAT (`csat_da_equipe`) e o TME
 * (`vw_tme_equipe`), como referência nos gráficos.
 */
export default async function PainelAtendente({
  pessoaId, competencia, atual, canalPedido, topo,
}: {
  pessoaId: string;
  competencia: string;
  atual: string;
  /** Canal vindo da URL; sem ele, abre no canal em que a pessoa mais atende. */
  canalPedido?: string;
  /** O topo da página, que recebe as abas de canal (precisa estar dentro do ProvedorDeCanal). */
  topo: React.ReactNode;
}) {
  const anterior = mesAnterior(competencia);
  const meses = [competencia, anterior];
  const db = await criarClienteServidor();

  const equipe = Promise.all(CANAIS.flatMap(({ chave }) => [1, 2, 3, 4].map((semana) =>
    db.rpc('csat_da_equipe', { p_mes: competencia, p_semana: semana, p_origem: chave }))));

  const [csat, volume, extrato, fechados, pesos, regras, tmeEquipe, cotaAntes, monitorias, csatEquipe] = await Promise.all([
    db.from('vw_csat_semanal').select('origem, semana, avaliacoes, positivas, mes_competencia')
      .eq('pessoa_id', pessoaId).in('mes_competencia', meses),
    db.from('volume_semanal').select('canal, semana, finalizados, tme_seg, mes_competencia')
      .eq('pessoa_id', pessoaId).in('mes_competencia', meses),
    db.from('vw_extrato_cota')
      .select('semana, origem, regra, rotulo, grupo, cargo_id, quantidade, peso, cota')
      .eq('pessoa_id', pessoaId).eq('mes_competencia', competencia),
    db.from('vw_pagamento_mensal').select('mes_competencia, resultado, meta, atingiu_meta, valor')
      .eq('pessoa_id', pessoaId).order('mes_competencia', { ascending: false }).limit(4),
    // A tabela inteira de pesos é pequena e vem numa consulta só; o cargo da
    // pessoa sai do próprio extrato, logo abaixo.
    db.from('pesos_por_cargo').select('cargo_id, regra, peso').eq('ativo', true),
    db.from('regras').select('chave, rotulo, grupo, faixa_min, ordem').eq('ativo', true).order('ordem'),
    db.from('vw_tme_equipe').select('semana, canal, tme_seg').eq('mes_competencia', competencia),
    db.from('vw_cota_mensal').select('resultado').eq('pessoa_id', pessoaId).eq('mes_competencia', anterior).maybeSingle(),
    db.from('vw_monitorias')
      .select('id, codigo, protocolo, data_atendimento, mes_referencia, semana_mes, nota_final, zerado, parecer')
      .eq('operador_id', pessoaId)
      .order('data_atendimento', { ascending: false }).order('codigo', { ascending: false })
      .limit(20),
    equipe,
  ]);

  const todoCsat = (csat.data ?? []) as CsatSemana[];
  const todoVolume = (volume.data ?? []) as Volume[];
  const semanasCsat = todoCsat.filter((s) => s.mes_competencia === competencia);
  const volumes = todoVolume.filter((v) => v.mes_competencia === competencia);
  const linhas = (extrato.data ?? []) as LinhaExtrato[];
  const historico = (fechados.data ?? []) as Pagamento[];
  const todasRegras = (regras.data ?? []) as Regra[];
  const tmesEquipe = (tmeEquipe.data ?? []) as { semana: number; canal: Canal; tme_seg: number | null }[];
  const cargoId = linhas[0]?.cargo_id;
  const peso = new Map(((pesos.data ?? []) as { cargo_id: number; regra: string; peso: number }[])
    .filter((p) => p.cargo_id === cargoId)
    .map((p) => [p.regra, Number(p.peso)]));

  const avaliacoesDo = (c: Canal) => semanasCsat.filter((s) => s.origem === c).reduce((a, s) => a + s.avaliacoes, 0);
  const canalInicial: Canal = CANAIS.some((c) => c.chave === canalPedido)
    ? canalPedido as Canal
    : avaliacoesDo('diretores') > avaliacoesDo('huggy') ? 'diretores' : 'huggy';

  const resultado = linhas.reduce((a, l) => a + Number(l.cota), 0);
  const meta = peso.get('meta') ?? null;
  const resultadoAntes = cotaAntes.data ? Number(cotaAntes.data.resultado) : null;
  const vs = `vs ${nomeDoMes(anterior)}`;
  const seta = (d: number) => (d >= 0 ? '▲' : '▼');

  // ---------------------------------------------------------- monitorias
  const lista = (monitorias.data ?? []) as Monitoria[];
  const { data: itens } = lista.length
    ? await db.from('vw_feedback_individual').select('monitoria_id, criterio, observacao')
      .in('monitoria_id', lista.map((m) => m.id)).eq('conforme', false).order('criterio_ordem')
    : { data: [] };
  const apontamentos = new Map<string, Apontamento[]>();
  for (const a of (itens ?? []) as Apontamento[]) {
    apontamentos.set(a.monitoria_id, [...(apontamentos.get(a.monitoria_id) ?? []), a]);
  }
  const notasDe = (m: string) => lista.filter((x) => x.mes_referencia === m).map((x) => Number(x.nota_final));
  const notaMes = media(notasDe(competencia));
  const notaAntes = media(notasDe(anterior));
  const dNota = notaMes != null && notaAntes != null ? (notaMes - notaAntes) * 100 : null;
  const doMes = lista.filter((x) => x.mes_referencia === competencia);
  // O que mais aparece: critérios reprovados nas monitorias do mês.
  const recorrentes = [...doMes.flatMap((m) => (apontamentos.get(m.id) ?? []).map((a) => a.criterio))
    .reduce((mapa, c) => mapa.set(c, (mapa.get(c) ?? 0) + 1), new Map<string, number>())]
    .sort((a, b) => b[1] - a[1]);
  const ultima = lista[0];
  const falhasDaUltima = ultima ? (apontamentos.get(ultima.id) ?? []).length : 0;

  // ------------------------------------------------------- quanto falta
  const falta = meta != null ? meta - resultado : null;
  const canalPrincipal: Canal = volumes.filter((v) => v.canal === 'diretores').reduce((a, v) => a + v.finalizados, 0)
    > volumes.filter((v) => v.canal === 'huggy').reduce((a, v) => a + v.finalizados, 0) ? 'diretores' : 'huggy';
  const pesoDoAtendimento = peso.get(canalPrincipal === 'huggy' ? 'huggy_atendimento' : 'diretores_atendimento') ?? 0;
  const finalizadosQueFaltam = falta != null && falta > 0 && pesoDoAtendimento > 0 ? Math.ceil(falta / pesoDoAtendimento) : null;

  // O próximo degrau de C-SAT e o que ele acrescentaria, no canal principal.
  const doPrincipal = semanasCsat.filter((s) => s.origem === canalPrincipal);
  const avalPrincipal = doPrincipal.reduce((a, s) => a + s.avaliacoes, 0);
  const csatPrincipal = avalPrincipal ? doPrincipal.reduce((a, s) => a + s.positivas, 0) / avalPrincipal : null;
  const proximoDegrau = csatPrincipal != null ? DEGRAUS_CSAT.find((d) => d > csatPrincipal) ?? null : null;
  const faixaDe = (v: number) => (v >= 0.95 ? 'csat_95' : v >= 0.90 ? 'csat_90_95'
    : v >= 0.85 ? 'csat_85_90' : v >= 0.80 ? 'csat_80_85' : 'csat_abaixo_80');
  const finalizadosPrincipal = volumes.filter((v) => v.canal === canalPrincipal).reduce((a, v) => a + v.finalizados, 0);
  const ganhoDoDegrau = csatPrincipal != null && proximoDegrau != null
    ? ((peso.get(faixaDe(proximoDegrau)) ?? 0) - (peso.get(faixaDe(csatPrincipal)) ?? 0)) * finalizadosPrincipal
    : null;

  // Projeção pessoal: só com o ciclo correndo, pelo ritmo das semanas com
  // volume lançado — a mesma conta da tela do gestor.
  const semanasLancadas = new Set(volumes.map((v) => v.semana)).size;
  const projetar = competencia === atual && semanasLancadas > 0 && semanasLancadas < 4;
  const projecao = projetar ? (resultado * 4) / semanasLancadas : null;

  // ------------------------------------------------ ganhos e perdas do mês
  const porRegra = [...new Map(linhas.map((l) => [l.regra + (l.origem ?? ''), l])).values()]
    .map((base) => {
      const iguais = linhas.filter((l) => l.regra === base.regra && l.origem === base.origem);
      return {
        chave: base.regra + (base.origem ?? ''),
        rotulo: base.rotulo,
        quantidade: iguais.reduce((a, l) => a + Number(l.quantidade), 0),
        cota: iguais.reduce((a, l) => a + Number(l.cota), 0),
      };
    });
  const ganhos = porRegra.filter((r) => r.cota > 0).sort((a, b) => b.cota - a.cota).slice(0, 6);
  const perdas = porRegra.filter((r) => r.cota < 0).sort((a, b) => a.cota - b.cota);

  // Quanto vale cada coisa no cargo da pessoa.
  const regraDaNota = (n: number) => todasRegras.find((r) => r.grupo === 'nota' && Number(r.faixa_min) === n)?.chave;
  const valeQuanto = [
    { rotulo: `Cada atendimento finalizado em ${CANAIS.find((c) => c.chave === canalPrincipal)!.rotulo}`, peso: pesoDoAtendimento },
    { rotulo: 'Cada nota 5', peso: peso.get(regraDaNota(5) ?? '') },
    { rotulo: 'Cada nota 1', peso: peso.get(regraDaNota(1) ?? '') },
  ].filter((v): v is { rotulo: string; peso: number } => v.peso != null && v.peso !== 0);

  // ------------------------------------------------------------ por canal
  const porCanal = Object.fromEntries(CANAIS.map(({ chave: c, rotulo }, indice) => {
    const deste = (m: string) => todoCsat.filter((s) => s.origem === c && s.mes_competencia === m);
    const soma = (l: CsatSemana[]) => l.reduce((a, s) => [a[0] + s.positivas, a[1] + s.avaliacoes], [0, 0]);
    const csatDe = (m: string) => { const [p, t] = soma(deste(m)); return t ? p / t : null; };
    const csatMes = csatDe(competencia);
    const csatAntes = csatDe(anterior);
    const csatSemanas = [1, 2, 3, 4].map((s) => {
      const l = deste(competencia).find((x) => x.semana === s);
      return l && l.avaliacoes ? { valor: l.positivas / l.avaliacoes, positivas: l.positivas, avaliacoes: l.avaliacoes } : null;
    });
    const csatEquipeMes = media([1, 2, 3, 4].map((_, i) => csatEquipe[indice * 4 + i].data)
      .filter((v): v is number => v != null).map(Number));

    const vol = (m: string) => todoVolume.filter((v) => v.canal === c && v.mes_competencia === m);
    const volSemanas = [1, 2, 3, 4].map((s) => vol(competencia).find((v) => v.semana === s)?.finalizados ?? null);
    const volTotal = vol(competencia).reduce((a, v) => a + v.finalizados, 0);
    const volAntes = vol(anterior).reduce((a, v) => a + v.finalizados, 0);
    const volMediaSemanal = media(volSemanas.filter((v): v is number => v != null));

    const tmeSemanas = [1, 2, 3, 4].map((s) => {
      const v = vol(competencia).find((x) => x.semana === s);
      return v && (v.tme_seg ?? 0) > 0 ? v.tme_seg! : null;
    });
    const tmeDe = (m: string) => media(vol(m).map((v) => v.tme_seg ?? 0).filter((t) => t > 0));
    const tmeMes = tmeDe(competencia);
    const tmeAntes = tmeDe(anterior);
    const tmeEquipeSemana = (s: number) => {
      const t = tmesEquipe.find((x) => x.canal === c && x.semana === s)?.tme_seg;
      return t != null && t > 0 ? Number(t) : null;
    };
    const tmeEquipeMes = media([1, 2, 3, 4].map(tmeEquipeSemana).filter((t): t is number => t != null));
    const faixasTme = todasRegras.filter((r) => r.grupo === (c === 'huggy' ? 'tme' : 'tme_diretores'));

    const dCsat = csatMes != null && csatAntes != null ? (csatMes - csatAntes) * 100 : null;
    const dVol = volTotal && volAntes ? (volTotal - volAntes) / volAntes : null;
    const dTme = tmeMes != null && tmeAntes != null ? tmeMes - tmeAntes : null;

    return [c, {
      blocoCsat: <Bloco rotulo="Meu C-SAT" nota="meta 95%" min={0.7} max={1}
                        valor={csatMes != null ? percentual(csatMes) : '—'}
                        comparacao={dCsat == null ? null : { texto: `${seta(dCsat)} ${num(Math.abs(dCsat), 1)} pt`, melhor: dCsat >= 0, vs }}
                        barras={csatSemanas.map((s) => s && { v: s.valor, cor: BARRA[tomDoCsat(s.valor)] })} />,
      blocoVol: <Bloco rotulo="Meus atendimentos" nota="finalizados"
                       valor={volTotal ? num(volTotal) : '—'}
                       comparacao={dVol == null ? null : { texto: `${seta(dVol)} ${num(Math.abs(dVol * 100), 1)}%`, melhor: dVol >= 0, vs }}
                       barras={volSemanas.map((v) => v == null ? null : { v, cor: 'bg-marca-600' })} />,
      // TME: subir é piorar.
      blocoTme: <Bloco rotulo="Meu TME" nota="média"
                       valor={tmeMes != null ? tempo(tmeMes) : '—'}
                       comparacao={dTme == null ? null : { texto: `${seta(dTme)} ${tempo(Math.abs(dTme))}`, melhor: dTme <= 0, vs }}
                       barras={tmeSemanas.map((v, i) => v == null ? null : {
                         v, cor: (tmeEquipeSemana(i + 1) ?? Infinity) < v ? 'bg-amber-500' : 'bg-marca-600' })} />,

      detalheCsat: (
        <div className="grid items-start gap-4 xl:grid-cols-[1.3fr_1fr]">
          <Painel>
            <Secao titulo={`Seu C-SAT por semana · ${rotulo}`} subtitulo="Positivas sobre avaliações. Escala de 75% a 100%.">
              {csatMes == null ? <Vazio>Sem avaliações neste canal.</Vazio> : (
                <GraficoDeLinha min={0.75} max={1} formatar={percentual}
                                referencia={{ valor: META_CSAT, rotulo: 'meta 95%' }}
                                pontos={csatSemanas.map((s): PontoDaLinha => s && { valor: s.valor, tom: tomDoCsat(s.valor) })} />
              )}
            </Secao>
          </Painel>
          <Painel>
            <Secao titulo="Próximo degrau" subtitulo="A faixa do C-SAT é semanal e multiplica os seus finalizados.">
              {c === canalPrincipal && proximoDegrau != null && ganhoDoDegrau != null && ganhoDoDegrau > 0 && (
                <p className="mb-4 rounded-lg bg-marca-50 px-4 py-3 text-sm text-slate-800">
                  Subindo de <b className="text-marca-700 dark:text-marca-400">{percentual(csatPrincipal!)}</b> para{' '}
                  <b className="text-marca-700 dark:text-marca-400">{percentual(proximoDegrau)}</b>, cada atendimento
                  passa a valer mais: <b className="text-marca-700 dark:text-marca-400">+{num(ganhoDoDegrau)} pts</b> sobre
                  os seus {num(finalizadosPrincipal)} finalizados.
                </p>
              )}
              <ul className="divide-y divide-slate-100 text-sm">
                {csatSemanas.map((s, i) => (
                  <li key={i} className="flex justify-between py-1.5">
                    <span className="text-slate-600">{i + 1}ª semana</span>
                    <span className="tabular-nums text-slate-800">{s ? `${s.positivas} de ${s.avaliacoes}` : '—'}</span>
                  </li>
                ))}
              </ul>
              {csatEquipeMes != null && (
                <p className="mt-3 text-xs text-slate-500">C-SAT médio da equipe no mês: {percentual(csatEquipeMes)}.</p>
              )}
            </Secao>
          </Painel>
        </div>
      ),

      detalheVol: (
        <div className="grid items-start gap-4 xl:grid-cols-[1.3fr_1fr]">
          <Painel>
            <Secao titulo={`Seus atendimentos por semana · ${rotulo}`} subtitulo="Finalizados, com a sua média semanal como referência.">
              {!volTotal ? <Vazio>Nenhum volume lançado neste canal.</Vazio> : (
                <GraficoDeLinha formatar={(v) => num(v)}
                                referencia={volMediaSemanal != null ? { valor: volMediaSemanal, rotulo: `sua média ${num(volMediaSemanal)}` } : undefined}
                                pontos={volSemanas.map((v): PontoDaLinha => v == null ? null : { valor: v })} />
              )}
            </Secao>
          </Painel>
          <Painel>
            <Secao titulo="No mês" subtitulo="Comparado com você mesmo no mês anterior.">
              <ul className="divide-y divide-slate-100 text-sm">
                <li className="flex justify-between py-2"><span className="text-slate-600">{nomeDoMesMaiusculo(competencia)}</span><span className="font-semibold tabular-nums text-slate-900">{num(volTotal)}</span></li>
                <li className="flex justify-between py-2"><span className="text-slate-600">{nomeDoMesMaiusculo(anterior)}</span><span className="tabular-nums text-slate-800">{volAntes ? num(volAntes) : '—'}</span></li>
                {dVol != null && (
                  <li className="flex justify-between py-2"><span className="text-slate-600">Variação</span>
                    <span className={`font-semibold tabular-nums ${dVol >= 0 ? 'text-marca-700 dark:text-marca-400' : 'text-rose-700'}`}>
                      {seta(dVol)} {num(Math.abs(dVol * 100), 1)}%
                    </span></li>
                )}
              </ul>
              {pesoDoAtendimento > 0 && c === canalPrincipal && (
                <p className="mt-3 text-xs text-slate-500">Cada finalizado vale {num(pesoDoAtendimento, 2)} pts no seu cargo e ainda é a base da faixa de C-SAT.</p>
              )}
            </Secao>
          </Painel>
        </div>
      ),

      detalheTme: (
        <div className="grid items-start gap-4 xl:grid-cols-[1.3fr_1fr]">
          <Painel>
            <Secao titulo={`Seu TME por semana · ${rotulo}`} subtitulo="Âmbar nas semanas acima da média da equipe.">
              {tmeMes == null ? <Vazio>Nenhum tempo lançado neste canal.</Vazio> : (
                <GraficoDeLinha formatar={tempo}
                                referencia={tmeEquipeMes != null ? { valor: tmeEquipeMes, rotulo: `média da equipe ${tempo(tmeEquipeMes)}` } : undefined}
                                pontos={tmeSemanas.map((v, i): PontoDaLinha => v == null ? null
                                  : { valor: v, tom: (tmeEquipeSemana(i + 1) ?? Infinity) < v ? 'atencao' : 'bom' })} />
              )}
            </Secao>
          </Painel>
          <Painel>
            <Secao titulo="Como o TME conta" subtitulo="A faixa vem do TME médio da equipe e vale para todos.">
              {faixasTme.length === 0 ? <Vazio>O tempo não gera pontos neste canal.</Vazio> : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {faixasTme.map((f) => {
                    const p = peso.get(f.chave) ?? 0;
                    return (
                      <li key={f.chave} className="flex justify-between gap-3 py-2">
                        <span className="text-slate-600">{f.rotulo}</span>
                        <span className={`whitespace-nowrap font-semibold tabular-nums ${p > 0 ? 'text-marca-700 dark:text-marca-400' : p < 0 ? 'text-rose-700' : 'text-slate-500'}`}>
                          {p > 0 ? '+' : ''}{num(p, 2)} por atendimento
                        </span>
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

  const doCanal = (chave: string) => CANAIS.map(({ chave: c }) => <NoCanal key={c} canal={c}>{porCanal[c][chave]}</NoCanal>);

  // --------------------------------------------------- como chegar à meta
  const nomeCanalPrincipal = CANAIS.find((c) => c.chave === canalPrincipal)!.rotulo;
  const passos: { texto: React.ReactNode; tom: 'bom' | 'atencao' }[] = [];
  if (meta != null && falta != null && falta > 0) {
    passos.push({ tom: 'atencao', texto: <>Faltam <b>{num(falta)} pts</b></> });
    if (finalizadosQueFaltam != null) {
      passos.push({ tom: 'bom', texto: <>≈ <b>{num(finalizadosQueFaltam)} atendimentos</b> finalizados em {nomeCanalPrincipal}</> });
    }
    if (proximoDegrau != null && ganhoDoDegrau != null && ganhoDoDegrau > 0) {
      passos.push({ tom: 'bom', texto: <>ou subir o C-SAT para <b>{percentual(proximoDegrau)}</b>: <b>+{num(ganhoDoDegrau)} pts</b></> });
    }
  } else if (meta != null && falta != null) {
    passos.push({ tom: 'bom', texto: <><b>Meta atingida</b> — daqui em diante cada ponto continua contando para o valor do mês</> });
  }
  if (ultima && falhasDaUltima > 0) {
    passos.push({ tom: 'atencao', texto: <>Última monitoria: <b>{falhasDaUltima} critério{falhasDaUltima > 1 ? 's' : ''}</b> a melhorar</> });
  }

  const dResultado = resultadoAntes != null ? resultado - resultadoAntes : null;
  const bateu = meta != null && resultado >= meta;

  const destaques: Destaque[] = [
    {
      chave: 'meta',
      tom: meta != null && !bateu ? 'atencao' : 'normal',
      bloco: (
        <>
          <p className="text-sm text-slate-500">Minha meta</p>
          <p className={`text-[1.65rem] font-semibold leading-tight tracking-tight tabular-nums ${
            meta != null && !bateu ? 'text-amber-700' : 'text-slate-900'}`}>
            {num(resultado)}
            {meta != null && <span className="ml-1.5 text-xs font-normal tracking-normal text-slate-500">de {num(meta)} pts</span>}
          </p>
          {meta != null && (
            <div className="mt-2"><BarraDeMeta atingimento={resultado / meta} escala={Math.max(1.25, resultado / meta)} /></div>
          )}
          {dResultado != null && (
            <p className="mt-1 text-xs text-slate-500">
              <b className={`font-semibold ${dResultado >= 0 ? 'text-marca-700 dark:text-marca-400' : 'text-rose-700'}`}>
                {seta(dResultado)} {num(Math.abs(dResultado))} pts
              </b> {vs}
            </p>
          )}
          {projecao != null && meta != null && (
            <p className="mt-0.5 text-xs text-slate-600">
              Projeção: <b className={projecao >= meta ? 'text-marca-700 dark:text-marca-400' : 'text-amber-700'}>
                {num(projecao)}{projecao >= meta ? ' ✓' : ''}</b> no fim do ciclo
            </p>
          )}
        </>
      ),
      detalhe: (
        <div className="grid items-start gap-4 xl:grid-cols-[1.1fr_1fr_1fr]">
          <Painel>
            <Secao titulo="De onde vieram seus pontos" subtitulo="O que mais somou e o que tirou pontos no mês.">
              {!porRegra.length ? <Vazio>Nada lançado nesta competência.</Vazio> : (
                <ul className="space-y-2 text-sm">
                  {[...ganhos, ...perdas].map((r) => (
                    <li key={r.chave} className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 truncate text-slate-700">
                        {r.rotulo}<span className="ml-1.5 text-xs text-slate-400">{num(r.quantidade, 2)}×</span>
                      </span>
                      <span className={`font-semibold tabular-nums ${r.cota > 0 ? 'text-marca-700 dark:text-marca-400' : 'text-rose-700'}`}>
                        {r.cota > 0 ? '+' : ''}{num(r.cota, 1)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          </Painel>
          <Painel>
            <Secao titulo="Seus últimos meses" subtitulo="Pontos, meta e valor de cada mês fechado."
                   acao={<Link href="/cota/historico" className="text-xs text-marca-700 hover:underline dark:text-marca-400">ver histórico ›</Link>}>
              {historico.length === 0 ? <Vazio>Nenhum mês fechado ainda.</Vazio> : (
                <ul className="space-y-3 text-sm">
                  {historico.map((m) => {
                    const a = m.meta ? Number(m.resultado) / Number(m.meta) : null;
                    return (
                      <li key={m.mes_competencia} className="grid grid-cols-[5.5rem_1fr_6.5rem] items-center gap-3">
                        <span className="text-slate-600">{nomeDoMesMaiusculo(m.mes_competencia)}</span>
                        {a == null ? <span /> : (
                          <span className="relative h-2 overflow-hidden rounded-full bg-slate-100">
                            <span className={`crescer-x absolute inset-0 origin-left rounded-full ${a >= 1 ? 'bg-marca-600' : 'bg-amber-500'}`}
                                  style={{ transform: `scaleX(${Math.min(1, a / 1.6)})` }} />
                          </span>
                        )}
                        <span className="text-right tabular-nums">
                          {!m.atingiu_meta ? <span className="text-slate-500">abaixo da meta</span>
                            : m.valor == null ? <span className="text-slate-500">valor a definir</span>
                              : <span className="font-semibold text-marca-700 dark:text-marca-400">{reais(Number(m.valor))}</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Secao>
          </Painel>
          <Painel>
            <Secao titulo="Quanto vale cada coisa" subtitulo="Contas aproximadas, para dar direção — o valor real sai do extrato.">
              {valeQuanto.length === 0 ? <Vazio>Sem pesos definidos para o seu cargo.</Vazio> : (
                <ul className="space-y-2 text-sm">
                  {valeQuanto.map((v) => (
                    <li key={v.rotulo} className="flex justify-between gap-3">
                      <span className="text-slate-700">{v.rotulo}</span>
                      <span className={`font-semibold tabular-nums ${v.peso > 0 ? 'text-marca-700 dark:text-marca-400' : 'text-rose-700'}`}>
                        {v.peso > 0 ? '+' : ''}{num(v.peso, 2)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Secao>
          </Painel>
        </div>
      ),
    },
    { chave: 'csat', bloco: doCanal('blocoCsat'), detalhe: doCanal('detalheCsat') },
    { chave: 'vol', bloco: doCanal('blocoVol'), detalhe: doCanal('detalheVol') },
    { chave: 'tme', bloco: doCanal('blocoTme'), detalhe: doCanal('detalheTme') },
    {
      chave: 'monitoria',
      bloco: (
        <Bloco rotulo="Minha monitoria" nota="nota média"
               valor={notaMes != null ? percentual(notaMes) : '—'}
               comparacao={dNota == null ? null : { texto: `${seta(dNota)} ${num(Math.abs(dNota), 1)} pt`, melhor: dNota >= 0, vs }}
               rodape={`${doMes.length} monitoria${doMes.length === 1 ? '' : 's'} no mês`} />
      ),
      detalhe: (
        <div className="grid items-start gap-4 xl:grid-cols-[1.3fr_1fr]">
          <Painel>
            <Secao titulo="Suas monitorias" subtitulo="As mais recentes primeiro. O protocolo abre a monitoria completa.">
              {lista.length === 0 ? <Vazio>Nenhuma monitoria registrada.</Vazio> : (
                <ul className="-my-2 divide-y divide-slate-100">
                  {lista.slice(0, 8).map((m) => {
                    const falhas = apontamentos.get(m.id) ?? [];
                    return (
                      <li key={m.id} className="py-3">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <a href={`${ENDERECO_MONITORIAS}/monitorias/${m.id}`} target="_blank" rel="noreferrer"
                             className="font-semibold tabular-nums text-marca-700 hover:underline dark:text-marca-400">
                            {m.protocolo}
                          </a>
                          <span className="tabular-nums text-slate-400/70">{codigoMonitoria(m.codigo)}</span>
                          <span className="tabular-nums text-slate-500">{formatarData(m.data_atendimento)} · {m.semana_mes}ª semana</span>
                          <span className="ml-auto"><EtiquetaNota valor={Number(m.nota_final)} zerado={m.zerado} /></span>
                        </div>
                        {falhas.length > 0 ? (
                          <ul className="mt-1.5 space-y-0.5 text-sm text-slate-600">
                            {falhas.map((f) => (
                              <li key={f.criterio}>
                                <span className="text-rose-600">✕</span> {f.criterio}
                                {f.observacao && <span className="text-slate-500"> — {f.observacao}</span>}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1.5 text-sm text-marca-700 dark:text-marca-400">Todos os critérios atendidos.</p>
                        )}
                        {m.parecer && <p className="mt-1 text-xs italic text-slate-500">{m.parecer}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Secao>
          </Painel>
          <Painel>
            <Secao titulo="O que mais aparece" subtitulo="Critérios que você deixou de cumprir no mês.">
              {recorrentes.length === 0 ? <Vazio>Nenhum critério reprovado neste mês.</Vazio> : (
                <ul className="divide-y divide-slate-100 text-sm">
                  {recorrentes.map(([criterio, vezes]) => (
                    <li key={criterio} className="flex justify-between gap-3 py-2">
                      <span className="text-slate-700">{criterio}</span>
                      <span className="whitespace-nowrap tabular-nums text-slate-500">{vezes} {vezes === 1 ? 'vez' : 'vezes'}</span>
                    </li>
                  ))}
                </ul>
              )}
              {notaMes != null && (
                <p className={`mt-3 text-xs ${tomDaNota(notaMes) === 'bom' ? 'text-slate-500' : 'text-amber-700'}`}>
                  A monitoria só pontua com média a partir de 85%.
                </p>
              )}
            </Secao>
          </Painel>
        </div>
      ),
    },
  ];

  return (
    <ProvedorDeCanal inicial={canalInicial}>
      <div className="space-y-6">
        {topo}
        <div className="space-y-4">
          {/* Como chegar à meta: direção, não cobrança. */}
          {passos.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm font-semibold text-sobre-fundo">
                {falta != null && falta > 0 ? 'Como chegar à meta' : 'Seu mês'}
              </span>
              {passos.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-2 rounded-xl bg-superficie px-3 py-1.5 text-sm text-slate-800 shadow-sm">
                  <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${p.tom === 'atencao' ? 'bg-amber-500' : 'bg-marca-600'}`} />
                  {p.texto}
                </span>
              ))}
            </div>
          )}
          <SeletorDeDetalhe destaques={destaques} />
        </div>
      </div>
    </ProvedorDeCanal>
  );
}

/** Rótulo, valor grande, comparação com o mês anterior e as quatro semanas em barras. */
function Bloco({ rotulo, valor, nota, comparacao, rodape, barras, min = 0, max }: {
  rotulo: string; valor: string; nota?: string;
  comparacao?: { texto: string; melhor: boolean; vs: string } | null;
  rodape?: string;
  barras?: ({ v: number; cor: string } | null)[]; min?: number; max?: number;
}) {
  const teto = max ?? Math.max(1, ...(barras ?? []).map((b) => b?.v ?? 0));
  const fracao = (v: number) => Math.max(0.04, Math.min(1, (v - min) / (teto - min)));
  return (
    <>
      <p className="text-sm text-slate-500">{rotulo}</p>
      <p className="text-[1.65rem] font-semibold leading-tight tracking-tight tabular-nums text-slate-900">
        {valor}{nota && <span className="ml-1.5 text-xs font-normal tracking-normal text-slate-500">{nota}</span>}
      </p>
      {comparacao && (
        <p className="mt-0.5 text-xs text-slate-500">
          <b className={`font-semibold ${comparacao.melhor ? 'text-marca-700 dark:text-marca-400' : 'text-rose-700'}`}>{comparacao.texto}</b> {comparacao.vs}
        </p>
      )}
      {rodape && <p className="mt-0.5 text-xs text-slate-500">{rodape}</p>}
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
}
