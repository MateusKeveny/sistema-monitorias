import Link from '@/componentes/Link';
import EntradaRapida from '@/componentes/agenda/EntradaRapida';
import ListaDaAgenda, { type Grupo } from '@/componentes/agenda/ListaDaAgenda';
import { Painel } from '@/componentes/ui';
import { criarServidorDaAgenda, exigirUsuario } from '@/lib/agenda/db-servidor';
import { feriasDoPerformance, pendenciasDoPerformance } from '@/lib/agenda/ponte';
import { avisosDeFerias } from '@/lib/ferias';
import { mesDeCompetencia, periodoDaSemana, semanaDoCiclo, diaMes } from '@/lib/formatar';
import { agoraNoBrasil, atrasado, diaDoItem, faixaDeHora, linhaDoTempo, planoDoDia } from '@/lib/agenda/plano';
import { dataPorExtenso, diasEntre, nomeDoMes, rotuloDoDia, somarDias } from '@/lib/agenda/tempo';
import { COLUNAS_ITEM, type ItemAgenda, type Pendencia } from '@/lib/agenda/tipos';

export const dynamic = 'force-dynamic';

/**
 * Meu dia: a entrada do assistente e o plano do dia — lembretes e pendências
 * do sistema numa ordem só, com o motivo de cada um estar ali. Embaixo, o que
 * vem nos próximos dias e o que ainda não tem data.
 */
export default async function MeuDia({ searchParams }: { searchParams: Promise<{ novo?: string }> }) {
  const [usuario, { novo }] = await Promise.all([exigirUsuario(), searchParams]);
  const db = await criarServidorDaAgenda();
  // As pendências vêm do banco dos painéis, pela ponte (lib/agenda/ponte.ts).
  const vePendencias = usuario.ve_pendencias;

  const [itens, pendencias, preferencias, aparelhos, equipe, minhas] = await Promise.all([
    db.from('agenda_itens').select(COLUNAS_ITEM).is('concluido_em', null)
      .order('lembrar_em', { ascending: true, nullsFirst: false }).limit(500)
      .then((r) => (r.data ?? []) as ItemAgenda[]),
    vePendencias ? pendenciasDoPerformance().then((r) => r.lista) : Promise.resolve([] as Pendencia[]),
    db.from('agenda_preferencias').select('pendencias').maybeSingle().then((r) => r.data),
    db.from('agenda_inscricoes').select('endpoint', { count: 'exact', head: true }).then((r) => r.count ?? 0),
    // Férias (61 e agenda/04): da equipe pela ponte; as suas, daqui.
    vePendencias ? feriasDoPerformance() : Promise.resolve(null),
    db.from('minhas_ferias').select('id, inicio, fim').gte('fim', somarDias(agoraNoBrasil().dia, -7))
      .then((r) => (r.data ?? []) as { id: string; inicio: string; fim: string }[]),
  ]);

  const agora = agoraNoBrasil();
  const comPendencias = vePendencias && preferencias?.pendencias !== false;
  // No plano do dia só o que está perto (janela do resumo); o resto fica na tela Férias.
  const avisosFerias: Pendencia[] = avisosDeFerias(
    [...minhas.map((m) => ({ ...m, pessoa: usuario.nome, minha: true })), ...(equipe?.ferias ?? [])],
    equipe?.prazos ?? [], agora.dia, 'resumo',
  ).map((a) => ({ chave: `ferias:${a.chave}`, texto: a.texto, acao: 'Férias', href: '/agenda/ferias', grave: a.grave, quantidade: 1 }));
  const plano = planoDoDia(itens, [...(comPendencias ? pendencias : []), ...avisosFerias], agora);
  const proximos = linhaDoTempo(itens, agora, 7);
  const semData = itens.filter((i) => !i.lembrar_em);

  const deHoje = itens.filter((i) => diaDoItem(i) === agora.dia && !atrasado(i, agora)).length;
  const atrasados = itens.filter((i) => atrasado(i, agora)).length;

  // O ciclo de 26 a 25: em que semana estamos e quando ela acaba.
  const competencia = mesDeCompetencia(agora.dia);
  const semana = semanaDoCiclo(agora.dia);
  const [, fimDaSemana] = periodoDaSemana(competencia, semana);
  const fimDoCiclo = `${competencia.slice(0, 8)}25`;
  const faltam = diasEntre(agora.dia, fimDoCiclo);

  const grupos: Grupo[] = [
    {
      titulo: 'Plano do dia',
      subtitulo: plano.length ? 'na ordem sugerida' : undefined,
      vazio: 'Nada para hoje. Adicione um lembrete acima ou aproveite o respiro.',
      linhas: plano.map((e, n) => e.tipo === 'item'
        ? { tipo: 'item', chave: e.chave, item: e.item, motivo: e.motivo, tom: e.tom, numero: n + 1 }
        : { tipo: 'pendencia', chave: e.chave, pendencia: e.pendencia, motivo: e.motivo, tom: e.tom, numero: n + 1 }),
    },
    ...proximos.map(({ dia, ocorrencias }): Grupo => ({
      titulo: rotuloDoDia(dia, agora.dia),
      linhas: ocorrencias.map((o) => ({
        tipo: 'item', chave: o.item.id, item: o.item, projetada: o.projetada,
        motivo: o.hora ? faixaDeHora(o.item, o.hora) : 'Dia inteiro', tom: 'normal',
      })),
    })),
    {
      titulo: 'Sem data',
      subtitulo: semData.length ? `${semData.length} ${semData.length > 1 ? 'itens' : 'item'}` : undefined,
      linhas: semData.map((i) => ({ tipo: 'item', chave: i.id, item: i })),
    },
  ];

  const primeiroNome = usuario.nome.trim().split(/\s+/)[0];
  const saudacao = Number(agora.hora.slice(0, 2)) < 12 ? 'Bom dia' : Number(agora.hora.slice(0, 2)) < 18 ? 'Boa tarde' : 'Boa noite';

  return (
    <div className="space-y-4">
      <header className="text-sobre-fundo">
        <p className="text-sm text-sobre-fundo-suave">{dataPorExtenso(agora.dia).replace(/^./, (c) => c.toUpperCase())}</p>
        <h1 className="text-2xl font-bold tracking-tight">{saudacao}, {primeiroNome}</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">
          Semana {semana} do ciclo de {nomeDoMes(competencia)} · termina {diaMes(fimDaSemana)}
          {faltam >= 0 && <> · ciclo fecha em {faltam === 0 ? 'hoje' : `${faltam} dia${faltam > 1 ? 's' : ''}`}</>}
        </p>
      </header>

      <Painel>
        <div className="px-4 py-4 sm:px-6">
          <EntradaRapida focar={novo === '1'} />
        </div>

        <div className="grid grid-cols-3 text-center">
          <Contador valor={deHoje} rotulo="para hoje" />
          <Contador valor={atrasados} rotulo={atrasados === 1 ? 'atrasado' : 'atrasados'} tom={atrasados ? 'text-rose-700' : undefined} />
          <Contador valor={comPendencias ? pendencias.length : null} rotulo="do sistema"
                    tom={pendencias.some((p) => p.grave) ? 'text-amber-700' : undefined} />
        </div>

        <ListaDaAgenda grupos={grupos} />
      </Painel>

      {aparelhos === 0 && (
        <Link href="/agenda/ajustes"
              className="block rounded-2xl bg-superficie px-5 py-4 text-sm shadow-sm ring-1 ring-amber-300 hover:bg-amber-50">
          <span className="font-semibold text-slate-900">Ative as notificações neste aparelho</span>
          <span className="block text-slate-600">Sem isso a agenda não consegue lembrar você na hora. Leva 10 segundos →</span>
        </Link>
      )}
    </div>
  );
}

function Contador({ valor, rotulo, tom }: { valor: number | null; rotulo: string; tom?: string }) {
  return (
    <div className="px-2 py-3">
      <p className={`text-xl font-bold tabular-nums ${tom ?? 'text-slate-900'}`}>{valor ?? '—'}</p>
      <p className="text-xs text-slate-500">{rotulo}</p>
    </div>
  );
}
