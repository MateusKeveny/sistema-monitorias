import { criarClienteServidor, exigirMonitor } from '@/lib/supabase/servidor';
import FormularioMonitoria from '@/componentes/FormularioMonitoria';
import { mesAbertoDasMonitorias } from '@/lib/mes-aberto';
import { foraDasMonitorias } from '@/lib/monitorados';
import { monitoriasPorSetor, setorDasPessoas } from '@/lib/monitoriasDoSetor';
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

  const mesAberto = await mesAbertoDasMonitorias();
  const [{ data: criterios }, { data: operadores }, { data: canais }, fora, setores, porSetor] = await Promise.all([
    db.from('criterios').select('*').eq('ativo', true).order('ordem'),
    db.from('pessoas').select('*').eq('avaliado', true).eq('ativo', true).order('nome'),
    db.from('canais').select('*').eq('ativo', true).order('nome'),
    foraDasMonitorias(db),
    // Monitorias 6.0: o formulário é o do setor de quem é avaliado.
    setorDasPessoas(db, mesAberto),
    monitoriasPorSetor(db),
  ]);
  // Setor com monitorias desligadas não é monitorado (etapa 4).
  const lista = ((operadores ?? []) as Operador[]).filter((p) => !fora.has(p.id));

  return (
    <FormularioMonitoria
      perfilId={perfil.id}
      criterios={(criterios ?? []) as Criterio[]}
      operadores={lista}
      canais={(canais ?? []) as Canal[]}
      mesAberto={mesAberto}
      setorDe={Object.fromEntries(lista.map((p) => [p.id, setores.get(p.id) ?? 1]))}
      porSemanaDe={Object.fromEntries([...porSetor].map(([id, m]) => [id, m.porSemana]))}
      // Vindo do nome na Cobertura do ciclo: só vale quem está entre os avaliados ativos.
      operadorInicial={lista.some((o) => o.id === operador) ? operador : undefined}
    />
  );
}
