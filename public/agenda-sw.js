/*
 * Service worker da Agenda da Gestão (migração 59).
 *
 * Só cuida das notificações: mostra o que chega do servidor e responde aos
 * toques. Não guarda páginas em cache — a agenda é sempre lida do banco, e
 * uma cópia velha na tela seria pior do que a falta de rede.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (evento) => {
  let d = {};
  try { d = evento.data ? evento.data.json() : {}; } catch (e) { d = { corpo: evento.data && evento.data.text() }; }
  const doItem = !!(d.item && d.selo);
  evento.waitUntil(self.registration.showNotification(d.titulo || 'Agenda da Gestão', {
    body: d.corpo || '',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    icon: '/agenda-192.png',
    badge: '/agenda-selo.png',
    data: { url: d.url || '/agenda', item: d.item || null, selo: d.selo || null },
    // Onde cabem 3 botões (Android), vão os três. No computador o navegador
    // mostra só 2: Concluir e Reagendar — o Adiar fica no menu ⋯ da linha.
    actions: !doItem ? [] : (self.Notification && Notification.maxActions >= 3)
      ? [{ action: 'concluir', title: 'Concluir' }, { action: 'adiar', title: 'Adiar 15 min' },
         { action: 'reagendar', title: 'Reagendar' }]
      : [{ action: 'concluir', title: 'Concluir' }, { action: 'reagendar', title: 'Reagendar' }],
    requireInteraction: doItem,
  }));
});

self.addEventListener('notificationclick', (evento) => {
  const n = evento.notification;
  const { url, item, selo } = n.data || {};
  n.close();

  if ((evento.action === 'concluir' || evento.action === 'adiar') && item && selo) {
    evento.waitUntil(
      fetch('/api/agenda/acao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, selo, acao: evento.action }),
      }).then(async (r) => {
        // Avisa as telas abertas para recarregarem a lista.
        const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        abertas.forEach((c) => c.postMessage({ agenda: 'atualizar' }));
        if (!r.ok) throw new Error('falhou');
      }).catch(() => self.registration.showNotification('Não deu para registrar', {
        body: 'Abra a agenda para concluir ou adiar.', icon: '/agenda-192.png', data: { url: '/agenda' },
      })),
    );
    return;
  }

  // Toque na notificação: traz a agenda para a frente (ou abre). "Reagendar"
  // abre a agenda com o lembrete aberto para escolher a nova data.
  evento.waitUntil((async () => {
    const caminho = evento.action === 'reagendar' && item ? `/agenda?reagendar=${encodeURIComponent(item)}` : (url || '/agenda');
    const destino = new URL(caminho, self.location.origin).href;
    const abertas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of abertas) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
        await c.focus();
        if ('navigate' in c) await c.navigate(destino).catch(() => {});
        return;
      }
    }
    await self.clients.openWindow(destino);
  })());
});
