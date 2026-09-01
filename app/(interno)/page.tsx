import Link from 'next/link';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { Cartao, Indicador, EtiquetaNota, Tabela, Th, Td, Vazio } from '@/componentes/ui';
import EvolucaoMensal from '@/componentes/EvolucaoMensal';
import CoberturaDoCiclo from '@/componentes/CoberturaDoCiclo';
import SolicitacoesDeExclusao, { type Solicitacao } from '@/componentes/SolicitacoesDeExclusao';
import { nota, mesRotulo, mesCurto, percentual, data as formatarData } from '@/lib/formatar';
import type { LinhaRanking, LinhaCriterio, Monitoria } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

export default async function Painel({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const perfil = await exigirPerfil();
  const escolhido = (await searchParams).mes;
  const db = await criarClienteServidor();

  // O ranking completo é pequeno — uma linha por operador por mês — e resolve
  // três coisas de uma vez: a lista de meses do seletor, os números do mês
  // escolhido e a série do gráfico. Evita uma consulta só para descobrir qual
  // é o último mês com dados.
  const { data: todoRanking } = await db.from('vw_ranking_mensal').select('*');
  const ranking = (todoRanking ?? []) as LinhaRanking[];

  const meses = [...new Set(ranking.map((l) => l.mes_referencia))].sort().reverse();

  // Um operador sem monitorias e um sistema recém-instalado chegam aqui pelo
  // mesmo caminho, mas precisam de mensagens diferentes: instrução de
  // instalação não é assunto de quem está sendo avaliado.
  if (meses.length === 0) {
    return perfil.papel === 'operador' ? (
      <Cartao titulo="Nenhuma monitoria por enquanto">
        <Vazio>
          Você ainda não tem monitorias registradas. Assim que a Qualidade avaliar
          um atendimento seu, o resultado aparece aqui.
        </Vazio>
      </Cartao>
    ) : (
      <Cartao titulo="Nenhuma monitoria registrada">
        <Vazio>
          Nenhuma monitoria foi lançada ainda. Comece em{' '}
          <Link href="/monitorias/nova" className="text-marca-700 dark:text-marca-400 underline">
            Nova monitoria
          </Link>.
        </Vazio>
      </Cartao>
    );
  }

  // Mês pedido na URL, se existir de fato; senão o mais recente com dados.
  const mes = escolhido && meses.includes(escolhido) ? escolhido : meses[0];
  const ehOperador = perfil.papel === 'operador';

  const [{ data: criterios }, { data: recentes }, { data: porSemana }, { data: ativos },
         { data: solicitacoes, error: erroSolicitacoes }] =
    await Promise.all([
      // A view respeita a RLS: para um operador estes já são os critérios que
      // ele próprio reprovou, não os do time.
      db.from('vw_criterios_reprovados').select('*').eq('mes_referencia', mes)
        .gt('reprovacoes', 0)
        .order('pontos_perdidos', { ascending: false })
        .limit(ehOperador ? 3 : 6),
      ehOperador
        ? db.from('vw_monitorias').select('*').eq('mes_referencia', mes)
            .order('data_atendimento', { ascending: false }).limit(6)
        : Promise.resolve({ data: null }),
      // Cobertura do ciclo: só faz sentido para quem enxerga o time inteiro.
      ehOperador
        ? Promise.resolve({ data: null })
        : db.from('vw_monitorias').select('operador_id, semana_mes').eq('mes_referencia', mes),
      ehOperador
        ? Promise.resolve({ data: null })
        : db.from('pessoas').select('id, nome').eq('avaliado', true).eq('ativo', true).order('nome'),
      // Fila de exclusões: só o gestor decide, então só ele carrega.
      perfil.papel === 'gestor'
        // O nome do operador precisa da chave estrangeira explícita: monitorias
        // aponta duas vezes para pessoas — quem foi avaliado e quem monitorou —
        // e sem dizer qual, a consulta não sabe qual seguir.
        ? db.from('solicitacoes_exclusao')
            .select('id, motivo, solicitada_por_nome, solicitada_em,'
              + ' monitoria:monitorias(id, protocolo, data_atendimento, nota_final,'
              + ' operador:pessoas!monitorias_operador_id_fkey(nome))')
            .eq('status', 'pendente')
            .order('solicitada_em')
        : Promise.resolve({ data: null, error: null }),
    ]);

  const linhas = ranking
    .filter((l) => l.mes_referencia === mes)
    .sort((a, b) => Number(b.nota_media) - Number(a.nota_media));
  const piores = (criterios ?? []) as LinhaCriterio[];
  const minhasUltimas = (recentes ?? []) as Monitoria[];

  // Grade operador × semana. Parte da lista de operadores ativos, não das
  // monitorias: quem não foi monitorado nenhuma vez precisa aparecer com zero,
  // e é justamente esse o caso que passava despercebido.
  const contagem = new Map<string, number[]>();
  for (const o of (ativos ?? []) as { id: string }[]) contagem.set(o.id, [0, 0, 0, 0]);
  for (const m of (porSemana ?? []) as { operador_id: string; semana_mes: number }[]) {
    const linha = contagem.get(m.operador_id);
    if (linha && m.semana_mes >= 1 && m.semana_mes <= 4) linha[m.semana_mes - 1]++;
  }
  const cobertura = ((ativos ?? []) as { id: string; nome: string }[]).map((o) => ({
    operador_id: o.id,
    operador: o.nome,
    semanas: contagem.get(o.id) ?? [0, 0, 0, 0],
  }));

  // Consulta que falha devolve data nulo, o que aqui pareceria "nenhuma
  // pendência" — foi assim que uma consulta quebrada passou despercebida,
  // enquanto o contador no menu, que não usa junção, seguia mostrando o número.
  if (erroSolicitacoes) {
    console.error('Falha ao carregar solicitações de exclusão:', erroSolicitacoes.message);
  }

  // A consulta traz o operador aninhado; a tela quer o nome direto.
  type SolicitacaoBruta = {
    id: string; motivo: string; solicitada_por_nome: string | null; solicitada_em: string;
    monitoria: {
      id: string; protocolo: string; data_atendimento: string; nota_final: number;
      operador: { nome: string } | null;
    } | null;
  };
  const pendentes: Solicitacao[] = ((solicitacoes ?? []) as unknown as SolicitacaoBruta[])
    .map((s) => ({
      id: s.id,
      motivo: s.motivo,
      solicitada_por_nome: s.solicitada_por_nome,
      solicitada_em: s.solicitada_em,
      monitoria: s.monitoria && {
        id: s.monitoria.id,
        protocolo: s.monitoria.protocolo,
        data_atendimento: s.monitoria.data_atendimento,
        nota_final: s.monitoria.nota_final,
        operador: s.monitoria.operador?.nome ?? '—',
      },
    }));

  // Quantas semanas do ciclo já terminaram. No ciclo 26→25 as semanas fecham
  // nos dias 02, 10, 18 e 25 do mês de competência. Num ciclo em andamento,
  // cobrar semana que ainda não aconteceu apontaria falha onde não há.
  const fimDasSemanas = [2, 10, 18, 25];
  const hoje = new Date().toISOString().slice(0, 10);
  const semanasEncerradas = fimDasSemanas.filter(
    (dia) => `${mes.slice(0, 8)}${String(dia).padStart(2, '0')}` < hoje).length;

  // Os totais saem do próprio ranking, que já vem agregado pelo banco. Antes
  // havia uma quarta consulta trazendo as monitorias inteiras do mês — cerca de
  // 10 KB de pareceres — só para contar quatro números.
  const total = linhas.reduce((s, l) => s + l.total_monitorias, 0);
  const media = total
    ? linhas.reduce((s, l) => s + Number(l.nota_media) * l.total_monitorias, 0) / total
    : null;
  const zeradas = linhas.reduce((s, l) => s + l.zeradas, 0);
  const impecaveis = linhas.reduce((s, l) => s + l.impecaveis, 0);
  const abaixo = linhas.filter((l) => Number(l.nota_media) < 0.85).length;

  // Série mensal consolidada para o gráfico — sempre todo o período, mesmo
  // quando o resto da tela está filtrado por um mês.
  const porMes = new Map<string, { soma: number; qtd: number; zeradas: number }>();
  for (const l of ranking) {
    const atual = porMes.get(l.mes_referencia) ?? { soma: 0, qtd: 0, zeradas: 0 };
    atual.soma += Number(l.nota_media) * l.total_monitorias;
    atual.qtd += l.total_monitorias;
    atual.zeradas += l.zeradas;
    porMes.set(l.mes_referencia, atual);
  }
  const serie = [...porMes.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([m, v]) => ({
      mes: mesCurto(m),
      nota: Number(((v.soma / v.qtd) * 100).toFixed(1)),
      monitorias: v.qtd,
      zeradas: v.zeradas,
    }));


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-sobre-fundo">
            {ehOperador ? 'Meu desempenho' : 'Painel de qualidade'}
          </h1>
          <p className="text-sm text-sobre-fundo-suave">
            Referência: {mesRotulo(mes)}
            {mes !== meses[0] && ' · mês anterior ao atual'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Sem JavaScript: trocar o mês é uma navegação, então o endereço
              reflete o que está na tela e pode ser compartilhado. */}
          {meses.length > 1 && (
            <form className="flex items-center gap-2">
              <label htmlFor="mes" className="text-sm text-sobre-fundo-suave">Mês</label>
              <select
                id="mes" name="mes" defaultValue={mes}
                className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                           outline-none focus:border-marca-600"
              >
                {meses.map((m) => <option key={m} value={m}>{mesRotulo(m)}</option>)}
              </select>
              <button
                type="submit"
                className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                           font-medium text-slate-700 hover:bg-slate-50"
              >
                Ver
              </button>
            </form>
          )}

          <Link
            href={ehOperador ? '/monitorias' : '/relatorios'}
            className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm
                       font-medium text-slate-700 hover:bg-slate-50"
          >
            {ehOperador ? 'Ver minhas monitorias' : 'Ver relatórios'}
          </Link>
        </div>
      </div>

      {perfil.papel === 'gestor' && (
        erroSolicitacoes ? (
          <Cartao titulo="Exclusões aguardando sua decisão">
            <p className="text-sm text-rose-800">
              Não foi possível carregar a fila: {erroSolicitacoes.message}
            </p>
          </Cartao>
        ) : (
          <SolicitacoesDeExclusao pendentes={pendentes} />
        )
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador
          rotulo="Nota média do mês" valor={nota(media)}
          tom={media == null ? 'neutro' : media >= 0.95 ? 'bom' : media >= 0.85 ? 'alerta' : 'ruim'}
          detalhe={`${total} monitoria${total === 1 ? '' : 's'} avaliada${total === 1 ? '' : 's'}`}
        />
        <Indicador
          rotulo="Monitorias zeradas" valor={String(zeradas)}
          tom={zeradas > 0 ? 'ruim' : 'bom'}
          detalhe={total ? `${percentual(zeradas / total)} do total` : undefined}
        />
        <Indicador
          rotulo={ehOperador ? 'Minhas notas 100%' : 'Atendimentos impecáveis'}
          valor={String(impecaveis)}
          tom="bom" detalhe="nota cheia, sem desconto"
        />
        {ehOperador ? (
          <Indicador
            rotulo="Menor nota do mês"
            valor={nota(linhas.length ? Number(linhas[0].nota_minima) : null)}
            tom={linhas.length && Number(linhas[0].nota_minima) < 0.85 ? 'alerta' : 'neutro'}
            detalhe="a avaliação mais baixa do período"
          />
        ) : (
          <Indicador
            rotulo="Operadores abaixo de 85%"
            valor={String(abaixo)}
            tom={abaixo > 0 ? 'alerta' : 'neutro'}
            detalhe={`de ${linhas.length} com monitoria no mês`}
          />
        )}
      </div>

      {serie.length > 1 && (
        <Cartao titulo="Evolução da nota média">
          <EvolucaoMensal dados={serie} />
        </Cartao>
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Para o operador, o ranking mostraria uma linha só — ele mesmo. No
            lugar dele vão as últimas avaliações, que é o que ele quer ver. */}
        {ehOperador ? (
          <Cartao
            titulo="Minhas últimas monitorias"
            className="lg:col-span-3"
            acao={
              <Link href="/monitorias"
                className="text-xs font-medium text-marca-700 dark:text-marca-400 hover:underline">
                ver todas →
              </Link>
            }
          >
            {minhasUltimas.length === 0 ? (
              <Vazio>Nenhuma monitoria registrada ainda.</Vazio>
            ) : (
              <Tabela>
                <thead>
                  <tr>
                    <Th>Data</Th>
                    <Th>Protocolo</Th>
                    <Th className="text-center">Semana</Th>
                    <Th className="text-right">Nota</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {minhasUltimas.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <Td className="whitespace-nowrap tabular-nums">
                        {formatarData(m.data_atendimento)}
                      </Td>
                      <Td className="whitespace-nowrap font-mono text-xs">{m.protocolo}</Td>
                      <Td className="text-center tabular-nums">{m.semana_mes}ª</Td>
                      <Td className="text-right">
                        <EtiquetaNota valor={Number(m.nota_final)} zerado={m.zerado} />
                      </Td>
                      <Td>
                        <Link href={`/monitorias/${m.id}`}
                          className="whitespace-nowrap text-xs font-medium text-marca-700
                                     dark:text-marca-400 hover:underline">
                          abrir →
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </Cartao>
        ) : (
          <Cartao
            titulo="Ranking do mês"
            className="lg:col-span-3"
            acao={
              <Link href="/relatorios/ranking"
                className="text-xs font-medium text-marca-700 dark:text-marca-400 hover:underline">
                relatório completo →
              </Link>
            }
          >
            {linhas.length === 0 ? (
              <Vazio>Nenhuma monitoria neste mês.</Vazio>
            ) : (
              <Tabela>
                <thead>
                  <tr>
                    <Th className="w-10">#</Th>
                    <Th>Operador</Th>
                    <Th className="text-right">Monitorias</Th>
                    <Th className="text-right">Zeradas</Th>
                    <Th className="text-right">Nota média</Th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, i) => (
                    <tr key={l.operador_id} className="hover:bg-slate-50">
                      <Td className="tabular-nums text-slate-400">{i + 1}</Td>
                      <Td className="font-medium text-slate-900">{l.operador}</Td>
                      <Td className="text-right tabular-nums">{l.total_monitorias}</Td>
                      <Td className={`text-right tabular-nums ${
                        l.zeradas ? 'text-rose-700 font-semibold' : 'text-slate-400'}`}>
                        {l.zeradas || '—'}
                      </Td>
                      <Td className="text-right"><EtiquetaNota valor={Number(l.nota_media)} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Tabela>
            )}
          </Cartao>
        )}

        <Cartao
          titulo={ehOperador ? 'Meus pontos de atenção' : 'Critérios de maior impacto na nota'}
          className="lg:col-span-2"
          acao={ehOperador ? undefined : (
            <Link href="/relatorios/criterios"
              className="text-xs font-medium text-marca-700 dark:text-marca-400 hover:underline">
              detalhar →
            </Link>
          )}
        >
          {piores.length === 0 ? (
            <Vazio>
              {ehOperador
                ? 'Nenhum critério reprovado no mês. Continue assim.'
                : 'Nenhum critério reprovado no mês.'}
            </Vazio>
          ) : (
            <ul className="space-y-3">
              {piores.map((c) => (
                <li key={c.criterio_id}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-sm font-medium text-slate-800">{c.criterio}</span>
                    <span className="shrink-0 text-xs tabular-nums text-slate-500">
                      {c.reprovacoes}/{c.avaliacoes}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-rose-500"
                      style={{ width: `${Math.max(3, Number(c.taxa_reprovacao) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {percentual(Number(c.taxa_reprovacao))} de reprovação · peso {percentual(Number(c.peso))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>

      {!ehOperador && (
        <CoberturaDoCiclo linhas={cobertura} semanasEncerradas={semanasEncerradas} />
      )}
    </div>
  );
}
