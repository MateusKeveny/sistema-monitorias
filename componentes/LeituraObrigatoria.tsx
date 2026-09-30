'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { COR_TIPO, ROTULO_TIPO, validade, type RegistroDiario } from '@/lib/diario';

const dataBR = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/**
 * Leitura obrigatória do diário (1.29.0): com processo ou treinamento ainda
 * não lido, o Performance abre aqui, no lugar do painel, até a pessoa
 * confirmar cada um. O layout decide quando mostrar (migração 38); ao
 * confirmar o último, a atualização da página devolve o painel.
 */
export default function LeituraObrigatoria({
  registros, nomes, hoje,
}: {
  registros: RegistroDiario[];
  nomes: Record<string, string>;
  hoje: string;
}) {
  const router = useRouter();
  const [lidos, setLidos] = useState<Set<string>>(new Set());
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const total = registros.length;
  const feitos = lidos.size;

  async function confirmar(id: string) {
    setOcupado(id); setErro(null);
    const { error } = await criarClienteNavegador().from('diario_leituras').insert({ registro_id: id });
    setOcupado(null);
    // Já confirmado (outra aba, clique duplo): conta como lido.
    if (error && error.code !== '23505') { setErro(error.message); return; }
    setLidos((s) => new Set(s).add(id));
  }

  async function sair() {
    await criarClienteNavegador().auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div className="min-h-screen px-6 py-8">
      <div className="mx-auto flex max-w-3xl items-center justify-between">
        <span className="text-sm font-bold tracking-tight text-sobre-fundo">Painel de Performance</span>
        <button type="button" onClick={sair}
                className="rounded-lg border border-white/30 px-3 py-1.5 text-sm font-medium text-sobre-fundo hover:bg-white/10">
          Sair
        </button>
      </div>

      <div className="mx-auto mt-8 max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight text-sobre-fundo sm:text-[1.7rem]">Antes de começar: novidades do diário</h1>
        <p className="mt-1 text-sm text-sobre-fundo-suave">
          Processos e treinamentos novos da equipe. Leia cada um e confirme; o painel libera quando todos estiverem confirmados.
        </p>

        <div className="mt-4 flex items-center gap-3 text-sm text-sobre-fundo-suave">
          <span className="tabular-nums">{feitos} de {total} confirmado{total > 1 ? 's' : ''}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/20" role="progressbar"
               aria-valuemin={0} aria-valuemax={total} aria-valuenow={feitos}>
            <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-300"
                 style={{ width: `${total ? (feitos / total) * 100 : 100}%` }} />
          </div>
        </div>

        {erro && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>}

        <div className="mt-4 grid gap-3">
          {registros.map((r) => {
            const lido = lidos.has(r.id);
            const v = validade(r, hoje);
            return (
              <article key={r.id} className={`rounded-[18px] bg-superficie px-6 py-5 shadow-sm transition ${lido ? 'opacity-70' : ''}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${COR_TIPO[r.tipo]}`}>{ROTULO_TIPO[r.tipo]}</span>
                  <b className="text-base font-semibold text-slate-900">{r.assunto}</b>
                  {v && <span className="rounded-md bg-sky-500/15 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300">{v.texto}</span>}
                </div>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{r.descricao}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
                  <span className="text-xs text-slate-500">{nomes[r.pessoa_id] ?? '—'} · {dataBR(r.data)}</span>
                  {lido ? (
                    <span className="text-sm font-semibold text-marca-700 dark:text-marca-400">✓ Ciente</span>
                  ) : (
                    <button type="button" disabled={ocupado !== null} onClick={() => confirmar(r.id)}
                            className="rounded-lg bg-marca-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
                      {ocupado === r.id ? 'Confirmando…' : 'Li e estou ciente'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-end gap-4 text-sm text-sobre-fundo-suave">
          <span>{feitos === total ? 'Tudo lido. O painel está liberado.'
            : `Falta${total - feitos > 1 ? 'm' : ''} ${total - feitos} registro${total - feitos > 1 ? 's' : ''}.`}</span>
          <button type="button" disabled={feitos < total} onClick={() => router.refresh()}
                  className="rounded-xl bg-marca-600 px-4 py-2 text-sm font-semibold text-white hover:bg-marca-700 disabled:cursor-not-allowed disabled:opacity-40">
            Ir para o painel
          </button>
        </div>
      </div>
    </div>
  );
}
