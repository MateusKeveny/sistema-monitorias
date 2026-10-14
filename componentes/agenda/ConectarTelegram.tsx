'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteDaAgenda } from '@/lib/agenda/db-cliente';
import { dataHora } from '@/lib/formatar';

/**
 * Liga a agenda a uma conversa do Telegram (supabase/agenda/02-telegram.sql):
 * gera um código de 15 minutos e abre o bot com ele. Quem toca em "Iniciar"
 * no Telegram fica ligado; a tela confere em "Já conectei".
 */
export default function ConectarTelegram({ bot, ligado }: {
  /** @usuario do bot; null se o servidor não tem o TELEGRAM_TOKEN. */
  bot: string | null;
  ligado: { nome: string | null; criado_em: string } | null;
}) {
  const router = useRouter();
  const [aguardando, setAguardando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const db = criarClienteDaAgenda();

  async function conectar() {
    if (!bot) return;
    // A aba abre antes da espera pelo banco: o celular bloqueia janela aberta
    // depois de uma espera, fora do toque.
    const aba = window.open('about:blank', '_blank');
    setOcupado(true);
    setMensagem(null);
    const { data, error } = await db.rpc('agenda_telegram_codigo');
    setOcupado(false);
    if (error || !data) { aba?.close(); setMensagem(`Não foi possível gerar o código: ${error?.message ?? 'sem resposta'}`); return; }
    const link = `https://t.me/${bot}?start=${data}`;
    if (aba) aba.location.href = link; else window.location.href = link;
    setAguardando(true);
  }

  async function desconectar() {
    setOcupado(true);
    await db.rpc('agenda_telegram_desvincular');
    setOcupado(false);
    setMensagem('O Telegram não recebe mais os avisos.');
    router.refresh();
  }

  async function testar() {
    setOcupado(true);
    setMensagem(null);
    const { data, error } = await db.rpc('agenda_testar');
    setOcupado(false);
    setMensagem(error ? `Falhou: ${error.message}`
      : `Enviado para ${data} destino${Number(data) === 1 ? '' : 's'}. Deve chegar em alguns segundos.`);
  }

  const botao = 'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60';

  if (!bot) {
    return <p className="text-sm text-slate-600">O bot do Telegram ainda não foi configurado no servidor.</p>;
  }

  return (
    <div className="space-y-3">
      {ligado ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-marca-50 px-2.5 py-1 text-sm font-medium text-marca-700 dark:text-marca-400">
            <span className="h-2 w-2 rounded-full bg-marca-600" />
            Conectado{ligado.nome ? ` · ${ligado.nome}` : ''} desde {dataHora(ligado.criado_em)}
          </span>
          <button onClick={testar} disabled={ocupado} className={`${botao} border border-slate-300 text-slate-700 hover:bg-slate-50`}>
            Enviar teste
          </button>
          <button onClick={desconectar} disabled={ocupado} className={`${botao} text-slate-500 hover:bg-slate-100`}>
            Desconectar
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={conectar} disabled={ocupado} className={`${botao} bg-marca-600 text-white hover:bg-marca-700`}>
              {ocupado ? 'Abrindo…' : 'Conectar Telegram'}
            </button>
            {aguardando && (
              <button onClick={() => router.refresh()} className={`${botao} border border-slate-300 text-slate-700 hover:bg-slate-50`}>
                Já conectei
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500">
            {aguardando
              ? 'No Telegram, toque em Iniciar. O código vale por 15 minutos.'
              : `Abre a conversa com @${bot} no Telegram. Depois de tocar em Iniciar, os lembretes chegam lá.`}
          </p>
        </div>
      )}
      {mensagem && <p role="status" className="text-sm text-slate-600">{mensagem}</p>}
    </div>
  );
}
