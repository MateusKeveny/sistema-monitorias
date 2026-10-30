import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import SetasDeCompetencia from '@/componentes/SetasDeCompetencia';
import PainelMetricasDaSemana, { type SemanaDoCanal } from '@/componentes/PainelMetricasDaSemana';
import { resolverCompetencia } from '@/lib/competencia';
import { fonteDoMes } from '@/lib/resumo';
import { todas } from '@/lib/consultas';
import { diaMes, periodoDaSemana } from '@/lib/formatar';

export const dynamic = 'force-dynamic';

const CANAIS = [
  { chave: 'huggy', nome: 'Expansão', grupo: 'tme' },
  { chave: 'diretores', nome: 'Diretores-Expansão', grupo: 'tme_diretores' },
] as const;

type Desligada = {
  semana: number; canal: string; motivo: string; tem_registro_diario: boolean;
  diario_registro_id: string | null; desligado_por_nome: string | null; desligado_em: string;
};
type Faixa = { chave: string; rotulo: string; grupo: string; faixa_min: number | null; faixa_max: number | null };

/**
 * Métricas da semana (1.49.0, migração 66): o gestor desliga o TME de uma
 * semana de um canal — a faixa deixa de entrar no extrato da equipe toda
 * daquele canal —, com o motivo e o registro do diário de bordo, se houve.
 * Só a gestão vê o motivo. Mês fechado fica só para consulta.
 */
export default async function MetricasDaSemana({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const [, { competencia, atual }] = await todas([exigirGestor(), resolverCompetencia(mes)]);
  const db = await criarClienteServidor();
  const fonte = await fonteDoMes(competencia);
  const [de] = periodoDaSemana(competencia, 1);
  const [, ate] = periodoDaSemana(competencia, 4);

  const [tme, volume, desligadas, faixas, efeito, fechado, diario, filas] = await todas([
    db.from('vw_tme_equipe').select('semana, canal, tme_seg').eq('mes_competencia', competencia),
    db.from('volume_semanal').select('semana, canal, finalizados, tme_seg').eq('mes_competencia', competencia),
    db.from('metricas_desligadas').select('semana, canal, motivo, tem_registro_diario, diario_registro_id, desligado_por_nome, desligado_em')
      .eq('mes_competencia', competencia),
    db.from('regras').select('chave, rotulo, grupo, faixa_min, faixa_max').in('grupo', ['tme', 'tme_diretores']),
    // O que a faixa de TME rendeu (ou tirou) na semana, somado na equipe.
    db.from(fonte.extrato).select('semana, origem, cota').eq('mes_competencia', competencia)
      .in('grupo', ['tme', 'tme_diretores']),
    db.from('fechamentos_cota').select('id', { count: 'exact', head: true }).eq('mes_competencia', competencia),
    db.from('diario_registros').select('id, data, tipo, assunto').gte('data', de).lte('data', ate)
      .order('data'),
    // TME por pessoa (migração 90): as filas e desde quando.
    db.from('canais_do_setor').select('*'),
  ]);
  const porPessoa = (fila: string) => ((filas.data ?? []) as { apelido: string | null; tme_por_pessoa_desde?: string | null }[])
    .some((f) => f.apelido === fila && !!f.tme_por_pessoa_desde && f.tme_por_pessoa_desde <= competencia);

  const listaDesligadas = (desligadas.data ?? []) as Desligada[];
  const registros = (diario.data ?? []) as { id: string; data: string; tipo: string; assunto: string }[];
  // Registro vinculado de fora do mês (raro): busca pelo id para mostrar o assunto.
  const faltam = listaDesligadas.map((d) => d.diario_registro_id)
    .filter((id): id is string => !!id && !registros.some((r) => r.id === id));
  if (faltam.length) {
    const { data } = await db.from('diario_registros').select('id, data, tipo, assunto').in('id', faltam);
    registros.push(...((data ?? []) as typeof registros));
  }

  const canais = CANAIS.map((c) => ({
    chave: c.chave,
    nome: c.nome,
    semanas: [1, 2, 3, 4].map((s): SemanaDoCanal => {
      const [ini, fim] = periodoDaSemana(competencia, s);
      const t = ((tme.data ?? []) as { semana: number; canal: string; tme_seg: number }[])
        .find((x) => x.semana === s && x.canal === c.chave);
      const tmeSeg = t?.tme_seg != null && Number(t.tme_seg) > 0 ? Number(t.tme_seg) : null;
      const faixa = tmeSeg == null ? null : ((faixas.data ?? []) as Faixa[]).find((f) => f.grupo === c.grupo
        && (f.faixa_min == null || tmeSeg >= Number(f.faixa_min)) && (f.faixa_max == null || tmeSeg < Number(f.faixa_max)));
      const finalizados = ((volume.data ?? []) as { semana: number; canal: string; finalizados: number }[])
        .filter((v) => v.semana === s && v.canal === c.chave).reduce((a, v) => a + Number(v.finalizados), 0);
      const pontos = ((efeito.data ?? []) as { semana: number; origem: string; cota: number }[])
        .filter((e) => e.semana === s && e.origem === c.chave).reduce((a, e) => a + Number(e.cota), 0);
      const d = listaDesligadas.find((x) => x.semana === s && x.canal === c.chave);
      return {
        semana: s,
        periodo: `${diaMes(ini)} a ${diaMes(fim)}`,
        de: ini,
        ate: fim,
        tmeSeg,
        faixa: faixa?.rotulo ?? null,
        finalizados,
        pontos,
        // Fila que avalia por pessoa: quantos caíram em cada faixa (sem TME = melhor faixa).
        porPessoa: !porPessoa(c.chave) ? null : ((faixas.data ?? []) as Faixa[])
          .filter((f) => f.grupo === c.grupo)
          .sort((a, b) => Number(a.faixa_min ?? -1) - Number(b.faixa_min ?? -1))
          .map((f) => ({
            faixa: f.rotulo,
            pessoas: ((volume.data ?? []) as { semana: number; canal: string; tme_seg: number | null }[])
              .filter((v) => v.semana === s && v.canal === c.chave).filter((v) => {
                const t = Number(v.tme_seg ?? 0);
                return (f.faixa_min == null || t >= Number(f.faixa_min)) && (f.faixa_max == null || t < Number(f.faixa_max));
              }).length,
          })).filter((x) => x.pessoas > 0),
        desligada: d ? {
          motivo: d.motivo,
          temRegistroDiario: d.tem_registro_diario,
          registro: registros.find((r) => r.id === d.diario_registro_id) ?? null,
          por: d.desligado_por_nome,
          em: d.desligado_em,
        } : null,
      };
    }),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Métricas da semana</h1>
        <div className="mt-1.5">
          <SetasDeCompetencia competencia={competencia} atual={atual} caminho="/cota/metricas" compacto />
        </div>
        <p className="mt-2 max-w-3xl text-xs leading-relaxed text-sobre-fundo-suave">
          O TME conta pela equipe: a faixa sai do TME médio do canal na semana e vale para os atendimentos de
          todos. Numa semana atípica, desligue a chave — a faixa deixa de entrar no extrato da equipe toda do
          canal. O motivo fica registrado e só a gestão vê.
          {(fechado.count ?? 0) > 0 && <strong className="ml-1 text-sobre-fundo-atencao">Este mês já foi fechado: só consulta.</strong>}
        </p>
      </div>
      <PainelMetricasDaSemana competencia={competencia} canais={canais} registros={registros}
                              fechado={(fechado.count ?? 0) > 0} />
    </div>
  );
}
