import Link from '@/componentes/Link';
import { BarraDeMeta, Quadro } from '@/componentes/ui';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { mesRotulo } from '@/lib/formatar';
import { REGRA_MEDIA, REGRA_META } from '@/lib/tipos';

const num = (v: number, casas = 0) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas });
const nomeCurto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');
/** "Rinaldo da Rocha Nunes" → "Rinaldo Nunes": primeiro e último nome. */
const primeiroEUltimo = (nome: string) => {
  const p = nome.trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p.at(-1)}` : p[0];
};
const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

type Linha = { semana: number | null; regra: string; rotulo: string; quantidade: number; peso: number; cota: number };

/**
 * A cota de quem recebe pela média de outros cargos (1.21.0) — o Pleno.
 *
 * A tela do operador fala em atendimentos, C-SAT e TME da própria pessoa, e
 * nada disso compõe a cota de um Pleno: ela vem da média dos Juniores
 * multiplicada, mais as demandas lançadas (presencial, chamados, SLA). Aqui a
 * conta aparece aberta, com as demandas do mês e os Juniores que formam a
 * média — quem puxa para cima e quem precisa de apoio.
 *
 * Mês fechado mostra o que foi congelado no fechamento, como o extrato.
 */
export default async function PainelPleno({
  pessoaId, cargoId, competencia,
}: {
  pessoaId: string;
  cargoId: number;
  competencia: string;
}) {
  const db = await criarClienteServidor();
  const [cota, fechamento, extrato, pesos, regras, referencias, cargos, presenciais] = await Promise.all([
    db.from('vw_cota_mensal').select('resultado, meta').eq('pessoa_id', pessoaId).eq('mes_competencia', competencia).maybeSingle(),
    db.from('fechamentos_cota').select('id, resultado, meta').eq('pessoa_id', pessoaId).eq('mes_competencia', competencia).maybeSingle(),
    db.from('vw_extrato_cota').select('semana, regra, rotulo, quantidade, peso, cota')
      .eq('pessoa_id', pessoaId).eq('mes_competencia', competencia),
    db.from('pesos_por_cargo').select('regra, peso').eq('cargo_id', cargoId).eq('ativo', true),
    db.from('regras').select('chave, rotulo, manual, valor_manual, ordem').eq('ativo', true).order('ordem'),
    db.from('cargos_referencia').select('referencia_id').eq('cargo_id', cargoId),
    db.from('cargos').select('id, nome'),
    db.from('vw_presenciais').select('data, cliente_nome, demanda')
      .eq('pessoa_id', pessoaId).eq('mes_competencia', competencia).order('data', { ascending: false }).limit(3),
  ]);

  const congelado = fechamento.data as { id: string; resultado: number; meta: number | null } | null;
  const { data: linhasFechadas } = congelado
    ? await db.from('fechamento_linhas').select('semana, regra, rotulo, quantidade, peso, cota').eq('fechamento_id', congelado.id)
    : { data: null };
  const linhas = ((linhasFechadas ?? extrato.data ?? []) as Linha[])
    .map((l) => ({ ...l, quantidade: Number(l.quantidade), peso: Number(l.peso), cota: Number(l.cota) }));

  const resultado = congelado ? Number(congelado.resultado) : cota.data ? Number(cota.data.resultado) : null;
  const meta = congelado?.meta != null ? Number(congelado.meta)
    : cota.data?.meta != null ? Number(cota.data.meta)
      : Number((pesos.data ?? []).find((p) => p.regra === REGRA_META)?.peso ?? 0) || null;

  const media = linhas.find((l) => l.regra === REGRA_MEDIA);
  const multiplicador = Number((pesos.data ?? []).find((p) => p.regra === REGRA_MEDIA)?.peso ?? media?.peso ?? 1);
  const demandasLinhas = linhas.filter((l) => l.regra !== REGRA_MEDIA);
  const somaDemandas = demandasLinhas.reduce((a, l) => a + l.cota, 0);

  // Demandas: o que aconteceu no mês, somado por regra, e as que pontuam para
  // cima no cargo e ainda não aconteceram, em cinza — o que ela pode buscar.
  const pesoDe = new Map((pesos.data ?? []).map((p) => [p.regra as string, Number(p.peso)]));
  const manuais = ((regras.data ?? []) as { chave: string; rotulo: string; manual: boolean; valor_manual: boolean; ordem: number }[])
    .filter((r) => r.manual && pesoDe.has(r.chave) && r.chave !== REGRA_META && r.chave !== REGRA_MEDIA);
  const demandas = manuais.map((r) => {
    const doMes = demandasLinhas.filter((l) => l.regra === r.chave);
    return {
      chave: r.chave, rotulo: r.rotulo, valorManual: r.valor_manual, peso: pesoDe.get(r.chave) ?? 0,
      quantidade: doMes.reduce((a, l) => a + l.quantidade, 0),
      cota: doMes.reduce((a, l) => a + l.cota, 0),
      semanas: [...new Set(doMes.map((l) => l.semana).filter((s): s is number => s != null))].sort(),
    };
  }).filter((d) => d.quantidade || d.cota || (d.peso > 0 && !d.valorManual));

  // Os cargos que formam a média e quem, neles, compôs a média do mês.
  const nomeCargo = new Map(((cargos.data ?? []) as { id: number; nome: string }[]).map((c) => [c.id, c.nome]));
  const nomesReferencia = ((referencias.data ?? []) as { referencia_id: number }[])
    .map((r) => nomeCargo.get(r.referencia_id)).filter(Boolean) as string[];
  const { data: daEquipe } = nomesReferencia.length
    ? await db.from('vw_cota_mensal').select('pessoa_id, pessoa, cargo, resultado, compoe_media')
      .eq('mes_competencia', competencia).in('cargo', nomesReferencia)
    : { data: [] };
  const composicao = ((daEquipe ?? []) as { pessoa_id: string; pessoa: string; resultado: number; compoe_media: boolean }[])
    .filter((p) => p.compoe_media)
    .map((p) => ({ ...p, resultado: Number(p.resultado) }))
    .sort((a, b) => b.resultado - a.resultado);
  const escala = Math.max(meta ?? 0, ...composicao.map((p) => p.resultado), 1) * 1.05;
  const referenciaNome = nomesReferencia.map((n) => n.replace(/^Atendente\s+/, '')).join(' e ');
  const plural = referenciaNome === 'Júnior' ? 'Juniores' : referenciaNome;
  const rotuloMedia = `Média dos ${plural}`;

  return (
    <div className="space-y-4">
      <h2 className="pt-1 text-base font-semibold text-sobre-fundo">
        Minha cota <span className="ml-2 text-xs font-normal text-sobre-fundo-suave">o resultado e a conta que leva até ele</span>
      </h2>

      <Quadro>
        {resultado == null ? (
          <p className="text-sm text-slate-600">Nada calculado para {mesRotulo(competencia)} ainda.</p>
        ) : (
          <div className="grid items-center gap-x-10 gap-y-6 tabular-nums lg:grid-cols-[1.1fr_1.5fr_1fr]">
            <div>
              <p className="text-sm text-slate-500">Resultado de {mesRotulo(competencia).split('/')[0].toLowerCase()}</p>
              <p className="text-4xl font-semibold tracking-tight text-slate-900">
                {num(resultado)} <span className="text-base font-normal text-slate-500">pts</span>
              </p>
              {meta != null && (
                <>
                  <div className="mt-3"><BarraDeMeta atingimento={resultado / meta} escala={Math.max(1.25, resultado / meta)} /></div>
                  <p className="mt-2 text-sm text-slate-600">
                    Meta de {num(meta)}
                    {resultado >= meta
                      ? <> · <strong className="text-marca-700 dark:text-marca-400">{num(resultado - meta)} acima</strong></>
                      : <> · <strong className="text-amber-700 dark:text-amber-300">faltam {num(meta - resultado)}</strong></>}
                    {' '}· {num((resultado / meta) * 100)}%
                  </p>
                </>
              )}
            </div>

            <dl className="grid gap-2 text-sm">
              {media && (
                <>
                  <div className="flex justify-between gap-3"><dt className="text-slate-600">{rotuloMedia} no mês</dt><dd className="font-semibold">{num(media.quantidade)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-600">× {num(multiplicador, 2)} do seu cargo</dt><dd className="font-semibold">{num(media.cota)}</dd></div>
                </>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-slate-600">{somaDemandas >= 0 ? '+' : '−'} Suas demandas</dt>
                <dd className="font-semibold">{num(Math.abs(somaDemandas))}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-slate-200 pt-2">
                <dt className="text-slate-600">Total</dt>
                <dd className="text-base font-semibold text-marca-700 dark:text-marca-400">{num(resultado)} pts</dd>
              </div>
            </dl>

            <p className="text-[13px] leading-relaxed text-slate-500">
              A maior parte vem da <strong className="text-slate-700">{rotuloMedia.toLowerCase()}</strong>: quando a equipe
              sobe, você sobe junto. Cada <strong className="text-slate-700">100 pts</strong> a mais na média viram{' '}
              <strong className="text-slate-700">{num(100 * multiplicador)}</strong> para você.
              <span className="mt-2 block">{congelado ? 'Competência fechada: valores congelados no fechamento.' : 'O valor sai no fechamento.'}</span>
            </p>
          </div>
        )}
      </Quadro>

      <div className="grid items-start gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Quadro titulo="Minhas demandas no mês" subtitulo="O que você registrou ou foi lançado para você."
                acao={<Link href="/cota/presencial" className="whitespace-nowrap text-sm font-semibold text-marca-700 hover:underline dark:text-marca-400">
                  Registrar presencial ›
                </Link>}>
          {demandas.length === 0 ? (
            <p className="text-sm text-slate-500">Nenhuma demanda com pontuação no seu cargo.</p>
          ) : (
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="border-b border-slate-200 pb-1.5 font-medium">Demanda</th>
                  <th className="border-b border-slate-200 pb-1.5 text-right font-medium">Quantidade</th>
                  <th className="border-b border-slate-200 pb-1.5 text-right font-medium">Vale</th>
                  <th className="border-b border-slate-200 pb-1.5 text-right font-medium">Pontos</th>
                </tr>
              </thead>
              <tbody>
                {demandas.map((d) => {
                  const feita = d.quantidade > 0 || d.cota !== 0;
                  return (
                    <tr key={d.chave} className={feita ? 'text-slate-700' : 'text-slate-400'}>
                      <td className="border-b border-slate-100 py-2">
                        {d.rotulo}
                        {d.semanas.length > 0 && (
                          <span className="ml-2 rounded-md bg-slate-100 px-1.5 py-px text-xs text-slate-600">
                            {d.semanas.map((s) => `${s}ª`).join(' e ')} semana
                          </span>
                        )}
                      </td>
                      <td className="border-b border-slate-100 py-2 text-right">{feita ? num(d.quantidade, 2) : '—'}</td>
                      <td className="border-b border-slate-100 py-2 text-right">{d.valorManual ? 'digitado' : num(d.peso, 2)}</td>
                      <td className={`border-b border-slate-100 py-2 text-right font-semibold ${!feita ? ''
                        : d.cota < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-marca-700 dark:text-marca-400'}`}>
                        {feita ? `${d.cota > 0 ? '+' : d.cota < 0 ? '−' : ''}${num(Math.abs(d.cota), 2)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {(presenciais.data ?? []).length > 0 && (
            <p className="mt-3 text-[13px] leading-relaxed text-slate-500">
              Últimos presenciais:{' '}
              {((presenciais.data ?? []) as { data: string; cliente_nome: string; demanda: string }[])
                .map((p) => `${dia(p.data)} · ${primeiroEUltimo(p.cliente_nome)}, ${p.demanda}`).join(' · ')}
              {' '}<Link href={`/cota/presencial?mes=${competencia.slice(0, 7)}`} className="font-semibold text-marca-700 hover:underline dark:text-marca-400">ver todos ›</Link>
            </p>
          )}
        </Quadro>

        <Quadro titulo="De onde vem a sua média"
                subtitulo={`Os ${plural} de ${mesRotulo(competencia).split('/')[0].toLowerCase()}: quem puxa a média para cima e quem precisa de apoio.`}>
          {composicao.length === 0 ? (
            <p className="text-sm text-slate-500">Ninguém compôs a média neste mês ainda.</p>
          ) : (
            <ul className="grid gap-2.5 tabular-nums">
              {composicao.map((p) => {
                const tom = meta == null || p.resultado >= meta ? 'bg-marca-600'
                  : p.resultado >= meta * 0.9 ? 'bg-amber-500' : 'bg-rose-500';
                return (
                  <li key={p.pessoa_id}>
                    <Link href={`/cota/extrato?pessoa=${p.pessoa_id}&mes=${competencia.slice(0, 7)}`}
                          className="grid grid-cols-[8.5rem_1fr_3.5rem] items-center gap-3 rounded-lg text-sm hover:bg-slate-50">
                      <span className="truncate text-slate-700">{nomeCurto(p.pessoa)}</span>
                      <span className="relative h-2 rounded-full bg-slate-100">
                        <span className={`crescer-x absolute inset-0 origin-left rounded-full ${tom}`}
                              style={{ transform: `scaleX(${p.resultado / escala})` }} />
                        {meta != null && (
                          <span aria-hidden className="absolute -inset-y-1 w-0.5 rounded-full bg-slate-500"
                                style={{ left: `${(meta / escala) * 100}%` }} />
                        )}
                      </span>
                      <span className="text-right font-semibold text-slate-800">{num(p.resultado)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Traço cinza: a meta. Quem entrou ou saiu no meio do mês não entra na média. Clique para abrir o extrato.
          </p>
        </Quadro>
      </div>
    </div>
  );
}
