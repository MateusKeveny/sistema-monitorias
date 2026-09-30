import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import PainelAtendentes from '@/componentes/PainelAtendentes';
import { mesAnterior } from '@/lib/competencia';
import { hojeNoBrasil, mesDeCompetencia, periodoDaSemana } from '@/lib/formatar';
import type { Cargo, CargoDaPessoa, Pessoa, Saida } from '@/lib/tipos';
import type { AnotacaoGestor, LeituraDaPessoa, LeituraDiario } from '@/lib/diario';

export const dynamic = 'force-dynamic';

/**
 * Atendentes: quem está na operação, o cargo, o vínculo com o Hub, o que
 * aparece na tela inicial e o registro de quem saiu — tudo na ficha da pessoa.
 *
 * A tela mora só aqui, mas o efeito é dos dois sistemas — o cadastro de
 * pessoas é o mesmo banco, e encerrar o acesso encerra também o das
 * monitorias.
 */
export default async function Atendentes() {
  await exigirGestor();
  const db = await criarClienteServidor();

  const [{ data: pessoas }, { data: saidas }, { data: cargos }, { data: historico }, { data: leituras },
    { data: registros }, { data: confirmacoes }, { data: anotacoes }] = await Promise.all([
    db.from('pessoas').select('*').order('nome'),
    db.from('saidas').select('*').order('data', { ascending: false }),
    db.from('cargos').select('*').eq('ativo', true).order('ordem'),
    db.from('cargos_da_pessoa').select('*'),
    // Leitura obrigatória do diário (migração 38): o que cada um ainda não leu.
    db.rpc('leituras_do_diario'),
    db.from('diario_registros').select('id, tipo, assunto, criado_em').in('tipo', ['processo', 'treinamento']),
    db.from('diario_leituras').select('pessoa_id, ciente_em').order('ciente_em', { ascending: false }),
    // Anotações do gestor sobre cada pessoa (migração 43; só gestor lê).
    db.from('diario_anotacoes').select('*').not('sobre_pessoa_id', 'is', null)
      .order('data', { ascending: false }).order('criado_em', { ascending: false }),
  ]);

  const registro = new Map((registros ?? []).map((r) => [r.id as string, r]));
  const leituraDe: Record<string, LeituraDaPessoa> = {};
  for (const l of (leituras ?? []) as LeituraDiario[]) {
    const d = (leituraDe[l.pessoa_id] ??= { pendentes: [], ultima: null });
    const r = registro.get(l.registro_id);
    if (!l.ciente_em && r) d.pendentes.push({ id: r.id, tipo: r.tipo, assunto: r.assunto, desde: r.criado_em });
  }
  for (const c of confirmacoes ?? []) {
    const d = (leituraDe[c.pessoa_id as string] ??= { pendentes: [], ultima: null });
    d.ultima ??= c.ciente_em as string;
  }

  const competencia = mesDeCompetencia(hojeNoBrasil());
  const [inicioDoCicloAnterior] = periodoDaSemana(mesAnterior(competencia), 1);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Atendentes</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">
          Entrada, cargo, vínculo com o Hub, tela inicial e saída — tudo de uma pessoa num lugar só.
          Vale para os dois sistemas.
        </p>
      </div>

      <PainelAtendentes
        pessoas={(pessoas ?? []) as Pessoa[]}
        saidas={(saidas ?? []) as Saida[]}
        cargos={(cargos ?? []) as Cargo[]}
        historico={(historico ?? []) as CargoDaPessoa[]}
        leituras={leituraDe}
        anotacoes={(anotacoes ?? []) as AnotacaoGestor[]}
        competencia={competencia}
        inicioDoCicloAnterior={inicioDoCicloAnterior}
      />
    </div>
  );
}
