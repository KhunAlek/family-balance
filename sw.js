'use strict';

self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = String(payload.title || 'Family Cash Flow');
  const options = {
    body: String(payload.body || 'Open the app to review an update.'),
    icon: '/assets/v25/icon-192.png',
    badge: '/assets/v25/badge-96.png',
    tag: String(payload.tag || 'family-cash-flow'),
    renotify: false,
    data: { actionUrl: String(payload.actionUrl || '/') },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.actionUrl || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clientsList) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(target);
        return client.focus();
      }
    }
    return clients.openWindow(target);
  })());
});
