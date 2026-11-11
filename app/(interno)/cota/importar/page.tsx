import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import { setorDoCookie } from '@/lib/setorEscolhido';
import { setorDasPessoas } from '@/lib/monitoriasDoSetor';
import ImportadorAvaliacoes from '@/componentes/ImportadorAvaliacoes';
import type { Canal } from '@/lib/setores';
import ImportadorChamados from '@/componentes/ImportadorChamados';
import FilaDeAtrasos, { type ChamadoAtrasado } from '@/componentes/FilaDeAtrasos';
import NotasGuardadas, { type NotaGuardada } from '@/componentes/NotasGuardadas';
import SemanasDeChamados, { type SemanaDeChamados } from '@/componentes/SemanasDeChamados';
import SetasDeCompetencia from '@/componentes/SetasDeCompetencia';
import { Quadro } from '@/componentes/ui';
import { SLA_ULTIMA, lerPrazoDoSla } from '@/lib/sla';
import { mesAnterior , resolverCompetencia } from '@/lib/competencia';
import { dataHora, diaMes, hojeNoBrasil, mesDeCompetencia, mesRotulo, periodoDaSemana, mesValido } from '@/lib/formatar';
import type { Pessoa } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

const SEMANAS = [1, 2, 3, 4];

/**
 * Importar (1.19.0): antes de escolher o arquivo, o que já está no sistema —
 * avaliações válidas por semana e canal da competência — e a última
 * importação. Dá para ver a semana parcial ou vazia sem abrir o extrato.
 */
export default async function ImportarAvaliacoes({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; aba?: string; cat?: string }>;
}) {
  const perfil = await exigirGestor();
  // 4.4.0: ?cat= como nas outras telas; ?aba= continua valendo (links antigos).
  const { mes, aba: abaAntiga, cat } = await searchParams;
  const aba = cat ?? abaAntiga;
  const hoje = hojeNoBrasil();
  // O mesmo mês das outras telas (3.0): o escolhido, ou o mês em trabalho.
  const { competencia, atual } = await resolverCompetencia(mes);

  const db = await criarClienteServidor();

  // Cada um importa só o seu (3.0): o setor do seletor do menu.
  const { data: setoresDb } = await db.from('setores').select('id, nome').eq('ativo', true).order('ordem');
  const escolhido = await setorDoCookie();
  const setorId = ((setoresDb ?? []) as { id: number }[]).find((s) => String(s.id) === escolhido)?.id
    ?? (setoresDb?.[0] as { id: number } | undefined)?.id ?? 1;
  // 4.7.0: a aba de chamados só no setor que pontua tratativas de chamados (o
  // Elo é do Expansão). A aba "Mês anterior (planilha)", do Dashboard Expansão
  // de antes do sistema, saiu: os meses já importados continuam no banco.
  const { data: regraDeChamados } = await db.from('regras').select('chave')
    .eq('chave', 'chamados_tratados').eq('ativo', true).eq('setor_id', setorId).limit(1);
  const pontuaChamados = (regraDeChamados ?? []).length > 0;
  const opcoes = ([['hub', 'Avaliações (Hub)'], ['chamados', 'Chamados (ELO)']] as const)
    .filter(([chave]) => chave !== 'chamados' || pontuaChamados);

  // Abas internas (migração 53): cada relatório na sua. Chamados do ELO não
  // dependem das contagens do Hub, então a aba deles sai antes delas.
  const abas = opcoes.length < 2 ? null : (
    <div role="tablist" className="inline-flex gap-1 rounded-full border border-slate-200 bg-superficie p-1 shadow-sm">
      {opcoes.map(([chave, rotulo]) => {
        const ativa = chave === 'hub' ? aba !== 'chamados' : aba === chave;
        return (
          // <a> e não Link: carrega a página inteira. Pelo Link, a troca de aba
            // não completava no navegador do Analista (1.38.1); o endereço direto abria.
            <a key={chave} role="tab" aria-selected={ativa}
                href={chave === 'hub' ? '/cota/importar' : `/cota/importar?cat=${chave}`}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${ativa
                  ? 'bg-marca-600 font-semibold text-white' : 'text-slate-600 hover:text-slate-900'}`}>
            {rotulo}
          </a>
        );
      })}
    </div>
  );

  if (aba === 'chamados' && pontuaChamados) {
    const campos = 'protocolo, titulo, responsavel, aberto_em, concluido_em, tempo_util, tempo_interno, tempo_ti, motivo_atraso, observacao, justificativa, justificado_por_nome, justificado_em, decisao, decidido_por_nome, decidido_em, dias_escala';
    // Semanas sem chamados (migração 60): o mês corrente e, enquanto não
    // fechado, o anterior — os mesmos que a pendência olha.
    const anterior = mesAnterior(atual);
    // 4.3.0: o prazo vem das faixas do SLA (migração 104); 4.5.0: fora do prazo
    // é a faixa salva em cada chamado, pela escala de quem tratou (migração 107).
    const prazoSla = await lerPrazoDoSla(db);
    const [{ data: pendentes }, { data: decididos }, { count: anteriorFechado }, semanasAtual, semanasAnterior] = await Promise.all([
      db.from('chamados_elo').select(campos).eq('faixa_sla', SLA_ULTIMA).not('concluido_em', 'is', null)
        .neq('status', 'Cancelado').not('pessoa_id', 'is', null).is('decisao', null).order('aberto_em'),
      db.from('chamados_elo').select(campos).not('decisao', 'is', null).eq('mes_competencia', atual)
        .order('decidido_em', { ascending: false }),
      db.from('fechamentos_cota').select('pessoa_id', { count: 'exact', head: true }).eq('mes_competencia', anterior),
      db.rpc('chamados_por_semana', { p_mes: atual }),
      db.rpc('chamados_por_semana', { p_mes: anterior }),
    ]);
    const meses = [
      ...(anteriorFechado ? [] : [{ competencia: anterior, rotulo: mesRotulo(anterior), semanas: semanasAnterior.data }]),
      { competencia: atual, rotulo: mesRotulo(atual), semanas: semanasAtual.data },
    ].filter((m) => (m.semanas ?? []).length) as { competencia: string; rotulo: string; semanas: SemanaDeChamados[] }[];
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Importar</h1>
          <p className="mt-1 text-sm text-sobre-fundo-suave">Cada relatório na sua aba. A planilha é lida no seu computador.</p>
          <div className="mt-3">{abas}</div>
        </div>
        <ImportadorChamados />
        {meses.length > 0 && <SemanasDeChamados meses={meses} />}
        <FilaDeAtrasos prazo={prazoSla} pendentes={(pendentes ?? []) as ChamadoAtrasado[]} decididos={(decididos ?? []) as ChamadoAtrasado[]} />
      </div>
    );
  }

  // Contagem por célula com `head`: a view tem milhares de linhas, e ler as
  // linhas esbarraria no teto de 1.000 do PostgREST.
  const contar = (origem: string, semana: number) => db.from('vw_avaliacoes_validas')
    .select('id', { count: 'exact', head: true })
    .eq('mes_competencia', competencia).eq('origem', origem).eq('semana', semana)
    .then(({ count }) => count ?? 0);

  // Setores e filas (migração 79): qual nome do Hub vai para cada fila, e as
  // linhas da grade abaixo — uma por fila da árvore; sem a 79, as duas de sempre.
  const { data: canais } = await db.from('canais_do_setor').select('*').eq('ativo', true).order('ordem');
  // A grade, as notas guardadas e a leitura do arquivo ficam nas filas e pessoas do setor.
  const setorDe = await setorDasPessoas(db, competencia);
  const filas = ((canais ?? []) as Canal[]).filter((f) => (f.setor_id ?? 1) === setorId);
  // 4.7.0: sem fila cadastrada, a grade fica vazia (antes caía nas filas do Expansão).
  const linhasDaGrade = filas
    .flatMap((f) => (f.apelido ? [{ origem: f.apelido as string, rotulo: f.nome as string }] : []))
    .map((f, c) => ({ ...f, c }));
  const origensDoSetor = linhasDaGrade.map((f) => f.origem);

  const [{ data: pessoas }, ultima, ...contagens] = await Promise.all([
    db.from('pessoas').select('*').order('nome'),
    db.from('avaliacoes').select('importado_em, importado_por').in('origem', origensDoSetor.length ? origensDoSetor : ['-'])
      .not('importado_em', 'is', null).order('importado_em', { ascending: false }).limit(1).maybeSingle(),
    ...linhasDaGrade.flatMap(({ origem }) => SEMANAS.map((s) => contar(origem, s))),
  ]);

  // Notas de atendentes não reconhecidos, esperando atribuição (migração 45).
  const { data: guardadas } = await db.from('avaliacoes_guardadas')
    .select('nome_no_arquivo, nome_normalizado, data, nota, origem_arquivo, importado_em')
    .eq('situacao', 'guardada').in('origem', origensDoSetor.length ? origensDoSetor : ['-']).order('data').limit(5000);

  const lista = (pessoas ?? []) as Pessoa[];
  const ultimaImportacao = ultima.data as { importado_em: string; importado_por: string | null } | null;
  const quemImportou = lista.find((p) => p.id === ultimaImportacao?.importado_por)?.nome.split(' ')[0];

  const periodos = SEMANAS.map((s) => periodoDaSemana(competencia, s));
  const celula = (canal: number, semana: number) => contagens[canal * SEMANAS.length + semana - 1] as number;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Importar</h1>
        <div className="mt-3">{abas}</div>
        <div className="mt-1.5">
          <SetasDeCompetencia competencia={competencia} atual={atual} caminho="/cota/importar" compacto />
        </div>
        <p className="mt-2 text-xs text-sobre-fundo-suave">
          A planilha é lida no seu computador; só as avaliações novas são enviadas.
        </p>
      </div>

      <Quadro
        titulo="O que já está no sistema"
        subtitulo={<>
          Avaliações válidas por semana do ciclo.
          {ultimaImportacao && ` Última importação: ${dataHora(ultimaImportacao.importado_em)}${quemImportou ? `, por ${quemImportou}` : ''}.`}
        </>}
      >
        <div className="overflow-x-auto">
          <div className="grid min-w-[36rem] grid-cols-[10rem_repeat(4,1fr)] items-center gap-1.5 text-sm tabular-nums">
            <span />
            {SEMANAS.map((s) => (
              <span key={s} className="text-center text-xs text-slate-500">
                {s}ª · {diaMes(periodos[s - 1][0])} a {diaMes(periodos[s - 1][1])}
              </span>
            ))}
            {linhasDaGrade.map(({ origem, rotulo, c }) => {
              // Semana encerrada bem abaixo das outras do mesmo canal costuma
              // ser importação feita antes de a semana terminar.
              const encerradas = SEMANAS.filter((s) => hoje > periodos[s - 1][1]).map((s) => celula(c, s));
              const referencia = encerradas.length ? Math.max(...encerradas) : 0;
              return [
                <span key={`${origem}-rotulo`} className="text-slate-600">{rotulo}</span>,
                ...SEMANAS.map((s) => {
                  const q = celula(c, s);
                  const [de, ate] = periodos[s - 1];
                  const futura = hoje < de;
                  const correndo = hoje >= de && hoje <= ate;
                  // Parcial com certeza: a última importação foi antes de a
                  // semana acabar. Parcial provável: bem abaixo das outras.
                  const importadaAntes = !!ultimaImportacao && ultimaImportacao.importado_em.slice(0, 10) <= ate;
                  const parcial = !futura && !correndo && q > 0 && (importadaAntes || q < referencia * 0.5);
                  const [classe, texto] = futura ? ['bg-slate-100 text-slate-400 font-medium', '—']
                    : q === 0 ? [correndo ? 'bg-slate-100 text-slate-500 font-medium' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                      correndo ? 'em andamento' : 'nada ainda']
                      : parcial ? ['bg-amber-500/10 text-amber-700 dark:text-amber-300', `${q} · parcial?`]
                        : ['bg-marca-600/10 text-marca-700 dark:text-marca-400', correndo ? `${q} · em andamento` : String(q)];
                  return (
                    <span key={`${origem}-${s}`} className={`rounded-xl px-2.5 py-2 text-center font-semibold ${classe}`}>
                      {texto}
                    </span>
                  );
                }),
              ];
            })}
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          “Parcial?” marca a semana que terminou depois da última importação ou que está bem abaixo
          das outras do canal: vale importar o relatório de novo — só as que faltam entram.
        </p>
      </Quadro>

      <ImportadorAvaliacoes pessoas={lista} importadoPor={perfil.id} canais={(canais ?? []) as Canal[]}
                            setorId={setorId} setorDe={Object.fromEntries(setorDe)}
                            nomesDosSetores={((setoresDb ?? []) as { nome: string }[]).map((s) => s.nome)} />
      <NotasGuardadas notas={(guardadas ?? []) as NotaGuardada[]}
                      pessoas={lista.filter((p) => p.ativo && !p.desligado_em && (setorDe.get(p.id) ?? 1) === setorId)
                        .map((p) => ({ id: p.id, nome: p.nome }))} />
    </div>
  );
}
