import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import FormularioPresencial from '@/componentes/FormularioPresencial';
import SetasDeCompetencia from '@/componentes/SetasDeCompetencia';
import { Painel } from '@/componentes/ui';
import { diaMes, hojeNoBrasil, mesDeCompetencia, periodoDaSemana } from '@/lib/formatar';
import type { Presencial } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

/**
 * Atendimento presencial.
 *
 * A mesma tela para os dois lados: o operador registra e vê os próprios; quem
 * vê o time vê todos, com o nome de quem atendeu. A separação é da RLS, não
 * de um `if` aqui — o operador não recebe a linha do colega nem por engano.
 */
export default async function AtendimentoPresencial({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const perfil = await exigirPerfil();
  const { mes } = await searchParams;
  const hoje = hojeNoBrasil();
  const atual = mesDeCompetencia(hoje);
  const competencia = /^\d{4}-\d{2}$/.test(mes ?? '') ? `${mes}-01` : atual;
  const veOTime = perfil.papel !== 'operador';

  const db = await criarClienteServidor();

  const [{ data: registros }, { data: linhas }] = await Promise.all([
    db.from('vw_presenciais').select('*')
      .eq('mes_competencia', competencia).order('data', { ascending: false }),
    // O peso do presencial no cargo de quem está olhando, só para informar.
    db.from('vw_extrato_cota').select('cargo_id')
      .eq('pessoa_id', perfil.id).limit(1),
  ]);

  const cargoId = (linhas ?? [])[0]?.cargo_id as number | undefined;
  // Quem vê a equipe nem sempre pontua por presencial no próprio cargo (o
  // gestor não pontua): aí vale o peso de quem atende.
  const { data: pesos } = veOTime
    ? await db.from('pesos_por_cargo').select('peso').eq('regra', 'presencial').eq('ativo', true)
    : cargoId
      ? await db.from('pesos_por_cargo').select('peso')
        .eq('cargo_id', cargoId).eq('regra', 'presencial').eq('ativo', true)
      : { data: [] };

  const lista = (registros ?? []) as Presencial[];
  const valores = (pesos ?? []).map((p) => Number(p.peso)).filter((v) => v > 0);
  const pontos = valores.length ? Math.max(...valores) : null;
  const pessoasNoMes = new Set(lista.map((r) => r.pessoa_id)).size;

  // O mês por semana (1.19.0): quantos em cada uma, e se ela já começou.
  const semanas = [1, 2, 3, 4].map((s) => {
    const [de, ate] = periodoDaSemana(competencia, s);
    return {
      s, periodo: `${diaMes(de)} a ${diaMes(ate)}`, quantidade: lista.filter((r) => r.semana === s).length,
      situacao: hoje < de ? 'futura' : hoje <= ate ? 'andamento' : 'passada',
    };
  });
  const maiorSemana = Math.max(1, ...semanas.map((s) => s.quantidade));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">
          Atendimento presencial
        </h1>
        <div className="mt-1.5">
          <SetasDeCompetencia competencia={competencia} atual={atual} caminho="/cota/presencial" compacto />
        </div>
        <p className="mt-2 text-xs text-sobre-fundo-suave">
          {veOTime ? 'Toda a equipe' : 'Seus registros'}
          {pontos != null && ` · cada atendimento vale ${pontos.toLocaleString('pt-BR')} pts no extrato de quem atendeu`}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_repeat(4,1fr)]">
        <Painel className="px-5 py-4">
          <p className="text-[13px] text-slate-500">No mês</p>
          <p className="text-2xl font-semibold tabular-nums text-slate-900">
            {lista.length} atendimento{lista.length === 1 ? '' : 's'}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
            {pontos != null && lista.length > 0 && (
              <span className="rounded-md bg-marca-600/15 px-1.5 py-px font-semibold text-marca-700 dark:text-marca-400">
                +{(lista.length * pontos).toLocaleString('pt-BR')} pts
              </span>
            )}
            {veOTime && `em ${pessoasNoMes} pessoa${pessoasNoMes === 1 ? '' : 's'}`}
          </p>
        </Painel>
        {semanas.map((s) => (
          <Painel key={s.s} className="px-5 py-4">
            <p className="text-[13px] text-slate-500">{s.s}ª semana · {s.periodo}</p>
            {s.situacao === 'futura' ? (
              <>
                <p className="text-2xl font-semibold text-slate-400">—</p>
                <p className="mt-1 text-xs text-slate-500">ainda não começou</p>
              </>
            ) : (
              <>
                <p className="text-2xl font-semibold tabular-nums text-slate-900">{s.quantidade}</p>
                {s.situacao === 'andamento' ? (
                  <p className="mt-1 text-xs">
                    <span className="rounded-md bg-slate-100 px-1.5 py-px font-semibold text-slate-600">em andamento</span>
                  </p>
                ) : (
                  <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <span className="crescer-x block h-full origin-left rounded-full bg-marca-600"
                          style={{ transform: `scaleX(${s.quantidade / maiorSemana})` }} />
                  </span>
                )}
              </>
            )}
          </Painel>
        ))}
      </div>

      <FormularioPresencial
        registros={lista}
        pessoaId={perfil.id}
        veOTime={veOTime}
        pontosPorAtendimento={pontos}
      />
    </div>
  );
}
