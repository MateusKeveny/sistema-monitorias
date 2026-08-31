import { criarClienteServidor, exigirMonitor } from '@/lib/supabase/servidor';
import FormularioMonitoria from '@/componentes/FormularioMonitoria';
import type { Criterio, Operador, Canal } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export default async function NovaMonitoria() {
  const perfil = await exigirMonitor();
  const db = await criarClienteServidor();

  const [{ data: criterios }, { data: operadores }, { data: canais }] = await Promise.all([
    db.from('criterios').select('*').eq('ativo', true).order('ordem'),
    db.from('pessoas').select('*').eq('avaliado', true).eq('ativo', true).order('nome'),
    db.from('canais').select('*').eq('ativo', true).order('nome'),
  ]);

  return (
    <FormularioMonitoria
      perfilId={perfil.id}
      criterios={(criterios ?? []) as Criterio[]}
      operadores={(operadores ?? []) as Operador[]}
      canais={(canais ?? []) as Canal[]}
    />
  );
}
