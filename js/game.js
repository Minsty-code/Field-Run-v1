//====================
// Variables
//====================

let coords = [];              // points GPS du tracé en cours
let isRunning = false;        // une course est en cours ?
let watchId;                  // id du watchPosition GPS
let firstMapFix = true;       // vrai jusqu'au tout premier fix GPS
let firstPoint = null;        // point de départ du tracé en cours
let firstTracingFix = true;   // vrai jusqu'au premier point du tracé en cours
let isCentred = true;         // la carte suit-elle la position actuelle ?
let lastPosition = null;      // dernière position GPS connue

// Vrai si on vient d'être bloqué au moins une fois par "on est encore dans
// ou tout près de son propre territoire, on n'a pas encore commencé à tracer"
let recentlyNearOwnTerritory = false;
// Vrai si le tracé EN COURS est parti de son propre territoire (dedans ou à
// moins de 5m du bord — tolérance pour l'imprécision GPS) : dans ce cas,
// retoucher ce territoire plus tard ferme et agrandit la zone. Si le tracé
// est parti d'ailleurs, traverser son propre territoire ne déclenche rien —
// comme s'il n'existait pas pour ce trajet.
let traceOriginatesFromOwnTerritory = false;

// Chaque zone est un objet { id, owner, points, layer }.
// owner vaut "player" pour une zone tracée localement, ou l'id du compte
// (uuid Supabase) pour une zone chargée depuis le serveur.
let zones = [];

let playerTotalArea = 0;      // surface totale capturée (m²)

// Score en points, gardé séparé de playerTotalArea pour pouvoir plus tard
// ajouter des bonus/malus sans casser la correspondance avec la surface réelle.
let playerScore = 0;
const M2_PER_POINT = 10;      // 1 point = 10 m² (1 "hars")

// GAME_ZOOM : zoom maximum, utilisé en course (démarrage du tracking et
// recentrage pendant une course).
// IDLE_ZOOM : vue plus rapprochée qu'avant, utilisée hors course (premier
// centrage et recentrage hors course).
const GAME_ZOOM = 19;
const IDLE_ZOOM = 17;


//====================
// GPS
//====================

function startGPS() {
    if ("geolocation" in navigator) {
        watchId = navigator.geolocation.watchPosition(
            onPositionUpdate,
            handleError,
            { enableHighAccuracy: true, maximumAge: 0, timeout: 75000 }
        );
    } else {
        alert("GPS non disponible sur ce navigateur");
    }
}

function stopGPS() {
    if (watchId) {
        navigator.geolocation.clearWatch(watchId);
    }
}

// Appelée à chaque mise à jour de position GPS
function onPositionUpdate(position) {
    const lat = position.coords.latitude;
    const lon = position.coords.longitude;
    const accuracy = position.coords.accuracy;
    const currentPoint = [lat, lon];

    updateAccuracyCircle(lat, lon, accuracy);
    lastPosition = currentPoint;
    updateMarker(lat, lon);

    // Si "centré", la carte suit la position — mais seulement la position,
    // jamais le zoom, pour ne jamais écraser un zoom manuel ou le fait de ne
    // pas être centré (mode hors-course). Le zoom n'est forcé qu'au tout
    // premier centrage (plus bas) et au clic sur le bouton de recentrage
    // (voir main.js).
    if (isCentred) {
        map.panTo([lat, lon]);
    }

    if (isRunning) {
        // Ignore les mouvements trop faibles pour éviter le clignotement
        if (coords.length > 0) {
            const lastPoint = coords[coords.length - 1];
            const moveDistance = distance(lastPoint, currentPoint);

            if (moveDistance < 1) {
                checkCloseZone(currentPoint); // cas : retour lent vers le point de départ
                return;
            }
        }

        // La fermeture doit être vérifiée AVANT d'ajouter currentPoint à coords :
        // sinon le segment testé (dernier point du tracé -> position actuelle)
        // devient de longueur nulle une fois le point poussé, et ne peut plus
        // jamais être détecté comme croisant quoi que ce soit. C'est aussi ce
        // qui capture correctement la zone si le tracé traverse une zone
        // existante en cours de route (la sienne ou une autre) — au lieu de
        // simplement l'effacer.
        checkCloseZone(currentPoint);
        if (!isRunning) return; // garde-fou : la course a pu être arrêtée entre-temps

        // Tant qu'aucun tracé n'a encore commencé, on ne démarre pas tant
        // qu'on est dans ou tout près (5m, tolérance GPS) de SON PROPRE
        // territoire — ça évite de fermer une zone minuscule pile au moment
        // de sortir la toute première fois. On mémorise au passage qu'on en
        // vient, pour savoir plus tard si ce tracé lui est "rattaché".
        if (coords.length === 0 && isNearOwnTerritory(currentPoint, 5)) {
            recentlyNearOwnTerritory = true;
            return;
        }

        if (coords.length === 0) {
            // Premier point réellement enregistré pour ce tracé : il est
            // rattaché à son propre territoire seulement si on vient tout
            // juste d'en sortir (sinon il est parti d'ailleurs, et traverser
            // ce territoire plus tard ne devra rien déclencher).
            traceOriginatesFromOwnTerritory = recentlyNearOwnTerritory;
            recentlyNearOwnTerritory = false;
        }

        coords.push(currentPoint);
        updateLine(coords);

        if (firstTracingFix) {
            firstPoint = [...currentPoint]; // copie propre, pas une référence
            firstTracingFix = false;
        }
    }

    if (map && firstMapFix) {
        map.setView([lat, lon], isRunning ? GAME_ZOOM : IDLE_ZOOM);
        firstMapFix = false;
        hideLoader();
    }
}

// Distance entre deux points GPS, en mètres (formule de Haversine)
function distance(point1, point2) {
    const lat1 = point1[0];
    const lon1 = point1[1];
    const lat2 = point2[0];
    const lon2 = point2[1];

    const R = 6371000; // rayon de la Terre (m)

    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // distance en mètres
}


//====================
// Fermeture de zone
//====================

// Cherche un croisement entre le nouveau segment (dernier point du tracé ->
// position actuelle) et un segment plus ancien du même tracé.
// S'il y a plusieurs croisements possibles (le tracé repasse plusieurs fois
// au même endroit), on garde celui qui donne la PLUS GRANDE surface une fois
// la boucle fermée — pas le premier trouvé.
// Renvoie { point, index } où index est la position du segment croisé dans
// coords — nécessaire pour ne garder que la vraie boucle (du croisement au
// croisement), en ignorant tout tracé antérieur, y compris un point de
// départ imprécis.
function checkIntersection(currentPoint) {
    if (coords.length < 3) return null; // pas assez de segments pour croiser

    const newSegmentStart = coords[coords.length - 1];
    const newSegmentEnd = currentPoint;

    let best = null;
    let bestArea = -1;

    // On exclut seulement le segment immédiatement adjacent (i = length-2) :
    // il partage un point avec le nouveau segment et donnerait un faux
    // positif trivial. Tous les autres segments plus anciens sont candidats.
    for (let i = coords.length - 3; i >= 0; i--) {
        const segStart = coords[i];
        const segEnd = coords[i + 1];

        const intersection = segmentIntersection(segStart, segEnd, newSegmentStart, newSegmentEnd);
        if (intersection) {
            const loopPoints = [intersection, ...coords.slice(i + 1)];
            const area = calculatePolygonArea(loopPoints);
            if (area > bestArea) {
                bestArea = area;
                best = { point: intersection, index: i };
            }
        }
    }

    return best;
}

// Intersection entre deux segments [p1,p2] (existant) et [q1,q2] (nouveau)
function segmentIntersection(p1, p2, q1, q2) {
    const s1x = p2[0] - p1[0];
    const s1y = p2[1] - p1[1];
    const s2x = q2[0] - q1[0];
    const s2y = q2[1] - q1[1];

    const denom = (-s2x * s1y + s1x * s2y);

    // Seuil de parallélisme RELATIF à la longueur des segments, pas absolu.
    // Nos coordonnées sont en degrés GPS (des nombres minuscules, ~0.00001
    // pour quelques mètres) : un seuil absolu comme 1e-7 rejetait quasiment
    // TOUS les croisements réels en les prenant pour des parallèles. Ici,
    // normalizedDenom correspond à sin(angle entre les deux segments) —
    // proche de 0 seulement pour de vrais segments parallèles, quelle que
    // soit l'échelle des coordonnées utilisées.
    const s1Length = Math.sqrt(s1x * s1x + s1y * s1y);
    const s2Length = Math.sqrt(s2x * s2x + s2y * s2y);
    if (s1Length === 0 || s2Length === 0) return null;

    const normalizedDenom = Math.abs(denom) / (s1Length * s2Length);
    if (normalizedDenom < 0.000001) return null; // vraiment parallèles

    const s = (-s1y * (p1[0] - q1[0]) + s1x * (p1[1] - q1[1])) / denom;
    const t = (s2x * (p1[1] - q1[1]) - s2y * (p1[0] - q1[0])) / denom;

    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
        return [p1[0] + (t * s1x), p1[1] + (t * s1y)];
    }

    return null;
}

// Vérifie si la zone peut être fermée : retour au départ, auto-croisement
// du tracé, ou croisement d'une zone déjà existante.
function checkCloseZone(currentPoint) {
    if (coords.length < 1) return null;

    // Cas 1 : retour proche du point de départ
    if (firstPoint && distance(firstPoint, currentPoint) < 3 && coords.length > 5) {
        closeZone(coords);
        return;
    }

    // Cas 2 : auto-croisement du tracé
    const intersection = checkIntersection(currentPoint);
    if (intersection) {
        // On ne garde que la vraie boucle : du point de croisement jusqu'à
        // ce même point, en ignorant tout le tracé qui précède le croisement.
        const loopPoints = [intersection.point, ...coords.slice(intersection.index + 1)];
        closeZone(loopPoints);
        return;
    }

    // Cas 3 : croisement d'une zone déjà existante
    const zoneIntersection = checkZoneIntersection(currentPoint);
    if (zoneIntersection) {
        coords.push(zoneIntersection);
        closeZone(coords);
        return;
    }
}

// Croisement entre le tracé en cours et SA PROPRE zone déjà existante.
// Les zones ennemies ne déclenchent jamais de fermeture au simple contact —
// on peut traverser le territoire adverse librement, comme un terrain
// normal. C'est la forme finale de la boucle (fermée en rentrant chez soi
// ou par auto-croisement) qui capture le territoire adverse chevauché,
// géré côté serveur (insert_zone), indépendamment du trajet parcouru.
function checkZoneIntersection(currentPoint) {
    const newStart = coords[coords.length - 1];
    const newEnd = currentPoint;

    for (let i = 0; i < zones.length; i++) {
        const zone = zones[i];

        // On ignore toute zone qui n'est pas la sienne, et sa propre zone
        // si ce tracé n'en est pas parti (voir traceOriginatesFromOwnTerritory).
        if (zone.owner !== "player") continue;
        if (!traceOriginatesFromOwnTerritory) continue;

        const zonePoints = zone.points;
        for (let j = 0; j < zonePoints.length; j++) {
            const segStart = zonePoints[j];
            const segEnd = zonePoints[(j + 1) % zonePoints.length];
            const intersection = segmentIntersection(segStart, segEnd, newStart, newEnd);
            if (intersection) return intersection;
        }
    }
    return null;
}

// Test point-dans-polygone (ray casting) : est-ce que "point" est à
// l'intérieur du polygone "polygonPoints" ?
function isPointInPolygon(point, polygonPoints) {
    const lat = point[0];
    const lon = point[1];
    let inside = false;

    for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
        const latI = polygonPoints[i][0];
        const lonI = polygonPoints[i][1];
        const latJ = polygonPoints[j][0];
        const lonJ = polygonPoints[j][1];

        const intersect =
            ((lonI > lon) !== (lonJ > lon)) &&
            (lat < (latJ - latI) * (lon - lonI) / (lonJ - lonI) + latI);

        if (intersect) inside = !inside;
    }

    return inside;
}

// Distance approximative (en mètres) entre un point et un segment — utilise
// une projection locale plate, largement valable à l'échelle de quelques
// mètres (la tolérance qu'on applique ici).
function distanceToSegment(point, segStart, segEnd) {
    const R = 6371000;
    const toLocalMeters = (p) => [
        R * (p[0] - segStart[0]) * Math.PI / 180,
        R * (p[1] - segStart[1]) * Math.PI / 180 * Math.cos(segStart[0] * Math.PI / 180),
    ];

    const [px, py] = toLocalMeters(point);
    const [bx, by] = toLocalMeters(segEnd);

    const lengthSq = bx * bx + by * by;
    let t = lengthSq === 0 ? 0 : (px * bx + py * by) / lengthSq;
    t = Math.max(0, Math.min(1, t));

    const dx = px - t * bx;
    const dy = py - t * by;
    return Math.sqrt(dx * dx + dy * dy);
}

// Est-ce que le point est dans une de SES PROPRES zones, ou à moins de
// toleranceMeters de son bord (tolérance pour l'imprécision GPS) ?
function isNearOwnTerritory(point, toleranceMeters) {
    for (let i = 0; i < zones.length; i++) {
        if (zones[i].owner !== "player") continue;

        const zonePoints = zones[i].points;
        if (isPointInPolygon(point, zonePoints)) return true;

        for (let j = 0; j < zonePoints.length; j++) {
            const segStart = zonePoints[j];
            const segEnd = zonePoints[(j + 1) % zonePoints.length];
            if (distanceToSegment(point, segStart, segEnd) <= toleranceMeters) {
                return true;
            }
        }
    }
    return false;
}


//====================
// Surface
//====================

// Formule d'aire sphérique exacte : décompose le polygone en triangles
// polaires (chaque arête + le pôle Nord) et somme leurs aires signées.
// Contrairement à une projection plate, ça calcule l'aire directement sur
// la sphère, sans erreur liée à la courbure de la Terre.
function polarTriangleArea(tan1, lng1, tan2, lng2) {
    const deltaLng = lng1 - lng2;
    const t = tan1 * tan2;
    return 2 * Math.atan2(t * Math.sin(deltaLng), 1 + t * Math.cos(deltaLng));
}

function calculatePolygonArea(points) {
    if (points.length < 3) return 0;

    const R = 6371000;
    let total = 0;

    const prev = points[points.length - 1];
    let prevTanLat = Math.tan((Math.PI / 2 - prev[0] * Math.PI / 180) / 2);
    let prevLng = prev[1] * Math.PI / 180;

    for (let i = 0; i < points.length; i++) {
        const point = points[i];
        const tanLat = Math.tan((Math.PI / 2 - point[0] * Math.PI / 180) / 2);
        const lng = point[1] * Math.PI / 180;

        total += polarTriangleArea(tanLat, lng, prevTanLat, prevLng);

        prevTanLat = tanLat;
        prevLng = lng;
    }

    return Math.abs(total) * R * R; // en m²
}

// Ferme la zone : calcule sa surface, l'affiche, et la sauvegarde en ligne
// (le serveur découpe les zones adverses chevauchées de façon atomique —
// voir la fonction SQL insert_zone). Ne stoppe PAS la course : le joueur
// continue à courir immédiatement après, sur un tracé tout neuf.
function closeZone(points) {
    resetTraceAfterCapture();

    const area = calculatePolygonArea(points);

    const layer = L.polygon(points, {
        color: colorForIndex(currentColorIndex),
        fillOpacity: 0.4,
    }).addTo(map);

    const newZoneObj = { id: `player_${Date.now()}`, owner: "player", points, area, layer };
    zones.push(newZoneObj);

    // Le score/surface affichés sont toujours recalculés depuis les zones
    // réellement possédées (voir recalculatePlayerStatsFromZones), jamais
    // juste incrémentés en mémoire — ça évite qu'ils se désynchronisent de
    // la réalité (ex: après un rechargement de page, ou si une capture
    // distante change ce qu'on possède).
    recalculatePlayerStatsFromZones();

    // Fait correspondre l'id local au véritable id renvoyé par le serveur,
    // pour que les futurs événements temps réel (ex: quelqu'un découpe cette
    // même zone plus tard) puissent la reconnaître.
    saveZoneToSupabase(points, area).then(realId => {
        if (realId) newZoneObj.id = realId;
    });
}

// Recalcule le score et la surface totale du joueur à partir des zones qu'il
// possède ACTUELLEMENT (source de vérité : le tableau zones, synchronisé
// avec la base). Appelée à chaque changement de zones — chargement initial
// d'une session, capture personnelle, ou capture/découpe distante en temps
// réel — pour que l'affichage ne se désynchronise jamais de la réalité.
function recalculatePlayerStatsFromZones() {
    let total = 0;
    for (let i = 0; i < zones.length; i++) {
        if (zones[i].owner === "player") {
            total += zones[i].area || 0;
        }
    }
    playerTotalArea = total;
    playerScore = Math.round(total / M2_PER_POINT);
    updateAreaDisplay(playerTotalArea);
    updateScoreDisplay(playerScore);
}

// Vide le tracé en cours après une capture, sans toucher à isRunning ni à
// l'UI — pour que le joueur puisse enchaîner une nouvelle zone tout de
// suite, dans la même course.
function resetTraceAfterCapture() {
    clearLine();
    coords = [];
    firstTracingFix = true;
    firstPoint = null;
    recentlyNearOwnTerritory = false;
    traceOriginatesFromOwnTerritory = false;
}

// Convertit un anneau GeoJSON [lon, lat] (venant de Supabase) en points
// [lat, lon] utilisables par Leaflet. Utilisée par sync.js.
function toLatLngPoints(ring) {
    return ring.map(c => [c[1], c[0]]);
}


//====================
// Tracking
//====================

function startTracking() {
    if (!lastPosition) {
        alert("GPS en cours d'initialisation");
        return;
    }
    isRunning = true;
    map.setView(lastPosition, GAME_ZOOM);
    firstTracingFix = true;
    firstPoint = null;
    recentlyNearOwnTerritory = false;
    traceOriginatesFromOwnTerritory = false;
    updateButtonsUI(true);
    coords = [];
}

function stopTracking() {
    clearLine();
    isRunning = false;
    if (lastPosition) {
        map.setView(lastPosition, IDLE_ZOOM);
    }
    updateButtonsUI(false);
    coords = [];
}
