// Der Pokémon-Collector ist umgezogen. Dieser Service Worker räumt den alten Offline-Speicher auf und meldet sich ab.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('pokemon-')).map((k) => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) => c.navigate('https://stephanweigelt-ger.github.io/Pokemon-collector/'));
  })());
});
