import { criarClienteServidor, exigirGestor } from '@/lib/supabase/servidor';
import ArvoreDeSetores, { type GalhoDoSetor } from '@/componentes/ArvoreDeSetores';
import { hojeNoBrasil, mesDeCompetencia } from '@/lib/formatar';
import type { Canal, Setor } from '@/lib/setores';
import type { Cargo } from '@/lib/tipos';

type Historico = { pessoa_id: string; desde: string };

/** O registro vigente no mês: o último que começou até ele. */
function vigente<T extends Historico>(linhas: T[], pessoa: string, mes: string): T | undefined {
  return linhas.filter((h) => h.pessoa_id === pessoa && h.desde <= mes).sort((a, b) => b.desde.localeCompare(a.desde))[0];
}

/**
 * Árvore (aba de "Usuários e setores", 3.2.0): a operação desenhada como
 * organograma — setores e, em cada um, gestão, qualidade, filas e atendentes,
 * no mês corrente. O banco já limita o que cada um vê (migração 94): o
 * administrador, todos os setores; o gestor, o dele.
 */
export default async function TelaArvore() {
  const perfil = await exigirGestor();
  const db = await criarClienteServidor();
  const mes = mesDeCompetencia(hojeNoBrasil());
  const [{ data: setores }, { data: canais }, { data: pessoas }, { data: setoresDaPessoa }, { data: cargosDaPessoa }, { data: cargos }] =
    await Promise.all([
      db.from('setores').select('*').order('ordem'),
      db.from('canais_do_setor').select('*').order('ordem'),
      db.from('pessoas').select('id, nome, papel, ativo, desligado_em, perfil_de_teste').order('nome'),
      db.from('setores_da_pessoa').select('pessoa_id, setor_id, desde'),
      db.from('cargos_da_pessoa').select('pessoa_id, cargo_id, desde'),
      db.from('cargos').select('*').eq('ativo', true).order('ordem'),
    ]);

  const listaCargos = (cargos ?? []) as Cargo[];
  const hSetor = (setoresDaPessoa ?? []) as (Historico & { setor_id: number })[];
  const hCargo = (cargosDaPessoa ?? []) as (Historico & { cargo_id: number })[];
  // O perfil de teste (migração 39) é um usuário fantasma: fora da árvore.
  const naOperacao = ((pessoas ?? []) as { id: string; nome: string; papel: string; ativo: boolean; desligado_em: string | null; perfil_de_teste?: boolean }[])
    .filter((p) => p.ativo && !p.desligado_em && !p.perfil_de_teste);

  const galhos: GalhoDoSetor[] = ((setores ?? []) as Setor[]).map((s) => {
    const doSetor = naOperacao.filter((p) => p.papel !== 'administrador' && p.papel !== 'diretoria' && vigente(hSetor, p.id, mes)?.setor_id === s.id);
    return {
      id: s.id,
      nome: s.nome,
      monitorias: s.monitorias !== false,
      gestao: doSetor.filter((p) => p.papel === 'gestor').map((p) => p.nome),
      qualidade: doSetor.filter((p) => p.papel === 'qualidade').map((p) => p.nome),
      filas: ((canais ?? []) as Canal[]).filter((c) => c.setor_id === s.id)
        .map((c) => ({ nome: c.nome, tmePorPessoa: !!c.tme_por_pessoa_desde && c.tme_por_pessoa_desde <= mes })),
      atendentes: doSetor.filter((p) => p.papel === 'operador').map((p) => {
        const cargo = listaCargos.find((c) => c.id === vigente(hCargo, p.id, mes)?.cargo_id);
        return { id: p.id, nome: p.nome, cargo: cargo?.nome ?? null };
      }),
      cargos: listaCargos.filter((c) => (c.setor_id ?? 1) === s.id).map((c) => ({ id: c.id, nome: c.nome })),
    };
  });

  return (
    <ArvoreDeSetores galhos={galhos} administrador={!!perfil.administrador} mesAtual={mes}
                     administradores={naOperacao.filter((p) => p.papel === 'administrador').map((p) => p.nome)}
                     ceo={naOperacao.filter((p) => p.papel === 'diretoria').map((p) => p.nome)} />
  );
}
