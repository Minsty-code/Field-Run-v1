// ══════════════════════════════════════════
//  settings.js — Field Run
//  Menu Paramètres : mode de qualité graphique, crédits, déconnexion
// ══════════════════════════════════════════

const QUALITY_STORAGE_KEY = 'fieldrun_quality';
const DEFAULT_QUALITY = 'equilibre';

// Ce que chaque mode règle :
//  maxPixelRatio  : résolution maximale de la carte (1 = pixels CSS, 3 = écran natif)
//  fade           : durée du fondu des tuiles et des noms de lieux (ms)
//  labels         : afficher les noms de lieux et de rues
//  accuracyCircle : afficher le cercle de précision GPS
//  panThreshold   : la caméra ne suit que si on s'est déplacé de plus de N mètres
// Les effets de flou et les animations décoratives sont réglés en CSS (classes q-*).
const QUALITY_PRESETS = {
    graphique:    { maxPixelRatio: 3, fade: 200, labels: true,  accuracyCircle: true,  panThreshold: 2 },
    equilibre:    { maxPixelRatio: 2, fade: 0,   labels: true,  accuracyCircle: true,  panThreshold: 3 },
    performances: { maxPixelRatio: 1, fade: 0,   labels: false, accuracyCircle: false, panThreshold: 5 },
};

function loadSavedQuality() {
    try {
        const saved = localStorage.getItem(QUALITY_STORAGE_KEY);
        if (QUALITY_PRESETS[saved]) return saved;
    } catch (e) { /* stockage indisponible : mode par défaut */ }
    return DEFAULT_QUALITY;
}

let currentQuality = loadSavedQuality();

function qualityPreset() {
    return QUALITY_PRESETS[currentQuality];
}

// Classes CSS q-graphique / q-equilibre / q-performances sur <body>
function applyQualityToPage() {
    const cl = document.body.classList;
    Object.keys(QUALITY_PRESETS).forEach(name => cl.remove('q-' + name));
    cl.add('q-' + currentQuality);
}

function setQuality(mode) {
    if (!QUALITY_PRESETS[mode]) return;
    currentQuality = mode;

    try { localStorage.setItem(QUALITY_STORAGE_KEY, mode); } catch (e) { /* sans importance */ }

    applyQualityToPage();
    if (typeof applyQualityToMap === 'function') applyQualityToMap();
    updateQualityButtons();
}

function updateQualityButtons() {
    document.querySelectorAll('.qualityOption').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.quality === currentQuality);
    });
}

// ── Panneau Paramètres ─────────────────────
function setupSettingsMenu() {
    const panel = document.getElementById('settingsPanel');
    if (!panel) return;

    const open = () => { panel.style.display = 'flex'; updateQualityButtons(); };
    const close = () => { panel.style.display = 'none'; };

    document.getElementById('BtnSettings').addEventListener('click', open);
    document.getElementById('settingsPanelClose').addEventListener('click', close);
    // Toucher le fond sombre ferme le panneau
    panel.addEventListener('click', (e) => { if (e.target === panel) close(); });

    document.querySelectorAll('.qualityOption').forEach(btn => {
        btn.addEventListener('click', () => setQuality(btn.dataset.quality));
    });

    updateQualityButtons();
}

// Appliqué dès le chargement du script (le <body> existe déjà) pour éviter
// un flash d'effets de flou avant l'application du mode sauvegardé.
applyQualityToPage();
