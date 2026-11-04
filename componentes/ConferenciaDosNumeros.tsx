'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from '@/componentes/Link';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mensagemDoErro } from '@/lib/erro-amigavel';
import { dataHora } from '@/lib/formatar';
import type { Alerta } from '@/lib/conferenciaDoMes';

/**
 * Conferência dos números no Fechamento (3.4.0), com "ciente" (3.6.0,
 * migração 96): o gestor confere o aviso e marca; ele sai da tela inicial e
 * do Fechar, e fica guardado com quem marcou e quando. Se o número mudar, o
 * aviso volta (o ciente vale para aquele texto).
 */
export default function ConferenciaDosNumeros({ alertas, competencia }: { alertas: Alerta[]; competencia: string }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [verCientes, setVerCientes] = useState(false);
  const mesCurto = competencia.slice(0, 7);
  const pendentes = alertas.filter((a) => !a.ciente);
  const cientes = alertas.filter((a) => a.ciente);

  async function marcar(lista: Alerta[]) {
    setOcupado(lista.length > 1 ? 'todos' : `${lista[0].pessoa_id}|${lista[0].chave}`); setErro(null);
    const { error } = await criarClienteNavegador().from('conferencia_cientes').upsert(
      lista.map((a) => ({ mes_competencia: competencia, pessoa_id: a.pessoa_id, chave: a.chave, texto: a.texto })),
      { onConflict: 'mes_competencia,pessoa_id,chave,texto', ignoreDuplicates: true });
    setOcupado(null);
    if (error) return setErro(await mensagemDoErro(error));
    router.refresh();
  }

  async function desfazer(a: Alerta) {
    setOcupado(`${a.pessoa_id}|${a.chave}`); setErro(null);
    const { error } = await criarClienteNavegador().from('conferencia_cientes').delete().eq('id', a.ciente!.id);
    setOcupado(null);
    if (error) return setErro(await mensagemDoErro(error));
    router.refresh();
  }

  const linha = (a: Alerta, i: number) => (
    <li key={i} className="-mx-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2.5">
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${a.ciente ? 'bg-marca-600' : a.grave ? 'bg-rose-500' : 'bg-amber-500'}`} />
      <b className="w-44 shrink-0 text-slate-800">{a.pessoa}</b>
      <span className={`flex-1 ${a.ciente ? 'text-slate-500' : 'text-slate-700'}`}>
        {a.texto}
        {a.ciente && (
          <span className="block text-xs text-slate-500">
            Ciente{a.ciente.por ? ` · ${a.ciente.por}` : ''} · {dataHora(a.ciente.em)}
          </span>
        )}
      </span>
      <Link href={`/cota/extrato?mes=${mesCurto}&pessoa=${a.pessoa_id}`}
            className="rounded-full bg-marca-600/10 px-2.5 py-0.5 text-xs font-semibold text-marca-700 hover:bg-marca-600/20 dark:text-marca-400">
        Extrato ›
      </Link>
      {a.ciente ? (
        <button type="button" onClick={() => desfazer(a)} disabled={ocupado !== null}
                className="text-xs text-slate-500 hover:text-rose-700 hover:underline disabled:opacity-40">
          desfazer
        </button>
      ) : (
        <button type="button" onClick={() => marcar([a])} disabled={ocupado !== null}
                title="Conferi e está certo: sai da tela inicial e do aviso do Fechar"
                className="rounded-full border border-slate-300 px-2.5 py-0.5 text-xs font-semibold text-slate-700 hover:border-marca-600 hover:text-marca-700 disabled:opacity-40 dark:hover:text-marca-400">
          {ocupado === `${a.pessoa_id}|${a.chave}` ? '…' : 'Ciente'}
        </button>
      )}
    </li>
  );

  return (
    <div>
      {erro && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}
      {pendentes.length === 0 ? (
        <p className="text-sm font-medium text-marca-700 dark:text-marca-400">
          {cientes.length
            ? `✓ Nada pendente: ${cientes.length === 1 ? 'o aviso do mês foi conferido' : `os ${cientes.length} avisos do mês foram conferidos`}.`
            : '✓ Nada fora do padrão: volume, avaliações e C-SAT de cada pessoa batem entre as semanas.'}
        </p>
      ) : (
        <>
          <ul className="divide-y divide-slate-100 text-sm">{pendentes.map(linha)}</ul>
          {pendentes.length > 1 && (
            <div className="mt-2 flex justify-end">
              <button type="button" onClick={() => marcar(pendentes)} disabled={ocupado !== null}
                      className="text-xs font-semibold text-marca-700 hover:underline disabled:opacity-40 dark:text-marca-400">
                {ocupado === 'todos' ? 'Marcando…' : `Marcar os ${pendentes.length} como ciente`}
              </button>
            </div>
          )}
        </>
      )}
      {cientes.length > 0 && (
        <div className="mt-3 border-t border-slate-100 pt-2">
          <button type="button" onClick={() => setVerCientes((v) => !v)}
                  className="text-xs font-medium text-slate-500 hover:underline">
            {verCientes ? 'Esconder' : 'Ver'} os {cientes.length} já conferido{cientes.length > 1 ? 's' : ''} (ciente)
          </button>
          {verCientes && <ul className="mt-1 divide-y divide-slate-100 text-sm">{cientes.map(linha)}</ul>}
        </div>
      )}
    </div>
  );
}
