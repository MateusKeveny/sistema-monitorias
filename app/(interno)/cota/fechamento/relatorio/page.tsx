import Link from '@/componentes/Link';
import BotaoImprimir from '@/componentes/BotaoImprimir';
import { Quadro, Vazio } from '@/componentes/ui';
import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import { setorDasPessoas, monitoriasPorSetor, MONITORIAS_PADRAO } from '@/lib/monitoriasDoSetor';
import { mesRotulo, percentual, data as formatarData } from '@/lib/formatar';

export const dynamic = 'force-dynamic';

type Linha = {
  pessoa_id: string; semana: number | null; origem: string | null; regra: string; rotulo: string;
  grupo: string | null; ordem: number; quantidade: number; peso: number; cota: number;
};
type Cota = { pessoa_id: string; pessoa: string; cargo: string | null; resultado: number; meta: number | null };
type Csat = { pessoa_id: string; semana: number; avaliacoes: number; positivas: number };
type Volume = { pessoa_id: string; semana: number; canal: string; finalizados: number; tme_seg: number | null };

const pts = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const sinal = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${pts(Math.abs(v))}`;
const minutos = (seg: number | null) => (seg == null ? '—' : `${Math.round(seg / 60)} min`);
const lista = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}` : xs[0] ?? '');
/** "na semana 2 (81%)" / "nas semanas 1, 2 e 3 (82%, 88% e 81%)". */
const nasSemanas = (xs: { s: number; v: string }[]) => xs.length === 1
  ? `na semana ${xs[0].s} (${xs[0].v})`
  : `nas semanas ${lista(xs.map((x) => String(x.s)))} (${lista(xs.map((x) => x.v))})`;

/**
 * Relatório detalhado da cota (3.4.0): uma folha por atendente, no modelo da
 * folha de feedback do Monitorias — pronta para imprimir ou salvar em PDF e
 * levar ao 1:1. Substitui a planilha "detalhada"; o arquivo para importação
 * no portal continua igual (/api/cota/exportar).
 */
export default async function RelatorioDetalhado({ searchParams }: {
  searchParams: Promise<{ mes?: string; setor?: string; pessoa?: string }>;
}) {
  await exigirGestor();
  const { mes: mesPedido, setor, pessoa: pessoaPedida } = await searchParams;
  const mes = /^\d{4}-\d{2}$/.test(mesPedido ?? '') ? `${mesPedido}-01` : null;
  if (!mes) return <Quadro><Vazio>Informe o mês do relatório.</Vazio></Quadro>;
  const setorId = Number(setor) || 1;

  const db = await criarClienteServidor();
  const [cotas, extrato, csat, volume, fechados, setorDb, setorDe, monitorias, filas] = await Promise.all([
    db.from('vw_cota_mensal').select('pessoa_id, pessoa, cargo, resultado, meta').eq('mes_competencia', mes).order('pessoa'),
    db.from('vw_extrato_cota').select('pessoa_id, semana, origem, regra, rotulo, grupo, ordem, quantidade, peso, cota')
      .eq('mes_competencia', mes).order('ordem'),
    db.from('vw_csat_semanal').select('pessoa_id, semana, avaliacoes, positivas').eq('mes_competencia', mes),
    db.from('volume_semanal').select('pessoa_id, semana, canal, finalizados, tme_seg').eq('mes_competencia', mes),
    db.from('fechamentos_cota').select('pessoa_id, fechado_em').eq('mes_competencia', mes),
    db.from('setores').select('nome').eq('id', setorId).maybeSingle(),
    setorDasPessoas(db, mes),
    monitoriasPorSetor(db),
    db.from('canais_do_setor').select('setor_id, tme_por_pessoa_desde'),
  ]);
  const erro = [cotas, extrato, csat, volume].find((r) => r.error)?.error;
  if (erro) return <Quadro><Vazio>Não foi possível montar o relatório: {erro.message}</Vazio></Quadro>;

  const doSetor = (id: string) => (setorDe.get(id) ?? 1) === setorId;
  const piso = (monitorias.get(setorId) ?? MONITORIAS_PADRAO).piso;
  const pessoas = ((cotas.data ?? []) as Cota[]).filter((p) => doSetor(p.pessoa_id)
    && (!pessoaPedida || p.pessoa_id === pessoaPedida));
  const todas = ((cotas.data ?? []) as Cota[]).filter((p) => doSetor(p.pessoa_id));
  const linhas = (extrato.data ?? []) as Linha[];
  const csats = (csat.data ?? []) as Csat[];
  const volumes = (volume.data ?? []) as Volume[];
  const fechadoEm = new Map(((fechados.data ?? []) as { pessoa_id: string; fechado_em: string }[]).map((f) => [f.pessoa_id, f.fechado_em]));
  const nomeSetor = (setorDb.data as { nome: string } | null)?.nome ?? '';
  const posicao = new Map([...todas].sort((a, b) => Number(b.resultado) - Number(a.resultado)).map((p, i) => [p.pessoa_id, i + 1]));
  const mesCurto = mes.slice(0, 7);
  // TME por pessoa (migração 90): a partir de quando o TME de cada um vale pontos.
  const tmeVale = ((filas.data ?? []) as { setor_id: number; tme_por_pessoa_desde: string | null }[])
    .some((f) => f.setor_id === setorId && f.tme_por_pessoa_desde != null && f.tme_por_pessoa_desde <= mes);

  return (
    <div className="space-y-6">
      <div className="sem-impressao flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/cota/fechamento?mes=${mesCurto}`} className="text-sm text-sobre-fundo-suave hover:underline">← Fechamento</Link>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Relatório detalhado</h1>
          <p className="text-sm text-sobre-fundo-suave">{mesRotulo(mes)} · {nomeSetor} · uma folha por atendente</p>
        </div>
        <form className="flex items-center gap-2" action="/cota/fechamento/relatorio">
          <input type="hidden" name="mes" value={mesCurto} />
          <input type="hidden" name="setor" value={setorId} />
          <select name="pessoa" defaultValue={pessoaPedida ?? ''} aria-label="Atendente"
                  className="rounded-lg border border-slate-300 bg-superficie px-2 py-1.5 text-sm">
            <option value="">Todos ({todas.length})</option>
            {todas.map((p) => <option key={p.pessoa_id} value={p.pessoa_id}>{p.pessoa}</option>)}
          </select>
          <button type="submit" className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm hover:bg-slate-50">Ver</button>
          <BotaoImprimir />
        </form>
      </div>

      {pessoas.length === 0 && <Quadro><Vazio>Ninguém com cota em {mesRotulo(mes)} neste setor.</Vazio></Quadro>}

      {pessoas.map((p) => {
        const suas = linhas.filter((l) => l.pessoa_id === p.pessoa_id);
        const resultado = Number(p.resultado);
        const meta = p.meta == null ? null : Number(p.meta);
        const atingimento = meta ? resultado / meta : null;

        // Semana a semana.
        const semanas = [1, 2, 3, 4].map((s) => {
          const vol = volumes.filter((v) => v.pessoa_id === p.pessoa_id && v.semana === s);
          const finalizados = vol.reduce((a, v) => a + Number(v.finalizados), 0);
          const principal = [...vol].sort((a, b) => Number(b.finalizados) - Number(a.finalizados))[0];
          const cs = csats.filter((c) => c.pessoa_id === p.pessoa_id && c.semana === s);
          const aval = cs.reduce((a, c) => a + Number(c.avaliacoes), 0);
          const mon = suas.find((l) => l.grupo === 'monitoria' && l.semana === s);
          return {
            s, finalizados: vol.length ? finalizados : null,
            csat: aval ? cs.reduce((a, c) => a + Number(c.positivas), 0) / aval : null, avaliacoes: aval,
            tme: principal?.tme_seg && Number(principal.tme_seg) > 0 ? Number(principal.tme_seg) : null,
            monitoria: mon ? Number(mon.quantidade) : null,
            pontos: suas.filter((l) => l.semana === s).reduce((a, l) => a + Number(l.cota), 0),
          };
        });
        const doMes = suas.filter((l) => l.semana == null).reduce((a, l) => a + Number(l.cota), 0);

        // Extrato por categoria, no mês.
        const porCategoria = [...suas.reduce((m, l) => {
          const c = m.get(l.rotulo) ?? { rotulo: l.rotulo, quantidade: 0, cota: 0, ordem: l.ordem, grupo: l.grupo };
          c.quantidade += Number(l.quantidade); c.cota += Number(l.cota);
          return m.set(l.rotulo, c);
        }, new Map<string, { rotulo: string; quantidade: number; cota: number; ordem: number; grupo: string | null }>()).values()]
          .filter((c) => Math.abs(c.cota) >= 0.005 || c.quantidade);
        const somaram = porCategoria.filter((c) => c.cota > 0).sort((a, b) => b.cota - a.cota).slice(0, 3);
        const tiraram = porCategoria.filter((c) => c.cota < 0).sort((a, b) => a.cota - b.cota);

        // Pontos de melhoria, a partir dos números do mês.
        const melhorias: string[] = [];
        if (meta && resultado < meta) melhorias.push(`Faltaram ${pts(meta - resultado)} pts para a meta (${percentual(atingimento)} de atingimento).`);
        // O que mais tirou, numa linha (antes: uma linha por categoria).
        if (tiraram.length) {
          const totalTirado = tiraram.reduce((a, c) => a + c.cota, 0);
          melhorias.push(`Descontos no mês: ${sinal(totalTirado)} pts. O que mais tirou: ${lista(tiraram.slice(0, 3).map((c) => `${c.rotulo} (${sinal(c.cota)})`))}.`);
        }
        const csatBaixo = semanas.filter((s) => s.csat != null && s.csat < 0.9);
        if (csatBaixo.length) melhorias.push(`C-SAT abaixo de 90% ${nasSemanas(csatBaixo.map((s) => ({ s: s.s, v: percentual(s.csat) })))}: subir de faixa soma pontos em todos os atendimentos da semana.`);
        const tmeAlto = semanas.filter((s) => s.tme != null && s.tme > 15 * 60);
        if (tmeAlto.length) melhorias.push(`Seu TME passou de 15 min ${nasSemanas(tmeAlto.map((s) => ({ s: s.s, v: minutos(s.tme) })))}`
          + (tmeVale ? ': a faixa de TME é a sua, e vale pontos.' : '. Neste mês a faixa ainda era pela média da equipe; a partir de novembro, é pelo TME de cada um.'));
        const monBaixa = semanas.filter((s) => s.monitoria != null && s.monitoria <= piso);
        if (monBaixa.length) melhorias.push(`Monitoria sem pontuar (média até ${percentual(piso)}) ${nasSemanas(monBaixa.map((s) => ({ s: s.s, v: percentual(s.monitoria) })))}.`);
        const notasBaixas = suas.filter((l) => /nota_[12]$/.test(l.regra)).reduce((a, l) => a + Number(l.quantidade), 0);
        if (notasBaixas) melhorias.push(`${notasBaixas} avaliaç${notasBaixas > 1 ? 'ões' : 'ão'} com nota 1 ou 2 no mês: vale rever os atendimentos.`);

        return (
          <article key={p.pessoa_id}
                   className="pagina-impressa rounded-xl border border-slate-200 bg-superficie p-8 shadow-sm print:border-0 print:p-0 print:shadow-none">
            <header className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-marca-700 dark:text-marca-400">
                  Relatório de cota · Painel de Performance
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-slate-900">{p.pessoa}</h2>
                <p className="text-sm text-slate-500">{p.cargo ?? 'Sem cargo'} · {nomeSetor} · {mesRotulo(mes)}</p>
              </div>
              <p className="text-xs text-slate-500">
                {fechadoEm.get(p.pessoa_id) ? `Mês fechado em ${formatarData(fechadoEm.get(p.pessoa_id)!.slice(0, 10))}` : 'Mês em aberto: valores podem mudar'}
              </p>
            </header>

            <div className="grid gap-4 border-b border-slate-200 py-5 sm:grid-cols-4">
              {([
                ['Pontos no mês', pts(resultado)],
                ['Meta', meta == null ? '—' : pts(meta)],
                ['Atingimento', atingimento == null ? '—' : percentual(atingimento)],
                ['Posição no setor', `${posicao.get(p.pessoa_id) ?? '—'}º de ${todas.length}`],
              ] as const).map(([rotulo, valor]) => (
                <div key={rotulo}>
                  <p className="text-xs uppercase tracking-wide text-slate-500">{rotulo}</p>
                  <p className="text-2xl font-semibold tabular-nums text-slate-900">{valor}</p>
                </div>
              ))}
            </div>

            <section className="border-b border-slate-200 py-5">
              <h3 className="text-sm font-semibold text-slate-900">Semana a semana</h3>
              <table className="mt-2 w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-1 font-medium">Semana</th>
                    <th className="py-1 text-right font-medium">Finalizados</th>
                    <th className="py-1 text-right font-medium">C-SAT</th>
                    <th className="py-1 text-right font-medium">TME</th>
                    <th className="py-1 text-right font-medium">Monitoria</th>
                    <th className="py-1 text-right font-medium">Pontos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {semanas.map((s) => (
                    <tr key={s.s}>
                      <td className="py-1.5 text-slate-700">{s.s}ª</td>
                      <td className="py-1.5 text-right">{s.finalizados ?? '—'}</td>
                      <td className={`py-1.5 text-right ${s.csat != null && s.csat < 0.9 ? 'text-rose-700' : ''}`}>
                        {s.csat == null ? '—' : `${percentual(s.csat)}`}<span className="ml-1 text-xs text-slate-400">{s.avaliacoes ? `(${s.avaliacoes})` : ''}</span>
                      </td>
                      <td className={`py-1.5 text-right ${s.tme != null && s.tme > 15 * 60 ? 'text-rose-700' : ''}`}>{minutos(s.tme)}</td>
                      <td className={`py-1.5 text-right ${s.monitoria != null && s.monitoria <= piso ? 'text-rose-700' : ''}`}>
                        {s.monitoria == null ? '—' : percentual(s.monitoria)}
                      </td>
                      <td className="py-1.5 text-right font-semibold text-slate-900">{pts(s.pontos)}</td>
                    </tr>
                  ))}
                  {Math.abs(doMes) >= 0.005 && (
                    <tr>
                      <td className="py-1.5 text-slate-700" colSpan={5}>No mês (média da equipe, lançamentos do mês)</td>
                      <td className="py-1.5 text-right font-semibold text-slate-900">{pts(doMes)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            <section className="border-b border-slate-200 py-5">
              <h3 className="text-sm font-semibold text-slate-900">Extrato por categoria</h3>
              <table className="mt-2 w-full text-sm tabular-nums">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="py-1 font-medium">Categoria</th>
                    <th className="py-1 text-right font-medium">Quantidade</th>
                    <th className="py-1 text-right font-medium">Pontos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {porCategoria.sort((a, b) => a.ordem - b.ordem).map((c) => (
                    <tr key={c.rotulo}>
                      <td className="py-1.5 text-slate-700">{c.rotulo}</td>
                      <td className="py-1.5 text-right">{c.grupo === 'monitoria' ? '—' : pts(c.quantidade)}</td>
                      <td className={`py-1.5 text-right font-medium ${c.cota < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{sinal(c.cota)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="py-1.5 font-semibold text-slate-900" colSpan={2}>Total</td>
                    <td className="py-1.5 text-right font-semibold text-slate-900">{pts(resultado)}</td>
                  </tr>
                </tbody>
              </table>
            </section>

            <section className="grid gap-6 py-5 sm:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">O que mais somou</h3>
                <ul className="mt-2 space-y-1 text-sm">
                  {somaram.length ? somaram.map((c) => (
                    <li key={c.rotulo} className="flex justify-between gap-3">
                      <span className="text-slate-700">{c.rotulo}</span><span className="tabular-nums text-emerald-700">{sinal(c.cota)}</span>
                    </li>
                  )) : <li className="text-slate-500">—</li>}
                </ul>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Pontos de melhoria</h3>
                {melhorias.length ? (
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {melhorias.map((m) => <li key={m}>{m}</li>)}
                  </ul>
                ) : <p className="mt-2 text-sm text-emerald-700">Sem pontos de atenção no mês.</p>}
              </div>
            </section>

            <footer className="grid gap-8 border-t border-slate-200 pt-8 sm:grid-cols-2">
              {['Assinatura do atendente', 'Assinatura do gestor'].map((rotulo) => (
                <div key={rotulo}>
                  <div className="h-10 border-b border-slate-400" />
                  <p className="mt-1 text-xs text-slate-500">{rotulo}</p>
                </div>
              ))}
            </footer>
          </article>
        );
      })}
    </div>
  );
}
