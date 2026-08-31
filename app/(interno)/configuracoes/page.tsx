import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import PainelCriterios from '@/componentes/PainelCriterios';
import PainelPessoas from '@/componentes/PainelPessoas';
import PainelCadastro from '@/componentes/PainelCadastro';
import type { Canal, Criterio, Pessoa } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export default async function Configuracoes() {
  await exigirGestor();
  const db = await criarClienteServidor();

  const [{ data: criterios }, { data: pessoas }, { data: canais }] = await Promise.all([
    db.from('criterios').select('*').order('ordem'),
    db.from('pessoas').select('*').order('nome'),
    db.from('canais').select('*').order('nome'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-sobre-fundo">Configurações</h1>
        <p className="text-sm text-sobre-fundo-suave">
          Critérios e pesos, cadastro de pessoas e canais.
        </p>
      </div>

      <PainelCriterios criterios={(criterios ?? []) as Criterio[]} />

      <PainelPessoas pessoas={(pessoas ?? []) as Pessoa[]} />

      <PainelCadastro
        titulo="Canais de atendimento"
        subtitulo="Por onde o atendimento chegou. Vira opção no formulário de monitoria."
        tabela="canais"
        registros={(canais ?? []) as Canal[]}
      />
    </div>
  );
}
