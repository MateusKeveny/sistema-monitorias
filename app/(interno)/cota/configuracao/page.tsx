import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import MatrizDePesos from '@/componentes/MatrizDePesos';
import ReguasDeFaixa from '@/componentes/ReguasDeFaixa';
import PainelRegras from '@/componentes/PainelRegras';
import Abas from '@/componentes/Abas';
import AvisosTeams, { type SituacaoAviso } from '@/componentes/AvisosTeams';
import SubcategoriasDiario from '@/componentes/SubcategoriasDiario';
import QuemVeODiario, { type VisibilidadeDoDiario } from '@/componentes/QuemVeODiario';
import HistoricoDePesos, { type AlteracaoDePeso } from '@/componentes/HistoricoDePesos';
import SetoresECanais, { type SetorDoHubVisto } from '@/componentes/SetoresECanais';
import RegrasPorFila from '@/componentes/RegrasPorFila';
import Link from 'next/link';
import type { Canal, Setor } from '@/lib/setores';
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
  searchParams: Promise<{ cat?: string; setor?: string }>;
}) {
  await exigirGestor();
  const { cat, setor: setorPedido } = await searchParams;
  const db = await criarClienteServidor();

  const [
    { data: pessoas }, { data: cargos }, { data: regras },
    { data: pesos }, { data: referencias }, { data: historico }, { data: avisos }, { data: subcategorias }, { data: usosSub }, { data: alteracoes },
    { data: visibilidade }, { data: setores }, { data: canais }, { data: vistos },
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
    // Histórico de alteração de pesos (migração 56).
    db.from('pesos_historico').select('*').order('alterado_em', { ascending: false }).limit(300),
    // Quem vê cada tipo de registro do diário (migração 67).
    db.from('diario_visibilidade').select('*'),
    // Setores e canais (migração 79).
    db.from('setores').select('*').order('ordem'),
    db.from('canais_do_setor').select('*').order('ordem'),
    db.from('vw_setores_do_hub_vistos').select('*').order('atendimentos', { ascending: false }),
  ]);

  const usos: Record<number, number> = {};
  for (const u of (usosSub ?? []) as { subcategoria_id: number }[]) usos[u.subcategoria_id] = (usos[u.subcategoria_id] ?? 0) + 1;

  // Um setor por vez (etapa 4): cargos, pesos e métricas são do setor.
  const listaSetores = (setores ?? []) as Setor[];
  const setorId = listaSetores.find((s) => String(s.id) === setorPedido)?.id ?? listaSetores[0]?.id ?? 1;
  const doSetor = (x: { setor_id?: number }) => (x.setor_id ?? 1) === setorId;
  const listaCargos = ((cargos ?? []) as Cargo[]).filter(doSetor);
  const idsDosCargos = new Set(listaCargos.map((c) => c.id));
  const listaPesos = ((pesos ?? []) as PesoCargo[]).filter((p) => idsDosCargos.has(p.cargo_id));
  const listaRegras = ((regras ?? []) as RegraCota[]).filter(doSetor);

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

      {listaSetores.length > 1 && (
        <div className="inline-flex flex-wrap gap-1 rounded-xl bg-black/25 p-1" role="tablist" aria-label="Setor">
          {listaSetores.map((s) => (
            <Link key={s.id} role="tab" aria-selected={s.id === setorId}
                  href={`/cota/configuracao?setor=${s.id}${cat ? `&cat=${cat}` : ''}`}
                  className={`rounded-lg px-4 py-1.5 text-sm transition ${s.id === setorId
                    ? 'bg-superficie font-semibold text-slate-900 shadow-sm' : 'text-sobre-fundo-suave hover:text-sobre-fundo'}`}>
              {s.nome}
            </Link>
          ))}
        </div>
      )}

      {/* `key`: o atalho "+ Métrica manual" troca só o ?cat= e precisa reabrir na aba certa. */}
      <Abas
        key={`${setorId}-${cat ?? 'pesos'}`}
        inicial={cat}
        itens={[
          {
            chave: 'pesos',
            rotulo: 'Pesos por cargo',
            conteudo: (
              <MatrizDePesos
                setorId={setorId}
                cargos={listaCargos}
                regras={listaRegras}
                pesos={listaPesos}
                referencias={(referencias ?? []) as ReferenciaCargo[]}
                pessoasPorCargo={pessoasPorCargo}
              />
            ),
          },
          {
            chave: 'filas',
            rotulo: 'Regras por fila',
            conteudo: (
              <RegrasPorFila setores={listaSetores.filter((s) => s.id === setorId)} filas={(canais ?? []) as Canal[]} regras={listaRegras} pesos={listaPesos} cargos={listaCargos} />
            ),
          },
          {
            chave: 'historico',
            rotulo: 'Histórico de alterações',
            conteudo: <HistoricoDePesos alteracoes={(alteracoes ?? []) as AlteracaoDePeso[]} />,
          },
          {
            chave: 'faixas',
            rotulo: 'Faixas e nomes das métricas',
            conteudo: (
              <div className="space-y-6">
                <ReguasDeFaixa regras={listaRegras} pesosBase={pesosBase}
                               nomeBase={(base?.nome ?? '').replace(/^Atendente\s+/, '')} />
                <PainelRegras regras={listaRegras} setorId={setorId} />
              </div>
            ),
          },
          {
            chave: 'setores',
            rotulo: 'Setores e filas',
            conteudo: (
              <SetoresECanais setores={(setores ?? []) as Setor[]} canais={(canais ?? []) as Canal[]}
                              vistos={(vistos ?? []) as SetorDoHubVisto[]} />
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
            conteudo: (
              <div className="space-y-6">
                <QuemVeODiario configuracao={(visibilidade ?? []) as VisibilidadeDoDiario[]} />
                <SubcategoriasDiario subcategorias={(subcategorias ?? []) as Subcategoria[]} usos={usos} />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
