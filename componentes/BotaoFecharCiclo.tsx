'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteNavegador } from '@/lib/supabase/cliente';
import { mesRotulo } from '@/lib/formatar';
import { mensagemDoErro } from '@/lib/erro-amigavel';

/**
 * Congela a competência. O banco é quem decide: `fechar_ciclo` confere o papel
 * e nunca sobrescreve fechamento existente — número já entregue não se refaz.
 *
 * Desde a 3.0 (migração 92) o fechamento entra na fila de cálculo: o botão
 * pede, o banco fecha em seguida (sem o limite de tempo das consultas da tela)
 * e avisa no sino. Enquanto isso a tela mostra o andamento e se atualiza sozinha.
 */
type Pedido = { id: number; setor_id: number; mes_competencia: string; tipo: string; situacao: string; resultado: number | null; erro: string | null };
export default function BotaoFecharCiclo({
  competencia, setorId = 1, pessoas, avisos,
}: {
  competencia: string;
  /** Fecha só as pessoas deste setor (migração 88). */
  setorId?: number;
  /** Quantas pessoas entram no fechamento. */
  pessoas: number;
  /** Pendências que valem confirmar antes de congelar. */
  avisos: string[];
}) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  /** O pedido de fechamento deste setor e mês que está na fila (ou acabou de sair dela). */
  const [andamento, setAndamento] = useState<Pedido | null>(null);

  // Acompanha o pedido: ao abrir a tela (pode haver um em andamento) e, depois
  // de pedir, a cada 3 s até concluir.
  useEffect(() => {
    let parado = false;
    const db = criarClienteNavegador();
    const conferir = async () => {
      const { data } = await db.rpc('situacao_da_fila');
      if (parado) return;
      const p = ((data ?? []) as Pedido[]).find((x) => x.tipo === 'fechar' && x.setor_id === setorId
        && x.mes_competencia === competencia);
      if (!p) return;
      if (p.situacao === 'na_fila' || p.situacao === 'calculando') { setAndamento(p); return; }
      if (andamento) {
        setAndamento(null);
        if (p.situacao === 'pronto') setAviso(`${p.resultado ?? 0} pessoa(s) fechadas em ${mesRotulo(competencia)}.`);
        else setErro(p.erro ?? 'O fechamento não foi concluído.');
        router.refresh();
      }
    };
    conferir();
    const intervalo = setInterval(conferir, andamento ? 3_000 : 30_000);
    return () => { parado = true; clearInterval(intervalo); };
  }, [competencia, setorId, andamento, router]);

  async function fechar() {
    if (!confirm(`Fechar ${mesRotulo(competencia)} com ${pessoas} pessoa(s)?\n\n`
      + 'O resultado e o extrato ficam congelados como estão agora. '
      + 'Mudanças posteriores em pesos, volume ou lançamentos não alteram o que foi fechado, '
      + 'e não existe caminho para desfazer.')) return;

    setOcupado(true); setErro(null); setAviso(null);
    const { data, error } = await criarClienteNavegador().rpc('pedir_fechamento', { p_mes: competencia, p_setor: setorId });
    setOcupado(false);

    if (error) { setErro(await mensagemDoErro(error)); return; }
    // Na fila (ou já estava): a tela acompanha e avisa quando terminar.
    setAndamento({ id: 0, setor_id: setorId, mes_competencia: competencia, tipo: 'fechar',
      situacao: data === 'ja_na_fila' ? 'calculando' : 'na_fila', resultado: null, erro: null });
  }

  return (
    <div className="space-y-3">
      {avisos.length > 0 && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-600/20">
          <p className="font-semibold">Confira antes de fechar</p>
          <ul className="mt-1 list-disc pl-5">
            {avisos.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}
      {erro && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 ring-1 ring-rose-600/20">{erro}</p>
      )}
      {andamento && (
        <p className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
          <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"
               className="girar h-4 w-4 text-marca-600"><path d="M21 12a9 9 0 1 1-3-6.7" /></svg>
          Fechando {mesRotulo(competencia)}… Leva alguns segundos; você também recebe um aviso no sino quando terminar.
        </p>
      )}
      {aviso && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 ring-1 ring-emerald-600/20">{aviso}</p>
      )}

      <button
        type="button" onClick={fechar} disabled={ocupado || !!andamento || pessoas === 0}
        className="rounded-lg bg-marca-600 px-4 py-2 text-sm font-semibold text-white
                   hover:bg-marca-700 disabled:opacity-40"
      >
        {ocupado || andamento ? 'Fechando…' : `Fechar ${mesRotulo(competencia)}`}
      </button>
    </div>
  );
}
