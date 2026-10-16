// ══════════════════════════════════════════
//  map.js — Field Run
//  Terre 3D ronde (MapLibre GL JS, projection "globe")
// ══════════════════════════════════════════

// ── Variables ──────────────────────────────
let map;
let currentMarker;
let markerOnMap = false;
let mapReady = false;       // vrai une fois le style chargé et nos couches ajoutées
let introFlying = false;    // vrai pendant le vol d'introduction vers le joueur

// Fond de carte vectoriel OpenFreeMap : gratuit, sans clé API, usage commercial
// autorisé (attribution obligatoire, affichée par le contrôle de la carte).
// Si ça change un jour, remplacer cette seule URL suffit.
const MAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

const EMPTY_FC = { type: 'FeatureCollection', features: [] };

// Données dessinées par le jeu. Elles sont gardées en JS et poussées vers les
// sources GeoJSON dès que la carte est prête (le GPS peut répondre avant).
let traceLngLat = [];                 // tracé en cours, [lon, lat]
let accuracyFeature = null;           // cercle de précision GPS
const zoneFeatures = new Map();       // clé interne -> Feature GeoJSON
let zoneKeyCounter = 0;
let zonesRefreshQueued = false;

// ── Diagnostic à l'écran ───────────────────
// Sur téléphone il n'y a pas de console : toute erreur JS ou de carte
// s'affiche dans un bandeau rouge en haut de l'écran.
// TEMPORAIRE — à retirer une fois la carte validée.
function showMapDebug(text) {
    let el = document.getElementById('mapDebugBanner');
    if (!el) {
        el = document.createElement('div');
        el.id = 'mapDebugBanner';
        el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:100000;padding:10px 12px;' +
            'background:rgba(160,0,40,0.92);color:#fff;font:11px/1.4 monospace;white-space:pre-wrap;' +
            'word-break:break-word;max-height:40vh;overflow:auto;pointer-events:none';
        document.body.appendChild(el);
    }
    el.textContent += text + '\n';
}

window.addEventListener('error', (e) => {
    showMapDebug('JS : ' + e.message + ' (' + String(e.filename || '').split('/').pop() + ':' + e.lineno + ')');
});
window.addEventListener('unhandledrejection', (e) => {
    showMapDebug('Promesse : ' + ((e.reason && e.reason.message) || e.reason));
});

let mapErrorCount = 0;

// ── Initialisation carte ───────────────────
function initMap() {
    map = new maplibregl.Map({
        container: 'map',
        style: MAP_STYLE_URL,
        center: [10, 25],          // vue d'ensemble : toute la Terre visible
        zoom: 1.4,
        minZoom: 0.8,
        maxZoom: 20,
        attributionControl: false,
        dragRotate: false,         // carte toujours orientée nord en haut
        pitchWithRotate: false,
        touchPitch: false,
    });

    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    map.touchZoomRotate.disableRotation();
    setZoomAroundCenter(true);

    map.on('style.load', onStyleReady);
    map.on('error', (e) => {
        const msg = e && e.error ? e.error.message : String(e);
        console.warn('Erreur carte :', msg);
        if (mapErrorCount++ < 3) showMapDebug('Carte : ' + msg);
    });
}

// Zoom (pincement / molette) : autour du centre quand on suit le joueur, pour
// que zoomer ne décentre jamais ; autour du doigt une fois la carte déplacée.
function setZoomAroundCenter(on) {
    if (!map) return;
    const options = on ? { around: 'center' } : undefined;
    map.touchZoomRotate.enable(options);
    map.scrollZoom.enable(options);
}

function onStyleReady() {
    try {
        map.setProjection({ type: 'globe' });
    } catch (e) {
        console.warn('Projection globe indisponible :', e.message);
    }

    applyNeonTheme();

    // Halo d'atmosphère autour de la Terre (visible en dézoomant)
    try {
        map.setSky({
            'sky-color': '#2a0a5e',
            'horizon-color': '#8a2be2',
            'sky-horizon-blend': 0.6,
            'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
        });
    } catch (e) { /* le jeu fonctionne très bien sans atmosphère */ }

    addGameLayers();
    mapReady = true;

    refreshZonesSource();
    refreshTraceSource();
    refreshAccuracySource();
}

// ── Habillage néon noir / or / violet ──────
// On recolore le style OpenFreeMap couche par couche (par type et par nom)
// plutôt que de dépendre d'un fournisseur de style sombre.
function fillColorFor(id) {
    if (/water/.test(id)) return '#2a1060';
    if (/ice|glacier/.test(id)) return '#14142a';
    if (/park|wood|forest|grass|landcover|golf|pitch|garden|cemetery|nature|scrub|farm|wetland|sand|meadow|recreation/.test(id)) return '#13262a';
    if (/building/.test(id)) return '#222240';
    if (/aeroway|runway|taxiway/.test(id)) return '#1c1c2c';
    return '#14142a';
}

function lineColorFor(id) {
    if (/waterway|river|stream|canal/.test(id)) return '#2a1266';
    if (/boundary|admin|border/.test(id)) return '#EB00CD';
    if (/casing/.test(id)) return '#07070D';
    if (/motorway|trunk|primary/.test(id)) return '#F0C900';
    if (/secondary|tertiary/.test(id)) return '#B89A00';
    if (/rail|transit|subway|ferry/.test(id)) return '#4a2f7a';
    if (/aeroway|runway|taxiway|building/.test(id)) return '#2a2a44';
    if (/road|street|highway|bridge|tunnel|path|link|service|minor|track|pedestrian|footway/.test(id)) return '#6f6020';
    return '#2a2a44';
}

function applyNeonTheme() {
    const layers = (map.getStyle().layers) || [];

    layers.forEach(layer => {
        const id = layer.id.toLowerCase();
        const setPaint = (prop, value) => {
            try { map.setPaintProperty(layer.id, prop, value); } catch (e) { /* propriété absente : on ignore */ }
        };

        switch (layer.type) {
            case 'background':
                setPaint('background-color', '#14142a');
                break;
            case 'fill':
                setPaint('fill-pattern', undefined);
                setPaint('fill-color', fillColorFor(id));
                break;
            case 'fill-extrusion':
                setPaint('fill-extrusion-color', '#1a1a2c');
                break;
            case 'line':
                setPaint('line-color', lineColorFor(id));
                if (/boundary|admin|border/.test(id)) setPaint('line-opacity', 0.45);
                break;
            case 'symbol':
                setPaint('text-color', '#E8E2FF');
                setPaint('text-halo-color', '#07070D');
                setPaint('icon-opacity', 0.55);
                break;
            case 'raster':
            case 'hillshade':
                try { map.setLayoutProperty(layer.id, 'visibility', 'none'); } catch (e) {}
                break;
        }
    });
}

// ── Couches du jeu (zones, précision, tracé) ──
function addGameLayers() {
    // Zones et précision passent sous les noms de lieux ; le tracé reste au-dessus de tout.
    const firstSymbol = (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;

    map.addSource('zones', { type: 'geojson', data: EMPTY_FC });
    map.addSource('accuracy', { type: 'geojson', data: EMPTY_FC });
    map.addSource('trace', { type: 'geojson', data: EMPTY_FC });

    map.addLayer({
        id: 'zones-fill', type: 'fill', source: 'zones',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.4 },
    }, firstSymbol);
    map.addLayer({
        id: 'zones-line', type: 'line', source: 'zones',
        layout: { 'line-join': 'round' },
        paint: { 'line-color': ['get', 'color'], 'line-width': 2.5 },
    }, firstSymbol);

    map.addLayer({
        id: 'accuracy-fill', type: 'fill', source: 'accuracy',
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.07 },
    }, firstSymbol);
    map.addLayer({
        id: 'accuracy-line', type: 'line', source: 'accuracy',
        paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 },
    }, firstSymbol);

    map.addLayer({
        id: 'trace-line', type: 'line', source: 'trace',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#F0C900', 'line-width': 5, 'line-opacity': 0.95 },
    });
}

// ── Marqueur joueur (custom) ───────────────
function initMarker() {
    const el = document.createElement('div');
    el.className = 'playerDot';
    el.innerHTML = '<div class="playerDotCore"></div><div class="playerDotRing"></div>' +
                   '<div class="playerSpeed" id="playerSpeed"></div>';
    currentMarker = new maplibregl.Marker({ element: el });

    // Le GPS peut cesser d'envoyer des positions (arrêt, signal perdu) : sans
    // ce contrôle, la dernière vitesse resterait affichée indéfiniment.
    setInterval(() => {
        if (lastSpeedUpdate && Date.now() - lastSpeedUpdate > 4000) showSpeedLabel('–');
    }, 1000);
}

// ── Vitesse affichée au-dessus du point ────
let lastSpeedUpdate = 0;

function showSpeedLabel(text) {
    const el = document.getElementById('playerSpeed');
    if (!el) return;
    el.textContent = text === '–' ? '– km/h' : text + ' km/h';
    el.style.display = 'block';
}

// kmh : vitesse en km/h, ou null si pas assez de données fiables.
function updateMarkerSpeed(kmh) {
    lastSpeedUpdate = Date.now();
    if (kmh == null) { showSpeedLabel('–'); return; }
    // Sous 1 km/h : le GPS bouge tout seul à l'arrêt, on affiche 0 plutôt que du bruit
    showSpeedLabel(kmh < 1 ? '0' : String(Math.round(kmh)));
}

function updateMarker(lat, lon) {
    currentMarker.setLngLat([lon, lat]);
    if (!markerOnMap) {
        currentMarker.addTo(map);
        markerOnMap = true;
    }
}

// ── Cercle de précision ────────────────────
// Cercle géodésique approximé par un polygone de 48 côtés.
function circlePolygon(lat, lon, radiusM, steps = 48) {
    const R = 6371000;
    const d = radiusM / R;
    const latR = lat * Math.PI / 180;
    const lonR = lon * Math.PI / 180;
    const ring = [];

    for (let i = 0; i <= steps; i++) {
        const bearing = 2 * Math.PI * i / steps;
        const lat2 = Math.asin(Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(bearing));
        const lon2 = lonR + Math.atan2(
            Math.sin(bearing) * Math.sin(d) * Math.cos(latR),
            Math.cos(d) - Math.sin(latR) * Math.sin(lat2)
        );
        ring.push([lon2 * 180 / Math.PI, lat2 * 180 / Math.PI]);
    }
    return ring;
}

function updateAccuracyCircle(lat, lon, accuracy) {
    const color = accuracy > 100 ? '#EB00CD' : '#F0C900';
    accuracyFeature = {
        type: 'Feature',
        properties: { color },
        geometry: { type: 'Polygon', coordinates: [circlePolygon(lat, lon, accuracy)] },
    };
    refreshAccuracySource();
}

function refreshAccuracySource() {
    if (!mapReady) return;
    const src = map.getSource('accuracy');
    if (src) src.setData(accuracyFeature ? { type: 'FeatureCollection', features: [accuracyFeature] } : EMPTY_FC);
}

// ── Ligne de tracé ─────────────────────────
// coords : tableau de [lat, lon] (format interne du jeu)
function updateLine(coords) {
    traceLngLat = coords.map(p => [p[1], p[0]]);
    refreshTraceSource();
}

function clearLine() {
    traceLngLat = [];
    refreshTraceSource();
}

function refreshTraceSource() {
    if (!mapReady) return;
    const src = map.getSource('trace');
    if (!src) return;

    if (traceLngLat.length < 2) {
        src.setData(EMPTY_FC);
    } else {
        src.setData({
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: traceLngLat },
        });
    }
}

// ── Zones capturées ────────────────────────
// points : tableau de [lat, lon]. Renvoie une clé interne à garder dans
// l'objet zone (mapKey) pour pouvoir la retirer plus tard.
function addZoneToMap(points, color) {
    const key = ++zoneKeyCounter;

    const ring = points.map(p => [p[1], p[0]]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);

    zoneFeatures.set(key, {
        type: 'Feature',
        properties: { color },
        geometry: { type: 'Polygon', coordinates: [ring] },
    });
    refreshZonesSource();
    return key;
}

function removeZoneFromMap(key) {
    if (zoneFeatures.delete(key)) refreshZonesSource();
}

// Regroupe les mises à jour d'une même image : charger 200 zones d'un coup
// ne déclenche qu'un seul redessin.
function refreshZonesSource() {
    if (!mapReady || zonesRefreshQueued) return;
    zonesRefreshQueued = true;

    requestAnimationFrame(() => {
        zonesRefreshQueued = false;
        const src = map.getSource('zones');
        if (src) src.setData({ type: 'FeatureCollection', features: [...zoneFeatures.values()] });
    });
}

// ── Caméra ─────────────────────────────────
// latlon : [lat, lon]. Suivi GPS passif : ne touche jamais au zoom.
function mapPanTo(latlon) {
    if (!mapReady || introFlying) return;
    map.easeTo({ center: [latlon[1], latlon[0]], duration: 600, easing: t => t });
}

// Recentrage explicite avec niveau de zoom
function mapSetView(latlon, zoom) {
    if (!map) return;
    introFlying = false;
    map.easeTo({ center: [latlon[1], latlon[0]], zoom, duration: 800 });
}

// Premier fix GPS : on descend de la Terre entière jusqu'au joueur.
function mapIntroFlight(latlon, zoom) {
    if (!map) return;
    introFlying = true;
    map.flyTo({ center: [latlon[1], latlon[0]], zoom, duration: 5000, curve: 1.6, essential: true });
    // Après flyTo : lancer un vol interrompt d'abord l'animation en cours (suivi GPS),
    // dont le "moveend" ne doit pas compter comme la fin du vol d'introduction.
    map.once('moveend', () => { introFlying = false; });
}
