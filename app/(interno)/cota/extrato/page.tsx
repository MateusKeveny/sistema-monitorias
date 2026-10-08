import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { BarraDeMeta, Quadro, Vazio } from '@/componentes/ui';
import { mesRotulo, percentual, umaCasa } from '@/lib/formatar';
import SetasDeCompetencia from '@/componentes/SetasDeCompetencia';
import SeletorDeDetalhe from '@/componentes/SeletorDeDetalhe';
import { resolverCompetencia } from '@/lib/competencia';
import { resultadosNaMedia } from '@/lib/resultado-na-media';
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

const reais = (v: number, casas = 2) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: casas });
const num = (v: number, casas = 2) => Number(v).toLocaleString('pt-BR', { maximumFractionDigits: casas });
const um = umaCasa;
const chaveCanal = (o: Canal | null) => o ?? 'geral';
const nomeCurto = (nome: string) => nome.trim().split(' ').slice(0, 2).join(' ');

/** Faixa em que o C-SAT caiu, pelas mesmas regras do cálculo. */
const faixaDo = (csat: number, faixas: Faixa[]) => faixas.find((f) =>
  (f.faixa_min == null || csat >= Number(f.faixa_min))
  && (f.faixa_max == null || csat < Number(f.faixa_max)));

/**
 * Extrato (1.18.0): o resumo do mês, de onde vieram os pontos, as semanas lado
 * a lado (o clique abre o detalhe) e o resumo geral do mês por canal.
 *
 * As regras ficam em blocos por canal, como na planilha — o canal é o título do
 * bloco, não uma coluna repetida linha a linha — e na mesma sequência dela.
 */
export default async function Extrato({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; pessoa?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { mes, pessoa: pessoaPedida } = await searchParams;
  const { competencia, atual, emAberto } = await resolverCompetencia(mes);
  const veOTime = perfil.papel !== 'operador';

  const db = await criarClienteServidor();

  const { data: pessoas } = veOTime
    ? await db.from('pessoas').select('id, nome').eq('ativo', true).order('nome')
    : { data: [{ id: perfil.id, nome: perfil.nome }] };

  const lista = (pessoas ?? []) as Pick<Pessoa, 'id' | 'nome'>[];
  const pessoaId = veOTime && pessoaPedida && lista.some((p) => p.id === pessoaPedida)
    ? pessoaPedida : perfil.id;

  const [extrato, cota, csat, faixasCsat, fechamento, pago] = await Promise.all([
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
    db.from('fechamentos_cota').select('id, cargo, resultado, meta')
      .eq('pessoa_id', pessoaId).eq('mes_competencia', competencia).maybeSingle(),
    // Só existe em competência fechada: o valor sai do que foi entregue.
    db.from('vw_pagamento_mensal')
      .select('atingiu_meta, bonus, pontos_pagos, valor_por_ponto, valor')
      .eq('pessoa_id', pessoaId).eq('mes_competencia', competencia).maybeSingle(),
  ]);

  // Competência fechada mostra o que foi congelado, não o cálculo de hoje.
  // Sem isto o mesmo mês aparece com dois números — agosto/2026 chegou a
  // mostrar 330 pts aqui e 7.050 no histórico, depois de a planilha do
  // cálculo externo ser importada.
  const pagamento = pago.data as
    { atingiu_meta: boolean; bonus: number; pontos_pagos: number;
      valor_por_ponto: number | null; valor: number | null } | null;

  const congelado = fechamento.data as
    { id: string; cargo: string | null; resultado: number; meta: number | null } | null;

  const { data: linhasFechadas } = congelado
    ? await db.from('fechamento_linhas')
      .select('semana, origem, regra, rotulo, grupo, ordem, quantidade, peso, cota')
      .eq('fechamento_id', congelado.id).order('semana', { nullsFirst: false }).order('ordem')
    : { data: null };

  const aoVivo = (extrato.data ?? []) as Linha[];
  const linhas: Linha[] = linhasFechadas
    ? (linhasFechadas as Omit<Linha, 'cargo_id'>[])
      .map((l) => ({ ...l, cargo_id: aoVivo[0]?.cargo_id }))
    : aoVivo;
  const faixas = (faixasCsat.data ?? []) as Faixa[];
  const semanal = (csat.data ?? []) as CsatSemana[];
  const resultado = congelado
    ? Number(congelado.resultado)
    : cota.data ? Number(cota.data.resultado) : null;
  const meta = congelado
    ? (congelado.meta == null ? null : Number(congelado.meta))
    : cota.data?.meta != null ? Number(cota.data.meta) : null;

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
  // O mesmo multiplicador sobre a pontuação realizada (migração 48).
  const linhaRealizado = linhas.find((l) => l.regra === 'media_sobre_realizado');
  const totalMedia = Number(linhaMedia?.cota ?? 0) + Number(linhaRealizado?.cota ?? 0);
  // Com demanda tratada, a conta aparece inteira: (média + demanda) × peso.
  // Em duas linhas (média × peso, depois demanda × 0,2) ela confundia (08/10).
  const demanda = Number(linhaRealizado?.quantidade ?? 0);
  const contaComDemanda = linhaRealizado ? totalMedia + demanda : null;
  let composicao: { pessoa: string; cargo: string | null; resultado: number; comAtestado: number | null }[] = [];
  if (linhaMedia && cargoId) {
    const [referencias, cargos, resultados] = await Promise.all([
      db.from('cargos_referencia').select('referencia_id').eq('cargo_id', cargoId),
      db.from('cargos').select('id, nome'),
      db.from('vw_cota_mensal').select('pessoa_id, pessoa, cargo, resultado, compoe_media')
        .eq('mes_competencia', competencia),
    ]);
    const nomesReferencia = new Set(((referencias.data ?? []) as { referencia_id: number }[])
      .map((r) => ((cargos.data ?? []) as { id: number; nome: string }[])
        .find((c) => c.id === r.referencia_id)?.nome)
      .filter(Boolean) as string[]);
    const daMedia = ((resultados.data ?? []) as
      { pessoa_id: string; pessoa: string; cargo: string | null; resultado: number; compoe_media: boolean }[])
      // Quem trabalhou a competência pela metade não entra na média (migração
      // 23) e por isso não aparece aqui: listá-lo faria a conta não fechar.
      .filter((r) => r.compoe_media && r.cargo && nomesReferencia.has(r.cargo));
    // O valor que cada um levou para a média: congelado em mês fechado e sem
    // o atestado — senão a lista não fecha com a média (setembro/2026).
    const naMedia = await resultadosNaMedia(db, competencia, Boolean(congelado),
      new Map(daMedia.map((r) => [r.pessoa_id, Number(r.resultado)])));
    composicao = daMedia
      .map((r) => {
        const m = naMedia.get(r.pessoa_id);
        return { ...r, resultado: m?.valor ?? Number(r.resultado), comAtestado: m?.comAtestado ?? null };
      })
      .sort((a, b) => b.resultado - a.resultado);
  }

  // Só as semanas numeradas viram cartão; o que não tem semana entra no mês.
  const semanas = [...new Set(linhas.map((l) => l.semana))]
    .filter((s): s is number => s != null).sort((a, b) => a - b);

  // Ordem da planilha em todo quadro (1.18.0): atendimento e transferências,
  // TME, faixas de C-SAT, notas, monitoria e a demanda extra. O `ordem` do
  // catálogo sozinho não basta: o TME de Diretores (61–63) viria depois das
  // faixas (30–34) e das notas (40–44), que os dois canais dividem.
  const ETAPA: Record<string, number> = {
    media: 0, atendimento: 1, tme: 2, tme_diretores: 2, csat: 3, nota: 4, monitoria: 5,
  };
  const posicao = (grupo: string, ordem: number) => (ETAPA[grupo] ?? (ordem < 20 ? 1 : 6)) * 1000 + ordem;
  const naOrdem = <T extends { grupo: string; ordem: number }>(ls: T[]) =>
    [...ls].sort((a, b) => posicao(a.grupo, a.ordem) - posicao(b.grupo, b.ordem));
  const ORDEM_CANAL = ['huggy', 'diretores', 'geral'];
  const canaisDe = (ls: Linha[]) => [...new Set(ls.map((l) => chaveCanal(l.origem)))]
    .sort((a, b) => ORDEM_CANAL.indexOf(a) - ORDEM_CANAL.indexOf(b));

  const csatDe = (origem: Canal | null, semana: number | null) =>
    origem && semana ? semanal.find((c) => c.origem === origem && c.semana === semana) : undefined;

  // Mesma escala de cor do painel: verde na meta, âmbar atenção, rosa ruim.
  const tomCsat = (v: number) => v >= 0.9
    ? 'bg-marca-600/15 text-marca-700 dark:text-marca-400'
    : v >= 0.85 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
      : 'bg-rose-500/15 text-rose-700 dark:text-rose-300';
  const tomMonitoria = (v: number) => v > 0.85
    ? 'bg-marca-600/15 text-marca-700 dark:text-marca-400'
    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300';

  /** O C-SAT de um canal no cartão da semana, na cor da escala. */
  const etiquetaCsat = (canal: Canal, semana: number) => {
    const c = csatDe(canal, semana);
    return c ? (
      <span className={`rounded-md px-1.5 py-px font-semibold ${tomCsat(Number(c.csat))}`}>
        {canal === 'huggy' ? 'Exp' : 'Dir'} {percentual(Number(c.csat))}
      </span>
    ) : null;
  };

  /** O "Feito" de cada linha: a monitoria é média (percentual), não contagem. */
  const feito = (l: Pick<Linha, 'grupo' | 'quantidade'>) =>
    l.grupo === 'monitoria' ? percentual(Number(l.quantidade))
      : l.grupo === 'csat' ? num(Number(l.quantidade), 4) : num(Number(l.quantidade));

  /** Uma linha da tabela: rótulo, quantidade, peso e pontos. */
  const Linha = ({ l, detalhe }: { l: Linha; detalhe?: string }) => (
    <tr className="border-t border-slate-100">
      <td className="py-1.5 pr-2 text-slate-800">
        {l.rotulo}
        {detalhe && <span className="ml-2 text-xs font-semibold text-marca-700 dark:text-marca-400">{detalhe}</span>}
      </td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">{feito(l)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums text-slate-400">{num(Number(l.peso))}</td>
      <td className={`py-1.5 pl-2 text-right font-semibold tabular-nums ${
        Number(l.cota) < 0 ? 'text-rose-700' : 'text-slate-800'}`}>{num(Number(l.cota))}</td>
    </tr>
  );

  const Cabecalho = () => (
    <thead>
      <tr className="text-left text-[11px] text-slate-500">
        <th className="pb-1 pr-2 font-semibold">Categoria</th>
        <th className="px-2 pb-1 text-right font-semibold">Feito</th>
        <th className="px-2 pb-1 text-right font-semibold">Pontuação</th>
        <th className="pb-1 pl-2 text-right font-semibold">Cota</th>
      </tr>
    </thead>
  );

  // De onde vieram os pontos: cada regra somada no mês, os dois canais
  // juntos. Só o C-SAT fica separado por canal, porque a faixa de um canal
  // não diz nada sobre a do outro. A monitoria mostra a média das semanas.
  type Origem = { chave: string; rotulo: string; grupo: string; quantidade: number; cota: number; vezes: number };
  const porOrigem = new Map<string, Origem>();
  for (const l of linhas) {
    const chave = l.grupo === 'csat' ? `${l.regra}|${l.origem}` : l.regra;
    const o = porOrigem.get(chave) ?? {
      chave, grupo: l.grupo, quantidade: 0, cota: 0, vezes: 0,
      rotulo: l.grupo === 'csat' && l.origem ? `${l.rotulo} · ${NOME_CANAL[l.origem]}` : l.rotulo,
    };
    o.quantidade += Number(l.quantidade);
    o.cota += Number(l.cota);
    o.vezes += 1;
    porOrigem.set(chave, o);
  }
  const origens = [...porOrigem.values()].filter((o) => Math.abs(o.cota) >= 0.005).map((o) => ({
    ...o,
    detalhe: o.grupo === 'monitoria' ? `média ${percentual(o.quantidade / o.vezes)}`
      : o.grupo === 'media' ? '' : `${num(o.quantidade, 0)}×`,
  }));
  const somou = origens.filter((o) => o.cota > 0).sort((a, b) => b.cota - a.cota);
  const tirou = origens.filter((o) => o.cota < 0).sort((a, b) => a.cota - b.cota);
  const maiorOrigem = Math.max(1, ...origens.map((o) => Math.abs(o.cota)));

  return (
    <div className="space-y-6">
      {/* Topo no padrão das telas novas (1.18.0): de quem é o extrato, o mês
          com setas e, discreto, o cargo e a situação do mês. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">
            {veOTime ? `Extrato de ${(cota.data?.pessoa ?? lista.find((p) => p.id === pessoaId)?.nome ?? perfil.nome)
              .split(/\s+/).slice(0, 2).join(' ')}` : 'Seu extrato'}
          </h1>
          <div className="mt-1.5">
            <SetasDeCompetencia competencia={competencia} atual={atual} caminho="/cota/extrato" compacto
                                manter={{ pessoa: veOTime ? pessoaId : undefined }} />
          </div>
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-sobre-fundo-suave">
            {(congelado?.cargo ?? cota.data?.cargo) && <span>{congelado?.cargo ?? cota.data?.cargo}</span>}
            {congelado && <span className="font-semibold text-emerald-200">Competência fechada · valores congelados no fechamento</span>}
            {emAberto && <span className="opacity-75">{mesRotulo(atual)} ainda sem lançamentos</span>}
          </p>
        </div>

        {veOTime && (
          <form className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="mes" value={competencia.slice(0, 7)} />
            <label>
              <span className="mb-1 block text-xs font-medium text-sobre-fundo-suave">Pessoa</span>
              <select name="pessoa" defaultValue={pessoaId}
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-sm">
                {lista.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </label>
            <button className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5
                               text-sm font-medium text-slate-700 hover:bg-slate-50">
              Abrir
            </button>
          </form>
        )}
      </div>

      {/* O mês em uma linha, antes do detalhe: bateu a meta? quanto falta?
          quanto vale? Ficava na coluna da direita, que em janela média desce
          para depois de todas as semanas. */}
      {linhas.length > 0 && resultado != null && (
        <Quadro>
          <div className="grid items-center gap-x-10 gap-y-4 md:grid-cols-[auto_1fr_auto]">
            <div>
              <p className="text-sm text-slate-500">Resultado da competência</p>
              <p className="text-3xl font-semibold tabular-nums text-slate-900">
                {num(resultado, 0)} <span className="text-base font-normal text-slate-500">pts</span>
              </p>
            </div>

            {meta != null ? (
              <div>
                <BarraDeMeta atingimento={resultado / meta} escala={Math.max(1.25, resultado / meta)} />
                <p className="mt-2 text-sm text-slate-600">
                  Meta de {num(meta, 0)} pts
                  {resultado < meta
                    ? <> · <strong className="text-amber-700">faltam {num(meta - resultado, 0)} pts</strong></>
                    : ` · ${num(resultado - meta, 0)} pts acima`}
                </p>
              </div>
            ) : <span />}

            {pagamento ? (
              <div className="md:text-right">
                {pagamento.atingiu_meta ? (
                  pagamento.valor == null ? (
                    <p className="text-sm text-slate-600">Valor por ponto ainda não informado.</p>
                  ) : (
                    <>
                      <p className="text-2xl font-semibold tabular-nums text-marca-700 dark:text-marca-400">
                        {reais(pagamento.valor)}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {num(Number(pagamento.pontos_pagos))} pts
                        {Number(pagamento.bonus) > 0
                          && ` (${num(Number(resultado))} + ${num(Number(pagamento.bonus))} de bônus de equipe)`}
                        {' × '}{reais(Number(pagamento.valor_por_ponto), 6)} por ponto
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500 opacity-60">
                        *Valores aproximados. Os valores reais são encaminhados via Teams.
                      </p>
                    </>
                  )
                ) : (
                  <p className="text-sm text-slate-600">Abaixo da meta: esta competência não gera valor.</p>
                )}
              </div>
            ) : (
              <p className="text-sm text-slate-500 md:text-right">
                {congelado ? 'Valor por ponto ainda não informado.' : 'O valor sai no fechamento.'}
              </p>
            )}
          </div>
        </Quadro>
      )}

      {linhas.length === 0 ? (
        <Quadro titulo="Extrato"><Vazio>Nenhum ponto nesta competência.</Vazio></Quadro>
      ) : (
        <>
          {/* De onde vieram os pontos (1.18.0): cada categoria somada no mês,
              os dois canais e a monitoria juntos, do que mais somou ao que
              mais tirou. Responde "por que deu isso" antes das tabelas. */}
          <Quadro titulo="De onde vieram os pontos"
                  subtitulo="Cada categoria no mês, do que mais somou ao que mais tirou — os dois canais e a monitoria juntos.">
            <div className="grid gap-x-12 gap-y-6 lg:grid-cols-2">
              {([
                ['O que somou', somou, '+'],
                ['O que tirou', tirou, '−'],
              ] as const).map(([titulo, itens, sinal]) => (
                <div key={titulo}>
                  <h3 className="mb-2 text-[13px] font-semibold text-slate-500">
                    {titulo}
                    {itens.length > 0 && ` · ${sinal}${num(Math.abs(itens.reduce((a, i) => a + i.cota, 0)), 1)}`}
                  </h3>
                  {itens.length === 0 ? (
                    <p className="text-sm text-slate-500">Nada neste mês.</p>
                  ) : (
                    <ul className="grid gap-2.5">
                      {itens.map((i) => (
                        <li key={i.chave} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 text-sm">
                          <span className="truncate text-slate-700">
                            {i.rotulo}
                            {i.detalhe && <span className="ml-1.5 text-xs text-slate-500">{i.detalhe}</span>}
                          </span>
                          <span className={`text-right font-semibold tabular-nums ${
                            i.cota < 0 ? 'text-rose-700 dark:text-rose-300' : 'text-marca-700 dark:text-marca-400'}`}>
                            {i.cota < 0 ? '−' : '+'}{num(Math.abs(i.cota), 1)}
                          </span>
                          <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <span className={`crescer-x block h-full origin-left rounded-full ${
                              i.cota < 0 ? 'bg-rose-500' : 'bg-marca-600'}`}
                                  style={{ transform: `scaleX(${Math.max(0.02, Math.abs(i.cota) / maiorOrigem)})` }} />
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Quadro>

          {/* As semanas lado a lado; o clique abre o detalhe logo abaixo. */}
          {semanas.length > 0 && (
            <SeletorDeDetalhe inicial={null} alternar rotulo="Semanas do mês"
                              grade={`sm:grid-cols-2 ${semanas.length > 4 ? 'xl:grid-cols-5' : 'xl:grid-cols-4'}`}
                              destaques={semanas.map((semana) => {
              const daSemana = linhas.filter((l) => l.semana === semana);
              const soma = daSemana.reduce((a, l) => a + Number(l.cota), 0);
              const monitoria = daSemana.find((l) => l.grupo === 'monitoria');
              const canais = canaisDe(daSemana);
              return {
                chave: `s${semana}`,
                // Fragmento na raiz, como na tela inicial: com <div> o React acusa
                // lista sem chave ao hidratar o cartão vindo do servidor.
                bloco: (
                  <>
                    <p className="tabular-nums text-[13px] text-slate-500">{semana}ª semana</p>
                    <p className={`tabular-nums text-2xl font-semibold ${soma < 0 ? 'text-rose-700' : 'text-slate-900'}`}>
                      {num(soma, 0)} pts
                    </p>
                    <p className="tabular-nums mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                      C-SAT
                      {etiquetaCsat('huggy', semana)}
                      {etiquetaCsat('diretores', semana)}
                    </p>
                    <p className="tabular-nums mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                      Monitoria
                      {monitoria ? (
                        <span className={`rounded-md px-1.5 py-px font-semibold ${tomMonitoria(Number(monitoria.quantidade))}`}>
                          {percentual(Number(monitoria.quantidade))}
                        </span>
                      ) : <span className="text-slate-400">—</span>}
                    </p>
                  </>
                ),
                detalhe: (
                  <div className="grid items-start gap-4 xl:grid-cols-3">
                    {canais.map((canal) => {
                      const doCanal = naOrdem(daSemana.filter((l) => chaveCanal(l.origem) === canal));
                      const c = csatDe(canal === 'geral' ? null : canal as Canal, semana);
                      const somaCanal = doCanal.reduce((a, l) => a + Number(l.cota), 0);
                      return (
                        <Quadro key={canal} titulo={`${NOME_CANAL[canal]} · ${semana}ª semana`}
                                subtitulo={c ? `C-SAT ${percentual(Number(c.csat))} · ${c.positivas} de ${c.avaliacoes}` : undefined}
                                acao={<span className={`text-sm font-semibold tabular-nums ${
                                  somaCanal < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{num(somaCanal)} pts</span>}>
                          <table className="w-full text-sm">
                            <Cabecalho />
                            <tbody>
                              {doCanal.map((l) => (
                                <Linha key={`${l.regra}-${l.origem ?? 'sem'}`} l={l}
                                       detalhe={l.grupo === 'csat' && c ? percentual(Number(c.csat)) : undefined} />
                              ))}
                            </tbody>
                          </table>
                        </Quadro>
                      );
                    })}
                  </div>
                ),
              };
            })} />
          )}

          <h2 className="pt-2 text-base font-semibold text-sobre-fundo">Resumo geral do mês</h2>
          <div className="grid items-start gap-4 xl:grid-cols-3">
            {linhaMedia && (
              <Quadro
                className="xl:col-span-3"
                titulo="Como a média foi formada"
                acao={<span className="text-sm font-semibold tabular-nums text-slate-900">
                  {um(contaComDemanda ?? totalMedia)} pts
                </span>}
              >
                {composicao.length === 0 ? (
                  <p className="text-sm text-slate-600">
                    Média dos cargos de referência: <strong className="tabular-nums">{um(Number(linhaMedia.quantidade))}</strong> pts.
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
                            <span className="block text-[10px] text-slate-400">
                              {c.cargo}
                              {c.comAtestado != null && ` · ${um(c.comAtestado)} com o atestado`}
                            </span>
                          </span>
                          <span className="font-semibold tabular-nums text-slate-800">{um(c.resultado)}</span>
                        </li>
                      ))}
                    </ul>

                    {contaComDemanda != null ? (
                      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-6 gap-y-1.5 border-t border-slate-100 pt-3 text-sm">
                        <dt className="text-slate-600">Média da equipe recebida</dt>
                        <dd className="font-semibold tabular-nums text-slate-800">
                          {um(Number(linhaMedia.quantidade))}
                          <span className="ml-2 text-xs font-normal text-slate-500">média de {composicao.length} pessoa(s)</span>
                        </dd>
                        <dt className="text-slate-600">Demanda tratada</dt>
                        <dd className="font-semibold tabular-nums text-slate-800">{um(demanda)}</dd>
                        <dt className="text-slate-600">Cálculo</dt>
                        <dd className="tabular-nums text-slate-800">
                          ({um(Number(linhaMedia.quantidade))} + {um(demanda)}) × {num(Number(linhaMedia.peso))} ={' '}
                          <span className="text-lg font-semibold text-marca-700 dark:text-marca-400">{um(contaComDemanda)} pts</span>
                        </dd>
                      </dl>
                    ) : (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-sm">
                        <span className="text-slate-600">Média de {composicao.length} pessoa(s)</span>
                        <span className="font-semibold tabular-nums text-slate-800">{um(Number(linhaMedia.quantidade))}</span>
                        <span className="text-slate-400">×</span>
                        <span className="text-slate-600">multiplicador</span>
                        <span className="font-semibold tabular-nums text-slate-800">{num(Number(linhaMedia.peso))}</span>
                        <span className="text-slate-400">=</span>
                        <span className="text-lg font-semibold tabular-nums text-marca-700 dark:text-marca-400">
                          {um(Number(linhaMedia.cota))} pts
                        </span>
                        <span className="text-xs text-slate-500">
                          ({Number(linhaMedia.peso) >= 1 ? '+' : ''}{Math.round((Number(linhaMedia.peso) - 1) * 100)}% sobre a média)
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </Quadro>
            )}

            {canaisDe(linhas.filter((l) => l.regra !== 'media_da_equipe' && l.regra !== 'media_sobre_realizado')).map((canal) => {
              const doCanal = linhas.filter((l) => chaveCanal(l.origem) === canal && l.regra !== 'media_da_equipe' && l.regra !== 'media_sobre_realizado');
              const soma = doCanal.reduce((a, l) => a + Number(l.cota), 0);

              // Cada categoria somada no mês; o C-SAT tem tratamento próprio.
              // A monitoria é a média das semanas (cada semana já é a média
              // das monitorias dela), não a soma; a cota, essa sim, soma.
              const categorias = [...new Map(doCanal.filter((l) => l.grupo !== 'csat')
                .map((l) => [l.regra, l])).values()]
                .map((base) => {
                  const iguais = doCanal.filter((l) => l.regra === base.regra);
                  const total = iguais.reduce((a, l) => a + Number(l.quantidade), 0);
                  return {
                    ...base,
                    quantidade: base.grupo === 'monitoria' ? total / iguais.length : total,
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

              // As faixas entram no lugar delas na sequência da planilha:
              // depois do TME e antes das notas.
              const antes = naOrdem(categorias).filter((l) => posicao(l.grupo, l.ordem) < posicao('csat', 0));
              const depois = naOrdem(categorias).filter((l) => posicao(l.grupo, l.ordem) >= posicao('csat', 0));
              const monitoria = categorias.find((l) => l.grupo === 'monitoria');

              return (
                <Quadro
                  key={canal}
                  titulo={NOME_CANAL[canal]}
                  acao={<span className={`text-sm font-semibold tabular-nums ${
                    soma < 0 ? 'text-rose-700' : 'text-slate-900'}`}>{num(soma)} pts</span>}
                >
                  <table className="w-full text-sm">
                    <Cabecalho />
                    <tbody>
                      {antes.map((l) => <Linha key={l.regra} l={l} />)}

                      {linhasFaixa.length > 0 && (
                        <tr className="border-t border-slate-200">
                          <td colSpan={4} className="pb-1 pt-3">
                            <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold
                                             text-slate-600">
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
                      {linhasFaixa.length > 0 && depois.length > 0 && (
                        <tr><td colSpan={4} className="pt-2" /></tr>
                      )}

                      {depois.map((l) => <Linha key={l.regra} l={l} />)}
                    </tbody>
                  </table>
                  {monitoria && (
                    <p className="mt-3 text-xs leading-relaxed text-slate-500">
                      Monitoria: cada semana vale a média das monitorias dela, e o mês mostra a média das
                      semanas. A cota soma o que cada semana rendeu.
                    </p>
                  )}
                </Quadro>
              );
            })}
          </div>
        </>
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
