import { criarClienteServidor, exigirMonitor } from '@/lib/supabase/servidor';
import FormularioMonitoria from '@/componentes/FormularioMonitoria';
import { mesAbertoDasMonitorias } from '@/lib/mes-aberto';
import type { Criterio, Operador, Canal } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export default async function NovaMonitoria({
  searchParams,
}: {
  searchParams: Promise<{ operador?: string }>;
}) {
  const { operador } = await searchParams;
  const perfil = await exigirMonitor();
  const db = await criarClienteServidor();

  const [{ data: criterios }, { data: operadores }, { data: canais }] = await Promise.all([
    db.from('criterios').select('*').eq('ativo', true).order('ordem'),
    db.from('pessoas').select('*').eq('avaliado', true).eq('ativo', true).order('nome'),
    db.from('canais').select('*').eq('ativo', true).order('nome'),
  ]);
  const lista = (operadores ?? []) as Operador[];

  return (
    <FormularioMonitoria
      perfilId={perfil.id}
      criterios={(criterios ?? []) as Criterio[]}
      operadores={lista}
      canais={(canais ?? []) as Canal[]}
      mesAberto={await mesAbertoDasMonitorias()}
      // Vindo do nome na Cobertura do ciclo: só vale quem está entre os avaliados ativos.
      operadorInicial={lista.some((o) => o.id === operador) ? operador : undefined}
    />
  );
}
