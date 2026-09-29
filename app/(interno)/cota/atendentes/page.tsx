import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import PainelAtendentes from '@/componentes/PainelAtendentes';
import { mesAnterior } from '@/lib/competencia';
import { hojeNoBrasil, mesDeCompetencia, periodoDaSemana } from '@/lib/formatar';
import type { Cargo, CargoDaPessoa, Pessoa, Saida } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

/**
 * Atendentes: quem está na operação, o cargo, o vínculo com o Hub, o que
 * aparece na tela inicial e o registro de quem saiu — tudo na ficha da pessoa.
 *
 * A tela mora só aqui, mas o efeito é dos dois sistemas — o cadastro de
 * pessoas é o mesmo banco, e encerrar o acesso encerra também o das
 * monitorias.
 */
export default async function Atendentes() {
  await exigirGestor();
  const db = await criarClienteServidor();

  const [{ data: pessoas }, { data: saidas }, { data: cargos }, { data: historico }] = await Promise.all([
    db.from('pessoas').select('*').order('nome'),
    db.from('saidas').select('*').order('data', { ascending: false }),
    db.from('cargos').select('*').eq('ativo', true).order('ordem'),
    db.from('cargos_da_pessoa').select('*'),
  ]);

  const competencia = mesDeCompetencia(hojeNoBrasil());
  const [inicioDoCicloAnterior] = periodoDaSemana(mesAnterior(competencia), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Atendentes</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">
          Entrada, cargo, vínculo com o Hub, tela inicial e saída — tudo de uma pessoa num lugar só.
          Vale para os dois sistemas.
        </p>
      </div>

      <PainelAtendentes
        pessoas={(pessoas ?? []) as Pessoa[]}
        saidas={(saidas ?? []) as Saida[]}
        cargos={(cargos ?? []) as Cargo[]}
        historico={(historico ?? []) as CargoDaPessoa[]}
        competencia={competencia}
        inicioDoCicloAnterior={inicioDoCicloAnterior}
      />
    </div>
  );
}
