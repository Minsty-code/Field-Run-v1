//====================
// Lancement
//====================

document.addEventListener("DOMContentLoaded", () => {
    initMap();
    initMarker();
    initTrackingLine();

    // On distingue le geste qui doit décentrer (glisser la carte à la main)
    // du geste qui ne doit jamais décentrer (zoomer/dézoomer, même au pincé,
    // qui peut légèrement déplacer le centre selon où on pince sans que ce
    // soit une vraie intention de bouger la carte).
    map.on('dragstart', () => {
        isCentred = false;
        showCenterButton();
    });

    map.on('zoomend', () => {
        // Si on est censé être centré, on corrige tout dérapage du centre
        // causé par le geste de zoom (le pincé zoome vers l'endroit touché,
        // pas forcément vers le centre) — sans changer le niveau de zoom
        // choisi, juste le centrage.
        if (isCentred && lastPosition) {
            map.panTo(lastPosition, { animate: false });
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

    setupModePanelListeners();

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
