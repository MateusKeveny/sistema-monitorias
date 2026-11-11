/**
 * Setor e filas de uma tela do Performance (4.4.0).
 *
 * Até a 4.3 o Início, o Comparativo e as Métricas da semana tinham as duas
 * filas da Expansão escritas no código ('huggy' e 'diretores') e a meta de
 * C-SAT fixa em 95%. Com o Conexão Telecom (4 filas, meta de 94%) isso deixou
 * de valer: aqui as filas saem de `canais_do_setor` e a meta, da faixa de
 * C-SAT do próprio setor.
 *
 * Roda no servidor e no navegador (só recebe o cliente do banco).
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export type FilaDoSetor = {
  apelido: string;
  nome: string;
  setorId: number;
  regraFinalizado: string | null;
  grupoTme: string | null;
  grupoCsat: string | null;
  grupoNota: string | null;
  tmePorPessoaDesde: string | null;
};

/** Faixa de C-SAT em fração (0,94 = 94%). */
export type FaixaCsat = { chave: string; min: number | null; max: number | null };

/** As filas da Expansão, para quando o cadastro ainda não carregou. */
export const FILAS_PADRAO: FilaDoSetor[] = [
  { apelido: 'huggy', nome: 'Expansão', setorId: 1, regraFinalizado: 'huggy_atendimento', grupoTme: 'tme', grupoCsat: 'csat', grupoNota: 'nota', tmePorPessoaDesde: null },
  { apelido: 'diretores', nome: 'Diretores e acima', setorId: 1, regraFinalizado: 'diretores_atendimento', grupoTme: 'tme_diretores', grupoCsat: 'csat', grupoNota: 'nota', tmePorPessoaDesde: null },
];
export const META_CSAT_PADRAO = 0.95;

/**
 * O setor da tela: o escolhido no menu (cookie), se existir e estiver ativo,
 * ou o primeiro. Diferente do `setorDaTela` das Monitorias, não pula setor sem
 * monitoria — o Telecom não tem, e o Início dele mostrava o Expansão.
 */
export async function setorDoPerformance(db: SupabaseClient, pedido?: string | number | null) {
  const { data } = await db.from('setores').select('id, nome').eq('ativo', true).order('ordem');
  const setores = (data ?? []) as { id: number; nome: string }[];
  const setorId = setores.find((s) => String(s.id) === String(pedido ?? ''))?.id ?? setores[0]?.id ?? 1;
  return { setores, setorId };
}

/** O setor de uma pessoa na competência (o último `desde` até o mês). */
export async function setorDaPessoa(db: SupabaseClient, pessoaId: string, competencia: string): Promise<number> {
  const { data } = await db.from('setores_da_pessoa').select('setor_id, desde')
    .eq('pessoa_id', pessoaId).order('desde', { ascending: false });
  const lista = (data ?? []) as { setor_id: number; desde: string }[];
  return (lista.find((h) => h.desde <= competencia) ?? lista[lista.length - 1])?.setor_id ?? 1;
}

/** As filas ativas do setor, na ordem do cadastro. Sem cadastro: as da Expansão (só no setor 1). */
export async function filasDoSetor(db: SupabaseClient, setorId: number): Promise<FilaDoSetor[]> {
  const { data } = await db.from('canais_do_setor').select('*').eq('ativo', true).eq('setor_id', setorId).order('ordem');
  const filas = ((data ?? []) as {
    apelido: string | null; nome: string; setor_id: number; regra_finalizado?: string | null; grupo_tme?: string | null;
    grupo_csat?: string | null; grupo_nota?: string | null; tme_por_pessoa_desde?: string | null;
  }[]).filter((f) => f.apelido).map((f) => ({
    apelido: f.apelido!, nome: f.nome, setorId: f.setor_id, regraFinalizado: f.regra_finalizado ?? null,
    grupoTme: f.grupo_tme ?? null, grupoCsat: f.grupo_csat ?? null, grupoNota: f.grupo_nota ?? null,
    tmePorPessoaDesde: f.tme_por_pessoa_desde ?? null,
  }));
  return filas.length || setorId !== 1 ? filas : FILAS_PADRAO;
}

/** As faixas de C-SAT de cada grupo pedido, da mais baixa à mais alta. */
export async function faixasDeCsat(db: SupabaseClient, grupos: (string | null)[]): Promise<Record<string, FaixaCsat[]>> {
  const pedidos = [...new Set(grupos.filter((g): g is string => !!g))];
  if (!pedidos.length) return {};
  const { data } = await db.from('regras').select('chave, grupo, faixa_min, faixa_max').eq('ativo', true).in('grupo', pedidos);
  const porGrupo: Record<string, FaixaCsat[]> = {};
  for (const r of (data ?? []) as { chave: string; grupo: string; faixa_min: number | null; faixa_max: number | null }[]) {
    (porGrupo[r.grupo] ??= []).push({ chave: r.chave, min: r.faixa_min == null ? null : Number(r.faixa_min), max: r.faixa_max == null ? null : Number(r.faixa_max) });
  }
  for (const g of Object.keys(porGrupo)) porGrupo[g].sort((a, b) => (a.min ?? -1) - (b.min ?? -1));
  return porGrupo;
}

/** A meta de C-SAT: onde começa a faixa mais alta (Expansão 95%, Telecom 94%). */
export function metaDoCsat(faixas: FaixaCsat[] | undefined): number {
  const topo = faixas?.find((f) => f.max == null && f.min != null) ?? [...(faixas ?? [])].reverse().find((f) => f.min != null);
  return topo?.min ?? META_CSAT_PADRAO;
}

/** A faixa em que um C-SAT cai. */
export function faixaDoCsat(faixas: FaixaCsat[] | undefined, v: number): FaixaCsat | null {
  return (faixas ?? []).find((f) => (f.min == null || v >= f.min) && (f.max == null || v < f.max)) ?? null;
}

/** "94%" ou "94,5%". */
export const textoDaMeta = (v: number) => `${(Math.round(v * 1000) / 10).toLocaleString('pt-BR')}%`;
