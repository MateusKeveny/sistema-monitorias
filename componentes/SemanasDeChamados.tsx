'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { Quadro } from '@/componentes/ui';
import { dataHora, diaMes, periodoDaSemana } from '@/lib/formatar';
import { mensagemDoErro } from '@/lib/erro-amigavel';

export type SemanaDeChamados = {
  semana: number;
  quantidade: number;
  encerrada: boolean;
  marcada: boolean;
  marcado_por_nome: string | null;
  marcado_em: string | null;
};

/**
 * Chamados importados por semana do ciclo (migração 60). Semana encerrada sem
 * nenhum chamado vira pendência — no "Precisa de você" e na Agenda da Gestão —
 * até subir o relatório ou o gestor marcar "Sem chamados".
 */
export default function SemanasDeChamados({ meses }: {
  meses: { competencia: string; rotulo: string; semanas: SemanaDeChamados[] }[];
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function marcar(competencia: string, semana: number, marcar: boolean) {
    setOcupado(`${competencia}-${semana}`);
    setErro(null);
    const { error } = await criarClienteNavegador().rpc('marcar_semana_sem_chamados',
      { p_mes: competencia, p_semana: semana, p_marcar: marcar });
    setOcupado(null);
    if (error) { setErro(await mensagemDoErro(error)); return; }
    router.refresh();
  }

  const botao = 'rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-60';

  return (
    <Quadro titulo="Chamados por semana"
            subtitulo="Semana encerrada sem chamado importado fica pendente até o relatório subir. Se não houve chamado, marque “Sem chamados”.">
      <div className="space-y-4">
        {meses.map((m) => (
          <div key={m.competencia}>
            {meses.length > 1 && <p className="mb-1.5 text-xs font-medium text-slate-500">{m.rotulo}</p>}
            <div className="grid gap-1.5 sm:grid-cols-4">
              {m.semanas.map((s) => {
                const [de, ate] = periodoDaSemana(m.competencia, s.semana);
                const chave = `${m.competencia}-${s.semana}`;
                const pendente = s.encerrada && s.quantidade === 0 && !s.marcada;
                const classe = s.quantidade > 0 ? 'bg-marca-600/15 text-marca-700 dark:text-marca-400'
                  : pendente ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    : 'bg-slate-100 text-slate-500';
                return (
                  <div key={s.semana} className={`rounded-lg px-3 py-2 text-sm ${classe}`}>
                    <p className="text-xs opacity-80">{s.semana}ª · {diaMes(de)} a {diaMes(ate)}</p>
                    <p className="font-semibold tabular-nums">
                      {s.quantidade > 0 ? `${s.quantidade} chamado${s.quantidade > 1 ? 's' : ''}`
                        : s.marcada ? 'Sem chamados' : s.encerrada ? 'Nada importado' : 'Em andamento'}
                    </p>
                    {pendente && (
                      <button onClick={() => marcar(m.competencia, s.semana, true)} disabled={ocupado === chave}
                              className={`${botao} mt-1.5 border border-current hover:bg-white/40`}>
                        {ocupado === chave ? 'Marcando…' : 'Sem chamados'}
                      </button>
                    )}
                    {s.marcada && s.quantidade === 0 && (
                      <p className="mt-1 text-xs opacity-80">
                        {s.marcado_por_nome ? `${s.marcado_por_nome.split(' ')[0]}, ` : ''}
                        {s.marcado_em ? dataHora(s.marcado_em) : ''}
                        {' · '}
                        <button onClick={() => marcar(m.competencia, s.semana, false)} disabled={ocupado === chave}
                                className="underline underline-offset-2 hover:opacity-80">
                          Desfazer
                        </button>
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {erro && <p role="alert" className="mt-3 text-sm text-rose-700">{erro}</p>}
    </Quadro>
  );
}
