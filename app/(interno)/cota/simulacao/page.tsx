import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import SimuladorDeCenarios from '@/componentes/SimuladorDeCenarios';
import { resolverCompetencia } from '@/lib/competencia';
import { fonteDoMes } from '@/lib/resumo';
import { dados, todas } from '@/lib/consultas';
import { mesRotulo, periodoDaSemana } from '@/lib/formatar';
import type { Base, LinhaDoExtrato } from '@/lib/simulacao';

export const dynamic = 'force-dynamic';

const CAMPOS = 'pessoa_id, semana, origem, regra, rotulo, grupo, ordem, cargo_id, cargo, quantidade, peso, cota';
const PAGINA = 1000;

/**
 * Simulação (1.53.0): o mês aberto com outro cenário — TME de uma semana fora,
 * outro peso, outra meta, faixas de C-SAT diferentes, uma semana tirada de
 * alguém, presenciais a mais. Só o gestor. Nada é gravado: a tela carrega o
 * extrato de hoje e o cálculo do cenário roda no navegador (lib/simulacao.ts).
 */
export default async function Simulacao() {
  const [, { competencia }] = await todas([exigirGestor(), resolverCompetencia()]);
  const db = await criarClienteServidor();
  const fonte = await fonteDoMes(competencia);

  // O extrato passa de 1.000 linhas (o teto do PostgREST): lido em páginas.
  async function linhas(): Promise<LinhaDoExtrato[]> {
    const todasAsLinhas: LinhaDoExtrato[] = [];
    for (let de = 0; ; de += PAGINA) {
      const pagina = dados(await db.from(fonte.extrato).select(CAMPOS).eq('mes_competencia', competencia)
        .order('pessoa_id').order('semana', { nullsFirst: false }).order('ordem').order('regra')
        .range(de, de + PAGINA - 1)) as LinhaDoExtrato[];
      todasAsLinhas.push(...pagina);
      if (pagina.length < PAGINA) return todasAsLinhas;
    }
  }

  const [extrato, mensal, faixas, pesos, referencias, tme, desligadas, volume, csat, fechado, cargos] = await todas([
    linhas(),
    db.from(fonte.mensal).select('pessoa_id, pessoa, cargo, resultado, meta, compoe_media').eq('mes_competencia', competencia),
    db.from('regras').select('chave, rotulo, grupo, faixa_min, faixa_max, ordem').eq('ativo', true),
    db.from('pesos_por_cargo').select('cargo_id, regra, peso').eq('ativo', true),
    db.from('cargos_referencia').select('cargo_id, referencia_id'),
    db.from('vw_tme_equipe').select('semana, canal, tme_seg').eq('mes_competencia', competencia),
    db.rpc('semanas_sem_tme', { p_mes: competencia }),
    db.from('volume_semanal').select('pessoa_id, semana, canal, finalizados').eq('mes_competencia', competencia),
    db.from('vw_csat_semanal').select('pessoa_id, origem, semana, csat').eq('mes_competencia', competencia),
    db.from('fechamentos_cota').select('id', { count: 'exact', head: true }).eq('mes_competencia', competencia),
    db.from('cargos').select('id, nome'),
  ]);

  const num = <T extends object>(l: T[], campos: (keyof T)[]) =>
    l.map((x) => ({ ...x, ...Object.fromEntries(campos.map((c) => [c, x[c] == null ? null : Number(x[c])])) }));

  const base: Base = {
    linhas: num(extrato, ['quantidade', 'peso', 'cota']) as LinhaDoExtrato[],
    pessoas: num((mensal.data ?? []) as Base['pessoas'], ['resultado', 'meta']) as Base['pessoas'],
    faixas: num((faixas.data ?? []) as Base['faixas'], ['faixa_min', 'faixa_max']) as Base['faixas'],
    pesos: num((pesos.data ?? []) as Base['pesos'], ['peso']) as Base['pesos'],
    referencias: (referencias.data ?? []) as Base['referencias'],
    tme: num((tme.data ?? []) as Base['tme'], ['tme_seg']) as Base['tme'],
    tmeDesligado: ((desligadas.data ?? []) as { semana: number; canal: string }[]).map((d) => `${d.semana}|${d.canal}`),
    volume: num((volume.data ?? []) as Base['volume'], ['finalizados']) as Base['volume'],
    csat: num((csat.data ?? []) as Base['csat'], ['csat']) as Base['csat'],
  };

  const periodos = [1, 2, 3, 4].map((s) => periodoDaSemana(competencia, s));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Simulação</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">
          {mesRotulo(competencia)} · mês aberto · parte do extrato de hoje
        </p>
      </div>
      {(fechado.count ?? 0) > 0 ? (
        <p className="rounded-2xl bg-superficie px-5 py-4 text-sm text-slate-600 shadow-sm">
          {mesRotulo(competencia)} já está fechado. A simulação é só do mês aberto.
        </p>
      ) : (
        <SimuladorDeCenarios base={base} periodos={periodos}
                             cargos={((cargos.data ?? []) as { id: number; nome: string }[])} />
      )}
    </div>
  );
}
