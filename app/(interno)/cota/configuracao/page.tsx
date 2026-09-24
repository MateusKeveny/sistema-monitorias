import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import PainelCargos from '@/componentes/PainelCargos';
import PainelCargosDaPessoa from '@/componentes/PainelCargosDaPessoa';
import PainelRegras from '@/componentes/PainelRegras';
import type { Cargo, CargoDaPessoa, PesoCargo, Pessoa, ReferenciaCargo, RegraCota } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export default async function ConfiguracaoDaCota() {
  await exigirGestor();
  const db = await criarClienteServidor();

  const [
    { data: pessoas }, { data: cargos }, { data: regras },
    { data: pesos }, { data: referencias }, { data: historico },
  ] = await Promise.all([
    // Inclui quem foi desligado: o cargo dele decide como os meses em que ele
    // trabalhou são calculados, e isso precisa continuar ajustável depois da saída.
    db.from('pessoas').select('*').order('ativo', { ascending: false }).order('nome'),
    db.from('cargos').select('*').eq('ativo', true).order('ordem'),
    db.from('regras').select('*').order('ordem'),
    db.from('pesos_por_cargo').select('cargo_id, regra, peso, ativo'),
    db.from('cargos_referencia').select('*'),
    db.from('cargos_da_pessoa').select('*'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-sobre-fundo">Configuração</h1>
        <p className="text-sm text-sobre-fundo-suave">
          Cargos, pesos, metas, métricas e o cargo de cada pessoa.
        </p>
      </div>

      <PainelCargos
        cargos={(cargos ?? []) as Cargo[]}
        regras={(regras ?? []) as RegraCota[]}
        pesos={(pesos ?? []) as PesoCargo[]}
        referencias={(referencias ?? []) as ReferenciaCargo[]}
      />

      <PainelRegras regras={(regras ?? []) as RegraCota[]} />

      <PainelCargosDaPessoa
        pessoas={(pessoas ?? []) as Pessoa[]}
        cargos={(cargos ?? []) as Cargo[]}
        historico={(historico ?? []) as CargoDaPessoa[]}
      />
    </div>
  );
}
