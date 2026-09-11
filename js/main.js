//====================
// Lancement
//====================

document.addEventListener("DOMContentLoaded", () => {
    initMap();
    initMarker();
    initTrackingLine();

    map.on('moveend', () => {
        if (distance(lastPosition, [map.getCenter().lat, map.getCenter().lng]) < 3) {
            isCentred = true;
            hideCenterButton();
        } else {
            isCentred = false;
            showCenterButton();
        }
    });

    document.getElementById('BtnCenter').addEventListener('click', () => {
        isCentred = true;
        hideCenterButton();
        // setView (pas panTo) : recentre ET applique le bon zoom selon le
        // mode — zoom maximum en course, vue large (~1 km²) sinon.
        if (lastPosition) {
            map.setView(lastPosition, isRunning ? GAME_ZOOM : IDLE_ZOOM);
        }
    });

    updateButtonsUI(false);
    updateAreaDisplay(0);
    updateScoreDisplay(0);

    const Btnstart = document.getElementById('BtnStart');
    const Btnstop = document.getElementById('BtnStop');

    Btnstart.addEventListener("click", () => {
        startTracking();
        switchToStop();
        document.body.classList.add("game-running");
    });

    Btnstop.addEventListener("click", () => {
        stopTracking();
        switchToStart();
        document.body.classList.remove("game-running");
    });

    // Le GPS/la carte ne démarrent qu'une fois le joueur authentifié.
    // initAuth() (dans auth.js) affiche l'écran de connexion si besoin, et
    // appelle startGameAfterAuth() dès qu'une session valide existe.
    initAuth();

    // Bouton de déconnexion provisoire : recharger la page après
    // déconnexion est le moyen le plus simple et sûr de repartir sur une
    // base propre (zones, coords, marqueurs).
    document.getElementById('BtnLogout').addEventListener('click', async () => {
        await supabaseClient.auth.signOut();
        location.reload();
    });
});

// Appelée par auth.js une fois le joueur connecté (ou déjà connecté au chargement)
function startGameAfterAuth(username) {
    if (username) {
        const nameEl = document.getElementById('playerName');
        if (nameEl) nameEl.textContent = username;
    }
    showLoader();
    startGPS();

    // Charge les zones déjà capturées par les autres joueurs, puis écoute
    // les nouvelles captures en direct.
    loadAllZonesFromSupabase();
    subscribeToZoneRealtime();
}
