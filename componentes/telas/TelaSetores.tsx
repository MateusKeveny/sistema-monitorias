import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import SetoresECanais, { type ContagemDoSetor, type SetorDoHubVisto } from '@/componentes/SetoresECanais';
import { MONITORIAS_PADRAO } from '@/lib/monitoriasDoSetor';
import type { Canal, Setor } from '@/lib/setores';
import type { PesoCargo, RegraCota } from '@/lib/tipos';
import { contextoDasMetas, type ContextoMetas } from '@/lib/metasPorLista';
import type { HistoricoDoSetor } from '@/componentes/AcoesDoSetor';

/**
 * Setores e filas (aba de "Usuários e setores", 3.0; era uma aba da
 * Configuração): a árvore setor → filas, os nomes no Hub e, por setor, as
 * monitorias (quantas por semana e o piso, Monitorias 6.0).
 */
export default async function TelaSetores() {
  const perfil = await exigirGestor();
  const db = await criarClienteServidor();
  const [{ data: setores }, { data: canais }, { data: vistos }, { data: reguas }, { data: cargos }, { data: regras }, { data: criterios }] = await Promise.all([
    db.from('setores').select('*').order('ordem'),
    db.from('canais_do_setor').select('*').order('ordem'),
    db.from('vw_setores_do_hub_vistos').select('*').order('atendimentos', { ascending: false }),
    db.from('regras').select('chave, faixa_min').eq('grupo', 'monitoria'),
    // O que a cópia de um setor leva (novo setor: 3.2.0; cargos e metas no passo 4, 4.0.0).
    db.from('cargos').select('id, nome, ordem, setor_id').eq('ativo', true),
    db.from('regras').select('chave, rotulo, ordem, ativo, grupo, setor_id'),
    db.from('criterios').select('setor_id').eq('ativo', true),
  ]);
  const { data: pesos } = await db.from('pesos_por_cargo').select('cargo_id, regra, peso, ativo');
  const lista = (setores ?? []) as Setor[];
  // Excluir ou desativar (4.1.0, migração 100): o histórico de cada setor, só para o administrador.
  const historicos: Record<number, HistoricoDoSetor> = perfil.administrador
    ? Object.fromEntries((await Promise.all(lista.map((s) => db.rpc('historico_do_setor', { p_setor: s.id })
        .then((r) => [s.id, r.data as HistoricoDoSetor] as const)))).filter(([, h]) => h))
    : {};
  const monitorias = Object.fromEntries(lista.map((s) => {
    const regua = ((reguas ?? []) as Pick<RegraCota, 'chave' | 'faixa_min'>[]).find((r) => r.chave === s.regra_monitoria);
    return [s.id, {
      porSemana: s.monitorias_por_semana ?? MONITORIAS_PADRAO.porSemana,
      piso: regua?.faixa_min != null ? Number(regua.faixa_min) : MONITORIAS_PADRAO.piso,
    }];
  }));
  const quantos = (linhas: { setor_id: number | null }[] | null, id: number) => (linhas ?? []).filter((x) => (x.setor_id ?? 1) === id).length;
  const contagens: Record<number, ContagemDoSetor> = Object.fromEntries(lista.map((s) => [s.id, {
    cargos: quantos(cargos, s.id), metricas: quantos((regras ?? []).filter((r) => r.ativo), s.id), criterios: quantos(criterios, s.id),
  }]));
  // A base do passo "Cargos e metas" do novo setor: o mesmo contexto da lista de metas.
  const metasPorSetor: Record<number, ContextoMetas> = Object.fromEntries(lista.map((s) => {
    const cs = (cargos ?? []).filter((c) => (c.setor_id ?? 1) === s.id);
    const ids = new Set(cs.map((c) => c.id));
    return [s.id, contextoDasMetas(cs, (regras ?? []).filter((r) => (r.setor_id ?? 1) === s.id),
      ((pesos ?? []) as PesoCargo[]).filter((p) => ids.has(p.cargo_id)))];
  }));
  return <SetoresECanais setores={lista} canais={(canais ?? []) as Canal[]}
                         vistos={(vistos ?? []) as SetorDoHubVisto[]} monitorias={monitorias}
                         administrador={!!perfil.administrador} contagens={contagens} metasPorSetor={metasPorSetor}
                         historicos={historicos} />;
}
