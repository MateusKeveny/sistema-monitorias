import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import PainelAtendentes from '@/componentes/PainelAtendentes';
import CadastroEmLote from '@/componentes/CadastroEmLote';
import NovoUsuario from '@/componentes/NovoUsuario';
import { mesAnterior } from '@/lib/competencia';
import { hojeNoBrasil, mesDeCompetencia, periodoDaSemana } from '@/lib/formatar';
import type { Cargo, CargoDaPessoa, Pessoa, Saida, SetorDaPessoa } from '@/lib/tipos';
import type { Setor } from '@/lib/setores';
import type { AnotacaoGestor, LeituraDaPessoa, LeituraDiario } from '@/lib/diario';

/**
 * Pessoas (aba de "Usuários e setores", 3.0; era a tela Atendentes): quem está na operação, o cargo, o vínculo com o Hub, o que
 * aparece na tela inicial e o registro de quem saiu — tudo na ficha da pessoa.
 *
 * A tela mora só aqui, mas o efeito é dos dois sistemas — o cadastro de
 * pessoas é o mesmo banco, e encerrar o acesso encerra também o das
 * monitorias.
 */
export default async function TelaPessoas() {
  await exigirGestor();
  const db = await criarClienteServidor();

  const [{ data: pessoas }, { data: saidas }, { data: cargos }, { data: historico }, { data: leituras },
    { data: registros }, { data: confirmacoes }, { data: anotacoes }, { data: setores }, { data: setoresDaPessoa }] = await Promise.all([
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
    // Setor da pessoa, com histórico (migração 86).
    db.from('setores').select('*').eq('ativo', true).order('ordem'),
    db.from('setores_da_pessoa').select('*'),
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
      <p className="text-sm text-sobre-fundo-suave">
        Entrada, setor, cargo, vínculo com o Hub, tela inicial e saída — e o login: clique na pessoa e use
        <b className="font-semibold text-sobre-fundo"> Criar acesso</b>. Vale para os dois sistemas.
      </p>

      <div className="flex flex-wrap items-start gap-3">
        <NovoUsuario setores={(setores ?? []) as Setor[]} cargos={(cargos ?? []) as Cargo[]} />
        <CadastroEmLote pessoas={(pessoas ?? []) as Pessoa[]} setores={(setores ?? []) as Setor[]} cargos={(cargos ?? []) as Cargo[]} />
      </div>

      <PainelAtendentes
        pessoas={(pessoas ?? []) as Pessoa[]}
        saidas={(saidas ?? []) as Saida[]}
        cargos={(cargos ?? []) as Cargo[]}
        historico={(historico ?? []) as CargoDaPessoa[]}
        setores={(setores ?? []) as Setor[]}
        historicoSetor={(setoresDaPessoa ?? []) as SetorDaPessoa[]}
        leituras={leituraDe}
        anotacoes={(anotacoes ?? []) as AnotacaoGestor[]}
        competencia={competencia}
        inicioDoCicloAnterior={inicioDoCicloAnterior}
      />
    </div>
  );
}
