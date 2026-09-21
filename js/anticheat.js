//====================
// Anti-triche : limitation de vitesse
//====================
// Principe : pendant qu'un tracé est en cours (course active + au moins un
// point tracé), on surveille la vitesse réelle du joueur. Au-delà de la
// limite du mode choisi, un chrono de pénalité monte ; en dessous, il
// redescend. S'il atteint 5 secondes cumulées, le tracé en cours est annulé
// (mais la course continue, comme pour toute autre annulation dans le jeu).

const SPEED_LIMIT_COURSE_KMH = 15;
const SPEED_LIMIT_VELO_KMH = 30;
const SPEED_PENALTY_MAX_SECONDS = 5;

// Fenêtre glissante utilisée pour calculer la vitesse : lisse le bruit GPS
// naturel, bien plus fiable qu'une comparaison entre deux points consécutifs
// rapprochés dans le temps (où quelques mètres d'erreur GPS peuvent donner
// l'illusion d'un pic de vitesse chez quelqu'un d'immobile).
const SPEED_WINDOW_SECONDS = 5;

// Un point dont la précision GPS annoncée est pire que ça est ignoré pour le
// calcul de vitesse (mais reste utilisé normalement pour le tracé) : mieux
// vaut manquer une mesure que se fier à une position peu fiable.
const MIN_GPS_ACCURACY_METERS = 20;

// Un point qui donnerait, à lui seul, une vitesse instantanée absurde est
// traité comme un raté GPS et ignoré pour le calcul — sans ça, UNE mesure
// foireuse suffirait à déclencher le chrono à tort.
// NOTE (connue, volontairement pas traitée ici) : ce garde-fou peut aussi
// masquer un vrai téléport GPS (spoofing) en le prenant pour du bruit — sujet
// à part, à traiter plus tard avec la détection de spoofing.
const ABSURD_SPEED_KMH = 150;

let gameSpeedMode = "course"; // "course" (marche/course) ou "velo"
let speedLimitTestEnabled = false; // interrupteur de test — désactivé par défaut

let speedSamples = []; // historique récent : { point, time, accuracy }
let speedPenaltyTimer = 0; // secondes cumulées au-dessus de la limite (0 à 5)
let lastSpeedCheckTime = null;

function currentSpeedLimitKmh() {
    return gameSpeedMode === "velo" ? SPEED_LIMIT_VELO_KMH : SPEED_LIMIT_COURSE_KMH;
}

// Appelée à chaque position GPS reçue, que la course soit active ou non —
// la logique de pénalité se charge elle-même de ne s'appliquer qu'au bon moment.
function recordSpeedSample(point, timeMs, accuracy) {
    speedSamples.push({ point, time: timeMs, accuracy });

    // Ne garde que les échantillons dans la fenêtre glissante
    const cutoff = timeMs - SPEED_WINDOW_SECONDS * 1000;
    speedSamples = speedSamples.filter(s => s.time >= cutoff);

    const applies = speedLimitTestEnabled && isRunning && coords.length > 0;

    if (!applies) {
        if (speedPenaltyTimer > 0) {
            speedPenaltyTimer = 0;
            hideSpeedPenaltyUI();
        }
        lastSpeedCheckTime = null;
        return;
    }

    const speedKmh = computeCurrentSpeedKmh();

    if (lastSpeedCheckTime === null) {
        lastSpeedCheckTime = timeMs;
        return;
    }
    const dt = (timeMs - lastSpeedCheckTime) / 1000; // secondes réelles écoulées
    lastSpeedCheckTime = timeMs;

    if (speedKmh === null) return; // pas assez de données fiables pour juger

    const limit = currentSpeedLimitKmh();

    if (speedKmh > limit) {
        speedPenaltyTimer = Math.min(SPEED_PENALTY_MAX_SECONDS, speedPenaltyTimer + dt);
    } else {
        speedPenaltyTimer = Math.max(0, speedPenaltyTimer - dt);
    }

    if (speedPenaltyTimer > 0) {
        showSpeedPenaltyUI(speedPenaltyTimer);
    } else {
        hideSpeedPenaltyUI();
    }

    if (speedPenaltyTimer >= SPEED_PENALTY_MAX_SECONDS) {
        cancelTraceForSpeeding();
    }
}

// Calcule la vitesse actuelle (km/h) à partir des échantillons fiables de la
// fenêtre glissante, ou null si pas assez de données pour juger.
function computeCurrentSpeedKmh() {
    const valid = speedSamples.filter(s => s.accuracy == null || s.accuracy <= MIN_GPS_ACCURACY_METERS);
    if (valid.length < 2) return null;

    // Ignore un dernier point qui donnerait, à lui seul, un pic absurde par
    // rapport au précédent (probable raté GPS plutôt qu'un vrai déplacement).
    const last = valid[valid.length - 1];
    const prev = valid[valid.length - 2];
    const dtLastMs = last.time - prev.time;
    if (dtLastMs > 0) {
        const instantKmh = (distance(prev.point, last.point) / (dtLastMs / 1000)) * 3.6;
        if (instantKmh > ABSURD_SPEED_KMH) {
            valid.pop();
        }
    }
    if (valid.length < 2) return null;

    const first = valid[0];
    const latest = valid[valid.length - 1];
    const elapsedSeconds = (latest.time - first.time) / 1000;
    if (elapsedSeconds < 1) return null; // fenêtre trop courte pour être fiable

    let totalDistance = 0;
    for (let i = 1; i < valid.length; i++) {
        totalDistance += distance(valid[i - 1].point, valid[i].point);
    }

    const speedMs = totalDistance / elapsedSeconds;
    return speedMs * 3.6; // m/s -> km/h
}

// Annule le tracé en cours pour excès de vitesse — la course, elle, continue.
function cancelTraceForSpeeding() {
    resetTraceAfterCapture();
    speedPenaltyTimer = 0;
    lastSpeedCheckTime = null;
    hideSpeedPenaltyUI();
    showSpeedCutoffToast("Vitesse illégale : capture annulée. Ralentis et retente.");
}


//====================
// Retour visuel
//====================

function showSpeedPenaltyUI(timer) {
    const overlay = document.getElementById('speedPenaltyOverlay');
    const sign = document.getElementById('speedPenaltySign');
    const number = document.getElementById('speedPenaltyNumber');
    if (!overlay || !sign || !number) return;

    const remaining = Math.max(0, Math.ceil(SPEED_PENALTY_MAX_SECONDS - timer));
    number.textContent = remaining;

    const intensity = Math.min(1, timer / SPEED_PENALTY_MAX_SECONDS);
    overlay.style.background = `rgba(230, 90, 20, ${0.15 + intensity * 0.35})`;

    overlay.style.display = 'block';
    sign.style.display = 'flex';
}

function hideSpeedPenaltyUI() {
    const overlay = document.getElementById('speedPenaltyOverlay');
    const sign = document.getElementById('speedPenaltySign');
    if (overlay) overlay.style.display = 'none';
    if (sign) sign.style.display = 'none';
}

let speedCutoffToastTimeout = null;
function showSpeedCutoffToast(message) {
    const toast = document.getElementById('speedCutoffToast');
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add('visible');

    clearTimeout(speedCutoffToastTimeout);
    speedCutoffToastTimeout = setTimeout(() => {
        toast.classList.remove('visible');
    }, 3200);
}


//====================
// Panneau "Mode de jeu"
//====================

function openModePanel() {
    document.getElementById('modePanel').style.display = 'flex';
}
function closeModePanel() {
    document.getElementById('modePanel').style.display = 'none';
}

function setGameSpeedMode(mode) {
    gameSpeedMode = mode;
    document.getElementById('modeLabel').textContent = mode === "velo" ? "Vélo" : "Course";

    document.getElementById('modeOptionCourse').classList.toggle('active', mode !== "velo");
    document.getElementById('modeOptionVelo').classList.toggle('active', mode === "velo");
}

function setupModePanelListeners() {
    document.getElementById('BtnMode').addEventListener('click', openModePanel);
    document.getElementById('modePanelClose').addEventListener('click', closeModePanel);

    document.getElementById('modeOptionCourse').addEventListener('click', () => setGameSpeedMode("course"));
    document.getElementById('modeOptionVelo').addEventListener('click', () => setGameSpeedMode("velo"));

    const testToggle = document.getElementById('speedLimitTestToggle');
    testToggle.addEventListener('change', () => {
        speedLimitTestEnabled = testToggle.checked;
        if (!speedLimitTestEnabled) {
            speedPenaltyTimer = 0;
            lastSpeedCheckTime = null;
            hideSpeedPenaltyUI();
        }
    });
}
