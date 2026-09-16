// ══════════════════════════════════════════
//  map.js — Field Run
// ══════════════════════════════════════════

// ── Variables ──────────────────────────────
let map;
let currentMarker;
let accuracyCircle;
let line;

// ── Initialisation carte ───────────────────
function initMap() {
    map = L.map('map', {
        dragging: true,
        zoomControl: false,
    }).setView([0, 0], 13);

    // Tuiles Esri World Street Map — gratuites, sans clé API requise, rendu
    // plus soigné qu'OSM standard (hiérarchie des routes/bâtiments plus
    // lisible). Je ne peux pas garantir que ça restera gratuit indéfiniment
    // (CartoDB, utilisé avant, a fini par exiger une clé) — si ça recasse un
    // jour, remplacer juste l'URL et l'attribution ci-dessous suffit.
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, HERE, Garmin, USGS, Intermap, INCREMENT P',
        maxZoom: 19
    }).addTo(map);
}

// ── Marqueur joueur (custom) ───────────────
function initMarker() {
    const icon = L.divIcon({
        className: '',
        html: `
            <div class="playerDot">
                <div class="playerDotCore"></div>
                <div class="playerDotRing"></div>
            </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
    });

    currentMarker = L.marker([0, 0], { icon }).addTo(map);
}

// ── Ligne de tracé ─────────────────────────
function initTrackingLine() {
    line = L.polyline([], {
        color: '#F0C900',
        weight: 5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round',
    }).addTo(map);
}

// ── Update marqueur ────────────────────────
function updateMarker(lat, lon) {
    currentMarker.setLatLng([lat, lon]);
}

// ── Cercle de précision ────────────────────
function updateAccuracyCircle(lat, lon, accuracy) {
    const color = accuracy > 100 ? '#EB00CD' : '#F0C900';

    if (accuracyCircle) {
        accuracyCircle.setLatLng([lat, lon]).setRadius(accuracy);
        accuracyCircle.setStyle({ color });
    } else {
        accuracyCircle = L.circle([lat, lon], {
            radius: accuracy,
            color,
            weight: 1.5,
            fillColor: color,
            fillOpacity: 0.07,
        }).addTo(map);
    }
}

// ── Update / clear ligne ───────────────────
function updateLine(coords) {
    line.setLatLngs(coords);
}

function clearLine() {
    line.setLatLngs([]);
}
