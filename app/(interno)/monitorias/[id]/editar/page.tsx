import { notFound } from 'next/navigation';
import { criarClienteServidor, exigirMonitor } from '@/lib/supabase/servidor';
import FormularioMonitoria, { type MonitoriaEmEdicao } from '@/componentes/FormularioMonitoria';
import { mesAbertoDasMonitorias } from '@/lib/mes-aberto';
import { monitoriasPorSetor } from '@/lib/monitoriasDoSetor';
import type { Canal, Criterio, Operador } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

type ItemGravado = { criterio_id: string; conforme: boolean; observacao: string | null };

export default async function EditarMonitoria({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const perfil = await exigirMonitor();
  const { id } = await params;
  const db = await criarClienteServidor();

  const [{ data: monitoria }, { data: itens }, { data: criterios },
         { data: operadores }, { data: canais }, porSetor] = await Promise.all([
    db.from('monitorias')
      .select('id, protocolo, data_atendimento, numero_monitoria, operador_id, canal_id,'
        + ' tempo_atendimento_seg, zerado, motivo_zeramento, parecer, setor_id')
      .eq('id', id).maybeSingle(),
    db.from('monitoria_itens').select('criterio_id, conforme, observacao').eq('monitoria_id', id),
    // Traz também critérios inativos que esta monitoria já respondeu, senão a
    // edição apagaria do formulário uma resposta que existe no banco.
    db.from('criterios').select('*').order('ordem'),
    db.from('pessoas').select('*').eq('avaliado', true).eq('ativo', true).order('nome'),
    db.from('canais').select('*').eq('ativo', true).order('nome'),
    monitoriasPorSetor(db),
  ]);

  if (!monitoria) notFound();

  const gravados = (itens ?? []) as ItemGravado[];
  const respondidos = new Set(gravados.map((i) => i.criterio_id));

  // Os critérios do setor da monitoria (Monitorias 6.0), e os que ela já respondeu.
  const setorDaMonitoria = (monitoria as { setor_id?: number }).setor_id ?? 1;
  const relevantes = ((criterios ?? []) as Criterio[])
    .filter((c) => respondidos.has(c.id) || (c.ativo && (c.setor_id ?? 1) === setorDaMonitoria));

  const emEdicao: MonitoriaEmEdicao = {
    ...(monitoria as unknown as Omit<MonitoriaEmEdicao, 'respostas'>),
    respostas: Object.fromEntries(gravados.map((i) => [
      i.criterio_id, { conforme: i.conforme, observacao: i.observacao ?? '' },
    ])),
  };

  return (
    <FormularioMonitoria
      perfilId={perfil.id}
      criterios={relevantes}
      operadores={(operadores ?? []) as Operador[]}
      canais={(canais ?? []) as Canal[]}
      mesAberto={await mesAbertoDasMonitorias()}
      emEdicao={emEdicao}
      porSemanaDe={{ [setorDaMonitoria]: porSetor.get(setorDaMonitoria)?.porSemana ?? 4 }}
      setorDe={{ [emEdicao.operador_id]: setorDaMonitoria }}
    />
  );
}
