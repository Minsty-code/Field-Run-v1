// ══════════════════════════════════════════
//  sw.js — Field Run
//  Cache persistant des tuiles de carte (OpenFreeMap).
//  À placer à la RACINE du site, à côté de index.html.
//
//  Il ne touche à rien d'autre que les requêtes vers tiles.openfreemap.org :
//  le code du jeu (HTML/JS/CSS) n'est jamais mis en cache ici, donc une mise
//  à jour du site est toujours prise en compte immédiatement.
// ══════════════════════════════════════════

const TILE_CACHE = 'fieldrun-tiles-v1';
const STATIC_CACHE = 'fieldrun-map-static-v1';
const MAX_TILES = 600;   // au-delà, les plus anciennes sont supprimées
const TRIM_EVERY = 40;   // on ne fait le ménage qu'une fois toutes les N tuiles ajoutées

const MAP_HOST = 'tiles.openfreemap.org';
const TILE_PATH = /\/\d{1,2}\/\d+\/\d+\.pbf$/;   // .../{z}/{x}/{y}.pbf
const STATIC_PATH = /\/(fonts|sprites)\//;         // polices et icônes : ne changent presque jamais

let putsSinceTrim = 0;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // Supprime les caches des anciennes versions de ce fichier
        const names = await caches.keys();
        await Promise.all(
            names
                .filter(n => n.startsWith('fieldrun-') && n !== TILE_CACHE && n !== STATIC_CACHE)
                .map(n => caches.delete(n))
        );
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.hostname !== MAP_HOST) return; // tout le reste passe normalement par le réseau

    if (TILE_PATH.test(url.pathname)) {
        event.respondWith(cacheFirst(event, TILE_CACHE, true));
    } else if (STATIC_PATH.test(url.pathname)) {
        event.respondWith(cacheFirst(event, STATIC_CACHE, false));
    } else {
        // Style et description des tuiles (TileJSON) : changent quand une nouvelle
        // version de la carte sort, donc réseau d'abord ; le cache ne sert qu'hors-ligne.
        event.respondWith(networkFirst(event));
    }
});

// Les adresses de tuiles contiennent la version de la carte : une tuile en
// cache est donc toujours valable, on la sert sans interroger le réseau.
async function cacheFirst(event, cacheName, isTile) {
    const req = event.request;
    const cache = await caches.open(cacheName);

    const hit = await cache.match(req, { ignoreVary: true });
    if (hit) return hit;

    const res = await fetch(req);
    if (res.ok) {
        event.waitUntil(
            cache.put(req, res.clone())
                .then(() => (isTile ? trimSoon(cache) : null))
                .catch(() => {})
        );
    }
    return res;
}

async function networkFirst(event) {
    const req = event.request;
    const cache = await caches.open(STATIC_CACHE);
    try {
        const res = await fetch(req);
        if (res.ok) event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
        return res;
    } catch (e) {
        const hit = await cache.match(req, { ignoreVary: true });
        if (hit) return hit;
        throw e;
    }
}

async function trimSoon(cache) {
    if (++putsSinceTrim < TRIM_EVERY) return;
    putsSinceTrim = 0;

    const keys = await cache.keys();            // dans l'ordre d'ajout
    const extra = keys.length - MAX_TILES;
    for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
}
