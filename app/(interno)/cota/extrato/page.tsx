import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { Cartao, Vazio } from '@/componentes/ui';
import { hojeNoBrasil, mesDeCompetencia, mesRotulo, percentual } from '@/lib/formatar';
import type { Pessoa } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

type Canal = 'huggy' | 'diretores';

type Linha = {
  semana: number | null;
  origem: Canal | null;
  regra: string;
  rotulo: string;
  grupo: string;
  ordem: number;
  cargo_id: number;
  quantidade: number;
  peso: number;
  cota: number;
};

type Faixa = { chave: string; rotulo: string; faixa_min: number | null; faixa_max: number | null; ordem: number };
type CsatSemana = { origem: Canal; semana: number; avaliacoes: number; positivas: number; csat: number };

const NOME_CANAL: Record<string, string> = {
  huggy: 'Expansão',
  diretores: 'Diretores-Expansão',
  geral: 'Monitoria e lançamentos',
};

const num = (v: number, casas = 2) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas });
const chaveCanal = (o: Canal | null) => o ?? 'geral';
const nomeCurto = (nome: string) => nome.trim().split(' ').slice(0, 2).join(' ');

/** Faixa em que o C-SAT caiu, pelas mesmas regras do cálculo. */
const faixaDo = (csat: number, faixas: Faixa[]) => faixas.find((f) =>
  (f.faixa_min == null || csat >= Number(f.faixa_min))
  && (f.faixa_max == null || csat < Number(f.faixa_max)));

/**
 * Extrato: à esquerda o que aconteceu em cada semana, à direita a soma do mês.
 *
 * Dentro de cada semana as regras ficam em blocos por canal, como na planilha:
 * o canal é o título do bloco, não uma coluna repetida linha a linha.
 */
export default async function Extrato({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; pessoa?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { mes, pessoa: pessoaPedida } = await searchParams;
  const competencia = /^\d{4}-\d{2}$/.test(mes ?? '') ? `${mes}-01` : mesDeCompetencia(hojeNoBrasil());
  const veOTime = perfil.papel !== 'operador';

  const db = await criarClienteServidor();

  const { data: pessoas } = veOTime
    ? await db.from('pessoas').select('id, nome').eq('ativo', true).order('nome')
    : { data: [{ id: perfil.id, nome: perfil.nome }] };

  const lista = (pessoas ?? []) as Pick<Pessoa, 'id' | 'nome'>[];
  const pessoaId = veOTime && pessoaPedida && lista.some((p) => p.id === pessoaPedida)
    ? pessoaPedida : perfil.id;

  const [extrato, cota, csat, faixasCsat] = await Promise.all([
    db.from('vw_extrato_cota')
      .select('semana, origem, regra, rotulo, grupo, ordem, cargo_id, quantidade, peso, cota')
      .eq('pessoa_id', pessoaId).eq('mes_competencia', competencia)
      .order('semana', { nullsFirst: false }).order('ordem'),
    db.from('vw_cota_mensal').select('resultado, meta, cargo, pessoa')
      .eq('pessoa_id', pessoaId).eq('mes_competencia', competencia).maybeSingle(),
    db.from('vw_csat_semanal').select('origem, semana, avaliacoes, positivas, csat')
      .eq('pessoa_id', pessoaId).eq('mes_competencia', competencia),
    db.from('regras').select('chave, rotulo, faixa_min, faixa_max, ordem')
      .eq('grupo', 'csat').eq('ativo', true).order('ordem'),
  ]);

  const linhas = (extrato.data ?? []) as Linha[];
  const faixas = (faixasCsat.data ?? []) as Faixa[];
  const semanal = (csat.data ?? []) as CsatSemana[];
  const resultado = cota.data ? Number(cota.data.resultado) : null;
  const meta = cota.data?.meta != null ? Number(cota.data.meta) : null;

  // Peso de cada faixa no cargo da pessoa, para mostrar também as faixas que
  // ela não atingiu no resumo do mês.
  const cargoId = linhas[0]?.cargo_id;
  const { data: pesos } = cargoId
    ? await db.from('pesos_por_cargo').select('regra, peso').eq('cargo_id', cargoId).eq('ativo', true)
    : { data: [] };
  const pesoDaFaixa = new Map((pesos ?? []).map((p) => [p.regra as string, Number(p.peso)]));

  // Quando o cargo recebe por média, mostra de quem é a média: o resultado de
  // cada pessoa dos cargos de referência, a média e o multiplicador aplicado.
  const linhaMedia = linhas.find((l) => l.regra === 'media_da_equipe');
  let composicao: { pessoa: string; cargo: string | null; resultado: number }[] = [];
  if (linhaMedia && cargoId) {
    const [referencias, cargos, resultados] = await Promise.all([
      db.from('cargos_referencia').select('referencia_id').eq('cargo_id', cargoId),
      db.from('cargos').select('id, nome'),
      db.from('vw_cota_mensal').select('pessoa, cargo, resultado').eq('mes_competencia', competencia),
    ]);
    const nomesReferencia = new Set(((referencias.data ?? []) as { referencia_id: number }[])
      .map((r) => ((cargos.data ?? []) as { id: number; nome: string }[])
        .find((c) => c.id === r.referencia_id)?.nome)
      .filter(Boolean) as string[]);
    composicao = ((resultados.data ?? []) as { pessoa: string; cargo: string | null; resultado: number }[])
      .filter((r) => r.cargo && nomesReferencia.has(r.cargo))
      .map((r) => ({ ...r, resultado: Number(r.resultado) }))
      .sort((a, b) => b.resultado - a.resultado);
  }

  const semanas = [...new Set(linhas.map((l) => l.semana))].sort((a, b) => (a ?? 9) - (b ?? 9));
  const canaisDe = (ls: Linha[]) => [...new Set(ls.map((l) => chaveCanal(l.origem)))]
    .sort((a, b) => (a === 'geral' ? 1 : 0) - (b === 'geral' ? 1 : 0));

  const csatDe = (origem: Canal | null, semana: number | null) =>
    origem && semana ? semanal.find((c) => c.origem === origem && c.semana === semana) : undefined;

  /** Uma linha da tabela: rótulo, quantidade, peso e pontos. */
  const Linha = ({ l, detalhe }: { l: Linha; detalhe?: string }) => (
    <tr className="border-t border-slate-100">
      <td className="py-1.5 pr-2 text-slate-800">
        {l.rotulo}
        {detalhe && <span className="ml-2 text-xs font-semibold text-marca-700 dark:text-marca-400">{detalhe}</span>}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
        {l.grupo === 'csat' || l.grupo === 'monitoria' ? num(Number(l.quantidade), 4) : num(Number(l.quantidade))}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{num(Number(l.peso))}</td>
      <td className={`py-1.5 pl-2 text-right font-semibold tabular-nums ${
        Number(l.cota) < 0 ? 'text-rose-700' : 'text-slate-800'}`}>{num(Number(l.cota))}</td>
    </tr>
  );

  const Cabecalho = () => (
    <thead>
      <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
        <th className="pb-1 pr-2 font-semibold">Categoria</th>
        <th className="px-2 pb-1 text-right font-semibold">Feito</th>
        <th className="px-2 pb-1 text-right font-semibold">Pontuação</th>
        <th className="pb-1 pl-2 text-right font-semibold">Cota</th>
      </tr>
    </thead>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-sobre-fundo">Extrato</h1>
          <p className="text-sm text-sobre-fundo-suave">
            {cota.data?.pessoa ?? perfil.nome} · {mesRotulo(competencia)}
            {cota.data?.cargo ? ` · ${cota.data.cargo}` : ''}
          </p>
        </div>

        <form className="flex flex-wrap items-end gap-2">
          {veOTime && (
            <label>
              <span className="mb-1 block text-xs font-medium text-slate-600">Pessoa</span>
              <select name="pessoa" defaultValue={pessoaId}
                      className="rounded-md border border-slate-300 px-2 py-1 text-sm">
                {lista.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </label>
          )}
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-600">Competência</span>
            <input type="month" name="mes" defaultValue={competencia.slice(0, 7)}
                   className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <button className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5
                             text-sm font-medium text-slate-700 hover:bg-slate-50">
            Abrir
          </button>
        </form>
      </div>

      {linhas.length === 0 ? (
        <Cartao titulo="Extrato"><Vazio>Nenhum ponto nesta competência.</Vazio></Cartao>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-2">
          {/* ---------------- Esquerda: semana a semana ---------------- */}
          <div className="space-y-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-sobre-fundo-suave">Status semanal</h2>

            {semanas.map((semana) => {
              const daSemana = linhas.filter((l) => l.semana === semana);
              const soma = daSemana.reduce((a, l) => a + Number(l.cota), 0);
              return (
                <Cartao
                  key={semana ?? 'mes'}
                  titulo={semana ? `${semana}ª semana` : 'No mês'}
                  acao={<span className={`text-sm font-semibold tabular-nums ${
                    soma < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{num(soma)} pts</span>}
                >
                  <div className="space-y-4">
                    {canaisDe(daSemana).map((canal) => {
                      const doCanal = daSemana.filter((l) => chaveCanal(l.origem) === canal);
                      const c = csatDe(canal === 'geral' ? null : canal as Canal, semana);
                      return (
                        <section key={canal}>
                          <h3 className="mb-1 rounded bg-slate-100 px-2 py-1 text-xs font-semibold uppercase
                                         tracking-wide text-slate-600">
                            {NOME_CANAL[canal]}
                            {c && (
                              <span className="ml-2 font-normal normal-case tracking-normal text-slate-500">
                                C-SAT {percentual(Number(c.csat))} · {c.positivas} de {c.avaliacoes}
                              </span>
                            )}
                          </h3>
                          <table className="w-full text-sm">
                            <Cabecalho />
                            <tbody>
                              {doCanal.map((l) => (
                                <Linha
                                  key={`${l.regra}-${l.origem ?? 'sem'}`} l={l}
                                  detalhe={l.grupo === 'csat' && c ? percentual(Number(c.csat)) : undefined}
                                />
                              ))}
                            </tbody>
                          </table>
                        </section>
                      );
                    })}
                  </div>
                </Cartao>
              );
            })}
          </div>

          {/* ---------------- Direita: o mês somado ---------------- */}
          <div className="space-y-6 lg:sticky lg:top-24">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-sobre-fundo-suave">
              Somando todas as semanas do mês
            </h2>

            {resultado != null && (
              <Cartao titulo="Resultado da competência">
                <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
                  <p className="text-3xl font-semibold tabular-nums text-slate-900">
                    {num(resultado, 0)} <span className="text-base font-normal text-slate-500">pts</span>
                  </p>
                  {meta != null && (
                    <div className="min-w-48 flex-1">
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
                        <div className={`h-full rounded-full ${resultado >= meta ? 'bg-emerald-500' : 'bg-marca-600'}`}
                             style={{ width: `${Math.min(100, Math.max(0, (resultado / meta) * 100))}%` }} />
                      </div>
                      <p className="mt-2 text-sm text-slate-600">
                        {percentual(resultado / meta)} da meta de {num(meta, 0)} pts
                        {resultado < meta && ` · faltam ${num(meta - resultado, 0)} pts`}
                      </p>
                    </div>
                  )}
                </div>
              </Cartao>
            )}

            {linhaMedia && (
              <Cartao
                titulo="Como a média foi formada"
                acao={<span className="text-sm font-semibold tabular-nums text-slate-900">
                  {num(Number(linhaMedia.cota))} pts
                </span>}
              >
                {composicao.length === 0 ? (
                  <p className="text-sm text-slate-600">
                    Média dos cargos de referência: <strong className="tabular-nums">{num(Number(linhaMedia.quantidade))}</strong> pts.
                    O resultado de cada pessoa não aparece para o seu acesso.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {composicao.map((c) => (
                        <li key={c.pessoa}
                            className="flex items-baseline justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2
                                       ring-1 ring-slate-200">
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-slate-700">{nomeCurto(c.pessoa)}</span>
                            <span className="block text-[10px] text-slate-400">{c.cargo}</span>
                          </span>
                          <span className="font-semibold tabular-nums text-slate-800">{num(c.resultado, 0)}</span>
                        </li>
                      ))}
                    </ul>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-sm">
                      <span className="text-slate-600">Média de {composicao.length} pessoa(s)</span>
                      <span className="font-semibold tabular-nums text-slate-800">{num(Number(linhaMedia.quantidade))}</span>
                      <span className="text-slate-400">×</span>
                      <span className="text-slate-600">multiplicador</span>
                      <span className="font-semibold tabular-nums text-slate-800">{num(Number(linhaMedia.peso))}</span>
                      <span className="text-slate-400">=</span>
                      <span className="text-lg font-semibold tabular-nums text-marca-700 dark:text-marca-400">
                        {num(Number(linhaMedia.cota))} pts
                      </span>
                      <span className="text-xs text-slate-500">
                        ({Number(linhaMedia.peso) >= 1 ? '+' : ''}{Math.round((Number(linhaMedia.peso) - 1) * 100)}% sobre a média)
                      </span>
                    </div>
                  </div>
                )}
              </Cartao>
            )}

            {canaisDe(linhas).map((canal) => {
              const doCanal = linhas.filter((l) => chaveCanal(l.origem) === canal);
              const soma = doCanal.reduce((a, l) => a + Number(l.cota), 0);

              // Cada categoria somada no mês; o C-SAT tem tratamento próprio.
              const categorias = [...new Map(doCanal.filter((l) => l.grupo !== 'csat')
                .map((l) => [l.regra, l])).values()]
                .sort((a, b) => a.ordem - b.ordem)
                .map((base) => {
                  const iguais = doCanal.filter((l) => l.regra === base.regra);
                  return {
                    ...base,
                    quantidade: iguais.reduce((a, l) => a + Number(l.quantidade), 0),
                    cota: iguais.reduce((a, l) => a + Number(l.cota), 0),
                  };
                });

              // Todas as faixas de C-SAT, marcando em quais semanas pontuou.
              const semanasDoCanal = canal === 'geral' ? []
                : semanal.filter((c) => c.origem === canal as Canal);
              const linhasFaixa = canal === 'geral' ? [] : faixas.map((f) => {
                const atingidas = semanasDoCanal.filter((c) => faixaDo(Number(c.csat), faixas)?.chave === f.chave);
                const doExtrato = doCanal.filter((l) => l.regra === f.chave);
                return {
                  faixa: f,
                  semanas: atingidas.map((c) => c.semana).sort(),
                  quantidade: doExtrato.reduce((a, l) => a + Number(l.quantidade), 0),
                  peso: doExtrato[0]?.peso != null ? Number(doExtrato[0].peso) : pesoDaFaixa.get(f.chave) ?? 0,
                  cota: doExtrato.reduce((a, l) => a + Number(l.cota), 0),
                };
              });

              const csatMes = semanasDoCanal.length
                ? semanasDoCanal.reduce((a, c) => a + c.positivas, 0)
                  / semanasDoCanal.reduce((a, c) => a + c.avaliacoes, 0)
                : null;

              return (
                <Cartao
                  key={canal}
                  titulo={NOME_CANAL[canal]}
                  acao={<span className={`text-sm font-semibold tabular-nums ${
                    soma < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{num(soma)} pts</span>}
                >
                  <table className="w-full text-sm">
                    <Cabecalho />
                    <tbody>
                      {categorias.map((l) => <Linha key={l.regra} l={l} />)}

                      {linhasFaixa.length > 0 && (
                        <tr className="border-t border-slate-200">
                          <td colSpan={4} className="pb-1 pt-3">
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold uppercase
                                             tracking-wide text-slate-600">
                              C-SAT no mês
                            </span>
                            {csatMes != null && (
                              <span className="ml-2 text-xs font-semibold text-marca-700 dark:text-marca-400">
                                {percentual(csatMes)}
                              </span>
                            )}
                          </td>
                        </tr>
                      )}
                      {linhasFaixa.map((f) => (
                        <tr key={f.faixa.chave}
                            className={`border-t border-slate-100 ${f.semanas.length ? '' : 'text-slate-400'}`}>
                          <td className="py-1.5 pr-2">
                            {f.faixa.rotulo}
                            {f.semanas.length > 0 && (
                              <span className="ml-2 text-xs font-semibold text-marca-700 dark:text-marca-400">
                                {f.semanas.map((s) => `${s}ª`).join(', ')}
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{f.quantidade ? num(f.quantidade) : '—'}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{num(f.peso)}</td>
                          <td className={`py-1.5 pl-2 text-right font-semibold tabular-nums ${
                            f.cota < 0 ? 'text-rose-700' : f.semanas.length ? 'text-slate-800' : ''}`}>
                            {f.cota ? num(f.cota) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Cartao>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-xs leading-relaxed text-sobre-fundo-suave">
        Cada linha é <strong>quantidade × peso</strong>, com o peso do cargo vigente na competência.
        No C-SAT, o percentual da semana define a faixa, e a faixa multiplica os atendimentos
        finalizados. A monitoria só pontua com média acima de 85%, e as regras de valor digitado
        usam o valor informado pelo gestor.
      </p>
    </div>
  );
}
