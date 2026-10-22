import EntradaRapida from '@/componentes/agenda/EntradaRapida';
import ListaDaAgenda, { type Grupo } from '@/componentes/agenda/ListaDaAgenda';
import { Painel } from '@/componentes/ui';
import { criarServidorDaAgenda, exigirUsuario } from '@/lib/agenda/db-servidor';
import { agoraNoBrasil, atrasado, diaDoItem, faixaDeHora, linhaDoTempo } from '@/lib/agenda/plano';
import { rotuloDoDia } from '@/lib/agenda/tempo';
import { descreverRegra } from '@/lib/agenda/regras';
import { COLUNAS_ITEM, type ItemAgenda } from '@/lib/agenda/tipos';

export const dynamic = 'force-dynamic';

const DIAS = 30;

/**
 * Os próximos 30 dias, dia a dia, com as repetições projetadas, e a lista dos
 * lembretes que se repetem — para conferir de uma vez o que está programado.
 */
export default async function Proximos() {
  await exigirUsuario();
  const db = await criarServidorDaAgenda();
  const { data } = await db.from('agenda_itens').select(COLUNAS_ITEM).is('concluido_em', null)
    .order('lembrar_em', { ascending: true }).limit(500);
  const itens = (data ?? []) as ItemAgenda[];
  const agora = agoraNoBrasil();

  const hojeAinda = itens.filter((i) => diaDoItem(i) === agora.dia && !atrasado(i, agora));
  const recorrentes = itens.filter((i) => i.regra).sort((a, b) => a.titulo.localeCompare(b.titulo));

  const grupos: Grupo[] = [
    {
      titulo: 'Hoje',
      linhas: hojeAinda.map((i) => ({ tipo: 'item', chave: i.id, item: i, motivo: i.dia_inteiro ? 'Dia inteiro' : undefined })),
    },
    ...linhaDoTempo(itens, agora, DIAS).map(({ dia, ocorrencias }): Grupo => ({
      titulo: rotuloDoDia(dia, agora.dia),
      subtitulo: `${ocorrencias.length} ${ocorrencias.length > 1 ? 'itens' : 'item'}`,
      linhas: ocorrencias.map((o) => ({
        tipo: 'item', chave: o.item.id, item: o.item, projetada: o.projetada, motivo: o.hora ? faixaDeHora(o.item, o.hora) : 'Dia inteiro',
      })),
    })),
  ];

  return (
    <div className="space-y-4">
      <header className="text-sobre-fundo">
        <h1 className="text-2xl font-bold tracking-tight">Próximos {DIAS} dias</h1>
        <p className="text-sm text-sobre-fundo-suave">
          As repetições aparecem apagadas: o que se conclui é a ocorrência atual de cada uma.
        </p>
      </header>

      <Painel>
        <div className="px-4 py-4 sm:px-6"><EntradaRapida /></div>
        <ListaDaAgenda grupos={grupos.length > 1 || grupos[0].linhas.length ? grupos
          : [{ titulo: 'Nada programado', linhas: [], vazio: 'Nenhum lembrete nos próximos 30 dias.' }]} />
      </Painel>

      {recorrentes.length > 0 && (
        <Painel>
          <ListaDaAgenda grupos={[{
            titulo: 'Repetições programadas',
            subtitulo: `${recorrentes.length}`,
            linhas: recorrentes.map((i) => ({
              tipo: 'item', chave: i.id, item: i,
              motivo: `Próxima: ${rotuloDoDia(diaDoItem(i)!, agora.dia).toLowerCase()} · ${descreverRegra(i.regra)}`,
            })),
          }]} />
        </Painel>
      )}
    </div>
  );
}
