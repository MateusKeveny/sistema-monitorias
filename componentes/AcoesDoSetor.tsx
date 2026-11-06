'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mensagemDoErro } from '@/lib/erro-amigavel';

export type HistoricoDoSetor = {
  pessoas: number; pessoas_ativas: number; fechamentos: number; monitorias: number; valores: number;
  volumes: number; avaliacoes: number; lancamentos: number; metricas_desligadas: number; cargos_em_uso: number;
  usado_por_outro: number; ativos_outros: number;
};

/** Tem algo que não pode ser apagado: pessoas, fechamentos ou números lançados. */
export const temHistorico = (h: HistoricoDoSetor) =>
  h.pessoas + h.fechamentos + h.monitorias + h.valores + h.volumes + h.avaliacoes
  + h.lancamentos + h.metricas_desligadas + h.cargos_em_uso > 0;

/**
 * Excluir ou desativar um setor (4.1.0, migração 100) — só o administrador.
 * Sem histórico: "Excluir" apaga de vez (digitando o nome para confirmar).
 * Com histórico: não exclui; "Desativar" tira do menu, do seletor e das
 * listas e guarda tudo, e "Reativar" traz de volta. O banco confere de novo.
 */
export default function AcoesDoSetor({ setor, historico }: {
  setor: { id: number; nome: string; ativo: boolean };
  historico: HistoricoDoSetor;
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const comHistorico = temHistorico(historico);
  const ultimo = setor.ativo && historico.ativos_outros === 0;
  const botao = 'rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-40';

  async function chamar(fn: () => PromiseLike<{ error: unknown }>) {
    setOcupado(true); setErro(null);
    const { error } = await fn();
    setOcupado(false);
    if (error) { setErro(await mensagemDoErro(error as never)); return; }
    router.refresh();
  }

  function excluir() {
    const digitado = window.prompt(`Excluir de vez o setor "${setor.nome}", com as filas, os cargos e as configurações dele?\n\nNão dá para desfazer. Para confirmar, digite o nome do setor:`);
    if (digitado == null) return;
    if (digitado.trim() !== setor.nome.trim()) { setErro('O nome digitado não confere: nada foi excluído.'); return; }
    chamar(() => criarClienteNavegador().rpc('excluir_setor', { p_setor: setor.id }));
  }

  function desativar() {
    if (!confirm(`Desativar o setor "${setor.nome}"?\n\nEle some do menu, do seletor de setor e das listas. Os fechamentos e os números já lançados continuam guardados, e dá para reativar depois.`)) return;
    chamar(() => criarClienteNavegador().rpc('desativar_setor', { p_setor: setor.id, p_ativo: false }));
  }

  const motivoDesativar = ultimo ? 'É o único setor ativo.'
    : historico.pessoas_ativas > 0 ? `Há ${historico.pessoas_ativas} pessoa(s) ativa(s): mova-as pela Árvore antes.` : null;

  return (
    <span className="flex flex-wrap items-center gap-2">
      {!setor.ativo && (
        <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Desativado</span>
      )}
      {setor.ativo ? (
        comHistorico || historico.usado_por_outro > 0 ? (
          <button type="button" onClick={desativar} disabled={ocupado || !!motivoDesativar}
                  title={motivoDesativar ?? 'Tem histórico: em vez de excluir, desativa (guarda tudo e dá para reativar).'}
                  className={`${botao} border-amber-500/50 text-amber-700 hover:bg-amber-50 dark:text-amber-300`}>
            Desativar
          </button>
        ) : (
          <button type="button" onClick={excluir} disabled={ocupado || ultimo}
                  title={ultimo ? 'É o único setor ativo.' : 'Sem histórico: pode ser excluído de vez.'}
                  className={`${botao} border-rose-500/50 text-rose-700 hover:bg-rose-50 dark:text-rose-300`}>
            Excluir setor
          </button>
        )
      ) : (
        <>
          <button type="button" onClick={() => chamar(() => criarClienteNavegador().rpc('desativar_setor', { p_setor: setor.id, p_ativo: true }))}
                  disabled={ocupado} className={`${botao} border-marca-600/50 text-marca-700 hover:bg-marca-50 dark:text-marca-400`}>
            Reativar
          </button>
          {!comHistorico && historico.usado_por_outro === 0 && (
            <button type="button" onClick={excluir} disabled={ocupado}
                    className={`${botao} border-rose-500/50 text-rose-700 hover:bg-rose-50 dark:text-rose-300`}>
              Excluir setor
            </button>
          )}
        </>
      )}
      {erro && <span className="basis-full text-xs text-rose-700 dark:text-rose-300">{erro}</span>}
    </span>
  );
}
