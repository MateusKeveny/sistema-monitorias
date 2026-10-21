import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import ConferenciaDoCalculo, { type Rodada } from '@/componentes/ConferenciaDoCalculo';
import { hojeNoBrasil, mesDeCompetencia } from '@/lib/formatar';
import { fonteDoMes } from '@/lib/resumo';

export const dynamic = 'force-dynamic';

/**
 * Conferência do cálculo (2.1.0, migração 72): a última rodada (automática às
 * 06:00 ou pedida pelo gestor) e a conferência da simulação no mês aberto.
 */
export default async function Conferencia() {
  await exigirGestor();
  const competencia = mesDeCompetencia(hojeNoBrasil());
  const db = await criarClienteServidor();
  const [{ data: ultima }, fonte] = await Promise.all([
    db.from('conferencias_calculo').select('rodada_em, por, falhas, resultado')
      .order('rodada_em', { ascending: false }).limit(1).maybeSingle(),
    fonteDoMes(competencia),
  ]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Conferência do cálculo</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">Se os números que o sistema mostra e congela batem entre si.</p>
      </div>
      <ConferenciaDoCalculo ultima={(ultima ?? null) as Rodada | null} competencia={competencia}
                            fonte={{ extrato: fonte.extrato, mensal: fonte.mensal }} />
    </div>
  );
}
