import AvaliacoesDeUmACinco, { type AvaliacaoDoAtendente } from '@/componentes/AvaliacoesDeUmACinco';
import CsatDaEquipe, { type NotasCsat, type VolumeCsat } from '@/componentes/CsatDaEquipe';
import AssuntosDoMes, { type AssuntoDoMes } from '@/componentes/AssuntosDoMes';
import { setorDoCookie } from '@/lib/setorEscolhido';
import SetasDeCompetencia from '@/componentes/SetasDeCompetencia';
import { Painel, Secao, Vazio } from '@/componentes/ui';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { resolverCompetencia } from '@/lib/competencia';
import { mesRotulo, percentual, periodoDaSemana } from '@/lib/formatar';

export const dynamic = 'force-dynamic';

const CANAIS = [['huggy', 'Expansão'], ['diretores', 'Diretores-Expansão']] as const;

/**
 * Meu C-SAT (2.10.0): as avaliações do Hub de 1 a 5, as mesmas do cálculo do
 * C-SAT, e as abaixo de 4 em lista com o protocolo para copiar e revisar o
 * atendimento. Uma tela própria, no menu, para qualquer cargo — o Início do
 * Pleno e do Analista não tem C-SAT. Gestor e qualidade escolhem a pessoa; o
 * atendente vê as próprias (a RLS garante).
 */
export default async function MeuCsat({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; pessoa?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { mes, pessoa: pedida } = await searchParams;
  const veOTime = perfil.papel !== 'operador';
  const db = await criarClienteServidor();

  const { competencia, atual } = await resolverCompetencia(mes);
  const vazio = Promise.resolve({ data: [] as never[] });
  // Visão do gestor (3.7.0): atendimentos lançados × avaliações, do mesmo
  // volume e do mesmo C-SAT do cálculo.
  const [{ data: pessoas }, { data: volumes }, { data: notasDoMes }, { data: filasDb }, { data: assuntosDb }, { data: setoresDb }, setorEscolhido] = await Promise.all([
    // Todos, não só os avaliados: Pleno e Analista também têm notas; o
    // desligado no mês ainda aparece no resumo do mês.
    veOTime ? db.from('pessoas').select('id, nome, papel, ativo, desligado_em, perfil_de_teste').order('nome') : vazio,
    veOTime ? db.from('volume_semanal').select('pessoa_id, canal, canal_id, semana, finalizados').eq('mes_competencia', competencia) : vazio,
    veOTime ? db.from('vw_csat_semanal').select('pessoa_id, origem, semana, avaliacoes, positivas').eq('mes_competencia', competencia) : vazio,
    veOTime ? db.from('canais_do_setor').select('id, apelido, nome, ordem, setor_id').eq('ativo', true).order('ordem') : vazio,
    // Assuntos mais tratados (3.9.0, migração 99): a tabulação das avaliações do mês, por fila.
    veOTime ? db.rpc('assuntos_do_mes', { p_mes: competencia }) : vazio,
    veOTime ? db.from('setores').select('id').eq('ativo', true).order('ordem') : vazio,
    setorDoCookie(),
  ]);
  type P = { id: string; nome: string; papel: string; ativo: boolean; desligado_em: string | null; perfil_de_teste?: boolean };
  const todas = ((pessoas ?? []) as P[]).filter((p) => !p.perfil_de_teste && p.papel !== 'administrador' && p.papel !== 'diretoria');
  // No seletor, quem está na operação.
  const lista = todas.filter((p) => p.ativo && !p.desligado_em);
  const vols = (volumes ?? []) as VolumeCsat[];
  const notasEquipe = (notasDoMes ?? []) as NotasCsat[];
  const filas = ((filasDb ?? []) as { apelido: string | null; nome: string }[])
    .filter((x) => x.apelido).map((x) => [x.apelido!, x.nome] as [string, string]);
  // As filas do setor escolhido no menu (vale para qualquer equipe da árvore).
  const setorId = ((setoresDb ?? []) as { id: number }[]).find((x) => String(x.id) === setorEscolhido)?.id
    ?? ((setoresDb ?? []) as { id: number }[])[0]?.id ?? 1;
  const filasDoSetor = ((filasDb ?? []) as { id: number; nome: string; setor_id?: number }[])
    .filter((f) => (f.setor_id ?? 1) === setorId).map((f) => ({ id: f.id, nome: f.nome }));
  const idsDoSetor = new Set(filasDoSetor.map((f) => f.id));
  const assuntos = ((assuntosDb ?? []) as AssuntoDoMes[]).filter((a) => idsDoSetor.has(a.canal_id));
  const finalizadosPorFila: Record<number, number> = {};
  for (const v of (volumes ?? []) as { canal_id: number | null; finalizados: number }[]) {
    if (v.canal_id != null) finalizadosPorFila[v.canal_id] = (finalizadosPorFila[v.canal_id] ?? 0) + Number(v.finalizados);
  }
  // O assunto mais tratado no geral e em cada fila (3.9.0), para o resumo do topo.
  const topoDe = (ls: AssuntoDoMes[]) => {
    const porAssunto = new Map<string, { avaliacoes: number; positivas: number }>();
    for (const l of ls) {
      const a = porAssunto.get(l.assunto) ?? { avaliacoes: 0, positivas: 0 };
      a.avaliacoes += Number(l.avaliacoes); a.positivas += Number(l.positivas);
      porAssunto.set(l.assunto, a);
    }
    const total = [...porAssunto.values()].reduce((t, a) => t + a.avaliacoes, 0);
    const [assunto, a] = [...porAssunto.entries()].sort((x, y) => y[1].avaliacoes - x[1].avaliacoes)[0] ?? [];
    return assunto && a ? { assunto, avaliacoes: a.avaliacoes, fatia: total ? a.avaliacoes / total : 0, csat: a.avaliacoes ? a.positivas / a.avaliacoes : 0 } : null;
  };
  const maisTratados = [
    { chave: 'geral', rotulo: 'Geral', linhas: assuntos },
    ...filasDoSetor.map((f) => ({ chave: String(f.id), rotulo: f.nome, linhas: assuntos.filter((a) => a.canal_id === f.id) })),
  ].map((x) => ({ chave: x.chave, rotulo: x.rotulo, ...topoDe(x.linhas) }))
    .filter((x): x is { chave: string; rotulo: string; assunto: string; avaliacoes: number; fatia: number; csat: number } => 'assunto' in x && !!x.assunto);
  const semanasComDados = [1, 2, 3, 4].filter((sem) => vols.some((v) => v.semana === sem) || notasEquipe.some((n) => n.semana === sem));
  const pessoaId = veOTime ? (pedida && todas.some((p) => p.id === pedida) ? pedida : null) : perfil.id;

  const [inicio] = periodoDaSemana(competencia, 1);
  const [, fim] = periodoDaSemana(competencia, 4);
  const { data } = pessoaId
    ? await db.from('avaliacoes').select('origem, data, protocolo, nota, tabulacao')
      .eq('pessoa_id', pessoaId).gte('data', inicio).lte('data', fim).gte('nota', 1).lte('nota', 5)
    : { data: [] };
  const notas = (data ?? []) as (AvaliacaoDoAtendente & { origem: 'huggy' | 'diretores' })[];
  const canais = CANAIS.filter(([c]) => notas.some((a) => a.origem === c));
  const nome = todas.find((p) => p.id === pessoaId)?.nome;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">
            {veOTime ? (nome ? `C-SAT de ${nome.split(/\s+/).slice(0, 2).join(' ')}` : 'C-SAT dos atendentes') : 'Meu C-SAT'}
          </h1>
          <div className="mt-1.5">
            <SetasDeCompetencia competencia={competencia} atual={atual} caminho="/cota/csat" compacto
                                manter={pessoaId && veOTime ? { pessoa: pessoaId } : undefined} />
          </div>
          <p className="mt-2 text-sm text-sobre-fundo-suave">
            {veOTime && !pessoaId
              ? 'Atendimentos lançados × avaliações do Hub, as mesmas do cálculo do C-SAT. Escolha um atendente para ver as notas de 1 a 5.'
              : 'As avaliações do Hub de 1 a 5, as mesmas do cálculo do C-SAT.'}
          </p>
        </div>
        {veOTime && (
          <form className="flex items-end gap-2">
            <input type="hidden" name="mes" value={competencia.slice(0, 7)} />
            <label>
              <span className="mb-1 block text-xs font-medium text-sobre-fundo-suave">Atendente</span>
              <select name="pessoa" defaultValue={pessoaId ?? ''} className="rounded-md border border-slate-300 bg-superficie px-2 py-1.5 text-sm">
                <option value="">Equipe toda</option>
                {lista.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </label>
            <button className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Abrir
            </button>
            {pessoaId && (
              <a href={`/cota/csat?mes=${competencia.slice(0, 7)}`} className="px-1 py-1.5 text-sm text-marca-700 hover:underline dark:text-marca-400">
                Equipe
              </a>
            )}
          </form>
        )}
      </div>

      {veOTime && (
        <CsatDaEquipe pessoas={todas} volumes={vols} notas={notasEquipe} filas={filas} competencia={competencia}
                      pessoaId={pessoaId} semanasComDados={semanasComDados}
                      resumoExtra={!pessoaId && maisTratados.length ? (
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                          {maisTratados.map((m) => (
                            <div key={m.chave} className="rounded-2xl bg-superficie px-5 py-4 shadow-sm">
                              <p className="text-sm text-slate-500">Mais tratado · {m.rotulo}</p>
                              <p className="mt-0.5 line-clamp-2 text-lg font-semibold leading-snug tracking-tight text-slate-900" title={m.assunto}>{m.assunto}</p>
                              <p className="mt-1 text-xs text-slate-500">
                                {m.avaliacoes.toLocaleString('pt-BR')} avaliações · {percentual(m.fatia)} da {m.chave === 'geral' ? 'equipe' : 'fila'} · C-SAT {percentual(m.csat)}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : undefined} />
      )}

      {/* O ranking completo dos assuntos (3.9.0), no fim da visão da equipe. */}
      {veOTime && !pessoaId && (
        <AssuntosDoMes linhas={assuntos} finalizados={finalizadosPorFila} filas={filasDoSetor}
                       mes={mesRotulo(competencia).split(' ')[0].toLowerCase()} />
      )}

      {!pessoaId ? null : canais.length === 0 ? (
        <Painel><Secao><Vazio>Nenhuma avaliação neste mês.</Vazio></Secao></Painel>
      ) : canais.map(([c, rotulo]) => (
        <AvaliacoesDeUmACinco key={c} rotulo={rotulo} avaliacoes={notas.filter((a) => a.origem === c)} />
      ))}
    </div>
  );
}
