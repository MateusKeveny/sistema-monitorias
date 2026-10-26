import AvaliacoesDeUmACinco, { type AvaliacaoDoAtendente } from '@/componentes/AvaliacoesDeUmACinco';
import SetasDeCompetencia from '@/componentes/SetasDeCompetencia';
import { Painel, Secao, Vazio } from '@/componentes/ui';
import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import { resolverCompetencia } from '@/lib/competencia';
import { periodoDaSemana } from '@/lib/formatar';

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

  const [{ competencia, atual }, { data: pessoas }] = await Promise.all([
    resolverCompetencia(mes),
    veOTime
      // Todos os ativos, não só os avaliados: Pleno e Analista também têm notas.
      ? db.from('pessoas').select('id, nome').eq('ativo', true).is('desligado_em', null).order('nome')
      : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
  ]);
  const lista = (pessoas ?? []) as { id: string; nome: string }[];
  const pessoaId = veOTime ? (pedida && lista.some((p) => p.id === pedida) ? pedida : null) : perfil.id;

  const [inicio] = periodoDaSemana(competencia, 1);
  const [, fim] = periodoDaSemana(competencia, 4);
  const { data } = pessoaId
    ? await db.from('avaliacoes').select('origem, data, protocolo, nota, tabulacao')
      .eq('pessoa_id', pessoaId).gte('data', inicio).lte('data', fim).gte('nota', 1).lte('nota', 5)
    : { data: [] };
  const notas = (data ?? []) as (AvaliacaoDoAtendente & { origem: 'huggy' | 'diretores' })[];
  const canais = CANAIS.filter(([c]) => notas.some((a) => a.origem === c));
  const nome = lista.find((p) => p.id === pessoaId)?.nome;

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
          <p className="mt-2 text-sm text-sobre-fundo-suave">As avaliações do Hub de 1 a 5, as mesmas do cálculo do C-SAT.</p>
        </div>
        {veOTime && (
          <form className="flex items-end gap-2">
            <input type="hidden" name="mes" value={competencia.slice(0, 7)} />
            <label>
              <span className="mb-1 block text-xs font-medium text-sobre-fundo-suave">Atendente</span>
              <select name="pessoa" defaultValue={pessoaId ?? ''} className="rounded-md border border-slate-300 bg-superficie px-2 py-1.5 text-sm">
                <option value="">Escolha…</option>
                {lista.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </label>
            <button className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              Abrir
            </button>
          </form>
        )}
      </div>

      {!pessoaId ? (
        <Painel><Secao><Vazio>Escolha um atendente para ver as avaliações dele.</Vazio></Secao></Painel>
      ) : canais.length === 0 ? (
        <Painel><Secao><Vazio>Nenhuma avaliação neste mês.</Vazio></Secao></Painel>
      ) : canais.map(([c, rotulo]) => (
        <AvaliacoesDeUmACinco key={c} rotulo={rotulo} avaliacoes={notas.filter((a) => a.origem === c)} />
      ))}
    </div>
  );
}
