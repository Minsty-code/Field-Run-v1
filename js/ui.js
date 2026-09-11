// ══════════════════════════════════════════
//  ui.js — Field Run
// ══════════════════════════════════════════

function showLoader() {
    document.documentElement.style.setProperty('--loader-visible', '1');
    document.getElementById('loader').style.pointerEvents = 'all';
}

function hideLoader() {
    document.documentElement.style.setProperty('--loader-visible', '0');
    document.getElementById('loader').style.pointerEvents = 'none';
}

function handleError(error) {
    const txt = document.getElementById('loaderText');
    if (txt) {
        txt.textContent = '⚠️ GPS refusé ou indisponible';
        txt.style.color = '#EB00CD';
    }
}

function switchToStart() {
    document.documentElement.style.setProperty('--btnStart-visible', '1');
    document.getElementById('BtnStart').style.pointerEvents = 'auto';
    document.documentElement.style.setProperty('--btnStop-visible', '0');
    document.getElementById('BtnStop').style.pointerEvents = 'none';
}

function switchToStop() {
    document.documentElement.style.setProperty('--btnStop-visible', '1');
    document.getElementById('BtnStop').style.pointerEvents = 'auto';
    document.documentElement.style.setProperty('--btnStart-visible', '0');
    document.getElementById('BtnStart').style.pointerEvents = 'none';
}

function showCenterButton() {
    document.documentElement.style.setProperty('--btnCenter-visible', '1');
    document.getElementById('BtnCenter').style.pointerEvents = 'auto';
}

function hideCenterButton() {
    document.documentElement.style.setProperty('--btnCenter-visible', '0');
    document.getElementById('BtnCenter').style.pointerEvents = 'none';
}

function updateButtonsUI(running) {
    if (running) { switchToStop(); } else { switchToStart(); }
}

function updateAreaDisplay(sqMeters) {
    const el = document.getElementById('playerArea');
    if (!el) return;
    if (sqMeters >= 1000000) {
        el.textContent = (sqMeters / 1000000).toFixed(2) + ' km²';
    } else if (sqMeters >= 1000) {
        el.textContent = (sqMeters / 1000).toFixed(1) + ' k m²';
    } else {
        el.textContent = Math.round(sqMeters) + ' m²';
    }
}

function updateScoreDisplay(points) {
    const el = document.getElementById('playerScore');
    if (!el) return;
    el.textContent = Math.round(points).toLocaleString('fr-FR') + ' pts';
}
