const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getMimeType(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.ico') return 'image/x-icon';
  return 'application/octet-stream';
}

function getImageDataUrl(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return '';
    const buffer = fs.readFileSync(filePath);
    return `data:${getMimeType(filePath)};base64,${buffer.toString('base64')}`;
  } catch {
    return '';
  }
}

function buildSplashHtml({ version, productName, iconDataUrl }) {
  return `<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(productName)}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: linear-gradient(135deg, #f4fbf7 0%, #eef7ff 52%, #f8f0ff 100%);
        --card: rgba(255, 255, 255, 0.88);
        --border: rgba(15, 118, 110, 0.12);
        --text: #0f172a;
        --muted: #5f6f86;
        --primary: #0f766e;
        --accent: #6d28d9;
        --progress-bg: rgba(15, 118, 110, 0.12);
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        overflow: hidden;
        background: var(--bg);
        font-family: "Segoe UI", Inter, system-ui, sans-serif;
        color: var(--text);
      }

      .splash-shell {
        width: 100%;
        height: 100%;
        padding: 22px;
        display: grid;
        place-items: center;
        position: relative;
      }

      .splash-shell::before,
      .splash-shell::after {
        content: "";
        position: absolute;
        border-radius: 999px;
        filter: blur(16px);
        opacity: 0.8;
        pointer-events: none;
      }

      .splash-shell::before {
        width: 160px;
        height: 160px;
        background: rgba(15, 118, 110, 0.12);
        top: -30px;
        left: -10px;
      }

      .splash-shell::after {
        width: 180px;
        height: 180px;
        background: rgba(109, 40, 217, 0.10);
        right: -40px;
        bottom: -50px;
      }

      .splash-card {
        width: 100%;
        max-width: 520px;
        min-height: 280px;
        padding: 26px 28px;
        border-radius: 28px;
        background: var(--card);
        border: 1px solid var(--border);
        box-shadow: 0 28px 80px rgba(15, 23, 42, 0.16);
        display: grid;
        gap: 18px;
        align-content: center;
        position: relative;
        overflow: hidden;
      }

      .splash-card::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          radial-gradient(circle at top left, rgba(15, 118, 110, 0.08), transparent 36%),
          radial-gradient(circle at bottom right, rgba(109, 40, 217, 0.08), transparent 30%);
        pointer-events: none;
      }

      .brand-row {
        display: grid;
        grid-template-columns: 72px 1fr;
        gap: 16px;
        align-items: center;
        position: relative;
        z-index: 1;
      }

      .brand-mark {
        width: 72px;
        height: 72px;
        border-radius: 22px;
        background: linear-gradient(145deg, rgba(15, 118, 110, 0.18), rgba(109, 40, 217, 0.14));
        display: grid;
        place-items: center;
        border: 1px solid rgba(15, 118, 110, 0.12);
      }

      .brand-mark img {
        width: 52px;
        height: 52px;
        object-fit: contain;
      }

      .brand-kicker {
        margin: 0 0 6px;
        font-size: 11px;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: var(--primary);
      }

      .brand-title {
        margin: 0;
        font-size: 34px;
        line-height: 1;
        font-weight: 900;
        letter-spacing: -0.04em;
      }

      .brand-version {
        margin: 8px 0 0;
        font-size: 14px;
        color: var(--muted);
        font-weight: 700;
      }

      .status-copy {
        position: relative;
        z-index: 1;
        display: grid;
        gap: 6px;
      }

      .status-message {
        margin: 0;
        font-size: 19px;
        font-weight: 800;
        color: #10263f;
      }

      .status-step {
        margin: 0;
        font-size: 13px;
        color: var(--muted);
      }

      .progress-wrap {
        position: relative;
        z-index: 1;
        display: grid;
        gap: 8px;
      }

      .progress-track {
        width: 100%;
        height: 12px;
        border-radius: 999px;
        background: var(--progress-bg);
        overflow: hidden;
      }

      .progress-bar {
        width: 42%;
        height: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, var(--primary), #17b9aa 55%, var(--accent));
        box-shadow: 0 10px 18px rgba(15, 118, 110, 0.2);
        transition: width 220ms ease;
      }

      .progress-bar--animated {
        animation: pulse-progress 1.4s ease-in-out infinite;
      }

      .progress-meta {
        display: flex;
        justify-content: space-between;
        gap: 12px;
        font-size: 12px;
        color: var(--muted);
      }

      @keyframes pulse-progress {
        0%, 100% { filter: saturate(1); }
        50% { filter: saturate(1.25); }
      }
    </style>
  </head>
  <body>
    <div class="splash-shell">
      <div class="splash-card">
        <div class="brand-row">
          <div class="brand-mark">
            ${iconDataUrl ? `<img src="${iconDataUrl}" alt="Logo GPA" />` : '<div style="font-weight:900;font-size:28px;color:#0f766e;">GPA</div>'}
          </div>
          <div>
            <p class="brand-kicker">Gestionale Presenze Agricole</p>
            <h1 class="brand-title">GPA ${escapeHtml(version)}</h1>
            <p class="brand-version">Avvio di ${escapeHtml(productName)}</p>
          </div>
        </div>

        <div class="status-copy">
          <p id="status-message" class="status-message">Caricamento gestionale...</p>
          <p id="status-step" class="status-step">Avvio servizi</p>
        </div>

        <div class="progress-wrap">
          <div class="progress-track">
            <div id="progress-bar" class="progress-bar progress-bar--animated"></div>
          </div>
          <div class="progress-meta">
            <span id="progress-label">Attendere prego</span>
            <span id="progress-value">20%</span>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

async function createSplashWindow({ version, productName, iconPath, log }) {
  const iconDataUrl = getImageDataUrl(iconPath);
  const splashWindow = new BrowserWindow({
    width: 560,
    height: 340,
    minWidth: 560,
    minHeight: 340,
    maxWidth: 560,
    maxHeight: 340,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    movable: true,
    alwaysOnTop: true,
    center: true,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f4fbf7',
    skipTaskbar: false,
    icon: iconPath,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    },
  });

  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
    log?.('shown', {});
  });

  splashWindow.on('closed', () => {
    log?.('closed', {});
  });

  log?.('created', {});
  await splashWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(
    buildSplashHtml({ version, productName, iconDataUrl })
  )}`);
  return splashWindow;
}

async function updateSplashWindowStatus(splashWindow, { message, step, percent }) {
  // Difese contro stato distrutto / render frame in transizione.
  // Su Electron recenti `executeJavaScript` può lanciare
  //   "Render frame was disposed before WebFrameMain could be accessed"
  // se la splash sta venendo distrutta in parallelo. Tutte queste varianti
  // sono rumore non bloccante: silenziare e continuare l'avvio.
  if (!splashWindow || splashWindow.isDestroyed()) return;
  const webContents = splashWindow.webContents;
  if (!webContents || webContents.isDestroyed()) return;
  try {
    if (!webContents.mainFrame) return;
  } catch (_) {
    return;
  }

  const safeMessage = JSON.stringify(String(message || 'Caricamento gestionale...'));
  const safeStep = JSON.stringify(String(step || 'Avvio servizi'));
  const normalizedPercent = Number.isFinite(Number(percent)) ? Math.max(0, Math.min(100, Math.round(Number(percent)))) : null;
  const script = `
    (() => {
      const messageNode = document.getElementById('status-message');
      const stepNode = document.getElementById('status-step');
      const progressLabelNode = document.getElementById('progress-label');
      const progressValueNode = document.getElementById('progress-value');
      const progressBarNode = document.getElementById('progress-bar');
      if (messageNode) messageNode.textContent = ${safeMessage};
      if (stepNode) stepNode.textContent = ${safeStep};
      if (progressLabelNode) progressLabelNode.textContent = ${safeStep};
      if (progressValueNode) progressValueNode.textContent = ${normalizedPercent === null ? "''" : `'${normalizedPercent}%'`};
      if (progressBarNode && ${normalizedPercent === null ? 'false' : 'true'}) progressBarNode.style.width = '${normalizedPercent}%';
    })();
  `;

  // Ricontrolla subito prima della chiamata: il flusso fra il check sopra
  // e l'invio del messaggio IPC è asincrono e la finestra può chiudersi nel mezzo.
  if (splashWindow.isDestroyed() || webContents.isDestroyed()) return;

  try {
    await webContents.executeJavaScript(script, true);
  } catch (error) {
    const text = String((error && (error.message || error.toString())) || '');
    if (
      text.includes('Render frame was disposed') ||
      text.includes('WebFrameMain') ||
      text.includes('Object has been destroyed')
    ) {
      // Splash chiusa/distrutta durante l'aggiornamento: warning non bloccante.
      return;
    }
    // Errore inatteso: non interrompere l'avvio, ma lasciane traccia.
    try { console.warn('[splash] updateSplashWindowStatus failed:', text); } catch (_) { /* ignore */ }
  }
}

function closeSplashWindow(splashWindow) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.close();
}

module.exports = {
  closeSplashWindow,
  createSplashWindow,
  updateSplashWindowStatus,
};
