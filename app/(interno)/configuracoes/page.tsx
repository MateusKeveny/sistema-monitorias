import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import PainelCriterios from '@/componentes/PainelCriterios';
import PainelPessoas from '@/componentes/PainelPessoas';
import PainelCadastro from '@/componentes/PainelCadastro';
import { setorDoCookie } from '@/lib/setorEscolhido';
import type { Canal, Criterio, Pessoa } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export default async function Configuracoes({ searchParams }: { searchParams: Promise<{ setor?: string }> }) {
  await exigirGestor();
  const { setor: setorPedido } = await searchParams;
  const escolhido = await setorDoCookie();
  const db = await criarClienteServidor();

  const [{ data: criterios }, { data: pessoas }, { data: canais }, { data: setores }] = await Promise.all([
    db.from('criterios').select('*').order('ordem'),
    db.from('pessoas').select('*').order('nome'),
    db.from('canais').select('*').order('nome'),
    // Monitorias 6.0: cada setor com monitorias tem o seu formulário.
    db.from('setores').select('id, nome, monitorias').eq('ativo', true).order('ordem'),
  ]);
  const comMonitorias = ((setores ?? []) as { id: number; nome: string; monitorias: boolean | null }[])
    .filter((s) => s.monitorias !== false);
  const setorId = comMonitorias.find((s) => String(s.id) === (setorPedido ?? escolhido))?.id ?? comMonitorias[0]?.id ?? 1;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Configurações</h1>
        <p className="text-sm text-sobre-fundo-suave">
          Critérios e pesos, cadastro de pessoas e canais.
        </p>
      </div>

      <PainelCriterios key={setorId} setorId={setorId}
                       criterios={((criterios ?? []) as Criterio[]).filter((c) => (c.setor_id ?? 1) === setorId)} />

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
