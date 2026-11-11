import EscalaEFeriados from '@/componentes/EscalaEFeriados';
import { criarClienteServidor } from '@/lib/supabase/servidor';
import { hojeNoBrasil } from '@/lib/formatar';
import type { Escala, Feriado } from '@/lib/escala';
import { carregarRegrasDoSetor, TopoDasRegras } from '../configuracao/regras-do-setor';

export const dynamic = 'force-dynamic';

/**
 * Escala e feriados (4.6.0, migração 107): a escala de cada pessoa e os
 * feriados do setor, que o SLA dos chamados usa para contar só o tempo dentro
 * do expediente. Só o setor com a opção ligada usa; outro copia a configuração.
 */
export default async function EscalaDoSetor({ searchParams }: { searchParams: Promise<{ setor?: string }> }) {
  const { setor } = await searchParams;
  const d = await carregarRegrasDoSetor(setor);
  const db = await criarClienteServidor();
  const hoje = hojeNoBrasil();

  const [{ data: setores }, { data: setoresDaPessoa }, { data: pessoas }, { data: escalas }, { data: feriados }] = await Promise.all([
    db.from('setores').select('id, nome, sla_pela_escala').eq('ativo', true).order('ordem'),
    db.from('setores_da_pessoa').select('pessoa_id, setor_id, desde'),
    db.from('pessoas').select('id, nome, desligado_em, perfil_de_teste').order('nome'),
    db.from('escalas').select('id, pessoa_id, dia_semana, entrada, inicio_intervalo, fim_intervalo, saida, vale_desde'),
    db.from('feriados').select('*').eq('setor_id', d.setorId).order('data'),
  ]);

  // O setor de cada pessoa hoje (o vínculo mais recente que já começou).
  const setorDe = new Map<string, number>();
  for (const s of ((setoresDaPessoa ?? []) as { pessoa_id: string; setor_id: number; desde: string }[])
    .filter((s) => s.desde <= hoje).sort((a, b) => a.desde.localeCompare(b.desde))) setorDe.set(s.pessoa_id, s.setor_id);
  const lista = (escalas ?? []) as Escala[];
  const comEscala = new Set(lista.map((e) => e.pessoa_id));
  const doSetor = ((pessoas ?? []) as { id: string; nome: string; desligado_em: string | null; perfil_de_teste: boolean | null }[])
    .filter((p) => setorDe.get(p.id) === d.setorId && !p.perfil_de_teste && (!p.desligado_em || comEscala.has(p.id)))
    .map((p) => ({ id: p.id, nome: p.nome }));
  const todos = (setores ?? []) as { id: number; nome: string; sla_pela_escala: boolean }[];

  return (
    <div className="space-y-6">
      <TopoDasRegras dados={d} caminho="/cota/escala" titulo="Escala e feriados"
                     subtitulo="O horário de cada pessoa e os feriados do setor: o SLA dos chamados conta só o tempo dentro do expediente de quem tratou." />
      <EscalaEFeriados key={d.setorId} setorId={d.setorId} setorNome={d.setorNome}
                       ligado={todos.find((s) => s.id === d.setorId)?.sla_pela_escala ?? false}
                       outrosSetores={todos.filter((s) => s.id !== d.setorId).map((s) => ({ id: s.id, nome: s.nome, ligado: s.sla_pela_escala }))}
                       pessoas={doSetor}
                       escalas={lista.filter((e) => doSetor.some((p) => p.id === e.pessoa_id))}
                       feriados={(feriados ?? []) as Feriado[]} />
    </div>
  );
}
