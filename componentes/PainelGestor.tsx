import AlternadorCanal from '@/componentes/AlternadorCanal';
import AlternadorDeVisao from '@/componentes/AlternadorDeVisao';
import GraficoSemanal from '@/componentes/GraficoSemanal';
import { Cartao, Vazio } from '@/componentes/ui';
import GraficoCsat, { type PontoCsat } from '@/componentes/GraficoCsat';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { percentual } from '@/lib/formatar';

type Canal = 'huggy' | 'diretores';
const CANAIS: { chave: Canal; rotulo: string }[] = [
  { chave: 'huggy', rotulo: 'Expansão' },
  { chave: 'diretores', rotulo: 'Diretores-Expansão' },
];
const META_CSAT = 0.95;

const pct = (v: number, max: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;

type Csat = { pessoa_id: string; origem: Canal; semana: number; avaliacoes: number; positivas: number };
type Volume = { pessoa_id: string; canal: Canal; semana: number; finalizados: number; tme_seg: number | null };
type Criterio = { criterio: string; avaliacoes: number; reprovacoes: number; taxa_reprovacao: number };
type Cota = { pessoa_id: string; pessoa: string; cargo: string | null; resultado: number; meta: number | null };

const inteiro = (v: number) => v.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const nomeCurto = (nome: string) => nome.trim().split(/\s+/).slice(0, 2).join(' ');

/** Segundos → "12:34" ou "1h02". */
function tempo(seg: number) {
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = Math.round(seg % 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Tons das 4 semanas, do mais claro ao mais escuro. */
const TONS_SEMANA = ['bg-emerald-300', 'bg-emerald-500', 'bg-emerald-700', 'bg-emerald-900'];

/**
 * Tela inicial do gestor: a equipe inteira na competência.
 *
 * Tudo é SVG ou barra de CSS montado no servidor — nada de biblioteca de
 * gráfico no navegador. C-SAT, volume e TME respeitam o canal escolhido;
 * monitoria e cota são do mês inteiro, sem canal.
 */
export default async function PainelGestor({ competencia, canal }: { competencia: string; canal: Canal }) {
  // `canal` é só o canal que abre primeiro.
  const db = await criarClienteServidor();

  const [pessoas, csat, volume, criterios, cota] = await Promise.all([
    db.from('pessoas').select('id, nome'),
    db.from('vw_csat_semanal').select('pessoa_id, origem, semana, avaliacoes, positivas')
      .eq('mes_competencia', competencia),
    db.from('volume_semanal').select('pessoa_id, canal, semana, finalizados, tme_seg')
      .eq('mes_competencia', competencia),
    db.from('vw_criterios_reprovados').select('criterio, avaliacoes, reprovacoes, taxa_reprovacao')
      .eq('mes_referencia', competencia).gt('reprovacoes', 0)
      .order('reprovacoes', { ascending: false }).limit(8),
    db.from('vw_cota_mensal').select('pessoa_id, pessoa, cargo, resultado, meta')
      .eq('mes_competencia', competencia).order('resultado', { ascending: false }),
  ]);

  const nome = new Map((pessoas.data ?? []).map((p) => [p.id as string, nomeCurto(p.nome as string)]));

  // ---------- Monitoria e cota ----------
  const lista = (criterios.data ?? []) as Criterio[];
  const maiorReprov = Math.max(1, ...lista.map((c) => c.reprovacoes));
  const cotas = (cota.data ?? []) as Cota[];


  // C-SAT, volume e TME dos dois canais vêm prontos; o botão só alterna.
  const quadros = (canal: Canal) => {
    const rotuloCanal = CANAIS.find((c) => c.chave === canal)!.rotulo;
    // ---------- C-SAT ----------
    const csatCanal = ((csat.data ?? []) as Csat[]).filter((c) => c.origem === canal);
    const soma = (l: Csat[]) => l.reduce((a, c) => [a[0] + c.positivas, a[1] + c.avaliacoes], [0, 0]);
    const pontosCsat: PontoCsat[] = [1, 2, 3, 4].map((s) => {
      const [pos, tot] = soma(csatCanal.filter((c) => c.semana === s));
      return { semana: s, pessoa: tot ? pos / tot : null, equipe: null };
    });
    const [posMes, totMes] = soma(csatCanal);
    const csatPorPessoa = [...new Set(csatCanal.map((c) => c.pessoa_id))].map((id) => {
      const [pos, tot] = soma(csatCanal.filter((c) => c.pessoa_id === id));
      return { id, csat: pos / tot, avaliacoes: tot };
    }).sort((a, b) => b.csat - a.csat);
  
    // ---------- Volume ----------
    const volCanal = ((volume.data ?? []) as Volume[]).filter((v) => v.canal === canal);
    const volumePorPessoa = [...new Set(volCanal.map((v) => v.pessoa_id))].map((id) => {
      const semanas = [1, 2, 3, 4].map((s) => volCanal.find((v) => v.pessoa_id === id && v.semana === s)?.finalizados ?? 0);
      return { id, semanas, total: semanas.reduce((a, b) => a + b, 0) };
    }).sort((a, b) => b.total - a.total);
    const maiorVolume = Math.max(1, ...volumePorPessoa.map((v) => v.total));
    const mediaVolume = volumePorPessoa.length
      ? volumePorPessoa.reduce((a, v) => a + v.total, 0) / volumePorPessoa.length : 0;
  
    // ---------- TME ----------
    // Por pessoa: média das semanas ponderada pelos finalizados.
    const tmePorPessoa = [...new Set(volCanal.map((v) => v.pessoa_id))].map((id) => {
      const linhas = volCanal.filter((v) => v.pessoa_id === id && (v.tme_seg ?? 0) > 0);
      const peso = linhas.reduce((a, v) => a + Math.max(1, v.finalizados), 0);
      const tme = peso ? linhas.reduce((a, v) => a + (v.tme_seg ?? 0) * Math.max(1, v.finalizados), 0) / peso : null;
      return { id, tme };
    }).filter((x): x is { id: string; tme: number } => x.tme != null).sort((a, b) => a.tme - b.tme);
    // Média da equipe como a regra usa: média simples dos TMEs lançados.
    const tmesLancados = volCanal.map((v) => v.tme_seg ?? 0).filter((t) => t > 0);
    const tmeEquipe = tmesLancados.length ? tmesLancados.reduce((a, b) => a + b, 0) / tmesLancados.length : null;
    const maiorTme = Math.max(1, tmeEquipe ?? 0, ...tmePorPessoa.map((t) => t.tme), canal === 'diretores' ? 1800 : 0);
    // Referências das faixas de Diretores (15 e 30 min).
    const faixasTme = canal === 'diretores' ? [900, 1800] : [];

    // ---------- As mesmas medidas, semana a semana ----------
    // A média do mês esconde a semana ruim: quatro semanas de 30 min e uma de
    // 1h20 saem como "38 min" e ninguém vê o dia em que a fila estourou.
    const volumePorSemana = [1, 2, 3, 4].map((s) =>
      volCanal.filter((v) => v.semana === s).reduce((a, v) => a + v.finalizados, 0) || null);

    const tmePorSemana = [1, 2, 3, 4].map((s) => {
      // Média simples dos TMEs lançados, como a regra da faixa usa.
      const lancados = volCanal.filter((v) => v.semana === s).map((v) => v.tme_seg ?? 0).filter((t) => t > 0);
      return lancados.length ? lancados.reduce((a, b) => a + b, 0) / lancados.length : null;
    });

    /** Uma medida por semana, para a pessoa — usado na visão por atendente. */
    const semanasDe = (id: string, medir: (l: Csat[]) => number | null) =>
      [1, 2, 3, 4].map((s) => medir(csatCanal.filter((c) => c.pessoa_id === id && c.semana === s)));

    const tmeSemanalDe = (id: string) => [1, 2, 3, 4].map((s) => {
      const v = volCanal.find((x) => x.pessoa_id === id && x.semana === s);
      return v && (v.tme_seg ?? 0) > 0 ? v.tme_seg! : null;
    });

    /** Quatro caixinhas com o valor de cada semana. */
    const Semanas = ({ valores, formatar }: {
      valores: (number | null)[]; formatar: (v: number) => string;
    }) => (
      <div className="flex gap-1">
        {valores.map((v, i) => (
          <span key={i} title={`${i + 1}ª semana`}
                className={`flex-1 rounded px-1 py-0.5 text-center text-[10px] tabular-nums ${
                  v == null ? 'bg-slate-50 text-slate-300' : 'bg-slate-100 text-slate-600'}`}>
            {v == null ? '—' : formatar(v)}
          </span>
        ))}
      </div>
    );
  
  
    return (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* C-SAT da equipe */}
          <Cartao
            titulo={`C-SAT · ${rotuloCanal}`}
            acao={totMes > 0 && <span className="text-lg font-semibold tabular-nums text-slate-900">{percentual(posMes / totMes)}</span>}
          >
            {totMes === 0 ? <Vazio>Sem avaliações neste canal.</Vazio> : (
              <AlternadorDeVisao
                rotulos={['Por semana', 'Por atendente']}
                paineis={[
                  // A linha já mostra a evolução; repetir em barras não
                  // acrescenta nada. O que falta é o tamanho da amostra de
                  // cada semana: 100% de duas avaliações não é 100% de
                  // duzentas.
                  <div key="s" className="space-y-3">
                    <GraficoCsat pontos={pontosCsat} meta={META_CSAT} rotulo="Equipe" />
                    <table className="w-full border-t border-slate-100 pt-2 text-xs">
                      <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                          <th className="py-1 font-semibold">Semana</th>
                          <th className="py-1 text-right font-semibold">C-SAT</th>
                          <th className="py-1 text-right font-semibold">Positivas</th>
                          <th className="py-1 text-right font-semibold">Avaliações</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[1, 2, 3, 4].map((s) => {
                          const [pos, tot] = soma(csatCanal.filter((c) => c.semana === s));
                          const valor = tot ? pos / tot : null;
                          return (
                            <tr key={s} className="border-t border-slate-100">
                              <td className="py-1 text-slate-700">{s}ª</td>
                              <td className={`py-1 text-right font-semibold tabular-nums ${
                                valor == null ? 'text-slate-300'
                                  : valor >= META_CSAT ? 'text-emerald-700'
                                    : valor >= 0.85 ? 'text-amber-700' : 'text-rose-700'}`}>
                                {valor == null ? '—' : percentual(valor)}
                              </td>
                              <td className="py-1 text-right tabular-nums text-slate-500">
                                {tot ? inteiro(pos) : '—'}
                              </td>
                              <td className="py-1 text-right tabular-nums text-slate-500">
                                {tot ? inteiro(tot) : '—'}
                              </td>
                            </tr>
                          );
                        })}
                        <tr className="border-t border-slate-200">
                          <td className="py-1 font-semibold text-slate-700">Mês</td>
                          <td className="py-1 text-right font-semibold tabular-nums text-slate-800">
                            {percentual(posMes / totMes)}
                          </td>
                          <td className="py-1 text-right tabular-nums text-slate-500">{inteiro(posMes)}</td>
                          <td className="py-1 text-right tabular-nums text-slate-500">{inteiro(totMes)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>,
                  // Uma linha por pessoa: nome, as quatro semanas e o mês. A
                  // cor já diz a faixa, então dispensa barra; e a contagem de
                  // avaliações some — ela pertence à visão por semana, onde o
                  // tamanho da amostra importa.
                  <div key="p" className="text-xs">
                    <div className="flex items-center gap-2 pb-1 text-[10px] uppercase
                                    tracking-wide text-slate-400">
                      <span className="flex-1" />
                      {[1, 2, 3, 4].map((s) => (
                        <span key={s} className="w-11 text-center">{s}ª</span>
                      ))}
                      <span className="w-12 text-right">Mês</span>
                    </div>

                    <ul className="divide-y divide-slate-100">
                      {csatPorPessoa.map((p) => {
                        const semanas = semanasDe(p.id, (l) => {
                          const [pos, tot] = soma(l);
                          return tot ? pos / tot : null;
                        });
                        return (
                          <li key={p.id} className="flex items-center gap-2 py-1.5">
                            <span className="flex-1 truncate text-slate-700">{nome.get(p.id)}</span>
                            {semanas.map((v, i) => (
                              <span key={i} title={`${i + 1}ª semana`}
                                    className={`w-11 rounded px-1 py-0.5 text-center tabular-nums ${
                                      v == null ? 'text-slate-300'
                                        : v >= META_CSAT ? 'bg-emerald-50 text-emerald-700'
                                          : v >= 0.85 ? 'bg-amber-50 text-amber-700'
                                            : 'bg-rose-50 text-rose-700'}`}>
                                {v == null ? '·' : percentual(v)}
                              </span>
                            ))}
                            <span className={`w-12 text-right font-semibold tabular-nums ${
                              p.csat >= META_CSAT ? 'text-emerald-700'
                                : p.csat >= 0.85 ? 'text-amber-700' : 'text-rose-700'}`}>
                              {percentual(p.csat)}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>,
                ]}
              />
            )}
          </Cartao>
  
          {/* Volume */}
          <Cartao
            titulo={`Volume de atendimentos · ${rotuloCanal}`}
            acao={volumePorPessoa.length > 0 && (
              <span className="text-lg font-semibold tabular-nums text-slate-900">
                {inteiro(volumePorPessoa.reduce((a, v) => a + v.total, 0))}
              </span>
            )}
          >
            {volumePorPessoa.length === 0 ? <Vazio>Nenhum volume lançado neste canal.</Vazio> : (
              <AlternadorDeVisao
                rotulos={['Por semana', 'Por atendente']}
                paineis={[
                  <GraficoSemanal
                    key="s"
                    valores={volumePorSemana}
                    formatar={(v) => inteiro(v)}
                    media={volumePorSemana.filter((v): v is number => v != null).length
                      ? volumePorSemana.filter((v): v is number => v != null)
                        .reduce((a, b) => a + b, 0)
                        / volumePorSemana.filter((v) => v != null).length
                      : null}
                    cor="bg-marca-600"
                  />,
                  <div key="p" className="space-y-3">
                <ul className="space-y-2.5 text-xs">
                  {volumePorPessoa.map((p) => (
                    <li key={p.id} className="space-y-1">
                      <div className="flex justify-between">
                        <span className="text-slate-700">{nome.get(p.id)}</span>
                        <span className="font-semibold tabular-nums text-slate-800">{inteiro(p.total)}</span>
                      </div>
                      <div className="relative flex h-3 overflow-hidden rounded bg-slate-100">
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
                  </div>,
                ]}
              />
            )}
          </Cartao>
  
          {/* TME */}
          <Cartao
            titulo={`TME médio · ${rotuloCanal}`}
            acao={tmeEquipe != null && <span className="text-lg font-semibold tabular-nums text-slate-900">{tempo(tmeEquipe)}</span>}
          >
            {tmePorPessoa.length === 0 ? <Vazio>Nenhum TME lançado neste canal.</Vazio> : (
              <AlternadorDeVisao
                rotulos={['Por semana', 'Por atendente']}
                paineis={[
                  <GraficoSemanal
                    key="s"
                    valores={tmePorSemana}
                    formatar={(v) => tempo(v)}
                    media={tmeEquipe}
                    piorEMaior
                    referencias={faixasTme.map((f) => ({ valor: f, rotulo: `${f / 60} min` }))}
                    cor="bg-sky-500"
                  />,
                  <div key="p" className="space-y-3">
                <ul className="space-y-2.5 text-xs">
                  {tmePorPessoa.map((p) => {
                    const acima = tmeEquipe != null && p.tme > tmeEquipe;
                    return (
                      <li key={p.id} className="space-y-1">
                        <div className="flex justify-between">
                          <span className={acima ? 'font-semibold text-rose-700' : 'text-slate-700'}>
                            {acima && '▲ '}{nome.get(p.id)}
                          </span>
                          <span className={`font-semibold tabular-nums ${acima ? 'text-rose-700' : 'text-slate-800'}`}>{tempo(p.tme)}</span>
                        </div>
                        <div className="relative h-3 overflow-hidden rounded bg-slate-100">
                          <span className={`block h-full rounded ${acima ? 'bg-rose-400' : 'bg-sky-500'}`} style={{ width: pct(p.tme, maiorTme) }} />
                          {faixasTme.map((f) => (
                            <span key={f} className="absolute inset-y-0 w-px bg-amber-500/70" style={{ left: pct(f, maiorTme) }} />
                          ))}
                          {tmeEquipe != null && (
                            <span className="absolute inset-y-0 w-0.5 bg-slate-900/60" style={{ left: pct(tmeEquipe, maiorTme) }} />
                          )}
                        </div>
                        <Semanas valores={tmeSemanalDe(p.id)} formatar={(v) => tempo(v)} />
                      </li>
                    );
                  })}
                </ul>
                <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1"><span className="inline-block h-3 w-0.5 bg-slate-900/60" />média da equipe</span>
                  <span className="flex items-center gap-1"><span className="text-rose-700">▲</span>acima da média</span>
                  {faixasTme.length > 0 && (
                    <span className="flex items-center gap-1"><span className="inline-block h-3 w-px bg-amber-500/70" />faixas 15 e 30 min</span>
                  )}
                </div>
                  </div>,
                ]}
              />
            )}
          </Cartao>
        </div>
  
      );
  };

  return (
    <div className="space-y-6">
      <AlternadorCanal inicial={canal} paineis={{ huggy: quadros('huggy'), diretores: quadros('diretores') }} />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Critérios de monitoria */}
        <Cartao titulo="Critérios mais reprovados em monitoria">
          {lista.length === 0 ? <Vazio>Nenhuma reprovação nesta competência.</Vazio> : (
            <ul className="space-y-2.5 text-xs">
              {lista.map((c) => (
                <li key={c.criterio} className="space-y-1">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-700">{c.criterio}</span>
                    <span className="shrink-0 tabular-nums text-slate-500">
                      <strong className="text-slate-800">{c.reprovacoes}</strong> de {c.avaliacoes} · {percentual(Number(c.taxa_reprovacao))}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-slate-100">
                    <span className="block h-full rounded bg-rose-400" style={{ width: pct(c.reprovacoes, maiorReprov) }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        {/* Cota */}
        <Cartao titulo="Pontuação de cota" className="lg:col-span-2">
          {cotas.length === 0 ? <Vazio>Sem pontuação nesta competência.</Vazio> : (
            <div className="-mx-5 -my-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-semibold">Pessoa</th>
                    <th className="px-4 py-2.5 font-semibold">Cargo</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Pontos</th>
                    <th className="w-2/5 px-4 py-2.5 font-semibold">Atingimento</th>
                  </tr>
                </thead>
                <tbody>
                  {cotas.map((c) => {
                    const ating = c.meta ? Number(c.resultado) / Number(c.meta) : null;
                    return (
                      <tr key={`${c.pessoa_id}-${c.cargo}`} className="border-t border-slate-100">
                        <td className="px-4 py-2 font-medium text-slate-800">{nomeCurto(c.pessoa)}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">{c.cargo ?? '—'}</td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-800">{inteiro(Number(c.resultado))}</td>
                        <td className="px-4 py-2">
                          {ating == null ? <span className="text-xs text-slate-400">sem meta</span> : (
                            <div className="flex items-center gap-2">
                              <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                                <span className={`block h-full rounded-full ${ating >= 1 ? 'bg-emerald-500' : 'bg-marca-600'}`}
                                      style={{ width: pct(ating, 1) }} />
                              </span>
                              <span className="w-12 text-right text-xs font-semibold tabular-nums text-slate-700">{percentual(ating)}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Cartao>
      </div>
    </div>
  );
}
