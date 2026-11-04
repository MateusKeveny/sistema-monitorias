import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import ConferenciaDoCalculo, { type Rodada } from '@/componentes/ConferenciaDoCalculo';
import { hojeNoBrasil, mesDeCompetencia, mesRotulo, semanaDoCiclo } from '@/lib/formatar';
import { fonteDoMes } from '@/lib/resumo';
import { conferirNumerosDoMes, pendentesDaConferencia, type Csat, type Volume } from '@/lib/conferenciaDoMes';

export const dynamic = 'force-dynamic';

/**
 * Conferência do cálculo (2.1.0, migração 72): a última rodada (automática às
 * 06:00 ou pedida pelo gestor) e a conferência da simulação no mês aberto.
 * Na 3.5.0, também a conferência dos números do mês (a do Fechamento).
 */
export default async function Conferencia() {
  await exigirGestor();
  const competencia = mesDeCompetencia(hojeNoBrasil());
  const db = await criarClienteServidor();
  const [{ data: ultima }, fonte, { data: volumes }, { data: csats }] = await Promise.all([
    db.from('conferencias_calculo').select('rodada_em, por, falhas, resultado')
      .order('rodada_em', { ascending: false }).limit(1).maybeSingle(),
    fonteDoMes(competencia),
    db.from('volume_semanal').select('pessoa_id, semana, canal, finalizados').eq('mes_competencia', competencia),
    db.from('vw_csat_semanal').select('pessoa_id, semana, origem, avaliacoes, positivas').eq('mes_competencia', competencia),
  ]);
  const { data: pessoas } = await db.from(fonte.mensal).select('pessoa_id, pessoa').eq('mes_competencia', competencia);
  const semanasEncerradas = Math.max(0, semanaDoCiclo(hojeNoBrasil()) - 1);
  const importadas = new Set(((volumes ?? []) as Volume[]).map((v) => v.semana).filter((x) => x <= semanasEncerradas)).size;
  const todosAlertas = await conferirNumerosDoMes(db, {
    competencia, semanasEncerradas,
    pessoas: (pessoas ?? []) as { pessoa_id: string; pessoa: string }[],
    volumes: (volumes ?? []) as Volume[],
    csats: (csats ?? []) as Csat[],
  });
  const alertas = pendentesDaConferencia(todosAlertas);
  const cientes = todosAlertas.length - alertas.length;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Conferência do cálculo</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">Se os números que o sistema mostra e congela batem entre si.</p>
      </div>
      <ConferenciaDoCalculo ultima={(ultima ?? null) as Rodada | null} competencia={competencia}
                            fonte={{ extrato: fonte.extrato, mensal: fonte.mensal }}
                            numeros={{
                              chave: 'numeros', titulo: 'Números do mês dentro do padrão (finalizados × avaliações × C-SAT)',
                              ok: alertas.length === 0,
                              detalhe: semanasEncerradas === 0
                                ? `${mesRotulo(competencia).toLowerCase()}: nenhuma semana encerrada ainda`
                                : `${mesRotulo(competencia).toLowerCase()}: ${semanasEncerradas} semana${semanasEncerradas > 1 ? 's' : ''} encerrada${semanasEncerradas > 1 ? 's' : ''}`
                                  + (importadas < semanasEncerradas ? ` (${importadas ? `${importadas} com volume importado` : 'nenhuma com volume importado ainda'})` : '')
                                  + (alertas.length ? `, ${alertas.length} fora do padrão — confira no Fechamento` : '')
                                  + (cientes ? ` · ${cientes} já conferido${cientes > 1 ? 's' : ''} (ciente)` : ''),
                              itens: alertas.map((a) => `${a.grave ? '' : '(atenção) '}${a.pessoa}: ${a.texto}`),
                            }} />
    </div>
  );
}
