//====================
// Synchronisation des zones (Supabase)
//====================
// Sauvegarde une zone qu'on vient de fermer, charge les zones déjà
// existantes des autres joueurs au démarrage, et écoute en temps réel les
// nouvelles zones capturées par les autres.

//====================
// Couleur par compte joueur
//====================
// Chaque compte a SA couleur, attribuée une fois pour toutes à l'inscription
// et stockée dans profiles.color_index (voir le déclencheur SQL
// assign_color_index) — ça garantit des couleurs distinctes tant qu'il y a
// 8 comptes ou moins. À revoir (palette plus grande) au-delà.
const ZONE_COLOR_PALETTE = [
    "#2800A8", // indigo
    "#FF7A00", // orange
    "#00C2A8", // turquoise
    "#7B2FF7", // violet
    "#FF4D6D", // corail
    "#8BC400", // vert anis
    "#00AEEF", // cyan
    "#C900F0", // magenta
];

function colorForIndex(index) {
    if (typeof index !== "number" || index < 0) return ZONE_COLOR_PALETTE[0];
    return ZONE_COLOR_PALETTE[index % ZONE_COLOR_PALETTE.length];
}

// Convertit nos points [lat, lon] en chaîne GeoJSON Polygon (anneau fermé, [lon, lat])
function pointsToGeoJSON(points) {
    const ring = points.map(p => [p[1], p[0]]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
        ring.push([first[0], first[1]]);
    }
    return JSON.stringify({
        type: "Polygon",
        coordinates: [ring],
    });
}


//====================
// Sauvegarde d'une zone qu'on vient de capturer
//====================

// Renvoie l'id de la zone créée en base (ou null si échec), pour que game.js
// puisse faire correspondre l'id local de la zone à l'id réel — nécessaire
// pour reconnaître plus tard un événement temps réel qui la concerne.
async function saveZoneToSupabase(points, area) {
    const geojson = pointsToGeoJSON(points);

    const { data, error } = await supabaseClient.rpc("insert_zone", {
        p_owner_name: currentUsername || "Joueur",
        p_geojson: geojson,
        p_area: area,
    });

    if (error) {
        // On ne bloque jamais le jeu si la sauvegarde échoue (ex: pas de
        // réseau) — la zone reste visible localement, juste pas partagée.
        console.warn("Impossible de sauvegarder la zone en ligne :", error.message);
        return null;
    }

    return data; // uuid renvoyé par insert_zone
}


//====================
// Chargement des zones existantes et temps réel
//====================

async function loadAllZonesFromSupabase() {
    const { data, error } = await supabaseClient.rpc("get_all_zones");

    if (error) {
        console.warn("Impossible de charger les zones existantes :", error.message);
        return;
    }

    data.forEach(row => addRemoteZoneToMap(row));
}

// Ajoute une zone (venant de la base) sur la carte, sauf si elle y est déjà
// (même id). Une zone qui nous appartient peut arriver ici si un AUTRE
// joueur vient de la découper (le serveur en réinsère alors ce qu'il en
// reste, toujours à notre nom) — il faut bien l'afficher dans ce cas, d'où
// la vérification par id plutôt que par owner_id.
function addRemoteZoneToMap(row) {
    if (zones.some(z => z.id === row.id)) return;

    let geo;
    try {
        geo = JSON.parse(row.geojson);
    } catch (e) {
        return;
    }

    const ring = geo.coordinates[0];
    const latLngPoints = toLatLngPoints(ring);
    if (latLngPoints.length < 3) return;

    const isMine = row.owner_id === currentUserId;

    const layer = L.polygon(latLngPoints, {
        color: colorForIndex(row.color_index),
        fillOpacity: 0.4,
    }).addTo(map);

    zones.push({
        id: row.id,
        owner: isMine ? "player" : row.owner_id,
        points: latLngPoints,
        layer: layer,
    });
}

// Retire une zone de la carte suite à sa suppression en base (ex: elle
// vient d'être découpée/absorbée par la capture d'un autre joueur)
function removeZoneById(zoneId) {
    const index = zones.findIndex(z => z.id === zoneId);
    if (index === -1) return;

    const zone = zones[index];
    if (zone.layer) map.removeLayer(zone.layer);
    zones.splice(index, 1);
}

// Écoute en temps réel les créations et suppressions de zones
function subscribeToZoneRealtime() {
    supabaseClient
        .channel("zones-realtime")
        .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "zones" },
            (payload) => {
                fetchSingleZoneGeoJSON(payload.new.id).then(geoRow => {
                    if (geoRow) addRemoteZoneToMap(geoRow);
                });
            }
        )
        .on(
            "postgres_changes",
            { event: "DELETE", schema: "public", table: "zones" },
            (payload) => {
                // Ses éventuels restes arrivent séparément via un événement INSERT.
                removeZoneById(payload.old.id);
            }
        )
        .subscribe();
}

// Récupère la géométrie GeoJSON d'une seule zone (utilisé après un événement temps réel)
async function fetchSingleZoneGeoJSON(zoneId) {
    const { data, error } = await supabaseClient
        .rpc("get_all_zones")
        .eq("id", zoneId);

    if (error || !data || data.length === 0) return null;
    return data[0];
}
