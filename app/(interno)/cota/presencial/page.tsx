import { criarClienteServidor, exigirPerfil } from '@/lib/supabase/servidor';
import FormularioPresencial from '@/componentes/FormularioPresencial';
import { hojeNoBrasil, mesDeCompetencia, mesRotulo } from '@/lib/formatar';
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
  const competencia = /^\d{4}-\d{2}$/.test(mes ?? '') ? `${mes}-01` : mesDeCompetencia(hojeNoBrasil());
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
  const { data: peso } = cargoId
    ? await db.from('pesos_por_cargo').select('peso')
      .eq('cargo_id', cargoId).eq('regra', 'presencial').eq('ativo', true).maybeSingle()
    : { data: null };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-sobre-fundo">Atendimento presencial</h1>
          <p className="text-sm text-sobre-fundo-suave">
            {mesRotulo(competencia)}
            {veOTime ? ' · toda a equipe' : ' · seus registros'}
          </p>
        </div>

        <form className="flex items-end gap-2">
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-600">Competência</span>
            <input type="month" name="mes" defaultValue={competencia.slice(0, 7)}
                   className="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          </label>
          <button className="rounded-lg border border-slate-300 bg-superficie px-3 py-1.5
                             text-sm font-medium text-slate-700 hover:bg-slate-50">
            Abrir
          </button>
        </form>
      </div>

      <FormularioPresencial
        registros={(registros ?? []) as Presencial[]}
        pessoaId={perfil.id}
        veOTime={veOTime}
        pontosPorAtendimento={peso?.peso == null ? null : Number(peso.peso)}
      />
    </div>
  );
}
