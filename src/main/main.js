const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { getAppVariant, getRuntimeContext, getVariantConfig } = require('./runtimeContext');

if (!app || typeof app.whenReady !== 'function') {
  throw new Error(
    "Electron main process non disponibile. Verifica che ELECTRON_RUN_AS_NODE non sia attivo durante l'avvio dell'app."
  );
}

const variantConfig = getVariantConfig();
const APP_ERROR_TITLE = variantConfig.variant === 'demo'
  ? 'Errore avvio GPA versione 1 demo'
  : 'Errore avvio Gestionale';
const TRANSIENT_DEMO_PATHS = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'blob_storage',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Local Storage',
  'Session Storage',
  'Shared Dictionary',
  'Network',
  'DIPS',
];

function getResolvedUserDataPath() {
  return path.join(app.getPath('appData'), variantConfig.appDataDirName);
}

function configureAppIdentity() {
  app.setName(variantConfig.productName);
  if (typeof app.setAppUserModelId === 'function' && variantConfig.appId) {
    app.setAppUserModelId(variantConfig.appId);
  }

  const envOverride = process.env.GPA_USER_DATA_PATH
    ? String(process.env.GPA_USER_DATA_PATH).trim()
    : '';

  if (envOverride) {
    app.setPath('userData', envOverride);
    console.log(`[runtime] forced userData path from GPA_USER_DATA_PATH: ${envOverride}`);
  } else {
    app.setPath('userData', getResolvedUserDataPath());
  }

  const finalUserData = app.getPath('userData');
  const finalDbPath = path.join(finalUserData, 'data', 'presenze.sqlite');
  console.log(`[runtime] final userData path: ${finalUserData}`);
  console.log(`[runtime] final database path: ${finalDbPath}`);
}

configureAppIdentity();

const LOG_MAX_BYTES = 5 * 1024 * 1024;

function appendMainProcessLog(context, errorLike) {
  try {
    const targetDir = app.isReady()
      ? app.getPath('userData')
      : (process.env.GPA_USER_DATA_PATH
          ? String(process.env.GPA_USER_DATA_PATH).trim()
          : getResolvedUserDataPath());
    fs.mkdirSync(targetDir, { recursive: true });

    const logPath = path.join(targetDir, 'main-process.log');
    try {
      if (fs.existsSync(logPath) && fs.statSync(logPath).size > LOG_MAX_BYTES) {
        fs.renameSync(logPath, path.join(targetDir, 'main-process.old.log'));
      }
    } catch {}

    const payload = errorLike && errorLike.stack ? errorLike.stack : String(errorLike || 'Errore sconosciuto');
    const row = `[${new Date().toISOString()}] ${context}\n${payload}\n\n`;
    fs.appendFileSync(logPath, row, 'utf8');
  } catch {
    // Best effort logging to avoid crashing on logging failures.
  }
}

process.on('uncaughtException', (error) => {
  appendMainProcessLog('uncaughtException', error);
  dialog.showErrorBox(APP_ERROR_TITLE, String(error?.message || error || 'Errore sconosciuto'));
});

process.on('unhandledRejection', (reason) => {
  appendMainProcessLog('unhandledRejection', reason);
});

function logMainProcessEvent(context, details) {
  appendMainProcessLog(context, JSON.stringify(details, null, 2));
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function getOcrOnlineSettings(settings = {}) {
  const ocr = settings?.ocr || {};
  return {
    provider: 'ocr.space',
    language: ocr.language === 'eng' ? 'eng' : 'ita',
    engine: Number(ocr.engine) === 1 ? 1 : 2,
    apiKey: String(ocr.ocr_space_api_key || process.env.OCR_SPACE_API_KEY || '').trim(),
    confirmPrivacy: ocr.confirm_privacy_before_online !== false,
  };
}

function createOcrOnlineError(message, code = 'OCR_ONLINE_FAILED') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeOcrSpaceErrorMessage(message) {
  const raw = String(message || '').trim() || 'errore sconosciuto';
  if (/free|limit|maximum|max|size|dimensione|larger|exceed/i.test(raw)) {
    return 'OCR online non disponibile: il PDF supera i limiti del piano OCR.space configurato.';
  }
  return `OCR online fallito: ${raw}`;
}

function shouldOfferOnlineOcrFallback(records = [], diagnostics = {}) {
  if (diagnostics.detected_model !== 'scanned_pdf_ocr') return false;
  if (!diagnostics.ocr_attempted) return false;
  const recordCount = Array.isArray(records) ? records.length : 0;
  if (recordCount === 0) return true;
  const pagesCount = Number(diagnostics.pages_ocr_count || 0);
  if (pagesCount < 4) return false;
  const expectedFromPages = Math.max(1, Math.floor(pagesCount / 2));
  return expectedFromPages >= 2 && recordCount < expectedFromPages;
}

async function runOcrSpaceFallback(filePath, settings = {}) {
  const onlineSettings = getOcrOnlineSettings(settings);
  const startedAt = Date.now();
  const apiKey = onlineSettings.apiKey;
  if (!apiKey) {
    throw createOcrOnlineError('OCR online non configurato.', 'OCR_ONLINE_NOT_CONFIGURED');
  }

  logMainProcessEvent('ocr_online_started', {
    provider: onlineSettings.provider,
    duration_ms: 0,
    text_length: 0,
  });

  try {
    const form = new FormData();
    form.append('apikey', apiKey);
    form.append('language', onlineSettings.language);
    form.append('isOverlayRequired', 'false');
    form.append('OCREngine', String(onlineSettings.engine));
    form.append('scale', 'true');
    form.append('detectOrientation', 'true');
    const bytes = fs.readFileSync(filePath);
    form.append('file', new Blob([bytes], { type: 'application/pdf' }), path.basename(filePath));

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      body: form,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.IsErroredOnProcessing) {
      const message = Array.isArray(payload?.ErrorMessage)
        ? payload.ErrorMessage.join(' ')
        : payload?.ErrorMessage || `HTTP ${response.status}`;
      throw createOcrOnlineError(normalizeOcrSpaceErrorMessage(message));
    }

    const text = (payload?.ParsedResults || [])
      .map((item) => String(item?.ParsedText || '').trim())
      .filter(Boolean)
      .join('\n\n');
    logMainProcessEvent('ocr_online_completed', {
      provider: onlineSettings.provider,
      duration_ms: Date.now() - startedAt,
      text_length: text.length,
    });
    return { text };
  } catch (error) {
    logMainProcessEvent('ocr_online_failed', {
      provider: onlineSettings.provider,
      duration_ms: Date.now() - startedAt,
      text_length: 0,
    });
    throw error;
  }
}

async function getConfirmedOcrOnlineSettings(settings = {}) {
  const onlineSettings = getOcrOnlineSettings(settings);
  if (!onlineSettings.apiKey) {
    throw createOcrOnlineError('OCR online non configurato.', 'OCR_ONLINE_NOT_CONFIGURED');
  }

  if (!onlineSettings.confirmPrivacy) {
    return onlineSettings;
  }

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Annulla', 'Usa OCR online'],
    defaultId: 0,
    cancelId: 0,
    title: 'Conferma OCR online',
    message: 'Il PDF verrà inviato a un servizio esterno OCR.',
    detail: 'Continua solo se hai autorizzazione a inviare questo documento.',
  });

  return response === 1 ? onlineSettings : null;
}

async function parseWithOcrSpaceFallback(filePath, settings = {}, operationJobId = '') {
  const onlineSettings = await getConfirmedOcrOnlineSettings(settings);
  if (!onlineSettings) return null;

  const onlineResult = await runOcrSpaceFallback(filePath, settings);
  const onlineRecords = pdfImportService.parseOcrTextAssunzioni(onlineResult.text || '', {
    reason: 'ocr_online_success',
  });
  const onlineDiagnostics = onlineRecords.importDiagnostics || {};
  logMainProcessEvent('employees:pdf-import:online-parse-result', {
    job_id: operationJobId,
    records_length: onlineRecords.length,
    text_length: onlineDiagnostics.text_length || 0,
    candidate_blocks_count: onlineDiagnostics.candidate_blocks_count || 0,
  });
  Object.assign(onlineDiagnostics, {
    fallback_used: true,
    ocr_online_used: true,
    ocr_online_provider: onlineSettings.provider,
  });

  return {
    records: onlineRecords,
    diagnostics: onlineDiagnostics,
    text_length: String(onlineResult.text || '').length,
  };
}

function getKnownUserDataPaths() {
  const appDataRoot = app.getPath('appData');
  return {
    configured_user_data: app.getPath('userData'),
    resolved_demo_or_standard_root: getResolvedUserDataPath(),
    stable_variant_root: path.join(appDataRoot, variantConfig.appDataDirName),
    legacy_named_root: path.join(appDataRoot, variantConfig.legacyAppDataDirName),
    legacy_package_root: path.join(appDataRoot, variantConfig.legacyPackageUserDataDirName),
  };
}

function buildAppIdentitySnapshot() {
  const runtime = getRuntimeContext();
  return {
    variant: getAppVariant(),
    app_version: app.getVersion(),
    app_id: variantConfig.appId || '',
    app_variant: runtime.appVariant,
    is_dev: runtime.isDev,
    is_demo: runtime.isDemo,
    is_production: runtime.isProduction,
    product_name: variantConfig.productName,
    app_name: app.getName(),
    user_data_path: app.getPath('userData'),
    log_file: path.join(app.getPath('userData'), 'main-process.log'),
    executable_path: app.getPath('exe'),
    app_path: app.getAppPath(),
    cwd: process.cwd(),
    packaged: runtime.isPackaged,
    developer_machine_config_path: licenseService.getDeveloperMachineConfigPath(),
    known_user_data_paths: getKnownUserDataPaths(),
  };
}

const authService = require('./authService');
const employeeRepo = require('./employeeRepo');
const pdfImportService = require('./pdfImportService');
const attendanceRepo = require('./attendanceRepo');
const payrollRepo = require('./payrollRepo');
const financialMovementsRepo = require('./financialMovementsRepo');
const dashboardRepo = require('./dashboardRepo');
const teamsRepo = require('./teamsRepo');
const communicationRepo = require('./communicationRepo');
const occupationRepo = require('./occupationRepo');
const settingsService = require('./settingsService');
const backupService = require('./backupService');
const diagnosticsService = require('./diagnosticsService');
const licenseService = require('./licenseService');
const demoService = require('./demoService');
const { getDb, getDbPath, closeDb } = require('./db');
const { ensureAppStorageStructure } = require('./storagePaths');

const runtime = getRuntimeContext();

function requireWritableLicense(actionLabel) {
  if (authService.isSuperAdmin()) {
    logMainProcessEvent('sa:license-bypass', { action: actionLabel });
    return;
  }
  return licenseService.enforceLicenseGuard(actionLabel);
}

function getAppIconPath() {
  return path.join(__dirname, '..', 'assets', 'larix-icon.png');
}
let mainWindow = null;
let isQuittingAfterExitBackup = false;
const OPERATION_PROGRESS_CHANNEL = 'operations:progress';
const activeOperations = new Map();
const activeOperationControllers = new Map();
const activeOperationTimeouts = new Map();
const resetOperationJobIds = new Set();
const OPERATION_LOCK_TIMEOUT_MS = 180000;

function getActiveOperationsSnapshot() {
  return [...activeOperations.values()];
}

function emitOperationProgress(payload) {
  const normalized = {
    updated_at: new Date().toISOString(),
    percent: 0,
    status: 'running',
    ...payload,
  };

  if (normalized.status === 'idle' || normalized.status === 'completed' || normalized.status === 'error') {
    if (normalized.status === 'idle') {
      activeOperations.delete(normalized.type);
    } else {
      activeOperations.set(normalized.type, normalized);
      setTimeout(() => {
        const current = activeOperations.get(normalized.type);
        if (current?.job_id === normalized.job_id && current?.status === normalized.status) {
          activeOperations.delete(normalized.type);
        }
      }, 5000).unref?.();
    }
  } else {
    activeOperations.set(normalized.type, normalized);
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(OPERATION_PROGRESS_CHANNEL, normalized);
  }

  logMainProcessEvent(`operation:${normalized.type}:${normalized.status}`, normalized);
  return normalized;
}

function getOperationLockLogType(type) {
  return type === 'pdf-import' ? 'import-lock' : `operation-lock:${type}`;
}

function logOperationLock(type, action, details = {}) {
  logMainProcessEvent(`${getOperationLockLogType(type)}-${action}`, {
    type,
    ...details,
  });
}

function releaseOperationLock(type, jobId, reason = 'completed') {
  const timer = activeOperationTimeouts.get(type);
  if (timer) {
    clearTimeout(timer);
    activeOperationTimeouts.delete(type);
  }

  const currentController = activeOperationControllers.get(type);
  if (currentController?.job_id === jobId) {
    activeOperationControllers.delete(type);
  }
  resetOperationJobIds.delete(jobId);

  logOperationLock(type, 'released', {
    job_id: jobId,
    reason,
  });
}

function resetOperationLock(type, reason = 'manual-reset') {
  const active = activeOperationControllers.get(type);
  const current = activeOperations.get(type);
  const jobId = active?.job_id || current?.job_id || `${type}-reset-${Date.now()}`;
  resetOperationJobIds.add(jobId);

  if (active?.controller && !active.controller.signal.aborted) {
    active.controller.abort();
  }

  const timer = activeOperationTimeouts.get(type);
  if (timer) {
    clearTimeout(timer);
    activeOperationTimeouts.delete(type);
  }

  activeOperationControllers.delete(type);
  activeOperations.delete(type);

  logOperationLock(type, 'released', {
    job_id: jobId,
    reason,
  });
  emitOperationProgress({
    type,
    job_id: jobId,
    status: 'idle',
    step: 'reset',
    percent: 0,
    message: 'Lock importazione PDF resettato.',
  });
  logOperationLock(type, 'reset', {
    job_id: jobId,
    reason,
  });

  return { reset: true, job_id: jobId, message: 'Lock importazione PDF resettato.' };
}

async function runExclusiveOperation({ type, jobId, startMessage, fn }) {
  const running = activeOperations.get(type);
  if (running?.status === 'running') {
    throw new Error(running.concurrent_error_message || 'Operazione già in corso. Attendi il completamento.');
  }

  const operationJobId = jobId || `${type}-${Date.now()}`;
  const controller = new AbortController();
  activeOperationControllers.set(type, {
    job_id: operationJobId,
    controller,
  });
  let lockReleased = false;
  activeOperationTimeouts.set(type, setTimeout(() => {
    lockReleased = true;
    resetOperationLock(type, `timeout-${OPERATION_LOCK_TIMEOUT_MS}ms`);
  }, OPERATION_LOCK_TIMEOUT_MS));
  logOperationLock(type, 'acquired', {
    job_id: operationJobId,
    timeout_ms: OPERATION_LOCK_TIMEOUT_MS,
  });
  const progress = (update = {}) => {
    if (lockReleased || resetOperationJobIds.has(operationJobId)) {
      logMainProcessEvent(`operation:${type}:ignored-after-lock-reset`, {
        job_id: operationJobId,
        update,
      });
      return null;
    }
    return emitOperationProgress({
      type,
      job_id: operationJobId,
      ...update,
    });
  };

  progress({
    status: 'running',
    percent: 1,
    message: startMessage || 'Operazione avviata...',
  });

  try {
    const result = await fn(progress, operationJobId, controller.signal);
    if (result?.canceled) {
      progress({
        status: 'idle',
      });
      return result;
    }
    progress({
      status: 'completed',
      percent: 100,
      step: 'completed',
      message: 'Operazione completata.',
    });
    return result;
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError' || error?.code === 'PDF_IMPORT_CANCELLED') {
      progress({
        status: 'idle',
        step: 'cancelled',
        percent: 0,
        message: 'Importazione annullata',
      });
      logMainProcessEvent(`operation:${type}:cancelled`, {
        type,
        job_id: operationJobId,
        message: error?.message || 'Importazione annullata',
      });
      return { canceled: true, message: 'Importazione annullata' };
    }
    progress({
      status: 'error',
      step: 'error',
      message: error?.message || 'Operazione fallita.',
      error: error?.message || String(error),
    });
    throw error;
  } finally {
    if (resetOperationJobIds.has(operationJobId)) {
      lockReleased = true;
      resetOperationJobIds.delete(operationJobId);
    }
    if (!lockReleased) {
      lockReleased = true;
      releaseOperationLock(type, operationJobId, controller.signal.aborted ? 'cancelled' : 'finished');
    }
  }
}

function removePathIfExists(targetPath) {
  if (!fs.existsSync(targetPath)) return false;
  fs.rmSync(targetPath, { recursive: true, force: true });
  return true;
}

function cleanDemoBootstrapData() {
  if (variantConfig.variant !== 'demo') {
    return;
  }

  const demoUserDataPath = getResolvedUserDataPath();
  const cleanupTargets = TRANSIENT_DEMO_PATHS.map((entry) => path.join(demoUserDataPath, entry));

  const removedPaths = cleanupTargets.filter(removePathIfExists);

  fs.mkdirSync(demoUserDataPath, { recursive: true });

  logMainProcessEvent('demo:startup-cleanup', {
    demo_user_data_path: demoUserDataPath,
    preserved_paths: ['data', 'config', 'documents', 'backups', 'updates', 'Local State', 'Preferences'],
    removed_paths: removedPaths,
    legacy_paths_left_untouched: getKnownUserDataPaths(),
  });
}

function getPreloadPath() {
  return path.join(__dirname, 'preload.js');
}

function getRendererEntryPath() {
  return path.join(__dirname, '../../dist/index.html');
}

function getRendererAssetInfo() {
  const rendererEntryPath = getRendererEntryPath();
  const assetDir = path.join(path.dirname(rendererEntryPath), 'assets');
  return {
    renderer_entry_path: rendererEntryPath,
    renderer_entry_exists: fs.existsSync(rendererEntryPath),
    asset_dir_path: assetDir,
    asset_dir_exists: fs.existsSync(assetDir),
    asset_count: fs.existsSync(assetDir) ? fs.readdirSync(assetDir).length : 0,
  };
}

function getTargetYear(options = {}) {
  return Number(options?.targetYear) || new Date().getFullYear();
}

function buildAppRuntimeInfo() {
  return {
    is_demo: variantConfig.variant === 'demo',
    welcome_seen: variantConfig.variant === 'demo'
      ? demoService.getDemoRuntimeInfo().welcome_seen
      : true,
    reset_count: variantConfig.variant === 'demo'
      ? demoService.getDemoRuntimeInfo().reset_count
      : 0,
    runtime_paths: {
      user_data: app.getPath('userData'),
      database: getDbPath(),
      preload: getPreloadPath(),
      renderer_entry: getRendererEntryPath(),
    },
  };
}

function buildAvailableYears() {
  const currentYear = new Date().getFullYear();
  const years = new Set([currentYear]);

  [
    ...employeeRepo.listEmploymentYears(),
    ...attendanceRepo.listAttendanceYears(),
    ...payrollRepo.listPayrollYears(),
    ...communicationRepo.listCommunicationYears(),
  ].forEach((year) => {
    const normalized = Number(year);
    if (Number.isInteger(normalized) && normalized > 1900) {
      years.add(normalized);
    }
  });

  return [...years].sort((a, b) => b - a);
}

function attachWindowDiagnostics(windowInstance) {
  const { webContents } = windowInstance;

  webContents.on('did-start-loading', () => {
    logMainProcessEvent('renderer:did-start-loading', {
      url: webContents.getURL(),
    });
  });

  webContents.on('did-finish-load', () => {
    logMainProcessEvent('renderer:did-finish-load', {
      url: webContents.getURL(),
      title: windowInstance.getTitle(),
    });
  });

  webContents.on('did-fail-load', (_, errorCode, errorDescription, validatedURL, isMainFrame, frameProcessId, frameRoutingId) => {
    logMainProcessEvent('renderer:did-fail-load', {
      error_code: errorCode,
      error_description: errorDescription,
      validated_url: validatedURL,
      is_main_frame: isMainFrame,
      frame_process_id: frameProcessId,
      frame_routing_id: frameRoutingId,
    });
  });

  webContents.on('render-process-gone', (_, details) => {
    logMainProcessEvent('renderer:render-process-gone', details);
  });

  webContents.on('unresponsive', () => {
    logMainProcessEvent('renderer:unresponsive', {
      url: webContents.getURL(),
    });
  });

  webContents.on('responsive', () => {
    logMainProcessEvent('renderer:responsive', {
      url: webContents.getURL(),
    });
  });

  webContents.on('console-message', (event) => {
    const details = event;
    logMainProcessEvent('renderer:console-message', {
      level: details?.level,
      message: details?.message,
      line: details?.lineNumber,
      source_id: details?.sourceId,
    });
  });

  webContents.on('preload-error', (_, preloadPath, error) => {
    logMainProcessEvent('renderer:preload-error', {
      preload_path: preloadPath,
      error_message: error?.message || String(error),
      error_stack: error?.stack || '',
    });
  });
}

async function createWindow() {
  const preloadPath = getPreloadPath();
  const rendererEntryPath = getRendererEntryPath();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    icon: getAppIconPath(),
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  attachWindowDiagnostics(mainWindow);

  logMainProcessEvent('window:create', {
    ...buildAppIdentitySnapshot(),
    preload_path: preloadPath,
    preload_exists: fs.existsSync(preloadPath),
    renderer_entry_path: rendererEntryPath,
    renderer_entry_exists: fs.existsSync(rendererEntryPath),
  });

  if (!app.isPackaged) {
    const devUrl = 'http://localhost:5173';
    logMainProcessEvent('renderer:load-url', { target: devUrl });
    await mainWindow.loadURL(devUrl);
  } else {
    logMainProcessEvent('renderer:load-file', { target: rendererEntryPath });
    await mainWindow.loadFile(rendererEntryPath);
  }

  mainWindow.show();
}

function buildPdfHtml(contentHtml, landscape = false, debugRenderLabel = '') {
  const debugBadgeHtml = debugRenderLabel
    ? `<div class="app-real-debug-label">${String(debugRenderLabel)}</div>`
    : '';
  return `
  <!doctype html>
  <html lang="it">
    <head>
      <meta charset="UTF-8" />
      <title>Report PDF</title>
      <style>
        @page {
          size: A4 ${landscape ? 'landscape' : 'portrait'};
          margin: 2mm;
        }

        html, body {
          width: 210mm;
          height: auto;
          margin: 0;
          padding: 0;
          overflow: visible;
          background: white;
          font-family: Arial, Helvetica, sans-serif;
          color: #111827;
          font-size: 10px;
          line-height: 1.3;
        }

        * {
          box-sizing: border-box;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }

        .print-root {
          width: 206mm;
          margin: 0 auto;
          padding: 0;
          position: relative;
        }

        .app-real-debug-label {
          position: absolute;
          top: 1mm;
          right: 1mm;
          font-size: 7px;
          font-weight: 800;
          color: #991b1b;
          letter-spacing: 0.04em;
          z-index: 20;
        }

        .print-area,
        .report-page,
        .print-report,
        .pdf-report {
          width: 206mm;
          max-width: 206mm;
          min-height: 0;
          height: auto;
          margin: 0 auto;
          padding: 0;
          box-sizing: border-box;
          overflow: visible;
          page-break-after: avoid;
          break-after: avoid;
        }

        .print-sheet {
          width: 100%;
          max-width: 206mm;
          margin: 0 auto;
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .report-section,
        .calendar-section,
        .economic-section,
        .result-box,
        .kpi-row,
        .print-block {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        /* === EMPLOYEE COMPACT A4 — 1 PAGE (no transform, natural fit) === */
        .employee-print-area {
          width: 100% !important;
          max-width: 206mm !important;
          margin: 0 auto !important;
          transform: none !important;
          overflow: visible !important;
          page-break-after: avoid !important;
          break-after: avoid !important;
        }

        .employee-print-sheet {
          width: 100% !important;
          max-width: 206mm !important;
          min-height: 0 !important;
          padding: 4mm 5.5mm 3.5mm !important;
          border-radius: 0 !important;
          box-shadow: none !important;
          border: none !important;
          overflow: visible !important;
          page-break-after: avoid !important;
          break-after: avoid !important;
        }

        .employee-print-sheet {
          color: #111827 !important;
        }

        /* HEADER — max 18mm */
        .employee-print-sheet > div:first-child {
          margin-bottom: 4px !important;
          gap: 8px !important;
          align-items: center !important;
        }
        .employee-print-sheet > div:first-child > div:first-child > div:first-child {
          font-size: 19px !important;
          line-height: 1.05 !important;
        }
        .employee-print-sheet > div:first-child > div:first-child > div:nth-child(2) {
          font-size: 11px !important;
          margin-top: 2px !important;
        }
        .employee-print-sheet > div:first-child > div:last-child {
          font-size: 11px !important;
          padding: 5px 10px !important;
          white-space: nowrap !important;
          text-transform: uppercase !important;
          flex-shrink: 0 !important;
        }

        /* KPI ROW — max 22mm */
        .employee-print-sheet > div:nth-child(2) {
          gap: 6px !important;
          margin-bottom: 4px !important;
        }
        .employee-print-sheet > div:nth-child(2) > div {
          padding: 6px 8px !important;
          border-radius: 8px !important;
          border-color: #1f2937 !important;
          background: #fff !important;
        }
        .employee-print-sheet > div:nth-child(2) > div > div:first-child {
          font-size: 9px !important;
          margin-bottom: 2px !important;
          letter-spacing: 0.04em !important;
        }
        .employee-print-sheet > div:nth-child(2) > div > div:nth-child(2) {
          font-size: 16px !important;
          line-height: 1 !important;
          white-space: nowrap !important;
        }
        .employee-print-sheet > div:nth-child(2) > div > div:nth-child(3) {
          font-size: 9px !important;
          margin-top: 2px !important;
        }

        /* TARIFFE — max 8mm */
        .employee-print-sheet > div:nth-child(3) {
          gap: 6px !important;
          margin-bottom: 1px !important;
          flex-wrap: nowrap !important;
        }
        .employee-print-sheet > div:nth-child(3) > div {
          padding: 4px 9px !important;
          font-size: 10px !important;
          gap: 6px !important;
          border-color: #1f2937 !important;
          background: #fff !important;
        }

        /* SECTIONS (presenze / riepilogo / risultato) */
        .employee-print-sheet .employee-print-section,
        .employee-print-sheet .print-block {
          margin-top: 4px !important;
          padding: 6px 8px !important;
          border-radius: 8px !important;
          border-color: #1f2937 !important;
          background: #fff !important;
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }
        .employee-print-sheet .employee-print-section > div:first-child {
          margin-bottom: 4px !important;
          font-size: 9px !important;
          letter-spacing: 0.06em !important;
        }

        /* CALENDARIO PRESENZE — celle compatte */
        .employee-print-sheet [style*="Settimana "],
        .employee-print-sheet [style*="font-size: 10px"][style*="letter-spacing: 0.08em"] {
          margin-top: 0 !important;
          margin-bottom: 0 !important;
          font-size: 8px !important;
        }
        .employee-print-sheet [style*="grid-template-columns: repeat(7"] {
          gap: 4px !important;
        }
        .employee-print-sheet [style*="border-radius: 14px"][style*="justify-items: center"],
        .employee-print-sheet [style*="grid-template-rows"][style*="justify-items: center"] {
          padding: 4px 3px !important;
          gap: 3px !important;
          border-radius: 6px !important;
          min-height: 0 !important;
          border-color: #6b7280 !important;
          background: #fff !important;
        }
        .employee-print-sheet [style*="grid-template-rows"][style*="justify-items: center"] {
          grid-template-rows: 17px 18px 10px 10px 10px !important;
          padding: 3px 3px !important;
          gap: 1px !important;
        }
        .employee-print-sheet [style*="font-size: 13px"][style*="font-weight: 800"][style*="line-height: 1"] {
          font-size: 10px !important;
        }
        .employee-print-sheet [style*="width: 28px"][style*="height: 28px"] {
          width: 18px !important;
          height: 18px !important;
          font-size: 10px !important;
        }
        .employee-print-sheet [style*="2.25px solid"][style*="#000000"],
        .employee-print-sheet [style*="2.25px solid rgb(0, 0, 0)"],
        .employee-print-sheet [style*="1.75px solid"][style*="#000"] {
          border-color: #000 !important;
          border-width: 2px !important;
          background: #fff !important;
          color: #000 !important;
        }
        .employee-print-sheet [style*="min-height: 24"] {
          min-height: 12px !important;
          font-size: 8px !important;
        }
        .employee-print-sheet [style*="min-height: 10"] {
          min-height: 8px !important;
          font-size: 7.5px !important;
        }
        .employee-print-sheet [style*="font-size: 9px"][style*="line-height: 1.1"] {
          font-size: 7px !important;
          line-height: 1.05 !important;
        }
        .employee-print-sheet [style*="font-size: 9px"][style*="line-height: 1.05"] {
          font-size: 7.5px !important;
          line-height: 1.02 !important;
        }
        .employee-print-sheet [style*="font-size: 8.5px"][style*="line-height: 1.05"] {
          font-size: 7px !important;
          line-height: 1.02 !important;
        }
        /* week container gap */
        .employee-print-sheet [style*="display: grid"][style*="gap: 6px"][style*="margin-top: 10px"] {
          gap: 2px !important;
          margin-top: 4px !important;
        }
        /* legend */
        .employee-print-sheet [style*="display: flex"][style*="gap: 14px"][style*="margin-top: 12px"] {
          margin-top: 4px !important;
          font-size: 9px !important;
          gap: 8px !important;
        }

        /* RIEPILOGO ECONOMICO — righe compatte */
        .employee-print-sheet [style*="font-size: 11px"][style*="letter-spacing: 0.08em"] {
          font-size: 9px !important;
          margin-bottom: 4px !important;
        }
        .employee-print-sheet [style*="padding: 12px 0"],
        .employee-print-sheet [style*="padding: 12px 0 0"] {
          padding-top: 2px !important;
          padding-bottom: 2px !important;
        }
        .employee-print-sheet [style*="font-size: 12px"][style*="font-weight: 700"] {
          font-size: 10px !important;
        }
        .employee-print-sheet [style*="font-size: 13px"][style*="font-weight: 800"][style*="color: rgb(17, 24, 39)"] {
          font-size: 11px !important;
        }
        .employee-print-sheet [style*="font-size: 11px"][style*="margin-top: 4px"] {
          font-size: 9px !important;
          margin-top: 1px !important;
          line-height: 1.2 !important;
        }
        .employee-print-sheet [style*="font-size: 13px"][style*="font-weight: 800"][style*="white-space: nowrap"] {
          font-size: 11px !important;
        }
        .employee-print-sheet [style*="font-size: 15px"][style*="font-weight: 800"][style*="white-space: nowrap"] {
          font-size: 12px !important;
        }

        /* RISULTATO FINALE */
        .employee-print-sheet [style*="padding: 18px 20px"],
        .employee-print-sheet [style*="padding: 14px 16px"] {
          padding: 8px 11px !important;
          margin-top: 4px !important;
          border-radius: 10px !important;
          background: #fff !important;
        }
        .employee-print-sheet [style*="font-size: 14px"][style*="font-weight: 800"] {
          font-size: 11px !important;
          margin-bottom: 1px !important;
        }
        .employee-print-sheet [style*="font-size: 28px"][style*="font-weight: 900"] {
          font-size: 19px !important;
          line-height: 1 !important;
        }

        /* NOTE & FOOTER — max 6mm footer */
        .employee-print-sheet [style*="margin-top: 14px"][style*="padding: 12px 14px"],
        .employee-print-sheet [style*="margin-top: 10px"][style*="padding: 9px 11px"] {
          margin-top: 3px !important;
          padding: 4px 7px !important;
          font-size: 9px !important;
          border-color: #374151 !important;
          background: #fff !important;
        }
        .employee-print-sheet [style*="margin-top: 18px"][style*="padding-top: 14px"],
        .employee-print-sheet [style*="margin-top: 10px"][style*="padding-top: 8px"] {
          margin-top: 3px !important;
          padding-top: 3px !important;
          font-size: 8px !important;
        }

        /* Force PAGATO/NON PAGATO uppercase even on legacy snapshots */
        .employee-print-sheet > div:first-child > div:last-child {
          text-transform: uppercase !important;
        }

        .employee-print-layout {
          display: grid;
          grid-template-columns: 1fr;
          gap: 6px;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 10px;
        }

        th, td {
          padding: 4px;
        }

        thead {
          display: table-header-group;
        }

        tr {
          break-inside: avoid;
          page-break-inside: avoid;
        }
      </style>
    </head>
    <body>
      <div class="print-root">
        ${debugBadgeHtml}
        ${contentHtml}
      </div>
    </body>
  </html>
  `;
}

async function normalizeEmployeeReportPrintWindow(printWindow) {
  await printWindow.webContents.executeJavaScript(`
    (() => {
      const isEmptyAmount = (value) => {
        const text = String(value || '').trim();
        return !text || text === '-';
      };
      const normalizeAmount = (value, negative = false) => {
        const text = String(value || '').trim();
        if (!negative || isEmptyAmount(text) || text.startsWith('-')) return text;
        return '- ' + text;
      };

      document.querySelectorAll('.employee-print-sheet [style*="justify-items: center"]').forEach((cell) => {
        Array.from(cell.children).forEach((child) => {
          const text = child.textContent.trim();
          const hasGraphic = !!child.querySelector('img');
          if (!text && !hasGraphic) child.textContent = ' ';
        });
      });

      const sections = Array.from(document.querySelectorAll('.employee-print-section'));
      const economicSection = sections.find((section) => /Riepilogo economico/i.test(section.textContent));
      const table = economicSection?.children?.[1];
      if (!table) return;

      const orderedRows = [];
      Array.from(table.children).forEach((row) => {
        const labelNode = row.querySelector('div div:first-child');
        const amountNode = row.lastElementChild;
        const label = labelNode?.textContent.trim() || '';
        const detail = labelNode?.nextElementSibling?.textContent.trim() || '';
        const amount = amountNode?.textContent.trim() || '';
        let order = null;
        let hidden = false;
        let negative = false;

        if (/Retribuzione/i.test(label)) order = 1;
        else if (/Trasporto/i.test(label)) { order = 2; hidden = isEmptyAmount(amount) || /Non incluso/i.test(detail); }
        else if (/Crediti/i.test(label)) { order = 3; hidden = isEmptyAmount(amount) || /Nessun/i.test(detail); }
        else if (/Regalo|Extra/i.test(label)) { order = 4; hidden = isEmptyAmount(amount) || /Nessun/i.test(detail); }
        else if (/Busta paga/i.test(label)) { order = 5; hidden = isEmptyAmount(amount) || /Non inserita/i.test(detail); negative = true; }
        else if (/Rate/i.test(label)) { order = 6; hidden = isEmptyAmount(amount) || /Nessuna/i.test(detail); negative = true; }
        else if (/Acconti/i.test(label)) { order = 7; hidden = isEmptyAmount(amount) || /Nessun/i.test(detail); negative = true; }
        else if (/Debiti|debiti precedenti/i.test(label)) { order = 8; hidden = isEmptyAmount(amount) || /Nessun/i.test(detail); negative = true; }
        else if (/Compenso del mese/i.test(label)) hidden = true;
        else hidden = true;

        if (!hidden && order !== null) {
          if (negative && amountNode) amountNode.textContent = normalizeAmount(amount, true);
          orderedRows.push({ order, row });
        } else {
          row.remove();
        }
      });

      orderedRows.sort((a, b) => a.order - b.order).forEach(({ row }) => table.appendChild(row));
    })();
  `);
}

async function createPrintWindow({ html, landscape = false, show = false, debugRenderLabel = '' }) {
  const printWindow = new BrowserWindow({
    show,
    width: landscape ? 1400 : 794,
    height: landscape ? 900 : 1123,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const finalHtml = buildPdfHtml(html, landscape, debugRenderLabel);

  await printWindow.loadURL(
    `data:text/html;charset=UTF-8,${encodeURIComponent(finalHtml)}`
  );

  await new Promise((resolve) => setTimeout(resolve, 500));
  await normalizeEmployeeReportPrintWindow(printWindow);

  if (show) {
    printWindow.show();
    printWindow.focus();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return printWindow;
}

async function renderPdfToFile({ html, filePath, landscape = false, debugRenderLabel = '', onProgress = () => {} }) {
  onProgress({
    step: 'document_generation',
    percent: 45,
    message: 'Preparazione finestra di stampa...',
  });
  const pdfWindow = await createPrintWindow({ html, landscape, show: false, debugRenderLabel });

  onProgress({
    step: 'document_generation',
    percent: 72,
    message: 'Generazione PDF in corso...',
  });
  const pdfBuffer = await pdfWindow.webContents.printToPDF({
    printBackground: true,
    pageSize: 'A4',
    landscape,
    margins: {
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
    },
    preferCSSPageSize: true,
  });

  onProgress({
    step: 'file_save',
    percent: 90,
    message: 'Salvataggio file in corso...',
  });
  fs.writeFileSync(filePath, pdfBuffer);
  pdfWindow.close();
}

function buildTempPdfPath(fileName = 'stampa.pdf') {
  const tempDir = path.join(app.getPath('temp'), variantConfig.installerBaseName, 'print-preview');
  fs.mkdirSync(tempDir, { recursive: true });

  const safeBaseName = String(fileName || 'stampa.pdf')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim() || 'stampa.pdf';
  const finalFileName = safeBaseName.toLowerCase().endsWith('.pdf')
    ? safeBaseName
    : `${safeBaseName}.pdf`;

  return path.join(tempDir, `${Date.now()}-${finalFileName}`);
}

async function printHtmlDocument({ html, landscape = false, fileName, onProgress = () => {} }) {
  const tempPdfPath = buildTempPdfPath(fileName);
  await renderPdfToFile({
    html,
    filePath: tempPdfPath,
    landscape,
    onProgress,
  });

  onProgress({
    step: 'file_save',
    percent: 96,
    message: 'Apertura file generato...',
  });
  const openResult = await shell.openPath(tempPdfPath);
  if (openResult) {
    throw new Error(openResult);
  }

  return {
    canceled: false,
    preview_file_path: tempPdfPath,
  };
}

async function persistCommunicationArtifacts(communicationId) {
  const communication = communicationRepo.getCommunicationById(communicationId);
  if (!communication) {
    throw new Error('Comunicazione non trovata.');
  }

  const fileTargets = communicationRepo.getCommunicationFileTargets(communication);
  const pdfHtml = communicationRepo.buildCommunicationPdfHtml(communication);
  const excelXml = communicationRepo.buildCommunicationExcelXml(communication);

  fs.mkdirSync(path.dirname(fileTargets.excel.absolutePath), { recursive: true });
  fs.writeFileSync(fileTargets.excel.absolutePath, excelXml, 'utf8');

  await renderPdfToFile({
    html: pdfHtml,
    filePath: fileTargets.pdf.absolutePath,
    landscape: false,
  });

  return communicationRepo.updateCommunicationFiles(communication.id, {
    pdf_relative_path: fileTargets.pdf.relativePath,
    pdf_sha256: hashFile(fileTargets.pdf.absolutePath),
    pdf_created_at: new Date().toISOString(),
    excel_relative_path: fileTargets.excel.relativePath,
    excel_sha256: hashFile(fileTargets.excel.absolutePath),
    excel_created_at: new Date().toISOString(),
  });
}

app.whenReady().then(async () => {
  configureAppIdentity();
  cleanDemoBootstrapData();
  const storageLayout = ensureAppStorageStructure();
  await backupService.checkAndHandleIncompleteRestore();
  getDb();
  pdfImportService.init({ userDataDir: app.getPath('userData') });
  licenseService.setLogger(logMainProcessEvent);
  const bootRuntime = getRuntimeContext();
  const developerModeInfo = licenseService.getDeveloperModeInfo();
  logMainProcessEvent('bootstrap:runtime-info', {
    ...buildAppIdentitySnapshot(),
    runtime_context: bootRuntime,
    resolved_user_data_path: getResolvedUserDataPath(),
    storage_layout: storageLayout,
    database_path: getDbPath(),
    backup_path: backupService.getEffectiveBackupDir(),
    license_path: licenseService.getLicenseFilePath(),
    developer_mode: developerModeInfo,
    preload_path: getPreloadPath(),
    preload_exists: fs.existsSync(getPreloadPath()),
    renderer: getRendererAssetInfo(),
  });
  if (developerModeInfo.enabled) {
    logMainProcessEvent('bootstrap:developer-license-bypass', {
      appVariant: bootRuntime.appVariant,
      isDev: bootRuntime.isDev,
      isDemo: bootRuntime.isDemo,
      isProduction: bootRuntime.isProduction,
      source: developerModeInfo.source,
      configPath: developerModeInfo.configPath,
      message: developerModeInfo.source === 'development-variant'
        ? 'DEV MODE - license bypass attivo'
        : 'Developer machine whitelist attiva',
    });
  }
  if (variantConfig.variant === 'demo') {
    demoService.ensureDemoInitialized();
  }
  backupService.setLogger(logMainProcessEvent);
  diagnosticsService.setLogger(logMainProcessEvent);
  pdfImportService.setLogger(logMainProcessEvent);
  const dbModule = require('./db');
  dbModule.setLogger(logMainProcessEvent);
  dbModule.bootstrapIntegrityChecks(async (result) => {
    logMainProcessEvent('db:integrity-warning', result);
    const detail = [
      'Il controllo integrita del database ha rilevato possibili problemi.',
      '',
      ...(result.messages || []).map((message) => `- ${message}`),
      '',
      `Database: ${getDbPath()}`,
      `Backup: ${backupService.getEffectiveBackupDir()}`,
      '',
      'Si consiglia di ripristinare un backup valido prima di proseguire.',
    ].join('\n');

    const response = await dialog.showMessageBox({
      type: 'warning',
      title: 'Controllo integrita database',
      message: 'Possibile corruzione del database rilevata',
      detail,
      buttons: ['Apri cartella backup', 'Continua'],
      defaultId: 0,
      cancelId: 1,
    });

    if (response.response === 0) {
      try {
        await backupService.openBackupDirectory();
      } catch (error) {
        logMainProcessEvent('db:integrity-warning-open-backup-failed', {
          message: error?.message || String(error),
        });
      }
    }
  });
  await backupService.maybeRunAutomaticBackup();
  logMainProcessEvent('bootstrap:license-config', licenseService.getPublicKeyInfo());
  await licenseService.bootstrapLicenseMonitoring();

  ipcMain.handle('dashboard:summary', async () => dashboardRepo.getDashboardSummary());
  ipcMain.handle('license:getStatus', async () => licenseService.getLicenseStatus());
  ipcMain.handle('license:activate', async (_, activationCode) => {
    const result = licenseService.activate(activationCode);
    try { authService.audit('license:activate', 'license', null, {}); } catch {}
    return result;
  });
  ipcMain.handle('license:verify', async () => licenseService.verifyLicense({ reason: 'manual-ipc' }));
  ipcMain.handle('license:deactivate', async () => {
    const result = licenseService.deactivate();
    try { authService.audit('license:deactivate', 'license', null, {}); } catch {}
    return result;
  });
  ipcMain.handle('license:getActivationRequest', async () => licenseService.createActivationRequest());

  // Auth
  ipcMain.handle('auth:hasUsers', async () => {
    const hasUsers = authService.getUserCount() > 0;
    logMainProcessEvent('auth:hasUsers', { hasUsers });
    return hasUsers;
  });
  ipcMain.handle('auth:getLoginHints', async () => {
    const hints = authService.getLoginHints();
    logMainProcessEvent('auth:getLoginHints', {
      activeUsersCount: Array.isArray(hints?.active_users) ? hints.active_users.length : 0,
      hasLastUsername: Boolean(hints?.last_username),
      superAdminEnabled: Boolean(hints?.super_admin_enabled),
    });
    return hints;
  });
  ipcMain.handle('auth:login', async (_, credentials) => {
    logMainProcessEvent('auth:login:start', {
      username: credentials?.username || null,
    });
    const user = authService.login(credentials.username, credentials.password);
    logMainProcessEvent('auth:login:end', {
      username: user?.username || null,
      currentUserPresent: Boolean(user),
    });
    return user;
  });
  ipcMain.handle('auth:loginSuperAdmin', async (_, password) => {
    logMainProcessEvent('auth:loginSuperAdmin:start', {});
    const user = authService.loginSuperAdmin(password);
    logMainProcessEvent('auth:loginSuperAdmin:end', {
      currentUserPresent: Boolean(user),
    });
    return user;
  });
  ipcMain.handle('auth:logout', async () => {
    logMainProcessEvent('auth:logout:start', {
      currentUserPresent: Boolean(authService.getCurrentUser()),
    });
    authService.logout();
    logMainProcessEvent('auth:logout:end', {
      currentUserPresent: Boolean(authService.getCurrentUser()),
    });
  });
  ipcMain.handle('auth:getCurrentUser', async () => {
    const currentUser = authService.getCurrentUser();
    logMainProcessEvent('auth:getCurrentUser', {
      currentUserPresent: Boolean(currentUser),
    });
    return currentUser;
  });
  ipcMain.handle('auth:createFirstAdmin', async (_, payload) => {
    const hasUsers = authService.getUserCount() > 0;
    logMainProcessEvent('auth:createFirstAdmin:start', {
      hasUsers,
      username: payload?.username || null,
    });
    if (hasUsers) {
      logMainProcessEvent('auth:createFirstAdmin:blocked', {
        hasUsers: true,
        reason: 'already-created',
      });
      throw new Error('Amministratore già creato.');
    }
    const user = authService.createUser({ ...payload, role: 'admin' });
    try { authService.audit('users:create_first_admin', 'user', user.id, { username: user.username }); } catch {}
    logMainProcessEvent('auth:createFirstAdmin:end', {
      hasUsers: true,
      currentUserPresent: Boolean(authService.getCurrentUser()),
      userId: user?.id || null,
    });
    return user;
  });

  // Users (admin only)
  ipcMain.handle('users:list', async () => { authService.requireAdmin(); return authService.listUsers(); });
  ipcMain.handle('users:create', async (_, payload) => {
    authService.requireAdmin();
    const user = authService.createUser(payload);
    try { authService.audit('users:create', 'user', user.id, { username: payload.username, role: payload.role }); } catch {}
    return user;
  });
  ipcMain.handle('users:update', async (_, id, payload) => {
    authService.requireAdmin();
    authService.updateUser(id, payload);
    try { authService.audit('users:update', 'user', id, payload); } catch {}
  });
  ipcMain.handle('users:disable', async (_, id) => {
    authService.requireAdmin();
    authService.disableUser(id);
    try { authService.audit('users:disable', 'user', id, {}); } catch {}
  });
  ipcMain.handle('users:enable', async (_, id) => {
    authService.requireAdmin();
    authService.enableUser(id);
    try { authService.audit('users:enable', 'user', id, {}); } catch {}
  });
  ipcMain.handle('users:resetPassword', async (_, id, newPassword) => {
    authService.requireSuperAdmin();
    logMainProcessEvent('users:reset-password:start', { targetUserId: id });
    authService.changePassword(id, newPassword);
    try { authService.audit('users:reset_password', 'user', id, {}); } catch {}
    logMainProcessEvent('users:reset-password:end', { targetUserId: id });
  });
  ipcMain.handle('users:changeOwnPassword', async (_, newPassword) => {
    authService.requireAuth();
    authService.changeOwnPassword(newPassword);
    const currentUser = authService.getCurrentUser();
    try { authService.audit('users:change_own_password', 'user', currentUser?.userId || null, {}); } catch {}
    logMainProcessEvent('users:change-own-password:end', {
      currentUserPresent: Boolean(currentUser),
      userId: currentUser?.userId || null,
    });
  });
  ipcMain.handle('users:changeManagedPassword', async (_, id, newPassword) => {
    authService.requireAdmin();
    logMainProcessEvent('users:change-managed-password:start', { targetUserId: id });
    authService.changeManagedUserPassword(id, newPassword);
    try { authService.audit('users:change_password', 'user', id, {}); } catch {}
    logMainProcessEvent('users:change-managed-password:end', { targetUserId: id });
  });
  ipcMain.handle('users:getAuditLogs', async (_, options) => {
    authService.requireAdmin();
    return authService.getAuditLogs(options);
  });

  ipcMain.handle('appRuntime:getInfo', async () => buildAppRuntimeInfo());
  ipcMain.handle('appRuntime:getAvailableYears', async () => buildAvailableYears());
  ipcMain.handle('operations:getActiveJobs', async () => getActiveOperationsSnapshot());
  ipcMain.handle('operations:cancel', async (_, type) => {
    const normalizedType = String(type || '').trim();
    const active = activeOperationControllers.get(normalizedType);
    if (!active) {
      return { canceled: false, message: 'Nessuna importazione in corso.' };
    }

    logMainProcessEvent(`operation:${normalizedType}:cancel-requested`, {
      type: normalizedType,
      job_id: active.job_id,
    });
    resetOperationLock(normalizedType, 'cancel-request');
    return { canceled: true, message: 'Importazione annullata' };
  });
  ipcMain.handle('operations:reset', async (_, type, reason = 'renderer-reset') => {
    const normalizedType = String(type || '').trim();
    if (!normalizedType) {
      return { reset: false, message: 'Tipo operazione mancante.' };
    }
    const running = activeOperations.get(normalizedType);
    const active = activeOperationControllers.get(normalizedType);
    if (!running && !active) {
      return { reset: false, message: 'Nessun lock attivo.' };
    }
    return resetOperationLock(normalizedType, reason);
  });
  if (variantConfig.variant === 'demo') {
    ipcMain.handle('demo:markWelcomeSeen', async () => demoService.markWelcomeSeen());
    ipcMain.handle('demo:reset', async () => demoService.resetDemoData());
  }

  ipcMain.handle('settings:get', async () => settingsService.buildSettingsSummary());
  ipcMain.handle('settings:save', async (_, payload) => {
    requireWritableLicense('La modifica delle impostazioni operative');
    const result = settingsService.buildSettingsSummary(settingsService.saveSettings(payload));
    try { authService.audit('settings:save', 'settings', null, {}); } catch {}
    return result;
  });
  ipcMain.handle('settings:unlockAdmin', async (_, pin) => settingsService.buildSettingsSummary(settingsService.unlockAdmin(pin)));
  ipcMain.handle('settings:setRole', async (_, role) => settingsService.buildSettingsSummary(settingsService.setCurrentRole(role)));
  ipcMain.handle('settings:chooseBackupDirectory', async () => {
    requireWritableLicense('La modifica delle impostazioni operative');
    const result = await settingsService.chooseBackupDirectory(mainWindow);
    return result.canceled ? result : { ...result, settings: settingsService.buildSettingsSummary(result.settings) };
  });
  ipcMain.handle('settings:uploadLogo', async () => {
    requireWritableLicense('La modifica delle impostazioni operative');
    const result = await settingsService.uploadCompanyLogo(mainWindow);
    return result.canceled ? result : { ...result, settings: settingsService.buildSettingsSummary(result.settings) };
  });
  ipcMain.handle('settings:chooseLogoFile', async () => settingsService.chooseCompanyLogoFile(mainWindow));
  ipcMain.handle('settings:uploadMarkerAsset', async () => {
    requireWritableLicense('La modifica delle impostazioni operative');
    return settingsService.uploadMarkerAsset(mainWindow);
  });
  ipcMain.handle('settings:removeLogo', async () => {
    requireWritableLicense('La modifica delle impostazioni operative');
    return settingsService.buildSettingsSummary(settingsService.removeCompanyLogo());
  });
  ipcMain.handle('diagnostics:generateReport', async () => {
    try {
      return diagnosticsService.generateReport();
    } catch (error) {
      logMainProcessEvent('diagnostics:generate-error', {
        message: error?.message || String(error),
      });
      throw error;
    }
  });
  ipcMain.handle('diagnostics:logRendererError', async (_, payload = {}) => {
    return diagnosticsService.logRendererError({
      ...payload,
      timestamp: payload.timestamp || new Date().toISOString(),
    });
  });

  ipcMain.handle('backups:list', async () => backupService.listBackups());
  ipcMain.handle('backups:create', async (_, type) => {
    settingsService.requireAdmin();
    const result = await backupService.createBackup(type || 'manual');
    try { authService.audit('backup:create', 'backup', null, { type: type || 'manual' }); } catch {}
    return result;
  });
  ipcMain.handle('backups:openDirectory', async () => backupService.openBackupDirectory());
  ipcMain.handle('backups:chooseRestore', async () => {
    const result = await backupService.chooseRestoreBackup(mainWindow);
    if (result.canceled || !result.filePaths?.length) {
      return { canceled: true };
    }

    const backupDir = result.filePaths[0];
    return {
      canceled: false,
      backupDir,
      validation: backupService.validateBackup(backupDir),
    };
  });
  ipcMain.handle('backups:restore', async (_, backupDir) => {
    requireWritableLicense('Il ripristino dei backup');
    if (!backupDir || typeof backupDir !== 'string') {
      throw new Error('Percorso backup non valido.');
    }
    const resolvedBackupDir = path.resolve(backupDir);
    const effectiveRoot = path.resolve(backupService.getEffectiveBackupDir());
    if (!resolvedBackupDir.startsWith(effectiveRoot + path.sep)) {
      throw new Error('La cartella di ripristino deve trovarsi nella directory backup configurata.');
    }
    closeDb();
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      const result = await backupService.restoreBackup(resolvedBackupDir);
      const integrity = dbModule.runIntegrityCheck();
      if (!integrity.ok) {
        throw new Error(
          `Ripristino eseguito ma il controllo integrita del database ha rilevato problemi.\n\n` +
          `${(integrity.messages || []).join('\n')}\n\n` +
          `Backup sicurezza pre-restore: ${result.pre_restore_backup_dir || 'non disponibile'}`
        );
      }
      if (!app.isPackaged) {
        await dialog.showMessageBox({
          type: 'info',
          title: 'Ripristino completato',
          message: "Ripristino completato. In modalita sviluppo riavvia manualmente l'app.",
          buttons: ['OK'],
        });
        setTimeout(() => {
          app.exit(0);
        }, 150);
        return {
          ...result,
          relaunching: false,
          dev_manual_restart_required: true,
          message: "Ripristino completato. In modalita sviluppo riavvia manualmente l'app.",
        };
      }

      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 300);
      return {
        ...result,
        relaunching: true,
      };
    } catch (err) {
      getDb();
      throw err;
    }
  });

  ipcMain.handle('employees:list', async (_, options) => {
    const startedAt = Date.now();
    logMainProcessEvent('employees:list:start', { includeDeleted: !!options?.includeDeleted });
    const result = employeeRepo.listEmployees(options);
    logMainProcessEvent('employees:list:end', {
      includeDeleted: !!options?.includeDeleted,
      count: Array.isArray(result) ? result.length : 0,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  });
  ipcMain.handle('employees:listBasicForAttendance', async (_, options) => {
    const startedAt = Date.now();
    logMainProcessEvent('employees:listBasicForAttendance:start', { includeDeleted: !!options?.includeDeleted });
    const result = employeeRepo.listBasicEmployeesForAttendance(options);
    logMainProcessEvent('employees:listBasicForAttendance:end', {
      includeDeleted: !!options?.includeDeleted,
      count: Array.isArray(result) ? result.length : 0,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  });
  ipcMain.handle('employees:listBasic', async (_, options) => {
    const startedAt = Date.now();
    logMainProcessEvent('employees:listBasic:start', {
      includeDeleted: !!options?.includeDeleted,
      includePeriods: options?.includePeriods !== false,
      includeTeamHistory: !!options?.includeTeamHistory,
      includeHireDocFlag: !!options?.includeHireDocFlag,
    });
    const result = employeeRepo.listBasicEmployees(options);
    logMainProcessEvent('employees:listBasic:end', {
      includeDeleted: !!options?.includeDeleted,
      includePeriods: options?.includePeriods !== false,
      includeTeamHistory: !!options?.includeTeamHistory,
      includeHireDocFlag: !!options?.includeHireDocFlag,
      count: Array.isArray(result) ? result.length : 0,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  });
  ipcMain.handle('employees:getById', async (_, id, options) => {
    const startedAt = Date.now();
    logMainProcessEvent('employees:getById:start', { id: Number(id), includeDeleted: !!options?.includeDeleted });
    const result = employeeRepo.getEmployeeById(id, options);
    logMainProcessEvent('employees:getById:end', {
      id: Number(id),
      includeDeleted: !!options?.includeDeleted,
      found: !!result,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  });
  ipcMain.handle('employees:findHistoryMatches', async (_, criteria) =>
    employeeRepo.findEmployeeHistoryMatches(criteria)
  );
  ipcMain.handle('employees:create', async (_, payload) => {
    requireWritableLicense("L'aggiunta di nuovi dipendenti");
    const result = employeeRepo.createEmployee(payload);
    try { authService.audit('employee:create', 'employee', result?.id, { name: (payload?.first_name || '') + ' ' + (payload?.last_name || '') }); } catch {}
    return result;
  });
  ipcMain.handle('employees:update', async (_, id, payload) => {
    requireWritableLicense('La modifica dei dipendenti');
    const startedAt = Date.now();
    logMainProcessEvent('employees:update:start', { id: Number(id) });
    const result = employeeRepo.updateEmployee(id, payload);
    logMainProcessEvent('employees:update:end', {
      id: Number(id),
      duration_ms: Date.now() - startedAt,
    });
    try { authService.audit('employee:update', 'employee', id, {}); } catch {}
    return result;
  });
  ipcMain.handle('employees:archive', async (_, id) => {
    requireWritableLicense('La modifica dei dipendenti');
    const startedAt = Date.now();
    logMainProcessEvent('employees:archive:start', { id: Number(id) });
    const result = employeeRepo.archiveEmployee(id);
    logMainProcessEvent('employees:archive:end', {
      id: Number(id),
      duration_ms: Date.now() - startedAt,
    });
    try { authService.audit('employee:archive', 'employee', id, {}); } catch {}
    return result;
  });
  ipcMain.handle('employees:bulkArchive', async (_, ids = []) => {
    requireWritableLicense('La modifica dei dipendenti');
    const requestedCount = Array.isArray(ids) ? ids.length : 0;
    logMainProcessEvent('employees:bulk-archive:start', {
      requested_count: requestedCount,
    });
    try {
      const result = employeeRepo.bulkArchiveEmployees(ids);
      logMainProcessEvent('employees:bulk-archive:end', result);
      return result;
    } catch (error) {
      logMainProcessEvent('employees:bulk-archive:error', {
        requested_count: requestedCount,
        message: error?.message || String(error),
      });
      throw error;
    }
  });
  ipcMain.handle('employees:restore', async (_, id) => {
    requireWritableLicense('La modifica dei dipendenti');
    const startedAt = Date.now();
    logMainProcessEvent('employees:restore:start', { id: Number(id) });
    const result = employeeRepo.restoreEmployee(id);
    logMainProcessEvent('employees:restore:end', {
      id: Number(id),
      duration_ms: Date.now() - startedAt,
    });
    return result;
  });
  ipcMain.handle('employees:uploadHireDocument', async (_, employeeId) => {
    requireWritableLicense('La modifica dei dipendenti');
    return employeeRepo.uploadHireDocument(mainWindow, employeeId);
  });
  ipcMain.handle('employees:uploadHireDocumentForPeriod', async (_, employeeId, employmentPeriodId) => {
    requireWritableLicense('La modifica dei dipendenti');
    return employeeRepo.uploadHireDocumentForEmploymentPeriod(mainWindow, employeeId, employmentPeriodId);
  });
  ipcMain.handle('employees:openHireDocument', async (_, employeeId) =>
    employeeRepo.openHireDocument(employeeId)
  );
  ipcMain.handle('employees:openHireDocumentForPeriod', async (_, employeeId, employmentPeriodId) =>
    employeeRepo.openHireDocumentForEmploymentPeriod(employeeId, employmentPeriodId)
  );
  ipcMain.handle('employees:deleteHireDocument', async (_, employeeId) => {
    requireWritableLicense('La modifica dei dipendenti');
    return employeeRepo.deleteHireDocument(employeeId);
  });
  ipcMain.handle('employees:deleteHireDocumentForPeriod', async (_, employeeId, employmentPeriodId) => {
    requireWritableLicense('La modifica dei dipendenti');
    return employeeRepo.deleteHireDocumentForEmploymentPeriod(employeeId, employmentPeriodId);
  });
  ipcMain.handle('employees:uploadArt37Document', async (_, employeeId) => {
    requireWritableLicense('La modifica dei dipendenti');
    return employeeRepo.uploadArt37Document(mainWindow, employeeId);
  });
  ipcMain.handle('employees:openArt37Document', async (_, employeeId) =>
    employeeRepo.openArt37Document(employeeId)
  );
  ipcMain.handle('employees:deleteArt37Document', async (_, employeeId) => {
    requireWritableLicense('La modifica dei dipendenti');
    return employeeRepo.deleteArt37Document(employeeId);
  });
  ipcMain.handle('employees:uploadMedicalVisitDocument', async (_, employeeId) => {
    requireWritableLicense('La modifica dei dipendenti');
    return employeeRepo.uploadMedicalVisitDocument(mainWindow, employeeId);
  });
  ipcMain.handle('employees:openMedicalVisitDocument', async (_, employeeId) =>
    employeeRepo.openMedicalVisitDocument(employeeId)
  );
  ipcMain.handle('employees:deleteMedicalVisitDocument', async (_, employeeId) => {
    requireWritableLicense('La modifica dei dipendenti');
    return employeeRepo.deleteMedicalVisitDocument(employeeId);
  });
  ipcMain.handle('occupations:list', async () => occupationRepo.listOccupations());
  ipcMain.handle('occupations:create', async (_, name) => {
    requireWritableLicense('La modifica delle impostazioni operative');
    return occupationRepo.ensureOccupation(name);
  });

  ipcMain.handle('teams:list', async (_, options) => {
    const startedAt = Date.now();
    logMainProcessEvent('teams:list:start', { includeArchived: !!options?.includeArchived });
    const result = teamsRepo.listTeams(options);
    logMainProcessEvent('teams:list:end', {
      includeArchived: !!options?.includeArchived,
      count: Array.isArray(result) ? result.length : 0,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  });
  ipcMain.handle('teams:getById', async (_, id, options) => {
    const startedAt = Date.now();
    logMainProcessEvent('teams:getById:start', { id: Number(id), includeArchived: !!options?.includeArchived });
    const result = teamsRepo.getTeamById(id, options);
    logMainProcessEvent('teams:getById:end', {
      id: Number(id),
      includeArchived: !!options?.includeArchived,
      found: !!result,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  });
  ipcMain.handle('teams:create', async (_, payload) => {
    requireWritableLicense('La modifica delle squadre');
    return teamsRepo.createTeam(payload);
  });
  ipcMain.handle('teams:update', async (_, id, payload) => {
    requireWritableLicense('La modifica delle squadre');
    const teamId = Number(id);
    const startedAt = Date.now();
    const previousTeam = teamsRepo.getTeamById(teamId, { includeArchived: true });
    const previousMemberIds = new Set((previousTeam?.members || []).map((member) => Number(member.employee_id)));
    const nextMembers = Array.isArray(payload?.members) ? payload.members : [];
    const nextMemberIds = new Set(nextMembers.map((member) => Number(member.employee_id)).filter(Number.isFinite));
    const addedCount = [...nextMemberIds].filter((memberId) => !previousMemberIds.has(memberId)).length;
    const removedCount = [...previousMemberIds].filter((memberId) => !nextMemberIds.has(memberId)).length;
    logMainProcessEvent('teams:updateMembers:start', {
      teamId,
      previous_count: previousMemberIds.size,
      next_count: nextMemberIds.size,
      addedCount,
      removedCount,
    });
    const result = teamsRepo.updateTeam(teamId, payload);
    logMainProcessEvent('teams:updateMembers:end', {
      teamId,
      previous_count: previousMemberIds.size,
      next_count: nextMemberIds.size,
      addedCount,
      removedCount,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  });
  ipcMain.handle('teams:archive', async (_, id) => {
    requireWritableLicense('La modifica delle squadre');
    return teamsRepo.archiveTeam(id);
  });
  ipcMain.handle('teams:restore', async (_, id) => {
    requireWritableLicense('La modifica delle squadre');
    return teamsRepo.restoreTeam(id);
  });
  ipcMain.handle('employees:deletePermanently', async (_, id) => {
    requireWritableLicense('La modifica dei dipendenti');
    const result = employeeRepo.deleteEmployeePermanently(id);
    try { authService.audit('employee:delete', 'employee', id, {}); } catch {}
    return result;
  });
  ipcMain.handle('employees:bulkDelete', async (_, ids = []) => {
    requireWritableLicense('La modifica dei dipendenti');
    const requestedCount = Array.isArray(ids) ? ids.length : 0;
    logMainProcessEvent('employees:bulk-delete:start', {
      requested_count: requestedCount,
    });
    try {
      const result = employeeRepo.bulkDeleteEmployees(ids);
      logMainProcessEvent('employees:bulk-delete:end', result);
      return result;
    } catch (error) {
      logMainProcessEvent('employees:bulk-delete:error', {
        requested_count: requestedCount,
        message: error?.message || String(error),
        code: error?.code || null,
      });
      throw error;
    }
  });
  ipcMain.handle('teams:deletePermanently', async (_, id) => {
    requireWritableLicense('La modifica delle squadre');
    return teamsRepo.deleteTeamPermanently(id);
  });

  ipcMain.handle('employees:parsePdfImport', async (_, options = {}) => {
    return runExclusiveOperation({
      type: 'pdf-import',
      startMessage: 'Preparazione import PDF...',
      fn: async (progress, operationJobId, signal) => {
        logMainProcessEvent('employees:pdf-import:started', {
          job_id: operationJobId,
          target_year: getTargetYear(options),
        });
        progress({
          status: 'running',
          step: 'file_read',
          percent: 5,
          message: 'Seleziona il file PDF da importare...',
          concurrent_error_message: "Importazione PDF già in corso. Attendi il completamento prima di avviarne un'altra.",
        });
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
          title: 'Seleziona PDF assunzioni',
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
          properties: ['openFile'],
        });
        if (canceled || !filePaths[0]) {
          logMainProcessEvent('employees:pdf-import:cancelled', {
            job_id: operationJobId,
            stage: 'file_dialog',
          });
          emitOperationProgress({
            type: 'pdf-import',
            status: 'idle',
            job_id: `pdf-import-cancel-${Date.now()}`,
          });
          return { canceled: true };
        }
        if (signal.aborted) {
          logMainProcessEvent('employees:pdf-import:cancelled', {
            job_id: operationJobId,
            stage: 'after_file_dialog',
          });
          return { canceled: true };
        }

        progress({
          status: 'running',
          step: 'file_read',
          percent: 12,
          message: `Lettura file: ${path.basename(filePaths[0])}`,
          file_path: filePaths[0],
        });

        let records;
        try {
          records = await pdfImportService.parsePdfAssunzioniWithProgress(filePaths[0], {
            onProgress: progress,
            signal,
          });
        } catch (error) {
          logMainProcessEvent('employees:pdf-import:parse-result', {
            job_id: operationJobId,
            error_code: error?.code || '',
            detected_model: error?.detected_model || '',
            records_length: 0,
            text_length: error?.text_length || 0,
            ocr_attempted: !!error?.ocr_attempted,
            ocr_available: !!error?.ocr_available,
            ocr_enabled: !!error?.ocr_enabled,
            ocr_error: error?.ocr_error || error?.message || String(error),
            ocr_text_length: error?.ocr_text_length || 0,
            fallback_used: !!error?.fallback_used,
            reason: error?.reason || '',
            tessdata_path: error?.tessdataPath || '',
            tessdata_source: error?.tessdata_source || '',
          });
          if (pdfImportService.isAbortError(error) || signal.aborted) {
            logMainProcessEvent('employees:pdf-import:cancelled', {
              job_id: operationJobId,
              stage: 'parse_or_ocr',
            });
            return { canceled: true };
          }
          const canTryOnlineAfterLocalFailure = [
            'OCR_REQUIRED',
            'OCR_UNAVAILABLE',
            'OCR_NO_RECORDS',
          ].includes(error?.code) || String(error?.message || '').includes('OCR');
          if (canTryOnlineAfterLocalFailure) {
            const currentSettings = settingsService.getSettings();
            if (currentSettings?.ocr?.online_fallback_enabled) {
              const onlineParse = await parseWithOcrSpaceFallback(filePaths[0], currentSettings, operationJobId);
              if (onlineParse?.records?.length > 0) {
                records = onlineParse.records;
              } else if (onlineParse) {
                const onlineError = new Error(
                  onlineParse.text_length > 0
                    ? 'OCR online eseguito ma nessun lavoratore riconosciuto.'
                    : 'OCR online completato ma non ha restituito testo leggibile.'
                );
                onlineError.code = 'OCR_NO_RECORDS';
                throw onlineError;
              }
            }
          }
          if (!Array.isArray(records)) {
            if (error?.code === 'OCR_REQUIRED' || String(error?.message || '').includes('PDF scansionato')) {
              const readableError = new Error(
                error?.message || 'PDF scansionato: per leggerlo serve OCR. Installa/abilita dati OCR oppure inserisci manualmente.'
              );
              readableError.code = 'OCR_REQUIRED';
              throw readableError;
            }
            if (error?.code === 'OCR_UNAVAILABLE' || String(error?.message || '').includes('OCR non disponibile')) {
              throw new Error('OCR non disponibile su questo sistema');
            }
            throw new Error(`PDF non leggibile o parsing fallito. ${error?.message || error}`);
          }
        }
        let parseDiagnostics = records?.importDiagnostics || {};
        logMainProcessEvent('employees:pdf-import:parse-result', {
          job_id: operationJobId,
          detected_model: parseDiagnostics.detected_model || '',
          records_length: Array.isArray(records) ? records.length : 0,
          text_length: parseDiagnostics.text_length || 0,
          ocr_attempted: !!parseDiagnostics.ocr_attempted,
          ocr_available: !!parseDiagnostics.ocr_available,
          ocr_enabled: !!parseDiagnostics.ocr_enabled,
          ocr_error: parseDiagnostics.ocr_error || '',
          ocr_text_length: parseDiagnostics.ocr_text_length || 0,
          fallback_used: !!parseDiagnostics.fallback_used,
          reason: parseDiagnostics.reason || '',
          tessdata_path: parseDiagnostics.tessdata_path || '',
          tessdata_source: parseDiagnostics.tessdata_source || '',
        });
        if (shouldOfferOnlineOcrFallback(records, parseDiagnostics)) {
          const currentSettings = settingsService.getSettings();
          if (currentSettings?.ocr?.online_fallback_enabled) {
            const localRecordCount = Array.isArray(records) ? records.length : 0;
            try {
              const onlineParse = await parseWithOcrSpaceFallback(filePaths[0], currentSettings, operationJobId);
              if (onlineParse) {
                if (onlineParse.records.length > localRecordCount) {
                  records = onlineParse.records;
                  parseDiagnostics = onlineParse.diagnostics;
                } else if (!Array.isArray(records) || records.length === 0) {
                  const onlineError = new Error(
                    onlineParse.text_length > 0
                      ? 'OCR online eseguito ma nessun lavoratore riconosciuto.'
                      : 'OCR online completato ma non ha restituito testo leggibile.'
                  );
                  onlineError.code = 'OCR_NO_RECORDS';
                  throw onlineError;
                }
              }
            } catch (error) {
              if (!Array.isArray(records) || records.length === 0) {
                throw error;
              }
              parseDiagnostics = {
                ...parseDiagnostics,
                fallback_used: true,
                ocr_online_error: error?.message || String(error),
              };
            }
          }
          if (Array.isArray(records) && records.length === 0) {
            const message = parseDiagnostics.ocr_text_length > 0
              ? 'OCR eseguito ma nessun lavoratore riconosciuto.'
              : parseDiagnostics.ocr_error
              ? `OCR non riuscito: ${parseDiagnostics.ocr_error}`
              : 'OCR eseguito ma nessun testo leggibile nel PDF.';
            const noRecordsError = new Error(message);
            noRecordsError.code = 'OCR_NO_RECORDS';
            throw noRecordsError;
          }
        }
        if (signal.aborted) {
          logMainProcessEvent('employees:pdf-import:ignored-after-cancel', {
            job_id: operationJobId,
            stage: 'after_parse',
            record_count: Array.isArray(records) ? records.length : 0,
          });
          return { canceled: true };
        }

        const enriched = pdfImportService.checkDuplicates(records, {
          targetYear: getTargetYear(options),
          onProgress: progress,
        });
        const importDiagnostics = {
          ...parseDiagnostics,
          records_length: enriched.length,
          records_ready_count: enriched.filter((record) =>
            record.status === 'pronto' || record.status === 'nuovo_rapporto_datore'
          ).length,
          records_to_fix_count: enriched.filter((record) =>
            record.status === 'da_correggere' || record.status === 'duplicato'
          ).length,
        };
        if (signal.aborted) {
          logMainProcessEvent('employees:pdf-import:ignored-after-cancel', {
            job_id: operationJobId,
            stage: 'after_duplicate_check',
            record_count: enriched.length,
          });
          return { canceled: true };
        }
        const pdfEmployer = enriched.find((record) => record.pdf_employer?.name || record.pdf_employer?.tax_id)?.pdf_employer
          || { name: '', tax_id: '', workplace: '' };
        const employerResolution = settingsService.resolvePdfEmployer(pdfEmployer);
        const rowsWithResolvedEmployer = employerResolution.employer_short_name
          ? enriched.map((record) => ({
              ...record,
              hired_by_detected: record.hired_by_detected || employerResolution.employer_short_name,
              hired_by: record.hired_by || record.hired_by_detected || employerResolution.employer_short_name,
            }))
          : enriched;
        const resolvedRows = employerResolution.employer_short_name
          ? pdfImportService.checkDuplicates(rowsWithResolvedEmployer, {
              targetYear: getTargetYear(options),
            })
          : rowsWithResolvedEmployer;
        progress({
          status: 'running',
          step: 'duplicate_check',
          percent: 96,
          message: 'Controllo duplicati completato.',
          record_count: resolvedRows.length,
        });
        logMainProcessEvent('employees:pdf-import:completed', {
          job_id: operationJobId,
          file_path: filePaths[0],
          record_count: resolvedRows.length,
        });
        return {
          canceled: false,
          filePath: filePaths[0],
          records: resolvedRows,
          pdfEmployer,
          employerResolution,
          importDiagnostics: {
            ...importDiagnostics,
            records_length: resolvedRows.length,
            records_ready_count: resolvedRows.filter((record) =>
              record.status === 'pronto' || record.status === 'nuovo_rapporto_datore'
            ).length,
            records_to_fix_count: resolvedRows.filter((record) =>
              record.status === 'da_correggere' || record.status === 'duplicato'
            ).length,
          },
        };
      },
    });
  });

  ipcMain.handle('employees:evaluatePdfImportRows', async (_, { rows, targetYear }) => {
    return pdfImportService.checkDuplicates(Array.isArray(rows) ? rows : [], {
      targetYear: Number(targetYear) || new Date().getFullYear(),
    });
  });

  ipcMain.handle('employees:runOcrOnlineImport', async (_, payload = {}) => {
    requireWritableLicense("L'importazione di nuovi dipendenti");
    const filePath = String(payload.filePath || '').trim();
    const targetYear = Number(payload.targetYear) || new Date().getFullYear();
    if (!filePath || !fs.existsSync(filePath)) {
      const error = new Error('PDF non disponibile per OCR online.');
      error.code = 'OCR_ONLINE_FILE_MISSING';
      throw error;
    }

    const settings = settingsService.getSettings();
    if (!settings?.ocr?.online_fallback_enabled) {
      const error = new Error('OCR online non abilitato nelle Impostazioni.');
      error.code = 'OCR_ONLINE_DISABLED';
      throw error;
    }

    const onlineSettings = getOcrOnlineSettings(settings);
    if (!onlineSettings.apiKey) {
      throw createOcrOnlineError('OCR online non configurato.', 'OCR_ONLINE_NOT_CONFIGURED');
    }

    const startedAt = Date.now();
    logMainProcessEvent('ocr_online_manual_started', {
      provider: onlineSettings.provider,
      duration_ms: 0,
      text_length: 0,
    });

    try {
      const onlineResult = await runOcrSpaceFallback(filePath, settings);
      const onlineRecords = pdfImportService.parseOcrTextAssunzioni(onlineResult.text || '', {
        reason: 'ocr_online_manual_success',
      });
      const enriched = pdfImportService.checkDuplicates(onlineRecords, { targetYear });
      const diagnostics = {
        ...(onlineRecords.importDiagnostics || {}),
        fallback_used: true,
        ocr_online_used: true,
        ocr_online_manual: true,
        ocr_online_provider: onlineSettings.provider,
        records_length: enriched.length,
        records_ready_count: enriched.filter((record) =>
          record.status === 'pronto' || record.status === 'nuovo_rapporto_datore'
        ).length,
        records_to_fix_count: enriched.filter((record) =>
          record.status === 'da_correggere' || record.status === 'duplicato'
        ).length,
      };
      logMainProcessEvent('ocr_online_manual_completed', {
        provider: onlineSettings.provider,
        duration_ms: Date.now() - startedAt,
        text_length: String(onlineResult.text || '').length,
      });
      return {
        records: enriched,
        importDiagnostics: diagnostics,
      };
    } catch (error) {
      logMainProcessEvent('ocr_online_manual_failed', {
        provider: onlineSettings.provider,
        duration_ms: Date.now() - startedAt,
        text_length: 0,
      });
      throw error;
    }
  });

  ipcMain.handle('employees:resolvePdfEmployer', async (_, payload = {}) => {
    requireWritableLicense("L'importazione di nuovi dipendenti");
    const pdfEmployer = payload.pdfEmployer || {};
    const action = String(payload.action || '').trim();
    if (action === 'associate_existing') {
      const result = settingsService.savePdfEmployerMapping(pdfEmployer, payload.employerShortName);
      return settingsService.resolvePdfEmployer(pdfEmployer, result.settings);
    }
    if (action === 'create_new') {
      const result = settingsService.createEmployerFromPdfEmployer(pdfEmployer);
      return settingsService.resolvePdfEmployer(pdfEmployer, result.settings);
    }
    throw new Error('Azione di risoluzione datore non valida.');
  });

  ipcMain.handle('employees:confirmPdfImport', async (_, { filePath, rows }) => {
    requireWritableLicense("L'importazione di nuovi dipendenti");
    return runExclusiveOperation({
      type: 'pdf-import',
      startMessage: 'Importazione dipendenti in corso...',
      fn: async (progress) => {
        progress({
          status: 'running',
          step: 'backup_pre_import',
          percent: 8,
          message: 'Creazione backup di sicurezza pre-import...',
          concurrent_error_message: "Importazione PDF già in corso. Attendi il completamento prima di avviarne un'altra.",
        });
        backupService.createOperationSafetyBackup('import_pdf');
        const reclassifiedRows = pdfImportService.checkDuplicates(Array.isArray(rows) ? rows : [], {
          targetYear: Number(Array.isArray(rows) && rows[0]?.target_year) || new Date().getFullYear(),
        });
        const selectedRows = reclassifiedRows.filter(
          (row) => row.selected && (row.status === 'pronto' || row.status === 'nuovo_rapporto_datore')
        );
        const results = [];
        const totalRows = Math.max(1, selectedRows.length);
        const fileFingerprint = filePath && fs.existsSync(filePath) ? hashFile(filePath) : `pdf-import-${Date.now()}`;

        for (let index = 0; index < selectedRows.length; index += 1) {
          const row = selectedRows[index];
          const datori = row.hired_by === 'entrambi' ? ['LC', 'LG'] : [row.hired_by];
          const normDate = pdfImportService.normDateToISO;
          const sourcePagesLabel = Array.isArray(row.page_numbers) && row.page_numbers.length
            ? row.page_numbers.join('-')
            : String(Number(row.page_index ?? index));
          progress({
            status: 'running',
            step: 'data_save',
            percent: 18 + Math.round((index / totalRows) * 76),
            message: `Salvataggio dati ${index + 1} di ${totalRows}: ${row.last_name || ''} ${row.first_name || ''}`.trim(),
          });
          try {
            const sourceDocumentIdBase = `${fileFingerprint}:pages:${sourcePagesLabel}`;
            if (row.import_action === 'già_presente') {
              results.push({ fiscal_code: row.fiscal_code, action: 'saltato', employee_id: row.existing_employee_id });
            } else if (!employeeRepo.isValidFiscalCode(row.fiscal_code) || !row.first_name || !row.last_name || !row.hire_date_from) {
              results.push({
                fiscal_code: row.fiscal_code,
                action: 'scartato',
                error: 'Record incompleto: nome, cognome, codice fiscale e data sono obbligatori.',
              });
            } else if (row.existing_employee_id) {
              if (row.existing_is_deleted) {
                await employeeRepo.updateEmployee(row.existing_employee_id, {
                  first_name: row.first_name,
                  last_name: row.last_name,
                  fiscal_code: row.fiscal_code?.toUpperCase() || null,
                  hire_date_from: normDate(row.hire_date_from),
                  hire_date_to: normDate(row.hire_date_to),
                  hired_by: datori[0],
                  status: 'attivo',
                });
                await employeeRepo.restoreEmployee(row.existing_employee_id);
              }
              const periodTargets = [];
              for (const datore of datori) {
                const { period, action } = employeeRepo.upsertImportedEmploymentPeriod(row.existing_employee_id, {
                  hire_date_from: normDate(row.hire_date_from),
                  hire_date_to: normDate(row.hire_date_to),
                  hired_by: datore,
                  source_document_id: `${sourceDocumentIdBase}:${datore}`,
                });
                if (action === 'already_present') {
                  continue;
                }
                periodTargets.push({
                  employmentPeriodId: period.id,
                  hiredBy: datore,
                });
              }
              if (periodTargets.length) {
                await pdfImportService.attachEmployeePages(
                  filePath,
                  row.page_numbers || row.page_index,
                  row.existing_employee_id,
                  row.first_name,
                  row.last_name,
                  periodTargets
                );
                results.push({
                  fiscal_code: row.fiscal_code,
                  action: row.import_action === 'nuovo_rapporto_datore' ? 'nuovo_rapporto_datore' : 'aggiornato',
                  employee_id: row.existing_employee_id,
                });
              } else {
                results.push({ fiscal_code: row.fiscal_code, action: 'saltato', employee_id: row.existing_employee_id });
              }
            } else {
              const emp = await employeeRepo.createEmployee({
                first_name: row.first_name,
                last_name: row.last_name,
                fiscal_code: row.fiscal_code?.toUpperCase() || null,
                hire_date_from: normDate(row.hire_date_from),
                hire_date_to: normDate(row.hire_date_to),
                hired_by: datori[0],
                status: 'attivo',
              });
              const periodTargets = [];
              const firstPeriod = (emp.employment_periods || []).find((period) => period.is_current) || emp.employment_periods?.[0];
              if (firstPeriod) {
                employeeRepo.upsertImportedEmploymentPeriod(emp.id, {
                  hire_date_from: normDate(row.hire_date_from),
                  hire_date_to: normDate(row.hire_date_to),
                  hired_by: datori[0],
                  source_document_id: `${sourceDocumentIdBase}:${datori[0]}`,
                });
                periodTargets.push({
                  employmentPeriodId: firstPeriod.id,
                  hiredBy: datori[0],
                });
              }
              if (datori.length > 1) {
                const { period: secondPeriod } = employeeRepo.upsertImportedEmploymentPeriod(emp.id, {
                  hire_date_from: normDate(row.hire_date_from),
                  hire_date_to: normDate(row.hire_date_to),
                  hired_by: datori[1],
                  source_document_id: `${sourceDocumentIdBase}:${datori[1]}`,
                });
                periodTargets.push({
                  employmentPeriodId: secondPeriod.id,
                  hiredBy: datori[1],
                });
              }
              await pdfImportService.attachEmployeePages(
                filePath,
                row.page_numbers || row.page_index,
                emp.id,
                row.first_name,
                row.last_name,
                periodTargets
              );
              results.push({ fiscal_code: row.fiscal_code, action: 'creato', employee_id: emp.id });
            }
          } catch (err) {
            results.push({ fiscal_code: row.fiscal_code, action: 'errore', error: err.message });
          }
        }
        progress({
          status: 'running',
          step: 'data_save',
          percent: 98,
          message: 'Salvataggio import completato.',
        });
        return results;
      },
    });
  });

  ipcMain.handle('communications:list', async (_, options) => communicationRepo.listCommunications(options));
  ipcMain.handle('communications:save', async (_, payload) => {
    requireWritableLicense('La modifica delle comunicazioni operative');
    const communication = communicationRepo.saveCommunication(payload);
    return persistCommunicationArtifacts(communication.id);
  });
  ipcMain.handle('communications:delete', async (_, id) => {
    requireWritableLicense('La modifica delle comunicazioni operative');
    return communicationRepo.deleteCommunication(id);
  });
  ipcMain.handle('communications:openFile', async (_, id, type) =>
    communicationRepo.openCommunicationFile(id, type)
  );
  ipcMain.handle('communications:sendEmail', async (_, id, options) => {
    requireWritableLicense('La creazione di nuove comunicazioni operative');
    await persistCommunicationArtifacts(id);
    return communicationRepo.openCommunicationEmail(id, options);
  });
  ipcMain.handle('communications:listContacts', async () => settingsService.listCommunicationEmailContacts());
  ipcMain.handle('communications:saveContact', async (_, payload) => {
    requireWritableLicense('La modifica della rubrica comunicazioni');
    return settingsService.saveCommunicationEmailContact(payload);
  });
  ipcMain.handle('communications:deleteContact', async (_, id) => {
    requireWritableLicense('La modifica della rubrica comunicazioni');
    return settingsService.deleteCommunicationEmailContact(id);
  });

  ipcMain.handle('attendance:save', async (_, payload) => {
    requireWritableLicense("L'inserimento di nuove presenze");
    return attendanceRepo.saveAttendance(payload);
  });
  ipcMain.handle('attendance:bulkUpsert', async (_, payload) => {
    const __t0 = Date.now();
    requireWritableLicense("L'inserimento di nuove presenze");
    const __tLicense = Date.now();
    const result = attendanceRepo.bulkUpsertAttendance(payload);
    const __tTx = Date.now();
    try { authService.audit('attendance:bulkUpsert', 'attendance', null, { count: payload?.length }); } catch {}
    const __tAudit = Date.now();
    const __perf = {
      entries: Array.isArray(payload) ? payload.length : 0,
      backupRan: false,
      licenseMs: __tLicense - __t0,
      backupMs: 0,
      sqliteTxMs: __tTx - __tLicense,
      auditMs: __tAudit - __tTx,
      totalMs: __tAudit - __t0,
    };
    console.info('[attendance-perf][main] attendance:bulkUpsert', __perf);
    return { ...(result || {}), __perf };
  });
  ipcMain.handle('attendance:listByMonth', async (_, year, month) => {
    const startedAt = Date.now();
    logMainProcessEvent('attendance:listByMonth:start', {
      year: Number(year),
      month: Number(month),
    });
    const result = attendanceRepo.listAttendanceByMonth(year, month);
    logMainProcessEvent('attendance:listByMonth:end', {
      year: Number(year),
      month: Number(month),
      count: Array.isArray(result) ? result.length : 0,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  });
  ipcMain.handle('attendance:monthlySummary', async (_, month) =>
    attendanceRepo.getMonthlySummary(month)
  );
  ipcMain.handle('attendance:getMatrix', async (_, month) =>
    attendanceRepo.getAttendanceMatrix(month)
  );

  ipcMain.handle('payroll:saveRecord', async (_, payload) => {
    requireWritableLicense('La creazione o modifica di report e dati economici');
    const record = payrollRepo.upsertPayrollRecord(payload);
    const importedMovementIds = Array.isArray(payload?.importedFinancialMovementIds)
      ? payload.importedFinancialMovementIds
      : [];
    if (importedMovementIds.length) {
      financialMovementsRepo.markInserted(importedMovementIds, {
        report_id: record.id,
        month: record.month,
      });
    }
    return record;
  });
  ipcMain.handle('payroll:listByEmployee', async (_, employeeId) =>
    payrollRepo.listPayrollRecordsByEmployee(employeeId)
  );
  ipcMain.handle('payroll:listHistory', async (_, options) =>
    payrollRepo.listPayrollHistory(options)
  );
  ipcMain.handle('payroll:getRecord', async (_, employeeId, month) =>
    payrollRepo.getPayrollRecord(employeeId, month)
  );
  ipcMain.handle('payroll:getPreviousBalance', async (_, employeeId, month) =>
    payrollRepo.getPreviousBalance(employeeId, month)
  );
  ipcMain.handle('payroll:uploadDocument', async (_, employeeId, month) => {
    requireWritableLicense('Il caricamento di nuove buste paga');
    return payrollRepo.uploadPayrollDocument(mainWindow, employeeId, month);
  });
  ipcMain.handle('payroll:openDocument', async (_, employeeId, month) =>
    payrollRepo.openPayrollDocument(employeeId, month)
  );
  ipcMain.handle('payroll:deleteDocument', async (_, employeeId, month) => {
    requireWritableLicense('La modifica delle buste paga');
    return payrollRepo.deletePayrollDocument(employeeId, month);
  });
  ipcMain.handle('payroll:archiveRecord', async (_, id) => {
    requireWritableLicense('La modifica dei report economici');
    return payrollRepo.archivePayrollRecord(id);
  });
  ipcMain.handle('payroll:restoreRecord', async (_, id) => {
    requireWritableLicense('La modifica dei report economici');
    return payrollRepo.restorePayrollRecord(id);
  });
  ipcMain.handle('payroll:deleteRecord', async (_, id) => {
    requireWritableLicense('La modifica dei report economici');
    return payrollRepo.deletePayrollRecord(id);
  });

  ipcMain.handle('financialMovements:list', async (_, options) =>
    financialMovementsRepo.listMovements(options)
  );
  ipcMain.handle('financialMovements:listAvailable', async (_, options) =>
    financialMovementsRepo.listAvailableForReport(options)
  );
  ipcMain.handle('financialMovements:countAvailable', async (_, employeeId) =>
    financialMovementsRepo.countAvailableForReport(employeeId)
  );
  ipcMain.handle('financialMovements:countPendingForMonth', async (_, employeeId, month) =>
    financialMovementsRepo.countPendingForMonth(employeeId, month)
  );
  ipcMain.handle('financialMovements:save', async (_, payload) => {
    requireWritableLicense('La modifica di acconti e rate');
    return financialMovementsRepo.saveMovement(payload);
  });
  ipcMain.handle('financialMovements:createManyForEmployees', async (_, payload) => {
    requireWritableLicense('La modifica di acconti e rate');
    return financialMovementsRepo.createManyForEmployees(payload);
  });
  ipcMain.handle('financialMovements:delete', async (_, id) => {
    requireWritableLicense('La modifica di acconti e rate');
    return financialMovementsRepo.deleteMovement(id);
  });
  ipcMain.handle('financialMovements:markInserted', async (_, ids, context) => {
    requireWritableLicense('La modifica di acconti e rate');
    return financialMovementsRepo.markInserted(ids, context);
  });

  ipcMain.handle('reports:savePdf', async (_, payload) => {
    requireWritableLicense('La creazione di nuovi report');
    return runExclusiveOperation({
      type: 'report-export',
      startMessage: 'Avvio generazione report...',
      fn: async (progress) => {
        const defaultFileName = payload?.fileName || 'report.pdf';
        const html = payload?.html || '';
        const landscape = !!payload?.landscape;
        const debugRenderLabel = payload?.debugRenderLabel || '';

        if (!html.trim()) {
          throw new Error('HTML report mancante');
        }

        progress({
          status: 'running',
          step: 'data_load',
          percent: 10,
          message: 'Caricamento dati report...',
          file_name: defaultFileName,
          concurrent_error_message: "Generazione report già in corso. Attendi il completamento prima di avviarne un'altra.",
        });
        progress({
          status: 'running',
          step: 'attendance_calc',
          percent: 18,
          message: 'Calcolo presenze...',
        });
        progress({
          status: 'running',
          step: 'balance_calc',
          percent: 24,
          message: 'Calcolo acconti, debiti e crediti...',
        });
        progress({
          status: 'running',
          step: 'document_generation',
          percent: 30,
          message: 'Generazione documento in corso...',
        });

        const tempPdfPath = buildTempPdfPath(defaultFileName);
        await renderPdfToFile({
          html,
          filePath: tempPdfPath,
          landscape,
          debugRenderLabel,
          onProgress: progress,
        });

        const openResult = await shell.openPath(tempPdfPath);
        if (openResult) {
          throw new Error(openResult);
        }

        return {
          canceled: false,
          preview_file_path: tempPdfPath,
        };
      },
    });
  });

  ipcMain.handle('reports:printHtml', async (_, payload) => {
    requireWritableLicense('La creazione di nuovi report');
    return runExclusiveOperation({
      type: 'report-export',
      startMessage: 'Preparazione stampa report...',
      fn: async (progress) => {
        const html = payload?.html || '';
        const landscape = !!payload?.landscape;
        const fileName = payload?.fileName || 'stampa.pdf';

        if (!html.trim()) {
          throw new Error('HTML report mancante');
        }

        progress({
          status: 'running',
          step: 'data_load',
          percent: 10,
          message: 'Caricamento dati report...',
          file_name: fileName,
          concurrent_error_message: "Generazione report già in corso. Attendi il completamento prima di avviarne un'altra.",
        });
        progress({
          status: 'running',
          step: 'attendance_calc',
          percent: 18,
          message: 'Calcolo presenze...',
        });
        progress({
          status: 'running',
          step: 'balance_calc',
          percent: 24,
          message: 'Calcolo acconti, debiti e crediti...',
        });

        return printHtmlDocument({
          html,
          landscape,
          fileName,
          onProgress: progress,
        });
      },
    });
  });

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  appendMainProcessLog('startup-failure', error);
  dialog.showErrorBox(APP_ERROR_TITLE, String(error?.message || error || 'Errore sconosciuto'));
  app.exit(1);
});

app.on('before-quit', (event) => {
  if (isQuittingAfterExitBackup) {
    return;
  }

  event.preventDefault();
  (async () => {
    try {
      await backupService.maybeRunExitBackup();
    } finally {
      isQuittingAfterExitBackup = true;
      app.quit();
    }
  })();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
