/*
 * Service worker do Painel de Performance (2.4.0, migração 75).
 *
 * Só mostra os avisos do sino no canto da tela e, no clique, abre a tela do
 * aviso. Não guarda páginas em cache.
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (evento) => {
  let d = {};
  try { d = evento.data ? evento.data.json() : {}; } catch (e) { d = { corpo: evento.data && evento.data.text() }; }
  evento.waitUntil(self.registration.showNotification(d.titulo || 'Painel de Performance', {
    body: d.corpo || '',
    tag: d.tag || undefined,
    icon: '/favicon.ico',
    data: { url: d.url || '/cota' },
  }));
});

self.addEventListener('notificationclick', (evento) => {
  const n = evento.notification;
  const { url } = n.data || {};
  n.close();
  evento.waitUntil((async () => {
    const destino = new URL(url || '/cota', self.location.origin).href;
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
