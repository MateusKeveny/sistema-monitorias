'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

const FUSO = 'America/Sao_Paulo';
const hora = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: FUSO, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));

/** Os números da tela, na ordem, para saber quais mudaram depois da troca. */
const numerosDaTela = () =>
  [...document.querySelectorAll<HTMLElement>('main .tabular-nums')].map((el) => el.textContent ?? '');

/**
 * "Atualizado às 14:01" ao lado do mês (1.40.0, migração 58).
 *
 * Os totais do mês aberto vêm do resumo, que a fila de cálculo (migração 92)
 * refaz setor a setor logo depois de cada gravação. Com recálculo na fila,
 * mostra "Atualizando os números…" e pergunta ao banco a cada 5 s (sem
 * pendência, a cada 30 s); quando o resumo fica pronto, recarrega os dados da
 * tela sozinho — sem F5 — e realça por um instante os números que mudaram.
 */
export default function CarimboDoResumo({
  competencia, atualizadoEm, pendente,
}: {
  competencia: string;
  atualizadoEm: string;
  pendente: boolean;
}) {
  const router = useRouter();
  const [esperando, setEsperando] = useState(pendente);
  const antes = useRef<string[] | null>(null);

  // Os dados novos chegaram (o servidor mandou outro atualizadoEm): realça o
  // que mudou em relação ao que estava na tela.
  useEffect(() => {
    setEsperando(pendente);
    const anteriores = antes.current;
    if (!anteriores) return;
    antes.current = null;
    const els = [...document.querySelectorAll<HTMLElement>('main .tabular-nums')];
    if (els.length !== anteriores.length) return;
    els.forEach((el, i) => {
      if ((el.textContent ?? '') !== anteriores[i]) {
        el.classList.remove('realce-resumo');
        void el.offsetWidth; // reinicia a animação
        el.classList.add('realce-resumo');
      }
    });
  }, [atualizadoEm, pendente]);

  useEffect(() => {
    let parado = false;
    const db = criarClienteNavegador();
    const conferir = async () => {
      const { data } = await db.rpc('situacao_do_resumo');
      if (parado) return;
      const s = ((data ?? []) as { mes_competencia: string; atualizado_em: string | null; pendente: boolean }[])
        .find((r) => r.mes_competencia === competencia);
      if (!s) return;
      if (s.atualizado_em && s.atualizado_em !== atualizadoEm && !s.pendente) {
        antes.current = numerosDaTela();
        router.refresh();
      } else {
        setEsperando(s.pendente);
      }
    };
    const intervalo = setInterval(conferir, esperando ? 5_000 : 30_000);
    return () => { parado = true; clearInterval(intervalo); };
  }, [competencia, atualizadoEm, esperando, router]);

  return esperando ? (
    <span className="inline-flex items-center gap-1.5 opacity-90"
          title="Chegaram dados novos: os números desta tela se atualizam sozinhos em instantes.">
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
           className="girar h-3.5 w-3.5"><path d="M21 12a9 9 0 1 1-3-6.7" /></svg>
      Atualizando os números…
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 opacity-80"
          title="Os totais do mês se atualizam sozinhos logo depois de cada importação, lançamento ou monitoria.">
      <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
      </svg>
      Atualizado às {hora(atualizadoEm)}
    </span>
  );
}
