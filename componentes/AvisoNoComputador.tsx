'use client';

import { useEffect, useState } from 'react';
import { criarClienteNavegador } from '@/lib/supabase/cliente';

type Estado = 'carregando' | 'sem-suporte' | 'bloqueado' | 'desligado' | 'ligado';

const paraBytes = (base64url: string) => {
  const b = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (base64url.length % 4)) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const ehBrave = () => !!(navigator as Navigator & { brave?: unknown }).brave;

/**
 * "Receber também no canto da tela" (2.4.0, migração 75): inscreve este
 * computador para os avisos do sino chegarem como notificação do navegador,
 * mesmo com o painel fechado. O mesmo mecanismo da Agenda.
 */
export default function AvisoNoComputador() {
  const [estado, setEstado] = useState<Estado>('carregando');
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setEstado('sem-suporte'); return;
      }
      if (Notification.permission === 'denied') { setEstado('bloqueado'); return; }
      const reg = await navigator.serviceWorker.register('/cota-sw.js');
      const insc = await reg.pushManager.getSubscription();
      setEstado(insc && Notification.permission === 'granted' ? 'ligado' : 'desligado');
    })().catch(() => setEstado('sem-suporte'));
  }, []);

  async function ligar() {
    setOcupado(true); setMensagem(null);
    try {
      const { chave } = await fetch('/api/cota/avisos/chave').then((r) => r.json()) as { chave: string | null };
      if (!chave) { setMensagem('O aviso no computador ainda não está configurado no servidor.'); return; }
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') { setEstado(permissao === 'denied' ? 'bloqueado' : 'desligado'); return; }
      const reg = await navigator.serviceWorker.register('/cota-sw.js');
      await navigator.serviceWorker.ready;
      let insc = await reg.pushManager.getSubscription();
      const atual = insc?.options.applicationServerKey;
      if (insc && atual && new Uint8Array(atual).join() !== paraBytes(chave).join()) { await insc.unsubscribe(); insc = null; }
      insc ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: paraBytes(chave) });
      const j = insc.toJSON();
      const { error } = await criarClienteNavegador().from('inscricoes_push')
        .upsert({ endpoint: j.endpoint, p256dh: j.keys?.p256dh, auth: j.keys?.auth }, { onConflict: 'endpoint' });
      if (error) throw new Error(error.message);
      setEstado('ligado');
      setMensagem('Pronto: este computador vai receber os avisos.');
    } catch (e) {
      // O Brave vem com o serviço de push do Google desligado.
      setMensagem(ehBrave()
        ? 'O Brave recusou. Abra brave://settings/privacy, ligue "Usar os serviços do Google para mensagens push", reinicie o Brave e tente de novo.'
        : `Não foi possível ativar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcupado(false);
    }
  }

  async function desligar() {
    setOcupado(true);
    const reg = await navigator.serviceWorker.getRegistration('/cota-sw.js');
    const insc = await reg?.pushManager.getSubscription();
    if (insc) {
      await criarClienteNavegador().from('inscricoes_push').delete().eq('endpoint', insc.endpoint);
      await insc.unsubscribe();
    }
    setOcupado(false);
    setEstado('desligado');
    setMensagem('Este computador não recebe mais os avisos no canto da tela.');
  }

  if (estado === 'carregando' || estado === 'sem-suporte') return null;
  return (
    <div className="mt-1 border-t border-slate-100 px-2 pt-2 text-xs text-slate-600">
      {estado === 'ligado' ? (
        <p className="flex items-center justify-between gap-2">
          <span>🔔 Avisos no canto da tela ativos neste computador.</span>
          <button type="button" onClick={desligar} disabled={ocupado} className="shrink-0 text-slate-500 hover:underline">desativar</button>
        </p>
      ) : estado === 'bloqueado' ? (
        <p>O navegador está bloqueando notificações deste site. Libere no cadeado ao lado do endereço para ativar.</p>
      ) : (
        <p className="flex items-center justify-between gap-2">
          <span>Receber também no canto da tela, mesmo com o painel fechado.</span>
          <button type="button" onClick={ligar} disabled={ocupado}
                  className="shrink-0 rounded-md bg-marca-600 px-2.5 py-1 font-semibold text-white hover:bg-marca-700 disabled:opacity-40">
            {ocupado ? '…' : 'Ativar'}
          </button>
        </p>
      )}
      {mensagem && <p className="mt-1 text-slate-500">{mensagem}</p>}
    </div>
  );
}
