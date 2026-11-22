// ══════════════════════════════════════════
//  stopconfirm.js — Field Run
//  Confirmation de fin de course : il faut « colorier » le bouton avec le doigt.
//  Une fois colorié à 99 %, la course s'arrête et les zones capturées pendant
//  la course sont enregistrées pour de bon.
// ══════════════════════════════════════════

const PAINT_BRUSH_RADIUS = 25;   // rayon du pinceau (px CSS)
const PAINT_CELL = 4;            // taille d'une cellule du suivi de couverture (px CSS)
const PAINT_DONE_RATIO = 0.99;   // part du bouton à colorier ; pas 100 % : un petit coin oublié ne doit jamais bloquer
const PAINT_COLOR = '#FF2D3D';

let paintState = null; // { w, h, cols, rows, mask, cells, total, painted, last, done, ctx }


//====================
// Suivi de la couverture (pur calcul, sans dessin)
//====================

// Est-ce que (x, y) est dans un rectangle w×h aux coins arrondis de rayon r ?
function insideRoundedRect(x, y, w, h, r) {
    if (x < 0 || y < 0 || x > w || y > h) return false;
    const dx = Math.max(r - x, 0, x - (w - r));
    const dy = Math.max(r - y, 0, y - (h - r));
    return dx * dx + dy * dy <= r * r;
}

function distToSegmentSq(px, py, x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lengthSq = dx * dx + dy * dy;
    let t = lengthSq === 0 ? 0 : ((px - x0) * dx + (py - y0) * dy) / lengthSq;
    t = Math.max(0, Math.min(1, t));
    const cx = x0 + t * dx;
    const cy = y0 + t * dy;
    return (px - cx) * (px - cx) + (py - cy) * (py - cy);
}

// La surface du bouton est découpée en petites cellules ; seules celles qui
// sont réellement dans la forme arrondie comptent.
function createPaintGrid(w, h, cornerRadius) {
    const cols = Math.ceil(w / PAINT_CELL);
    const rows = Math.ceil(h / PAINT_CELL);
    const mask = new Uint8Array(cols * rows);
    let total = 0;

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (insideRoundedRect((c + 0.5) * PAINT_CELL, (r + 0.5) * PAINT_CELL, w, h, cornerRadius)) {
                mask[r * cols + c] = 1;
                total++;
            }
        }
    }
    return { w, h, cols, rows, mask, cells: new Uint8Array(cols * rows), total, painted: 0 };
}

// Marque les cellules touchées par un trait du pinceau (segment épais)
function markPaintSegment(grid, x0, y0, x1, y1) {
    const rad = PAINT_BRUSH_RADIUS;
    const c0 = Math.max(0, Math.floor((Math.min(x0, x1) - rad) / PAINT_CELL));
    const c1 = Math.min(grid.cols - 1, Math.floor((Math.max(x0, x1) + rad) / PAINT_CELL));
    const r0 = Math.max(0, Math.floor((Math.min(y0, y1) - rad) / PAINT_CELL));
    const r1 = Math.min(grid.rows - 1, Math.floor((Math.max(y0, y1) + rad) / PAINT_CELL));

    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
            const i = r * grid.cols + c;
            if (!grid.mask[i] || grid.cells[i]) continue;
            if (distToSegmentSq((c + 0.5) * PAINT_CELL, (r + 0.5) * PAINT_CELL, x0, y0, x1, y1) <= rad * rad) {
                grid.cells[i] = 1;
                grid.painted++;
            }
        }
    }
}

function paintCoverage(grid) {
    return grid.total === 0 ? 0 : grid.painted / grid.total;
}


//====================
// Écran de confirmation
//====================

function updateStopConfirmText() {
    const el = document.getElementById('stopConfirmText');
    if (!el) return;

    const n = pendingZoneSaves.length;
    const parts = [];

    if (n === 1) parts.push("La zone capturée pendant cette course sera définitivement validée.");
    else if (n > 1) parts.push(n + " zones capturées pendant cette course seront définitivement validées.");
    else parts.push("Aucune zone capturée pendant cette course.");

    if (coords.length > 1) parts.push("Ton tracé en cours, non fermé, sera abandonné.");

    el.textContent = parts.join(" ");
}

function openStopConfirm() {
    updateStopConfirmText();
    document.getElementById('stopConfirm').style.display = 'flex';
    setupPaintCanvas(); // après l'affichage : il faut pouvoir mesurer le bouton
}

function closeStopConfirm() {
    document.getElementById('stopConfirm').style.display = 'none';
    paintState = null;
}

function setupPaintCanvas() {
    const box = document.getElementById('stopPaintBtn');
    const canvas = document.getElementById('stopPaintCanvas');

    const rect = box.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = PAINT_BRUSH_RADIUS * 2;
    ctx.strokeStyle = PAINT_COLOR;
    ctx.fillStyle = PAINT_COLOR;

    const cornerRadius = parseFloat(getComputedStyle(box).borderTopLeftRadius) || 16;

    paintState = createPaintGrid(w, h, cornerRadius);
    paintState.ctx = ctx;
    paintState.last = null;
    paintState.done = false;
}

function paintStroke(x0, y0, x1, y1) {
    const ctx = paintState.ctx;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    if (x0 === x1 && y0 === y1) ctx.lineTo(x1 + 0.01, y1); // un simple appui laisse une tache ronde
    ctx.stroke();

    markPaintSegment(paintState, x0, y0, x1, y1);
    if (paintCoverage(paintState) >= PAINT_DONE_RATIO) completePaint();
}

// Le bouton est colorié : on remplit les derniers pourcents restants, puis on termine.
function completePaint() {
    if (!paintState || paintState.done) return;
    paintState.done = true;

    paintState.ctx.fillRect(0, 0, paintState.w, paintState.h);
    if (navigator.vibrate) navigator.vibrate(40);

    setTimeout(finishRunConfirmed, 280);
}

function setupStopConfirm() {
    const canvas = document.getElementById('stopPaintCanvas');
    if (!canvas) return;

    const localPoint = (e) => {
        const r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener('pointerdown', (e) => {
        if (!paintState || paintState.done) return;
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);

        const p = localPoint(e);
        paintState.last = p;
        paintStroke(p.x, p.y, p.x, p.y);
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!paintState || paintState.done || !paintState.last) return;
        e.preventDefault();

        // Un doigt rapide envoie moins d'événements que de points réellement parcourus
        const events = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
        for (const ev of events) {
            if (!paintState || paintState.done) return;
            const p = localPoint(ev);
            const last = paintState.last;
            paintState.last = p;
            paintStroke(last.x, last.y, p.x, p.y);
        }
    });

    const endStroke = () => { if (paintState) paintState.last = null; };
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    document.getElementById('stopConfirmCancel').addEventListener('click', closeStopConfirm);
}


//====================
// Fin de course confirmée
//====================

async function finishRunConfirmed() {
    closeStopConfirm();

    stopTracking();
    switchToStart();
    document.body.classList.remove('game-running');

    // C'est maintenant que les zones deviennent définitives : enregistrement en ligne
    const { saved, failed } = await commitPendingZones();

    if (failed > 0) {
        showSpeedCutoffToast("Course terminée. " + failed + " zone(s) n'ont pas pu être enregistrées (réseau) : elles seront renvoyées au prochain lancement.");
    } else if (saved > 0) {
        showSpeedCutoffToast("Course terminée : " + saved + (saved > 1 ? " zones validées." : " zone validée."));
    } else {
        showSpeedCutoffToast("Course terminée.");
    }
}
