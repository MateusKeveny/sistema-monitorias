import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import MatrizDePesos from '@/componentes/MatrizDePesos';
import ReguasDeFaixa from '@/componentes/ReguasDeFaixa';
import PainelRegras from '@/componentes/PainelRegras';
import Abas from '@/componentes/Abas';
import AvisosTeams, { type SituacaoAviso } from '@/componentes/AvisosTeams';
import SubcategoriasDiario from '@/componentes/SubcategoriasDiario';
import type { Subcategoria } from '@/lib/diario';
import { hojeNoBrasil, mesDeCompetencia } from '@/lib/formatar';
import type { Cargo, CargoDaPessoa, PesoCargo, Pessoa, ReferenciaCargo, RegraCota } from '@/lib/tipos';

export const dynamic = 'force-dynamic';

/**
 * Configuração (1.20.0): só as regras da cota.
 *
 * "Pesos por cargo" é a tabela da planilha — métrica na linha, cargo na
 * coluna. "Faixas e nomes" tem as réguas das métricas com faixa e o nome de
 * cada métrica. O cargo de cada pessoa e o que aparece na tela inicial foram
 * para a ficha da pessoa, em Atendentes.
 */
export default async function ConfiguracaoDaCota({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  await exigirGestor();
  const { cat } = await searchParams;
  const db = await criarClienteServidor();

  const [
    { data: pessoas }, { data: cargos }, { data: regras },
    { data: pesos }, { data: referencias }, { data: historico }, { data: avisos }, { data: subcategorias }, { data: usosSub },
  ] = await Promise.all([
    db.from('pessoas').select('id, ativo, desligado_em'),
    db.from('cargos').select('*').eq('ativo', true).order('ordem'),
    db.from('regras').select('*').order('ordem'),
    db.from('pesos_por_cargo').select('cargo_id, regra, peso, ativo'),
    db.from('cargos_referencia').select('*'),
    db.from('cargos_da_pessoa').select('*'),
    // Avisos no Teams (migração 40).
    db.rpc('situacao_dos_avisos'),
    // Subcategorias de problema operacional e quantos registros usam cada uma (migração 46).
    db.from('diario_subcategorias').select('*').order('ordem'),
    db.from('diario_registros').select('subcategoria_id').not('subcategoria_id', 'is', null),
  ]);

  const usos: Record<number, number> = {};
  for (const u of (usosSub ?? []) as { subcategoria_id: number }[]) usos[u.subcategoria_id] = (usos[u.subcategoria_id] ?? 0) + 1;

  const listaCargos = (cargos ?? []) as Cargo[];
  const listaPesos = (pesos ?? []) as PesoCargo[];
  const listaRegras = (regras ?? []) as RegraCota[];

  // Quantas pessoas na operação estão em cada cargo agora: é o "afeta N
  // pessoas" da barra de salvar.
  const competencia = mesDeCompetencia(hojeNoBrasil());
  const naOperacao = ((pessoas ?? []) as Pick<Pessoa, 'id' | 'ativo' | 'desligado_em'>[]).filter((p) => !p.desligado_em);
  const pessoasPorCargo: Record<number, number> = {};
  for (const p of naOperacao) {
    const vigente = ((historico ?? []) as CargoDaPessoa[])
      .filter((h) => h.pessoa_id === p.id && h.desde <= competencia)
      .sort((a, b) => b.desde.localeCompare(a.desde))[0];
    if (vigente) pessoasPorCargo[vigente.cargo_id] = (pessoasPorCargo[vigente.cargo_id] ?? 0) + 1;
  }

  const base = listaCargos.find((c) => c.nome === 'Atendente Júnior') ?? listaCargos[0];
  const pesosBase = Object.fromEntries(listaPesos
    .filter((p) => p.cargo_id === base?.id)
    .map((p) => [p.regra, p.ativo ? Number(p.peso) : null]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Configuração</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">
          As regras da cota. Mudar algo recalcula os meses em aberto; os fechados guardam o valor da época.
        </p>
      </div>

      {/* `key`: o atalho "+ Métrica manual" troca só o ?cat= e precisa reabrir na aba certa. */}
      <Abas
        key={cat ?? 'pesos'}
        inicial={cat}
        itens={[
          {
            chave: 'pesos',
            rotulo: 'Pesos por cargo',
            conteudo: (
              <MatrizDePesos
                cargos={listaCargos}
                regras={listaRegras}
                pesos={listaPesos}
                referencias={(referencias ?? []) as ReferenciaCargo[]}
                pessoasPorCargo={pessoasPorCargo}
              />
            ),
          },
          {
            chave: 'faixas',
            rotulo: 'Faixas e nomes das métricas',
            conteudo: (
              <div className="space-y-6">
                <ReguasDeFaixa regras={listaRegras} pesosBase={pesosBase}
                               nomeBase={(base?.nome ?? '').replace(/^Atendente\s+/, '')} />
                <PainelRegras regras={listaRegras} />
              </div>
            ),
          },
          {
            chave: 'avisos',
            rotulo: 'Avisos no Teams',
            conteudo: <AvisosTeams situacao={(avisos ?? []) as SituacaoAviso[]} />,
          },
          {
            chave: 'diario',
            rotulo: 'Diário de bordo',
            conteudo: <SubcategoriasDiario subcategorias={(subcategorias ?? []) as Subcategoria[]} usos={usos} />,
          },
        ]}
      />
    </div>
  );
}
