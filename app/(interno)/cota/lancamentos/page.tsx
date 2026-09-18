import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import FormularioLancamentos from '@/componentes/FormularioLancamentos';
import VolumeSemanal, { type LinhaVolume } from '@/componentes/VolumeSemanal';
import Link from '@/componentes/Link';
import { hojeNoBrasil, mesDeCompetencia, mesRotulo } from '@/lib/formatar';
import type {
  AvaliacaoDiretores, CargoDaPessoa, ConferenciaLancamento, Lancamento, PesoCargo, Pessoa, RegraCota,
} from '@/lib/tipos';

export const dynamic = 'force-dynamic';

/** Primeiro e último dia do ciclo 26→25 da competência. */
function periodoDoCiclo(competencia: string) {
  const [a, m] = competencia.split('-').map(Number);
  const anterior = new Date(Date.UTC(a, m - 2, 26)).toISOString().slice(0, 10);
  return { inicio: anterior, fim: `${competencia.slice(0, 7)}-25` };
}

export default async function LancamentosDeCota({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string; canal?: string }>;
}) {
  await exigirGestor();
  const { mes, canal: canalPedido } = await searchParams;
  // Tudo o que é lançado nesta página pertence ao canal escolhido.
  const canal = canalPedido === 'diretores' ? 'diretores' : 'huggy';

  const competencia = /^\d{4}-\d{2}$/.test(mes ?? '')
    ? `${mes}-01` : mesDeCompetencia(hojeNoBrasil());
  const { inicio, fim } = periodoDoCiclo(competencia);

  const db = await criarClienteServidor();
  const [pessoas, regras, pesos, historico, lancamentos, diretores, conferencia, volumes] = await Promise.all([
    db.from('pessoas').select('*').eq('ativo', true).order('nome'),
    db.from('regras').select('*').eq('manual', true).eq('ativo', true).order('ordem'),
    db.from('pesos_por_cargo').select('cargo_id, regra, peso, ativo').eq('ativo', true),
    db.from('cargos_da_pessoa').select('*'),
    db.from('lancamentos').select('*').eq('mes_competencia', competencia).eq('canal', canal)
      .order('criado_em', { ascending: false }),
    db.from('avaliacoes').select('id, pessoa_id, data, protocolo, nota, observacao, criado_em')
      .eq('origem', 'diretores').gte('data', inicio).lte('data', fim)
      .order('data', { ascending: false }),
    db.from('vw_lancamentos_a_conferir').select('*').eq('mes_competencia', competencia),
    db.from('volume_semanal').select('pessoa_id, semana, finalizados, tma_seg, tme_seg')
      .eq('mes_competencia', competencia).eq('canal', canal),
  ]);

  // Volume só para quem pontua por finalizado neste canal, no cargo vigente.
  const listaHistorico = (historico.data ?? []) as CargoDaPessoa[];
  const cargoDe = (id: string) => listaHistorico
    .filter((h) => h.pessoa_id === id && h.desde <= competencia)
    .sort((a, b) => b.desde.localeCompare(a.desde))[0]?.cargo_id;
  const cargosComAtendimento = new Set(((pesos.data ?? []) as PesoCargo[])
    .filter((p) => p.regra === (canal === 'huggy' ? 'huggy_atendimento' : 'diretores_atendimento')).map((p) => p.cargo_id));
  const pessoasDoVolume = ((pessoas.data ?? []) as Pessoa[])
    .filter((p) => { const c = cargoDe(p.id); return c != null && cargosComAtendimento.has(c); });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-sobre-fundo">Lançamentos</h1>
          <p className="text-sm text-sobre-fundo-suave">
            {mesRotulo(competencia)} · ciclo de {inicio.split('-').reverse().join('/')} a{' '}
            {fim.split('-').reverse().join('/')}
          </p>
        </div>
        <form className="flex items-end gap-2">
          <input type="hidden" name="canal" value={canal} />
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-600">Competência</span>
            <input
              type="month" name="mes" defaultValue={competencia.slice(0, 7)}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <button className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5
                             text-sm font-medium text-slate-700 hover:bg-slate-50">
            Abrir
          </button>
        </form>
      </div>

      <div className="inline-flex self-start rounded-lg bg-slate-100 p-1" role="tablist" aria-label="Canal">
        {([['huggy', 'Expansão'], ['diretores', 'Diretores-Expansão']] as const).map(([chave, rotulo]) => (
          <Link
            key={chave} role="tab" aria-selected={canal === chave}
            href={`/cota/lancamentos?mes=${competencia.slice(0, 7)}&canal=${chave}`}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              canal === chave ? 'bg-superficie text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
          >
            {rotulo}
          </Link>
        ))}
      </div>

      <VolumeSemanal
        key={`${competencia}-${canal}`}
        canal={canal}
        competencia={competencia}
        pessoas={pessoasDoVolume}
        volumes={(volumes.data ?? []) as LinhaVolume[]}
      />

      <FormularioLancamentos
        canal={canal}
        competencia={competencia}
        inicio={inicio}
        fim={fim}
        pessoas={(pessoas.data ?? []) as Pessoa[]}
        regras={(regras.data ?? []) as RegraCota[]}
        pesos={(pesos.data ?? []) as PesoCargo[]}
        historico={(historico.data ?? []) as CargoDaPessoa[]}
        lancamentos={(lancamentos.data ?? []) as Lancamento[]}
        diretores={(diretores.data ?? []) as AvaliacaoDiretores[]}
        conferencia={(conferencia.data ?? []) as ConferenciaLancamento[]}
      />
    </div>
  );
}
