import AlternadorCanal from '@/componentes/AlternadorCanal';
import AlternadorDeVisao from '@/componentes/AlternadorDeVisao';
import GraficoSemanal from '@/componentes/GraficoSemanal';
import GraficoCsat, { type PontoCsat } from '@/componentes/GraficoCsat';
import Link from '@/componentes/Link';
import { Cartao, Vazio } from '@/componentes/ui';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { corDoCsat, mesRotulo, percentual } from '@/lib/formatar';

type Canal = 'huggy' | 'diretores';
const CANAIS: { chave: Canal; rotulo: string }[] = [
  { chave: 'huggy', rotulo: 'Expansão' },
  { chave: 'diretores', rotulo: 'Diretores-Expansão' },
];
const META_CSAT = 0.95;
/** Faixas de C-SAT na ordem em que se sobe. */
const DEGRAUS_CSAT = [0.80, 0.85, 0.90, 0.95];

type CsatSemana = { origem: Canal; semana: number; avaliacoes: number; positivas: number };
type Volume = { canal: Canal; semana: number; finalizados: number; tme_seg: number | null };
type LinhaExtrato = {
  semana: number | null; origem: Canal | null; regra: string; rotulo: string;
  grupo: string; cargo_id: number; quantidade: number; peso: number; cota: number;
};
type Pagamento = {
  mes_competencia: string; resultado: number; meta: number | null;
  atingiu_meta: boolean; valor: number | null;
};

const num = (v: number, casas = 0) =>
  Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas });
const reais = (v: number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Segundos → "12:34" ou "1h02". */
function tempo(seg: number) {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = Math.round(seg % 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * A competência da própria pessoa, nos mesmos quadros da tela do gestor.
 *
 * A tela do gestor responde "como está a equipe". Esta responde três outras
 * perguntas, nesta ordem: quanto eu tenho, de onde veio e o que falta fazer.
 * A terceira é a que não existia em lugar nenhum — ninguém calcula de cabeça
 * quantos atendimentos faltam para a meta, nem quanto vale subir uma faixa de
 * C-SAT.
 *
 * Nada aqui mostra colega: da equipe, só a média agregada, que é o que a
 * função `csat_da_equipe` devolve.
 */
export default async function PainelAtendente({
  pessoaId, competencia, canalPedido,
}: {
  pessoaId: string;
  competencia: string;
  /** Canal vindo da URL; sem ele, abre no canal em que a pessoa mais atende. */
  canalPedido?: string;
}) {
  const db = await criarClienteServidor();

  const equipe = Promise.all(CANAIS.flatMap(({ chave }) => [1, 2, 3, 4].map((semana) =>
    db.rpc('csat_da_equipe', { p_mes: competencia, p_semana: semana, p_origem: chave }))));

  const [csat, volume, extrato, fechados, pesos, csatEquipe] = await Promise.all([
    db.from('vw_csat_semanal').select('origem, semana, avaliacoes, positivas')
      .eq('pessoa_id', pessoaId).eq('mes_competencia', competencia),
    db.from('volume_semanal').select('canal, semana, finalizados, tme_seg')
      .eq('pessoa_id', pessoaId).eq('mes_competencia', competencia),
    db.from('vw_extrato_cota')
      .select('semana, origem, regra, rotulo, grupo, cargo_id, quantidade, peso, cota')
      .eq('pessoa_id', pessoaId).eq('mes_competencia', competencia),
    db.from('vw_pagamento_mensal').select('mes_competencia, resultado, meta, atingiu_meta, valor')
      .eq('pessoa_id', pessoaId).order('mes_competencia', { ascending: false }).limit(3),
    // A tabela inteira de pesos é pequena e vem numa consulta só; o cargo da
    // pessoa sai do próprio extrato, logo abaixo.
    db.from('pesos_por_cargo').select('cargo_id, regra, peso').eq('ativo', true),
    equipe,
  ]);

  const semanasCsat = (csat.data ?? []) as CsatSemana[];
  const volumes = (volume.data ?? []) as Volume[];
  const linhas = (extrato.data ?? []) as LinhaExtrato[];
  const historico = (fechados.data ?? []) as Pagamento[];
  const cargoId = linhas[0]?.cargo_id;
  const peso = new Map(((pesos.data ?? []) as { cargo_id: number; regra: string; peso: number }[])
    .filter((p) => p.cargo_id === cargoId)
    .map((p) => [p.regra, Number(p.peso)]));

  const avaliacoesDo = (c: Canal) => semanasCsat.filter((s) => s.origem === c)
    .reduce((a, s) => a + s.avaliacoes, 0);
  const canalInicial: Canal = CANAIS.some((c) => c.chave === canalPedido)
    ? canalPedido as Canal
    : avaliacoesDo('diretores') > avaliacoesDo('huggy') ? 'diretores' : 'huggy';

  const resultado = linhas.reduce((a, l) => a + Number(l.cota), 0);
  const meta = peso.get('meta') ?? null;

  // ---------------------------------------------------------------- quadros
  const quadros = (canal: Canal) => {
    const rotulo = CANAIS.find((c) => c.chave === canal)!.rotulo;
    const doCanal = semanasCsat.filter((s) => s.origem === canal);
    const volCanal = volumes.filter((v) => v.canal === canal);
    const linhasCanal = linhas.filter((l) => l.origem === canal);
    const indice = CANAIS.findIndex((x) => x.chave === canal);

    const totalAval = doCanal.reduce((a, s) => a + s.avaliacoes, 0);
    const csatMes = totalAval
      ? doCanal.reduce((a, s) => a + s.positivas, 0) / totalAval : null;

    const pontosCsat: PontoCsat[] = [1, 2, 3, 4].map((n, i) => {
      const s = doCanal.find((x) => x.semana === n);
      const eq = csatEquipe[indice * 4 + i].data;
      return {
        semana: n,
        pessoa: s && s.avaliacoes ? s.positivas / s.avaliacoes : null,
        equipe: eq == null ? null : Number(eq),
      };
    });

    /** Pontos de um grupo de regras na semana. */
    const cotaDo = (grupo: (l: LinhaExtrato) => boolean, semana: number) =>
      linhasCanal.filter((l) => grupo(l) && l.semana === semana)
        .reduce((a, l) => a + Number(l.cota), 0);

    const regraAtendimento = canal === 'huggy' ? 'huggy_atendimento' : 'diretores_atendimento';
    const pesoAtendimento = peso.get(regraAtendimento) ?? 0;

    const finalizadosMes = volCanal.reduce((a, v) => a + v.finalizados, 0);
    const pontosCsatMes = linhasCanal.filter((l) => l.grupo === 'csat')
      .reduce((a, l) => a + Number(l.cota), 0);
    const pontosVolumeMes = linhasCanal.filter((l) => l.regra === regraAtendimento)
      .reduce((a, l) => a + Number(l.cota), 0);
    const pontosTmeMes = linhasCanal.filter((l) => l.grupo.startsWith('tme'))
      .reduce((a, l) => a + Number(l.cota), 0);

    const semNada = !totalAval && !volCanal.length;
    if (semNada) return <Vazio>Nada registrado neste canal.</Vazio>;

    return (
      <div className="grid gap-6 lg:grid-cols-3">
        {/* C-SAT */}
        <Cartao
          titulo={`C-SAT · ${rotulo}`}
          acao={csatMes != null && (
            <span className={`text-lg font-semibold tabular-nums ${corDoCsat(csatMes)}`}>
              {percentual(csatMes)}
            </span>
          )}
        >
          {totalAval === 0 ? <Vazio>Sem avaliações neste canal.</Vazio> : (
            <AlternadorDeVisao
              rotulos={['Por semana', 'No mês']}
              paineis={[
                <div key="s" className="space-y-3">
                  <GraficoCsat pontos={pontosCsat} meta={META_CSAT} />
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                        <th className="py-1 font-semibold">Semana</th>
                        <th className="py-1 text-right font-semibold">C-SAT</th>
                        <th className="py-1 text-right font-semibold">Avaliações</th>
                        <th className="py-1 text-right font-semibold">Pontos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[1, 2, 3, 4].map((s) => {
                        const linha = doCanal.find((x) => x.semana === s);
                        const v = linha && linha.avaliacoes
                          ? linha.positivas / linha.avaliacoes : null;
                        const p = cotaDo((l) => l.grupo === 'csat', s);
                        return (
                          <tr key={s} className="border-t border-slate-100">
                            <td className="py-1 text-slate-700">{s}ª</td>
                            <td className={`py-1 text-right font-semibold tabular-nums ${corDoCsat(v)}`}>
                              {v == null ? '—' : percentual(v)}
                            </td>
                            <td className="py-1 text-right tabular-nums text-slate-500">
                              {linha ? `${linha.positivas} de ${linha.avaliacoes}` : '—'}
                            </td>
                            <td className={`py-1 text-right font-semibold tabular-nums ${
                              p < 0 ? 'text-rose-700' : 'text-slate-800'}`}>
                              {p ? num(p, 2) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>,
                <div key="m" className="space-y-2 text-sm">
                  <p className="text-slate-600">
                    {doCanal.reduce((a, s) => a + s.positivas, 0)} avaliações positivas de{' '}
                    {totalAval} no mês.
                  </p>
                  <p className="text-slate-600">
                    A faixa do seu C-SAT multiplica os seus finalizados do canal. Neste mês
                    isso deu{' '}
                    <strong className={pontosCsatMes < 0 ? 'text-rose-700' : 'text-slate-900'}>
                      {num(pontosCsatMes, 2)} pts
                    </strong>.
                  </p>
                  <p className="text-xs text-slate-500">
                    A faixa é semanal: cada semana cai na sua própria faixa, e é por isso que
                    o total do mês não é a média das semanas.
                  </p>
                </div>,
              ]}
            />
          )}
        </Cartao>

        {/* Volume */}
        <Cartao
          titulo={`Atendimentos · ${rotulo}`}
          acao={<span className="text-lg font-semibold tabular-nums text-slate-900">
            {num(finalizadosMes)}
          </span>}
        >
          {!volCanal.length ? <Vazio>Nenhum volume lançado neste canal.</Vazio> : (
            <AlternadorDeVisao
              rotulos={['Por semana', 'No mês']}
              paineis={[
                <GraficoSemanal
                  key="s"
                  valores={[1, 2, 3, 4].map((s) =>
                    volCanal.find((v) => v.semana === s)?.finalizados ?? null)}
                  formatar={(v) => num(v)}
                  cor="bg-marca-600"
                />,
                <div key="m" className="space-y-2 text-sm text-slate-600">
                  <p>
                    {num(finalizadosMes)} finalizados × {num(pesoAtendimento, 2)} pts ={' '}
                    <strong className="text-slate-900">{num(pontosVolumeMes, 2)} pts</strong>.
                  </p>
                  <p className="text-xs text-slate-500">
                    Cada atendimento finalizado vale {num(pesoAtendimento, 2)} pontos no seu
                    cargo, e ainda serve de base para a faixa de C-SAT.
                  </p>
                </div>,
              ]}
            />
          )}
        </Cartao>

        {/* TME */}
        <Cartao titulo={`TME · ${rotulo}`}>
          {!volCanal.some((v) => (v.tme_seg ?? 0) > 0)
            ? <Vazio>Nenhum tempo lançado neste canal.</Vazio> : (
            <AlternadorDeVisao
              rotulos={['Por semana', 'No mês']}
              paineis={[
                <GraficoSemanal
                  key="s"
                  valores={[1, 2, 3, 4].map((s) => {
                    const v = volCanal.find((x) => x.semana === s);
                    return v && (v.tme_seg ?? 0) > 0 ? v.tme_seg! : null;
                  })}
                  formatar={(v) => tempo(v)}
                  referencias={canal === 'diretores'
                    ? [{ valor: 900, rotulo: '15 min' }, { valor: 1800, rotulo: '30 min' }] : []}
                  cor="bg-sky-500"
                />,
                <div key="m" className="space-y-2 text-sm text-slate-600">
                  <p>
                    {pontosTmeMes
                      ? <>O tempo rendeu <strong className={pontosTmeMes < 0 ? 'text-rose-700' : 'text-slate-900'}>
                          {num(pontosTmeMes, 2)} pts</strong> neste mês.</>
                      : 'O tempo não gera pontos neste canal.'}
                  </p>
                  <p className="text-xs text-slate-500">
                    A faixa de TME é da <strong>equipe</strong>, não sua: o tempo médio do canal
                    na semana decide a faixa, e ela é aplicada aos seus finalizados.
                  </p>
                </div>,
              ]}
            />
          )}
        </Cartao>
      </div>
    );
  };

  // ------------------------------------------------- ganhos e perdas do mês
  const porRegra = [...new Map(linhas.map((l) => [l.regra + (l.origem ?? ''), l])).values()]
    .map((base) => {
      const iguais = linhas.filter((l) => l.regra === base.regra && l.origem === base.origem);
      return {
        chave: base.regra + (base.origem ?? ''),
        rotulo: base.rotulo,
        canal: base.origem,
        quantidade: iguais.reduce((a, l) => a + Number(l.quantidade), 0),
        cota: iguais.reduce((a, l) => a + Number(l.cota), 0),
      };
    });
  const ganhos = porRegra.filter((r) => r.cota > 0).sort((a, b) => b.cota - a.cota).slice(0, 6);
  const perdas = porRegra.filter((r) => r.cota < 0).sort((a, b) => a.cota - b.cota);

  // ------------------------------------------------------------ quanto falta
  const falta = meta != null ? meta - resultado : null;
  const canalPrincipal: Canal = volumes.filter((v) => v.canal === 'diretores')
    .reduce((a, v) => a + v.finalizados, 0)
    > volumes.filter((v) => v.canal === 'huggy').reduce((a, v) => a + v.finalizados, 0)
    ? 'diretores' : 'huggy';
  const pesoDoAtendimento = peso.get(
    canalPrincipal === 'huggy' ? 'huggy_atendimento' : 'diretores_atendimento') ?? 0;
  const finalizadosQueFaltam = falta != null && falta > 0 && pesoDoAtendimento > 0
    ? Math.ceil(falta / pesoDoAtendimento) : null;

  // O próximo degrau de C-SAT e o que ele acrescentaria, no canal principal.
  const doPrincipal = semanasCsat.filter((s) => s.origem === canalPrincipal);
  const avalPrincipal = doPrincipal.reduce((a, s) => a + s.avaliacoes, 0);
  const csatPrincipal = avalPrincipal
    ? doPrincipal.reduce((a, s) => a + s.positivas, 0) / avalPrincipal : null;
  const proximoDegrau = csatPrincipal != null
    ? DEGRAUS_CSAT.find((d) => d > csatPrincipal) ?? null : null;
  const faixaDe = (v: number) => (v >= 0.95 ? 'csat_95' : v >= 0.90 ? 'csat_90_95'
    : v >= 0.85 ? 'csat_85_90' : v >= 0.80 ? 'csat_80_85' : 'csat_abaixo_80');
  const finalizadosPrincipal = volumes.filter((v) => v.canal === canalPrincipal)
    .reduce((a, v) => a + v.finalizados, 0);
  const ganhoDoDegrau = csatPrincipal != null && proximoDegrau != null
    ? ((peso.get(faixaDe(proximoDegrau)) ?? 0) - (peso.get(faixaDe(csatPrincipal)) ?? 0))
      * finalizadosPrincipal
    : null;

  return (
    <div className="space-y-6">
      <AlternadorCanal
        inicial={canalInicial}
        paineis={{ huggy: quadros('huggy'), diretores: quadros('diretores') }}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Ganhos e perdas */}
        <Cartao titulo="De onde vieram seus pontos" className="lg:col-span-2">
          {!porRegra.length ? <Vazio>Nada lançado nesta competência.</Vazio> : (
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  O que mais somou
                </p>
                <ul className="space-y-1.5 text-xs">
                  {ganhos.map((g) => (
                    <li key={g.chave} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-slate-700">
                        {g.rotulo}
                        <span className="ml-1 text-slate-400">
                          {num(g.quantidade, 2)}×
                        </span>
                      </span>
                      <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
                        +{num(g.cota, 2)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  O que tirou pontos
                </p>
                {!perdas.length ? (
                  <p className="text-xs text-slate-500">Nada tirou pontos neste mês.</p>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    {perdas.map((p) => (
                      <li key={p.chave} className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-slate-700">
                          {p.rotulo}
                          <span className="ml-1 text-slate-400">{num(p.quantidade, 2)}×</span>
                        </span>
                        <span className="font-semibold tabular-nums text-rose-700 dark:text-rose-300">
                          {num(p.cota, 2)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Cartao>

        {/* Quanto falta */}
        <Cartao titulo="Quanto falta">
          {meta == null ? <Vazio>Sem meta definida para o seu cargo.</Vazio>
            : falta != null && falta <= 0 ? (
              <div className="space-y-2">
                <p className="text-2xl font-semibold text-emerald-700 dark:text-emerald-300">
                  Meta atingida
                </p>
                <p className="text-sm text-slate-600">
                  {num(resultado)} de {num(meta)} pts · {percentual(resultado / meta)}
                </p>
                <p className="text-xs text-slate-500">
                  Daqui em diante cada ponto continua contando para o valor do mês.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-2xl font-semibold tabular-nums text-slate-900">
                  {num(falta!)} <span className="text-base font-normal text-slate-500">pts</span>
                </p>
                <ul className="space-y-1.5 text-sm text-slate-600">
                  {finalizadosQueFaltam != null && (
                    <li>
                      ≈ <strong className="text-slate-800">{num(finalizadosQueFaltam)}</strong>{' '}
                      atendimentos finalizados em{' '}
                      {CANAIS.find((c) => c.chave === canalPrincipal)!.rotulo}
                    </li>
                  )}
                  {proximoDegrau != null && ganhoDoDegrau != null && ganhoDoDegrau > 0 && (
                    <li>
                      ou subir o C-SAT de {percentual(csatPrincipal!)} para{' '}
                      {percentual(proximoDegrau)}: <strong className="text-slate-800">
                        +{num(ganhoDoDegrau)} pts
                      </strong>{' '}
                      sobre os seus {num(finalizadosPrincipal)} finalizados
                    </li>
                  )}
                </ul>
                <p className="text-xs text-slate-500">
                  Contas aproximadas, para dar direção — o valor real sai do extrato.
                </p>
              </div>
            )}
        </Cartao>
      </div>

      {/* Histórico curto */}
      {historico.length > 0 && (
        <Cartao
          titulo="Meses fechados"
          acao={<Link href="/cota/historico"
                      className="text-xs text-marca-700 hover:underline dark:text-marca-400">
            ver histórico
          </Link>}
        >
          <ul className="grid gap-3 sm:grid-cols-3">
            {historico.map((m) => (
              <li key={m.mes_competencia}
                  className="rounded-lg px-3 py-2 ring-1 ring-slate-200">
                <p className="text-xs text-slate-500">{mesRotulo(m.mes_competencia)}</p>
                <p className="text-lg font-semibold tabular-nums text-slate-900">
                  {num(Number(m.resultado))} <span className="text-xs font-normal text-slate-500">pts</span>
                </p>
                <p className="text-xs">
                  {!m.atingiu_meta
                    ? <span className="text-slate-500">abaixo da meta</span>
                    : m.valor == null
                      ? <span className="text-slate-500">valor a definir</span>
                      : <span className="font-semibold text-marca-700 dark:text-marca-400">
                          {reais(Number(m.valor))}
                        </span>}
                </p>
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </div>
  );
}
