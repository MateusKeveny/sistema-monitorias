'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { criarClienteDaAgenda } from '@/lib/agenda/db-cliente';

type Estado = 'carregando' | 'sem-suporte' | 'bloqueado' | 'desligado' | 'ligado';

const paraBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

/** Nome curto do aparelho, para a lista: "Android · Chrome", "Windows · Edge". */
function nomeDoAparelho(): string {
  const ua = navigator.userAgent;
  const so = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone' : /Windows/.test(ua) ? 'Windows'
    : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Aparelho';
  const nav = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox/.test(ua) ? 'Firefox'
    : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'navegador';
  const app = matchMedia('(display-mode: standalone)').matches ? ' (app)' : '';
  return `${so} · ${nav}${app}`;
}

/**
 * Liga as notificações neste aparelho: pede a permissão, inscreve o navegador
 * no serviço de notificação com a chave pública da agenda e guarda a
 * inscrição no banco (agenda_inscrever).
 */
export default function AtivarNotificacoes({ chavePublica }: { chavePublica: string | null }) {
  const router = useRouter();
  const [estado, setEstado] = useState<Estado>('carregando');
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    (async () => {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setEstado('sem-suporte'); return;
      }
      if (Notification.permission === 'denied') { setEstado('bloqueado'); return; }
      const reg = await navigator.serviceWorker.register('/agenda-sw.js');
      const insc = await reg.pushManager.getSubscription();
      setEstado(insc && Notification.permission === 'granted' ? 'ligado' : 'desligado');
    })().catch(() => setEstado('sem-suporte'));
  }, []);

  async function ligar() {
    if (!chavePublica) { setMensagem('A chave de notificação não está configurada no servidor.'); return; }
    setOcupado(true);
    setMensagem(null);
    try {
      const permissao = await Notification.requestPermission();
      if (permissao !== 'granted') { setEstado(permissao === 'denied' ? 'bloqueado' : 'desligado'); return; }
      const reg = await navigator.serviceWorker.register('/agenda-sw.js');
      await navigator.serviceWorker.ready;
      let insc = await reg.pushManager.getSubscription();
      // Inscrição feita com outra chave (troca de chave no servidor): refaz.
      const atual = insc?.options.applicationServerKey;
      if (insc && atual && new Uint8Array(atual).join() !== paraBytes(chavePublica).join()) {
        await insc.unsubscribe();
        insc = null;
      }
      insc ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: paraBytes(chavePublica) });
      const j = insc.toJSON();
      const { error } = await criarClienteDaAgenda().rpc('agenda_inscrever', {
        p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_aparelho: nomeDoAparelho(),
      });
      if (error) throw new Error(error.message);
      setEstado('ligado');
      setMensagem('Pronto: este aparelho vai receber os lembretes.');
      router.refresh();
    } catch (e) {
      setMensagem(`Não foi possível ativar: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setOcupado(false);
    }
  }

  async function desligar() {
    setOcupado(true);
    const reg = await navigator.serviceWorker.getRegistration('/agenda-sw.js');
    const insc = await reg?.pushManager.getSubscription();
    if (insc) {
      await criarClienteDaAgenda().rpc('agenda_desinscrever', { p_endpoint: insc.endpoint });
      await insc.unsubscribe();
    }
    setOcupado(false);
    setEstado('desligado');
    setMensagem('Este aparelho não recebe mais notificações.');
    router.refresh();
  }

  async function testar() {
    setOcupado(true);
    setMensagem(null);
    const { data, error } = await criarClienteDaAgenda().rpc('agenda_testar');
    setOcupado(false);
    setMensagem(error ? `Falhou: ${error.message}`
      : `Enviado para ${data} aparelho${Number(data) === 1 ? '' : 's'}. Deve chegar em alguns segundos.`);
  }

  const botao = 'rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60';

  return (
    <div className="space-y-3">
      {estado === 'carregando' && <p className="text-sm text-slate-500">Verificando este aparelho…</p>}
      {estado === 'sem-suporte' && (
        <p className="text-sm text-slate-600">
          Este navegador não aceita notificações de sites. No Android use o Chrome; no computador, o Edge ou o Chrome.
        </p>
      )}
      {estado === 'bloqueado' && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          As notificações foram bloqueadas para este site. Toque no cadeado ao lado do endereço → Permissões →
          Notificações → Permitir, e volte aqui.
        </p>
      )}
      {estado === 'desligado' && (
        <button onClick={ligar} disabled={ocupado} className={`${botao} bg-marca-600 text-white hover:bg-marca-700`}>
          {ocupado ? 'Ativando…' : 'Ativar notificações neste aparelho'}
        </button>
      )}
      {estado === 'ligado' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-marca-50 px-2.5 py-1 text-sm font-medium text-marca-700 dark:text-marca-400">
            <span className="h-2 w-2 rounded-full bg-marca-600" /> Ativas neste aparelho
          </span>
          <button onClick={testar} disabled={ocupado} className={`${botao} border border-slate-300 text-slate-700 hover:bg-slate-50`}>
            Enviar teste
          </button>
          <button onClick={desligar} disabled={ocupado} className={`${botao} text-slate-500 hover:bg-slate-100`}>
            Desativar
          </button>
        </div>
      )}
      {mensagem && <p role="status" className="text-sm text-slate-600">{mensagem}</p>}
    </div>
  );
}
