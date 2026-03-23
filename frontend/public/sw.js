self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data.json(); } catch (_) { data = { title: 'Kinnect', body: event.data ? event.data.text() : 'New notification' }; }

  var title = data.title || 'Kinnect';
  var options = {
    body: data.body || '',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: data.tag || 'kinnect-' + Date.now(),
    renotify: true,
    data: data
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].url && clientList[i].focus) {
          return clientList[i].focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
