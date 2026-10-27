import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import ImportadorAvaliacoes from '@/componentes/ImportadorAvaliacoes';
import type { Canal } from '@/lib/setores';
import ImportadorChamados from '@/componentes/ImportadorChamados';
import ImportadorMesAnterior, { type ImportacaoFeita, type PessoaDoCadastro } from '@/componentes/ImportadorMesAnterior';
import FilaDeAtrasos, { type ChamadoAtrasado } from '@/componentes/FilaDeAtrasos';
import NotasGuardadas, { type NotaGuardada } from '@/componentes/NotasGuardadas';
import SemanasDeChamados, { type SemanaDeChamados } from '@/componentes/SemanasDeChamados';
import SetasDeCompetencia from '@/componentes/SetasDeCompetencia';
import { Quadro } from '@/componentes/ui';
import { mesAnterior } from '@/lib/competencia';
import { dataHora, diaMes, hojeNoBrasil, mesDeCompetencia, mesRotulo, periodoDaSemana, mesValido } from '@/lib/formatar';
import type { Pessoa } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

const CANAIS = [['huggy', 'Expansão'], ['diretores', 'Diretores-Expansão']] as const;
const SEMANAS = [1, 2, 3, 4];

/**
 * Importar (1.19.0): antes de escolher o arquivo, o que já está no sistema —
 * avaliações válidas por semana e canal da competência — e a última
 * importação. Dá para ver a semana parcial ou vazia sem abrir o extrato.
 */
export default async function ImportarAvaliacoes({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; aba?: string }>;
}) {
  const perfil = await exigirGestor();
  const { mes, aba } = await searchParams;
  const hoje = hojeNoBrasil();
  const atual = mesDeCompetencia(hoje);
  const competencia = mesValido(mes) ? `${mes}-01` : atual;

  const db = await criarClienteServidor();

  // Abas internas (migração 53): cada relatório na sua. Chamados do ELO não
  // dependem das contagens do Hub, então a aba deles sai antes delas.
  const abas = (
    <div role="tablist" className="inline-flex rounded-xl bg-superficie p-1 shadow-sm">
      {([['hub', 'Avaliações (Hub)'], ['chamados', 'Chamados (ELO)'], ['mes-anterior', 'Mês anterior (planilha)']] as const).map(([chave, rotulo]) => {
        const ativa = chave === 'hub' ? aba !== 'chamados' && aba !== 'mes-anterior' : aba === chave;
        return (
          // <a> e não Link: carrega a página inteira. Pelo Link, a troca de aba
            // não completava no navegador do Analista (1.38.1); o endereço direto abria.
            <a key={chave} role="tab" aria-selected={ativa}
                href={chave === 'hub' ? '/cota/importar' : `/cota/importar?aba=${chave}`}
                className={`rounded-lg px-4 py-1.5 text-sm font-medium ${ativa
                  ? 'bg-marca-600 font-semibold text-white' : 'text-slate-600 hover:text-slate-900'}`}>
            {rotulo}
          </a>
        );
      })}
    </div>
  );

  // Meses antes do sistema (1.52.0, migração 69): o "Dashboard Expansão" de cada mês.
  if (aba === 'mes-anterior') {
    const [{ data: cadastro }, { data: feitas }, { data: primeiro }] = await Promise.all([
      db.from('pessoas').select('id, nome, email, nome_hub, ativo').order('nome'),
      db.from('importacoes_mes').select('id, mes_competencia, arquivo, importado_por_nome, importado_em, resumo, tipo')
        .order('mes_competencia', { ascending: false }),
      db.from('fechamentos_cota').select('mes_competencia').is('importacao_id', null)
        .order('mes_competencia').limit(1).maybeSingle(),
    ]);
    // Meses fechados pelo sistema e sem volume (1.54.0): deles, só o volume.
    const { data: fechadosDoSistema } = await db.from('fechamentos_cota').select('mes_competencia')
      .is('importacao_id', null).limit(1000);
    const mesesFechados = [...new Set(((fechadosDoSistema ?? []) as { mes_competencia: string }[]).map((f) => f.mes_competencia))];
    const contagens = await Promise.all(mesesFechados.map((m) => db.from('volume_semanal')
      .select('id', { count: 'exact', head: true }).eq('mes_competencia', m).then((r) => r.count ?? 0)));
    const semVolume = mesesFechados.filter((_, i) => contagens[i] === 0);
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Importar</h1>
          <p className="mt-1 text-sm text-sobre-fundo-suave">Cada relatório na sua aba. A planilha é lida no seu computador.</p>
          <div className="mt-3">{abas}</div>
        </div>
        {feitas == null && primeiro == null ? (
          <Quadro titulo="Mês anterior"><p className="text-sm text-slate-600">Falta rodar a migração 69 no banco.</p></Quadro>
        ) : (
          <ImportadorMesAnterior pessoas={(cadastro ?? []) as PessoaDoCadastro[]}
                                 importacoes={(feitas ?? []) as ImportacaoFeita[]}
                                 primeiroDoSistema={(primeiro as { mes_competencia: string } | null)?.mes_competencia ?? null}
                                 semVolume={semVolume} />
        )}
      </div>
    );
  }

  if (aba === 'chamados') {
    const campos = 'protocolo, titulo, responsavel, aberto_em, concluido_em, tempo_util, tempo_interno, tempo_ti, motivo_atraso, observacao, justificativa, justificado_por_nome, justificado_em, decisao, decidido_por_nome, decidido_em';
    // Semanas sem chamados (migração 60): o mês corrente e, enquanto não
    // fechado, o anterior — os mesmos que a pendência olha.
    const anterior = mesAnterior(atual);
    const [{ data: pendentes }, { data: decididos }, { count: anteriorFechado }, semanasAtual, semanasAnterior] = await Promise.all([
      db.from('chamados_elo').select(campos).gte('tempo_util', 3).not('concluido_em', 'is', null)
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
        <FilaDeAtrasos pendentes={(pendentes ?? []) as ChamadoAtrasado[]} decididos={(decididos ?? []) as ChamadoAtrasado[]} />
      </div>
    );
  }

  // Contagem por célula com `head`: a view tem milhares de linhas, e ler as
  // linhas esbarraria no teto de 1.000 do PostgREST.
  const contar = (origem: string, semana: number) => db.from('vw_avaliacoes_validas')
    .select('id', { count: 'exact', head: true })
    .eq('mes_competencia', competencia).eq('origem', origem).eq('semana', semana)
    .then(({ count }) => count ?? 0);

  const [{ data: pessoas }, ultima, ...contagens] = await Promise.all([
    db.from('pessoas').select('*').order('nome'),
    db.from('avaliacoes').select('importado_em, importado_por')
      .not('importado_em', 'is', null).order('importado_em', { ascending: false }).limit(1).maybeSingle(),
    ...CANAIS.flatMap(([origem]) => SEMANAS.map((s) => contar(origem, s))),
  ]);

  // Setores e canais (migração 79): qual nome do Hub vai para cada canal.
  const { data: canais } = await db.from('canais').select('*').eq('ativo', true).order('ordem');

  // Notas de atendentes não reconhecidos, esperando atribuição (migração 45).
  const { data: guardadas } = await db.from('avaliacoes_guardadas')
    .select('nome_no_arquivo, nome_normalizado, data, nota, origem_arquivo, importado_em')
    .eq('situacao', 'guardada').order('data').limit(5000);

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
            {CANAIS.map(([origem, rotulo], c) => {
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
                    : q === 0 ? [correndo ? 'bg-slate-100 text-slate-500 font-medium' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
                      correndo ? 'em andamento' : 'nada ainda']
                      : parcial ? ['bg-amber-500/15 text-amber-700 dark:text-amber-300', `${q} · parcial?`]
                        : ['bg-marca-600/15 text-marca-700 dark:text-marca-400', correndo ? `${q} · em andamento` : String(q)];
                  return (
                    <span key={`${origem}-${s}`} className={`rounded-lg px-2.5 py-2 text-center font-semibold ${classe}`}>
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

      <ImportadorAvaliacoes pessoas={lista} importadoPor={perfil.id} canais={(canais ?? []) as Canal[]} />
      <NotasGuardadas notas={(guardadas ?? []) as NotaGuardada[]}
                      pessoas={lista.filter((p) => p.ativo && !p.desligado_em).map((p) => ({ id: p.id, nome: p.nome }))} />
    </div>
  );
}
