/**
 * As regras da cota de um setor (4.4.0): o que antes a Configuração lia de uma
 * vez para as suas seis abas. Desde a 4.4.0 as abas viraram telas próprias, no
 * grupo "Metas e métricas" do menu — Pesos por cargo, Métricas e faixas,
 * Histórico de alterações —, e a Configuração ficou com os avisos e o diário.
 * Todas leem daqui, para as contas (pessoas por cargo, peso do cargo de base,
 * filas por régua) continuarem iguais.
 */
import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import { setorDoCookie } from '@/lib/setorEscolhido';
import PassoDoSetor, { type ResumoDoSetor } from '@/componentes/PassoDoSetor';
import { SLA_PRIMEIRA } from '@/lib/sla';
import type { Canal, Setor } from '@/lib/setores';
import { hojeNoBrasil, mesDeCompetencia } from '@/lib/formatar';
import type { Cargo, CargoDaPessoa, PesoCargo, Pessoa, ReferenciaCargo, RegraCota } from '@/lib/tipos';
import type { AlteracaoDePeso } from '@/componentes/HistoricoDePesos';

export async function carregarRegrasDoSetor(setorPedido?: string) {
  const perfil = await exigirGestor();
  const escolhido = await setorDoCookie();
  const db = await criarClienteServidor();

  const [
    { data: pessoas }, { data: cargos }, { data: regras }, { data: pesos }, { data: referencias },
    { data: historico }, { data: alteracoes }, { data: setores }, { data: canais }, { data: setoresDaPessoa },
  ] = await Promise.all([
    db.from('pessoas').select('id, ativo, desligado_em, perfil_de_teste'),
    db.from('cargos').select('*').eq('ativo', true).order('ordem'),
    db.from('regras').select('*').order('ordem'),
    db.from('pesos_por_cargo').select('cargo_id, regra, peso, ativo'),
    db.from('cargos_referencia').select('*'),
    db.from('cargos_da_pessoa').select('*'),
    // Histórico de alteração de pesos (migração 56).
    db.from('pesos_historico').select('*').order('alterado_em', { ascending: false }).limit(300),
    // Setores e canais (migração 79).
    db.from('setores').select('*').order('ordem'),
    db.from('canais_do_setor').select('*').order('ordem'),
    // O setor de cada pessoa, para o passo ① (3.2.0).
    db.from('setores_da_pessoa').select('pessoa_id, setor_id, desde'),
  ]);

  // Um setor por vez (etapa 4): cargos, pesos e métricas são do setor.
  const listaSetores = (setores ?? []) as Setor[];
  const setorId = listaSetores.find((s) => String(s.id) === (setorPedido ?? escolhido))?.id ?? listaSetores[0]?.id ?? 1;
  const setorNome = listaSetores.find((s) => s.id === setorId)?.nome ?? 'setor';
  const doSetor = (x: { setor_id?: number }) => (x.setor_id ?? 1) === setorId;
  const listaCargos = ((cargos ?? []) as Cargo[]).filter(doSetor);
  const idsDosCargos = new Set(listaCargos.map((c) => c.id));
  const listaPesos = ((pesos ?? []) as PesoCargo[]).filter((p) => idsDosCargos.has(p.cargo_id));
  const listaRegras = ((regras ?? []) as RegraCota[]).filter(doSetor);
  const todasAsFilas = (canais ?? []) as (Canal & { grupo_tma?: string | null })[];
  const filasDoSetor = todasAsFilas.filter((c) => c.setor_id === setorId && c.ativo !== false);

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

  // ① Os setores, com quantas pessoas (no mês) e cargos cada um tem.
  const setorAtualDe = new Map<string, number>();
  for (const h of ((setoresDaPessoa ?? []) as { pessoa_id: string; setor_id: number; desde: string }[])
    .filter((h) => h.desde <= competencia).sort((a, b) => a.desde.localeCompare(b.desde))) setorAtualDe.set(h.pessoa_id, h.setor_id);
  const resumoDosSetores: ResumoDoSetor[] = listaSetores.map((s) => ({
    id: s.id, nome: s.nome, monitorias: s.monitorias !== false,
    // O perfil de teste (migração 39) não conta: é um usuário fantasma.
    pessoas: naOperacao.filter((p) => !(p as { perfil_de_teste?: boolean }).perfil_de_teste && setorAtualDe.get(p.id) === s.id).length,
    cargos: ((cargos ?? []) as Cargo[]).filter((c) => (c.setor_id ?? 1) === s.id).length,
  }));

  const base = listaCargos.find((c) => c.nome === 'Atendente Júnior') ?? listaCargos[0];
  const pesosBase = Object.fromEntries(listaPesos
    .filter((p) => p.cargo_id === base?.id)
    .map((p) => [p.regra, p.ativo ? Number(p.peso) : null])) as Record<string, number | null>;

  // Quais filas do setor usam cada régua (4.4.0): o título da régua diz isso.
  const filasPorGrupo: Record<string, string[]> = {};
  for (const c of filasDoSetor) {
    for (const g of [c.grupo_tme, c.grupo_csat, c.grupo_tma]) if (g) (filasPorGrupo[g] ??= []).push(c.nome);
  }

  // O SLA dos chamados mostra os pesos do cargo que recebe o SLA (4.3.0).
  const cargoDoSla = listaCargos.find((c) => listaPesos.some((p) => p.cargo_id === c.id && p.regra === SLA_PRIMEIRA && p.ativo));
  const pesosDoSla = Object.fromEntries(listaPesos.filter((p) => p.cargo_id === cargoDoSla?.id)
    .map((p) => [p.regra, p.ativo ? Number(p.peso) : null])) as Record<string, number | null>;

  return {
    perfil, setorId, setorNome, listaSetores, resumoDosSetores, listaCargos, listaPesos, listaRegras,
    todasAsRegras: (regras ?? []) as RegraCota[], todasAsFilas, filasDoSetor,
    referencias: (referencias ?? []) as ReferenciaCargo[], pessoasPorCargo,
    base, pesosBase, filasPorGrupo, cargoDoSla, pesosDoSla,
    alteracoes: (alteracoes ?? []) as AlteracaoDePeso[],
  };
}

export type RegrasDoSetor = Awaited<ReturnType<typeof carregarRegrasDoSetor>>;

/** O topo das telas de metas e métricas: título, subtítulo e o setor (passo ①). */
export function TopoDasRegras({ titulo, subtitulo, dados, caminho }: {
  titulo: string; subtitulo: string; dados: RegrasDoSetor; caminho: string;
}) {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">{titulo}</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">{subtitulo}</p>
      </div>
      <PassoDoSetor setores={dados.resumoDosSetores} atual={dados.setorId} administrador={!!dados.perfil.administrador}
                    caminho={caminho} />
    </>
  );
}
