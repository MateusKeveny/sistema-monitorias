import ListaDeMonitorias from '@/componentes/ListaDeMonitorias';
import OQueMaisSeRepete from '@/componentes/OQueMaisSeRepete';
import { Quadro, Vazio } from '@/componentes/ui';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { conferida } from '@/lib/consultas';
import { MONITORIAS_PADRAO, monitoriasPorSetor, setorDasPessoas } from '@/lib/monitoriasDoSetor';
import { mesRotulo, percentual } from '@/lib/formatar';
import { janelaDe, monitoriasPorMes, ocorrenciasDaPessoa, repeticoes } from '@/lib/repeticoes';

type Monitoria = {
  id: string; codigo: number; protocolo: string; data_atendimento: string; mes_referencia: string;
  semana_mes: number; nota_final: number; zerado: boolean; motivo_zeramento: string | null;
  parecer: string | null; canal: string | null; monitor: string | null;
};

/**
 * Lista de Monitorias "Por atendente" (5.7.0): com um atendente escolhido, o
 * mesmo formato do Performance — "O que mais se repete" e as monitorias em
 * blocos, mês a mês — para o monitor preparar o feedback sem sair daqui.
 * Cada bloco abre a monitoria. Os filtros de mês e de falha crítica valem
 * para a lista; o quadro olha sempre os 3 meses até o mês da tela.
 */
export default async function MonitoriasPorAtendente({ operadorId, mes, soZeradas, aberto }: {
  operadorId: string; mes?: string; soZeradas: boolean; aberto: string;
}) {
  const db = await criarClienteServidor();
  const ultimo = mes ?? aberto;
  // O piso do setor da pessoa (Monitorias 6.0; a Expansão: 85%).
  const [porSetorMon, setorNoMes] = await Promise.all([monitoriasPorSetor(db), setorDasPessoas(db, ultimo)]);
  const piso = porSetorMon.get(setorNoMes.get(operadorId) ?? 1)?.piso ?? MONITORIAS_PADRAO.piso;
  const { data } = await conferida(db.from('vw_monitorias')
    .select('id, codigo, protocolo, data_atendimento, mes_referencia, semana_mes, nota_final, zerado, motivo_zeramento, parecer, canal, monitor')
    .eq('operador_id', operadorId).lte('mes_referencia', ultimo)
    .order('data_atendimento', { ascending: false }).order('codigo', { ascending: false })
    .limit(300));
  const todas = (data ?? []) as Monitoria[];

  const { data: itens } = todas.length
    ? await conferida(db.from('vw_feedback_individual').select('monitoria_id, criterio, observacao')
      .in('monitoria_id', todas.map((m) => m.id)).eq('conforme', false).order('criterio_ordem'))
    : { data: [] };
  const falhas = new Map<string, { criterio: string; observacao: string | null }[]>();
  for (const a of (itens ?? []) as { monitoria_id: string; criterio: string; observacao: string | null }[]) {
    falhas.set(a.monitoria_id, [...(falhas.get(a.monitoria_id) ?? []), a]);
  }

  const lista = todas.filter((m) => (!mes || m.mes_referencia === mes) && (!soZeradas || m.zerado));
  const meses = [...new Set(lista.map((m) => m.mes_referencia))];
  const janela = janelaDe(ultimo);

  return (
    <div className="space-y-6">
      <OQueMaisSeRepete linhas={repeticoes(ocorrenciasDaPessoa(todas, falhas), janela, monitoriasPorMes(todas.map((x) => x.mes_referencia), janela))} janela={janela} />
      {lista.length === 0 ? (
        <Quadro><Vazio>Nenhuma monitoria encontrada com esses filtros.</Vazio></Quadro>
      ) : meses.map((m) => {
        const doMes = lista.filter((x) => x.mes_referencia === m);
        const nota = doMes.reduce((s, x) => s + Number(x.nota_final), 0) / doMes.length;
        return (
          <Quadro key={m} titulo={mesRotulo(m)}
                  subtitulo={`${doMes.length} monitoria${doMes.length === 1 ? '' : 's'} · nota média ${percentual(nota)}`}>
            <ListaDeMonitorias comLink piso={piso} monitorias={doMes.map((x) => ({
              ...x, nota_final: Number(x.nota_final),
              reprovados: (falhas.get(x.id) ?? []).map(({ criterio, observacao }) => ({ criterio, observacao })),
            }))} />
          </Quadro>
        );
      })}
    </div>
  );
}
