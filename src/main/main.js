const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { getAppVariant, getRuntimeContext, getVariantConfig } = require('./runtimeContext');
const { buildTeamReportData } = require('./print/buildTeamReportData');
const { buildEmployeeReportData } = require('./print/buildEmployeeReportData');
const { renderEmployeeReportHtml, renderTeamReportHtml } = require('./print/printTemplate');
const {
  closeSplashWindow,
  createSplashWindow,
  updateSplashWindowStatus,
} = require('./splashWindow');

if (!app || typeof app.whenReady !== 'function') {
  throw new Error(
    "Electron main process non disponibile. Verifica che ELECTRON_RUN_AS_NODE non sia attivo durante l'avvio dell'app."
  );
}

const variantConfig = getVariantConfig();
const USE_TEAM_REPORT_TEMPLATE = true;
const USE_EMPLOYEE_REPORT_TEMPLATE = true;
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
    shared_access: {
      read_only: !!sharedAccessState.readOnlyMode,
      lock_owned: !!sharedAccessState.lockOwned,
      lock_file_path: sharedAccessState.lockFilePath || getSharedLockFilePath(),
      lock_info: sharedAccessState.lockInfo,
      message: sharedAccessState.lockMessage || '',
      recovery_used: !!sharedAccessState.recoveryUsed,
    },
  };
}

const authService = require('./authService');
const employeeRepo = require('./employeeRepo');
const pdfImportService = require('./pdfImportService');
const attendanceRepo = require('./attendanceRepo');
const payrollRepo = require('./payrollRepo');
const financialMovementsRepo = require('./financialMovementsRepo');
const dashboardRepo = require('./dashboardRepo');
const teamPayrollRepo = require('./teamPayrollRepo');
const teamsRepo = require('./teamsRepo');
const dpiRepo = require('./dpiRepo');
const communicationRepo = require('./communicationRepo');
const occupationRepo = require('./occupationRepo');
const printDocumentsRepo = require('./printDocumentsRepo');
const settingsService = require('./settingsService');
const backupService = require('./backupService');
const diagnosticsService = require('./diagnosticsService');
const licenseService = require('./licenseService');
const demoService = require('./demoService');
const { getDb, getDbPath, closeDb, setReadOnlyMode, runIntegrityCheck } = require('./db');
const { ensureAppStorageStructure, getDocumentsDir, getUserDataRoot } = require('./storagePaths');

const runtime = getRuntimeContext();

function requireWritableLicense(actionLabel) {
  if (sharedAccessState.readOnlyMode) {
    const error = new Error(sharedAccessState.lockMessage || 'Modalità sola lettura attiva.');
    error.code = 'APP_READ_ONLY_MODE';
    throw error;
  }
  if (authService.isSuperAdmin()) {
    logMainProcessEvent('sa:license-bypass', { action: actionLabel });
    return;
  }
  return licenseService.enforceLicenseGuard(actionLabel);
}

function getMergedLicenseStatus() {
  const baseStatus = licenseService.getLicenseStatus() || {};
  if (!sharedAccessState.readOnlyMode) {
    return baseStatus;
  }

  return {
    ...baseStatus,
    is_write_blocked: true,
    block_reason: 'shared_lock_read_only',
    message: sharedAccessState.lockMessage || `Modalità sola lettura — archivio aperto su ${sharedAccessState.lockInfo?.machine || 'altro PC'}`,
    read_only_mode: true,
    shared_lock: {
      file_path: sharedAccessState.lockFilePath,
      machine: sharedAccessState.lockInfo?.machine || '',
      user: sharedAccessState.lockInfo?.user || '',
      opened_at: sharedAccessState.lockInfo?.opened_at || '',
      pid: sharedAccessState.lockInfo?.pid || null,
      recovery_used: !!sharedAccessState.recoveryUsed,
    },
  };
}

function getAppIconPath() {
  return path.join(__dirname, '..', 'assets', 'larix-icon.png');
}
let mainWindow = null;
let splashWindow = null;
let isQuittingAfterExitBackup = false;
const OPERATION_PROGRESS_CHANNEL = 'operations:progress';
const activeOperations = new Map();
const activeOperationControllers = new Map();
const activeOperationTimeouts = new Map();
const resetOperationJobIds = new Set();
const OPERATION_LOCK_TIMEOUT_MS = 180000;
const SHARED_LOCK_FILE_NAME = '.gpa-lock.json';
const SHARED_LOCK_STALE_MS = 12 * 60 * 60 * 1000;
const sharedAccessState = {
  readOnlyMode: false,
  lockOwned: false,
  lockFilePath: '',
  lockInfo: null,
  lockMessage: '',
  recoveryUsed: false,
};

function getSharedLockFilePath() {
  return path.join(app.getPath('userData'), SHARED_LOCK_FILE_NAME);
}

function getCurrentSessionLockInfo() {
  const userInfo = (() => {
    try {
      return os.userInfo();
    } catch {
      return null;
    }
  })();

  return {
    machine: String(process.env.COMPUTERNAME || process.env.HOSTNAME || os.hostname() || 'PC sconosciuto').trim() || 'PC sconosciuto',
    user: String(process.env.USERNAME || process.env.USER || userInfo?.username || 'utente').trim() || 'utente',
    opened_at: new Date().toISOString(),
    pid: process.pid,
  };
}

function readSharedLockFile() {
  const lockFilePath = getSharedLockFilePath();
  if (!fs.existsSync(lockFilePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(lockFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    logMainProcessEvent('shared-lock:read-error', {
      lock_file_path: lockFilePath,
      message: error?.message || String(error),
    });
    return {
      invalid: true,
      machine: 'sessione non valida',
      user: '',
      opened_at: '',
      pid: null,
    };
  }
}

function isSharedLockStale(lockInfo) {
  const openedAt = Date.parse(String(lockInfo?.opened_at || ''));
  if (!Number.isFinite(openedAt)) {
    return true;
  }
  return (Date.now() - openedAt) > SHARED_LOCK_STALE_MS;
}

function isLockProcessAlive(lockInfo) {
  const pid = Number(lockInfo?.pid || 0);
  if (!pid || lockInfo?.machine !== os.hostname()) {
    return null;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') {
      return true;
    }
    if (error?.code === 'ESRCH') {
      return false;
    }
    return null;
  }
}

function writeSharedLockFile(lockInfo) {
  const lockFilePath = getSharedLockFilePath();
  fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });
  fs.writeFileSync(lockFilePath, JSON.stringify(lockInfo, null, 2), 'utf8');
  sharedAccessState.lockFilePath = lockFilePath;
  sharedAccessState.lockInfo = lockInfo;
  sharedAccessState.lockOwned = true;
  sharedAccessState.readOnlyMode = false;
  sharedAccessState.lockMessage = '';
}

function releaseSharedLockFile() {
  if (!sharedAccessState.lockOwned || !sharedAccessState.lockFilePath) {
    return;
  }

  try {
    const currentLock = readSharedLockFile();
    const sameOwner =
      currentLock &&
      currentLock.machine === sharedAccessState.lockInfo?.machine &&
      Number(currentLock.pid) === Number(sharedAccessState.lockInfo?.pid);

    if (sameOwner && fs.existsSync(sharedAccessState.lockFilePath)) {
      fs.unlinkSync(sharedAccessState.lockFilePath);
      logMainProcessEvent('shared-lock:released', {
        lock_file_path: sharedAccessState.lockFilePath,
      });
    }
  } catch (error) {
    logMainProcessEvent('shared-lock:release-error', {
      lock_file_path: sharedAccessState.lockFilePath,
      message: error?.message || String(error),
    });
  } finally {
    sharedAccessState.lockOwned = false;
  }
}

async function initializeSharedAccessMode() {
  sharedAccessState.readOnlyMode = false;
  sharedAccessState.lockOwned = false;
  sharedAccessState.lockFilePath = '';
  sharedAccessState.lockInfo = null;
  sharedAccessState.lockMessage = '';
  sharedAccessState.recoveryUsed = false;

  const currentLockInfo = getCurrentSessionLockInfo();
  const existingLock = readSharedLockFile();
  sharedAccessState.lockFilePath = getSharedLockFilePath();

  if (!existingLock) {
    writeSharedLockFile(currentLockInfo);
    logMainProcessEvent('shared-lock:acquired', {
      mode: 'read-write',
      lock_file_path: sharedAccessState.lockFilePath,
      lock_info: currentLockInfo,
    });
    return true;
  }

  const sameOwner =
    existingLock.machine === currentLockInfo.machine &&
    Number(existingLock.pid) === Number(currentLockInfo.pid);

  if (sameOwner) {
    writeSharedLockFile(currentLockInfo);
    logMainProcessEvent('shared-lock:refreshed-self', {
      lock_file_path: sharedAccessState.lockFilePath,
      lock_info: currentLockInfo,
    });
    return true;
  }

  const sameMachine = existingLock.machine === currentLockInfo.machine;
  const processAlive = isLockProcessAlive(existingLock);
  const stale = isSharedLockStale(existingLock) || (sameMachine && processAlive === false);
  const commonDetail = `Percorso condiviso: ${sharedAccessState.lockFilePath}\nSessione corrente: ${existingLock.machine || 'PC sconosciuto'}${existingLock.user ? ` (${existingLock.user})` : ''}\nAperta il: ${existingLock.opened_at || 'sconosciuto'}`;

  if (sameMachine && processAlive === false) {
    writeSharedLockFile(currentLockInfo);
    sharedAccessState.recoveryUsed = true;
    logMainProcessEvent('shared-lock:recovered-local-process-missing', {
      previous_lock: existingLock,
      next_lock: currentLockInfo,
    });
    return true;
  }

  if (stale) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Recupera sessione', 'Apri in sola lettura', 'Annulla'],
      defaultId: 1,
      cancelId: 2,
      title: 'Sessione condivisa rilevata',
      message: `Esiste un lock precedente del gestionale su ${existingLock.machine || 'un altro PC'}.`,
      detail: `${commonDetail}\n\nIl lock sembra vecchio o non valido. Vuoi recuperare la sessione?`,
    });

    if (response === 0) {
      writeSharedLockFile(currentLockInfo);
      sharedAccessState.recoveryUsed = true;
      logMainProcessEvent('shared-lock:recovered', {
        previous_lock: existingLock,
        next_lock: currentLockInfo,
      });
      return true;
    }

    if (response === 1) {
      sharedAccessState.readOnlyMode = true;
      sharedAccessState.lockOwned = false;
      sharedAccessState.lockInfo = existingLock;
      sharedAccessState.lockMessage = `Modalità sola lettura — archivio aperto su ${existingLock.machine || 'altro PC'}`;
      logMainProcessEvent('shared-lock:readonly-open', {
        previous_lock: existingLock,
        reason: 'stale-lock-readonly-choice',
      });
      return true;
    }

    app.exit(0);
    return false;
  }

  const { response } = await dialog.showMessageBox({
    type: 'info',
    buttons: ['Apri in sola lettura', 'Annulla'],
    defaultId: 0,
    cancelId: 1,
    title: 'Gestionale già aperto',
    message: `Gestionale già aperto su ${existingLock.machine || 'un altro PC'}.`,
    detail: `${commonDetail}\n\nVuoi aprire GPA in modalità sola lettura?`,
  });

  if (response !== 0) {
    app.exit(0);
    return false;
  }

  sharedAccessState.readOnlyMode = true;
  sharedAccessState.lockOwned = false;
  sharedAccessState.lockInfo = existingLock;
  sharedAccessState.lockMessage = `Modalità sola lettura — archivio aperto su ${existingLock.machine || 'altro PC'}`;
  logMainProcessEvent('shared-lock:readonly-open', {
    previous_lock: existingLock,
    reason: 'active-foreign-lock',
  });
  return true;
}

function focusExistingMainWindow() {
  const candidate = (
    mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
  ) || null;

  if (!candidate) {
    return null;
  }

  mainWindow = candidate;

  if (candidate.isMinimized()) {
    candidate.restore();
  }

  if (!candidate.isVisible()) {
    candidate.show();
  }

  candidate.focus();
  return candidate;
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const focusedWindow = focusExistingMainWindow();
    logMainProcessEvent('app:second-instance-blocked', {
      restored_existing_window: !!focusedWindow,
    });
  });
}

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

function logSplashEvent(event, details = {}) {
  try {
    console.info(`[splash] ${event}`);
  } catch {}
  logMainProcessEvent(`splash:${event}`, details);
}

async function setSplashStatus(message, step, percent) {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  await updateSplashWindowStatus(splashWindow, {
    message,
    step,
    percent,
  });
}

function destroySplashWindow() {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  closeSplashWindow(splashWindow);
  splashWindow = null;
}

function logAppMenu(type, details = {}) {
  try {
    console.info(`[app-menu] ${type}=${details.action || details.message || ''}`);
  } catch {}
  logMainProcessEvent(`app-menu:${type}`, details);
}

function getMainProcessLogPath() {
  return path.join(app.getPath('userData'), 'main-process.log');
}

function getCurrentMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow;
  }
  const fallbackWindow = BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  if (fallbackWindow) {
    mainWindow = fallbackWindow;
    return fallbackWindow;
  }
  return null;
}

async function runMenuAction(action, handler) {
  logAppMenu('action', { action });
  try {
    const result = await handler();
    logAppMenu('result', {
      action,
      result: typeof result === 'undefined' ? 'ok' : result,
    });
    return result;
  } catch (error) {
    logAppMenu('error', {
      action,
      message: error?.message || String(error),
    });
    const win = getCurrentMainWindow();
    await dialog.showMessageBox(win || undefined, {
      type: 'error',
      title: 'Operazione non completata',
      message: error?.message || String(error || 'Errore sconosciuto'),
    });
    return null;
  }
}

async function showPlaceholderMenuDialog(actionLabel) {
  const win = getCurrentMainWindow();
  await dialog.showMessageBox(win || undefined, {
    type: 'info',
    title: 'Funzione in preparazione',
    message: `${actionLabel} non e' ancora collegata in questa versione.`,
  });
}

async function openPathWithShell(targetPath, missingMessage) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    throw new Error(missingMessage || 'Percorso non trovato.');
  }
  const result = await shell.openPath(targetPath);
  if (result) {
    throw new Error(result);
  }
  return targetPath;
}

function extractRecentPerformanceSummary(limit = 15) {
  const logPath = getMainProcessLogPath();
  if (!fs.existsSync(logPath)) {
    return { entries: [], slowEntries: [] };
  }

  const lines = fs.readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const perfLines = lines.filter((line) =>
    /\[nav-perf\]|\[report-perf\]|\[attendance-perf\]|\[employee-open-perf\]|\[employee-docs-perf\]|\[employee-doc-upload-perf\]|\[communication-perf\]|\[backup-perf\]/i.test(line)
  );
  const recent = perfLines.slice(-limit);
  const slowEntries = recent.filter((line) => {
    const match = line.match(/(?:loadMs|ms)=([0-9]+)/i);
    return match ? Number(match[1]) > 1500 : false;
  });
  return {
    entries: recent,
    slowEntries,
  };
}

async function buildAndSetApplicationMenu() {
  const developerModeInfo = licenseService.getDeveloperModeInfo();
  const isDeveloperMode = !!developerModeInfo?.enabled;
  const appVersionLabel = `GPA ${app.getVersion()}`;

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Backup rapido',
          click: () => runMenuAction('backup-quick', async () => {
            requireWritableLicense('Il backup rapido');
            const result = await backupService.createBackup('manual');
            const win = getCurrentMainWindow();
            await dialog.showMessageBox(win || undefined, {
              type: 'info',
              title: 'Backup completato',
              message: 'Backup rapido creato con successo.',
              detail: result?.backup_dir || '',
            });
            return result?.backup_dir || 'created';
          }),
        },
        {
          label: 'Apri cartella backup',
          click: () => runMenuAction('open-backup-dir', () => openPathWithShell(
            backupService.getEffectiveBackupDir(),
            'Cartella backup non trovata.'
          )),
        },
        {
          label: 'Apri cartella documenti',
          click: () => runMenuAction('open-documents-dir', () => openPathWithShell(
            getDocumentsDir(),
            'Cartella documenti non trovata.'
          )),
        },
        { type: 'separator' },
        {
          label: 'Stampa pagina corrente',
          click: () => runMenuAction('print-current-page', async () => {
            const win = getCurrentMainWindow();
            if (!win) throw new Error('Finestra principale non disponibile.');
            await win.webContents.print({ printBackground: true, silent: false });
            return 'print-requested';
          }),
        },
        { type: 'separator' },
        {
          label: 'Esci',
          click: () => runMenuAction('app-quit', async () => {
            app.quit();
            return 'quit';
          }),
        },
      ],
    },
    {
      label: 'Operazioni',
      submenu: [
        {
          label: 'Aggiorna dati',
          click: () => runMenuAction('reload-data', async () => {
            const win = getCurrentMainWindow();
            if (!win) throw new Error('Finestra principale non disponibile.');
            win.reload();
            return 'reloaded';
          }),
        },
        {
          label: 'Archivia contratti scaduti',
          click: () => runMenuAction('archive-expired-contracts', async () => {
            requireWritableLicense("L'archiviazione dei contratti scaduti");
            const win = getCurrentMainWindow();
            const { response } = await dialog.showMessageBox(win || undefined, {
              type: 'question',
              buttons: ['Annulla', 'Conferma'],
              defaultId: 1,
              cancelId: 0,
              title: 'Archivia contratti scaduti',
              message: 'Vuoi archiviare i contratti a tempo determinato gia scaduti?',
            });
            if (response !== 1) return 'cancelled';
            const result = employeeRepo.archiveExpiredContracts();
            await dialog.showMessageBox(win || undefined, {
              type: 'info',
              title: 'Operazione completata',
              message: `Archiviazione completata per ${result?.archived_count || 0} dipendenti.`,
            });
            return result;
          }),
        },
        {
          label: 'Verifica documenti mancanti',
          click: () => runMenuAction('check-missing-documents', () => showPlaceholderMenuDialog('Verifica documenti mancanti')),
        },
        {
          label: 'Controlla visite/formazione in scadenza',
          click: () => runMenuAction('check-expiring-compliance', async () => {
            const employees = employeeRepo.listBasic({
              includeDeleted: false,
              includePeriods: false,
              includeTeamHistory: false,
              includeHireDocFlag: false,
            });
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const threshold = new Date(today);
            threshold.setDate(threshold.getDate() + 30);
            const expiringMedical = employees.filter((employee) => {
              if (!employee.medical_visit_done || !employee.medical_visit_expiry) return false;
              const target = new Date(`${String(employee.medical_visit_expiry).split('T')[0]}T00:00:00`);
              return !Number.isNaN(target.getTime()) && target >= today && target <= threshold;
            }).length;
            const expiringTraining = employees.filter((employee) => {
              if (!employee.art37_done || !employee.art37_expiry) return false;
              const target = new Date(`${String(employee.art37_expiry).split('T')[0]}T00:00:00`);
              return !Number.isNaN(target.getTime()) && target >= today && target <= threshold;
            }).length;
            const missingMedical = employees.filter((employee) => employee.medical_visit_required && !employee.medical_visit_done).length;
            const missingTraining = employees.filter((employee) => employee.art37_required && !employee.art37_done).length;
            const win = getCurrentMainWindow();
            await dialog.showMessageBox(win || undefined, {
              type: 'info',
              title: 'Controllo adempimenti',
              message: 'Riepilogo visite mediche e formazione.',
              detail: [
                `Visite in scadenza entro 30 giorni: ${expiringMedical}`,
                `Formazioni in scadenza entro 30 giorni: ${expiringTraining}`,
                `Visite mancanti: ${missingMedical}`,
                `Formazioni mancanti: ${missingTraining}`,
              ].join('\n'),
            });
            return { expiringMedical, expiringTraining, missingMedical, missingTraining };
          }),
        },
      ],
    },
    {
      label: 'Strumenti',
      submenu: [
        {
          label: 'Genera diagnostico GPA',
          click: () => runMenuAction('generate-diagnostics', async () => {
            const result = diagnosticsService.generateReport();
            const win = getCurrentMainWindow();
            await dialog.showMessageBox(win || undefined, {
              type: 'info',
              title: 'Diagnostico generato',
              message: result?.fileName || 'Diagnostico creato',
              detail: result?.filePath || '',
            });
            return result?.filePath || 'generated';
          }),
        },
        {
          label: 'Apri log principale',
          click: () => runMenuAction('open-main-log', () => openPathWithShell(
            getMainProcessLogPath(),
            'Log principale non trovato.'
          )),
        },
        {
          label: 'Apri cartella dati gestionale',
          click: () => runMenuAction('open-userdata-dir', () => openPathWithShell(
            getUserDataRoot(),
            'Cartella dati gestionale non trovata.'
          )),
        },
        {
          label: 'Verifica database',
          click: () => runMenuAction('verify-database', async () => {
            const result = runIntegrityCheck();
            const win = getCurrentMainWindow();
            await dialog.showMessageBox(win || undefined, {
              type: result?.ok ? 'info' : 'warning',
              title: 'Verifica database',
              message: result?.ok ? 'Integrity check completato con esito positivo.' : 'Integrity check con segnalazioni.',
              detail: Array.isArray(result?.messages) && result.messages.length ? result.messages.join('\n') : 'Nessun dettaglio disponibile.',
            });
            return result;
          }),
        },
        {
          label: 'Mostra stato NAS / lock',
          click: () => runMenuAction('show-nas-lock-status', async () => {
            const win = getCurrentMainWindow();
            await dialog.showMessageBox(win || undefined, {
              type: 'info',
              title: 'Stato NAS / lock condiviso',
              message: sharedAccessState.readOnlyMode ? 'Applicazione aperta in sola lettura.' : 'Applicazione aperta in lettura/scrittura.',
              detail: [
                `Modalita corrente: ${sharedAccessState.readOnlyMode ? 'RO' : 'RW'}`,
                `Lock posseduto: ${sharedAccessState.lockOwned ? 'si' : 'no'}`,
                `Percorso lock: ${sharedAccessState.lockFilePath || getSharedLockFilePath()}`,
                `Macchina lock: ${sharedAccessState.lockInfo?.machine || 'n/d'}`,
                `Aperto il: ${sharedAccessState.lockInfo?.opened_at || 'n/d'}`,
                sharedAccessState.lockMessage ? `Messaggio: ${sharedAccessState.lockMessage}` : '',
              ].filter(Boolean).join('\n'),
            });
            return sharedAccessState.readOnlyMode ? 'readonly' : 'readwrite';
          }),
        },
        {
          label: 'Mostra prestazioni recenti',
          click: () => runMenuAction('show-recent-performance', async () => {
            const summary = extractRecentPerformanceSummary();
            const win = getCurrentMainWindow();
            await dialog.showMessageBox(win || undefined, {
              type: 'info',
              title: 'Prestazioni recenti',
              message: summary.entries.length ? 'Ultimi eventi performance rilevati.' : 'Nessun evento performance recente trovato.',
              detail: summary.entries.length
                ? `${summary.entries.join('\n')}${summary.slowEntries.length ? `\n\nEventi oltre 1500 ms:\n${summary.slowEntries.join('\n')}` : ''}`
                : 'Controllare main-process.log per nuovi eventi.',
            });
            return { total: summary.entries.length, slow: summary.slowEntries.length };
          }),
        },
      ],
    },
    {
      label: 'Vista',
      submenu: [
        {
          label: 'Ricarica',
          accelerator: 'CmdOrCtrl+R',
          click: () => runMenuAction('view-reload', async () => {
            const win = getCurrentMainWindow();
            if (!win) throw new Error('Finestra principale non disponibile.');
            win.reload();
            return 'reloaded';
          }),
        },
        {
          label: 'Zoom avanti',
          accelerator: 'CmdOrCtrl+=',
          click: () => runMenuAction('zoom-in', async () => {
            const win = getCurrentMainWindow();
            if (!win) throw new Error('Finestra principale non disponibile.');
            const factor = win.webContents.getZoomFactor();
            win.webContents.setZoomFactor(Math.min(3, factor + 0.1));
            return win.webContents.getZoomFactor();
          }),
        },
        {
          label: 'Zoom indietro',
          accelerator: 'CmdOrCtrl+-',
          click: () => runMenuAction('zoom-out', async () => {
            const win = getCurrentMainWindow();
            if (!win) throw new Error('Finestra principale non disponibile.');
            const factor = win.webContents.getZoomFactor();
            win.webContents.setZoomFactor(Math.max(0.5, factor - 0.1));
            return win.webContents.getZoomFactor();
          }),
        },
        {
          label: 'Zoom normale',
          accelerator: 'CmdOrCtrl+0',
          click: () => runMenuAction('zoom-reset', async () => {
            const win = getCurrentMainWindow();
            if (!win) throw new Error('Finestra principale non disponibile.');
            win.webContents.setZoomFactor(1);
            return 1;
          }),
        },
        {
          label: 'Schermo intero',
          accelerator: 'F11',
          click: () => runMenuAction('toggle-fullscreen', async () => {
            const win = getCurrentMainWindow();
            if (!win) throw new Error('Finestra principale non disponibile.');
            win.setFullScreen(!win.isFullScreen());
            return win.isFullScreen();
          }),
        },
        ...(isDeveloperMode ? [{
          label: 'Nascondi/mostra DevTools',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => runMenuAction('toggle-devtools', async () => {
            const win = getCurrentMainWindow();
            if (!win) throw new Error('Finestra principale non disponibile.');
            win.webContents.toggleDevTools();
            return 'toggled';
          }),
        }] : []),
      ],
    },
    {
      label: 'Aiuto',
      submenu: [
        {
          label: 'Informazioni su GPA',
          click: () => runMenuAction('about-gpa', async () => {
            const win = getCurrentMainWindow();
            await dialog.showMessageBox(win || undefined, {
              type: 'info',
              title: 'Informazioni su GPA',
              message: variantConfig.productName,
              detail: [
                `Versione: ${app.getVersion()}`,
                `Variante: ${variantConfig.variant}`,
                `Percorso dati: ${getUserDataRoot()}`,
              ].join('\n'),
            });
            return appVersionLabel;
          }),
        },
        {
          label: `Versione ${appVersionLabel}`,
          enabled: false,
        },
        {
          label: 'Stato licenza',
          click: () => runMenuAction('license-status', async () => {
            const status = getMergedLicenseStatus();
            const win = getCurrentMainWindow();
            await dialog.showMessageBox(win || undefined, {
              type: 'info',
              title: 'Stato licenza',
              message: status?.is_write_blocked ? 'Licenza o accesso con scrittura bloccata.' : 'Licenza attiva.',
              detail: [
                `Write blocked: ${status?.is_write_blocked ? 'si' : 'no'}`,
                `Read only mode: ${status?.read_only_mode ? 'si' : 'no'}`,
                status?.message ? `Messaggio: ${status.message}` : '',
              ].filter(Boolean).join('\n'),
            });
            return status?.is_write_blocked ? 'blocked' : 'ok';
          }),
        },
        {
          label: 'Manuale / guida rapida',
          click: () => runMenuAction('quick-guide', () => showPlaceholderMenuDialog('Manuale / guida rapida')),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
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
    access_mode: {
      read_only: !!sharedAccessState.readOnlyMode,
      lock_owned: !!sharedAccessState.lockOwned,
      lock_file_path: sharedAccessState.lockFilePath || getSharedLockFilePath(),
      lock_info: sharedAccessState.lockInfo,
      message: sharedAccessState.lockMessage || '',
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

  await setSplashStatus('Caricamento interfaccia...', 'Preparazione finestra principale', 82);

  mainWindow = new BrowserWindow({
    title: variantConfig.productName,
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
  mainWindow.setTitle(variantConfig.productName);

  const readyToShowPromise = new Promise((resolve) => {
    mainWindow.once('ready-to-show', async () => {
      logSplashEvent('main-ready', {});
      await setSplashStatus('Interfaccia pronta', 'Apertura finestra principale', 100);
      destroySplashWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.setOpacity(0);
        } catch {}
        mainWindow.show();
        try {
          let opacity = 0;
          const fadeIn = setInterval(() => {
            if (!mainWindow || mainWindow.isDestroyed()) {
              clearInterval(fadeIn);
              return;
            }
            opacity = Math.min(1, opacity + 0.2);
            mainWindow.setOpacity(opacity);
            if (opacity >= 1) {
              clearInterval(fadeIn);
            }
          }, 24);
        } catch {
          mainWindow.show();
        }
      }
      resolve();
    });
  });

  attachWindowDiagnostics(mainWindow);
  mainWindow.webContents.on('did-finish-load', () => {
    try {
      mainWindow?.setTitle(variantConfig.productName);
      mainWindow?.webContents.executeJavaScript(
        `document.title = ${JSON.stringify(variantConfig.productName)};`,
        true
      ).catch(() => {});
    } catch {}
  });

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
    await setSplashStatus('Caricamento gestionale...', 'Connessione al server di sviluppo', 88);
    await mainWindow.loadURL(devUrl);
  } else {
    logMainProcessEvent('renderer:load-file', { target: rendererEntryPath });
    await setSplashStatus('Caricamento gestionale...', 'Lettura interfaccia di produzione', 88);
    await mainWindow.loadFile(rendererEntryPath);
  }
  await readyToShowPromise;
}

function buildPdfHtml(contentHtml, landscape = false, debugRenderLabel = '') {
  if (/^\s*(?:<!doctype\s+html|<html[\s>])/i.test(String(contentHtml || ''))) {
    return contentHtml;
  }

  const pageWidthMm = landscape ? 297 : 210;
  const pageHeightMm = landscape ? 210 : 297;
  const pageMarginMm = 6;
  const pageContentWidthMm = pageWidthMm - pageMarginMm * 2;
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
          margin: ${pageMarginMm}mm;
        }

        html, body {
          width: ${pageWidthMm}mm;
          height: ${pageHeightMm}mm;
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
          width: ${pageContentWidthMm}mm;
          max-width: none;
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
          width: 100%;
          max-width: none;
          min-height: 0;
          height: auto;
          margin: 0;
          padding: 0;
          box-sizing: border-box;
          overflow: visible;
          page-break-after: avoid;
          break-after: avoid;
        }

        .print-sheet {
          width: 100%;
          max-width: none;
          margin: 0;
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
          max-width: none !important;
          margin: 0 auto !important;
          transform: none !important;
          overflow: visible !important;
          page-break-after: avoid !important;
          break-after: avoid !important;
        }

        .employee-print-sheet {
          width: 100% !important;
          max-width: none !important;
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
      if (!table) {
        return;
      }

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

function buildUniquePdfPath(directoryPath, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(directoryPath, `${parsed.name}${parsed.ext || '.pdf'}`);
  let suffix = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(directoryPath, `${parsed.name} (${suffix})${parsed.ext || '.pdf'}`);
    suffix += 1;
  }
  return candidate;
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

function buildTeamTemplateRenderResult(payload = {}) {
  if (!USE_TEAM_REPORT_TEMPLATE) {
    throw new Error('Template report squadra disattivato');
  }

  console.info('[team-template-ipc] teamName=%s', payload?.teamName || '');
  const data = buildTeamReportData(payload);
  console.info('[team-print-template] data-built', {
    teamId: data?.team?.id || null,
    team: data?.team?.name || '',
    month: data?.team?.monthLabel || '',
    totalHours: data?.team?.totalHours || 0,
    equivalentDays: data?.team?.equivalentDays || 0,
    finalBalance: data?.economics?.finalBalance || 0,
  });
  const html = renderTeamReportHtml(data);
  return { data, html };
}

function buildEmployeeTemplateRenderResult(payload = {}) {
  if (!USE_EMPLOYEE_REPORT_TEMPLATE) {
    throw new Error('Template report dipendente disattivato');
  }

  console.info('[employee-template-preview]', {
    employeeId: payload?.employeeId || null,
    employeeName: payload?.dipendente?.nome || payload?.employeeName || '',
    month: payload?.periodo?.inizioISO || '',
  });
  const data = buildEmployeeReportData(payload);
  const html = renderEmployeeReportHtml(data);
  return { data, html };
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
  splashWindow = await createSplashWindow({
    version: app.getVersion(),
    productName: variantConfig.productName,
    iconPath: getAppIconPath(),
    log: logSplashEvent,
  });
  await setSplashStatus('Caricamento gestionale...', 'Verifica archivio condiviso', 12);
  const shouldContinueStartup = await initializeSharedAccessMode();
  if (!shouldContinueStartup) {
    destroySplashWindow();
    return;
  }
  await setSplashStatus('Inizializzazione database...', 'Configurazione modalita di accesso', 26);
  setReadOnlyMode(sharedAccessState.readOnlyMode);
  if (!sharedAccessState.readOnlyMode) {
    cleanDemoBootstrapData();
  }
  await setSplashStatus('Inizializzazione database...', 'Preparazione cartelle applicazione', 36);
  const storageLayout = ensureAppStorageStructure();
  if (!sharedAccessState.readOnlyMode) {
    await setSplashStatus('Caricamento gestionale...', 'Verifica backup di sicurezza', 44);
    await backupService.checkAndHandleIncompleteRestore();
  }
  await setSplashStatus('Inizializzazione database...', 'Apertura archivio dati', 54);
  getDb();
  if (!sharedAccessState.readOnlyMode) {
    try {
      await setSplashStatus('Caricamento gestionale...', 'Controllo contratti scaduti', 62);
      const expiredArchiveResult = employeeRepo.archiveExpiredContracts();
      logMainProcessEvent('employees:archive-expired-contracts:startup', expiredArchiveResult);
    } catch (error) {
      logMainProcessEvent('employees:archive-expired-contracts:startup-error', {
        message: error?.message || String(error),
      });
    }
  }
  await setSplashStatus('Caricamento gestionale...', 'Avvio servizi applicativi', 72);
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
  diagnosticsService.setContextProviders({
    getAppRuntimeInfo: () => buildAppRuntimeInfo(),
    getLicenseStatus: () => getMergedLicenseStatus(),
  });
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
  if (!sharedAccessState.readOnlyMode) {
    await backupService.maybeRunAutomaticBackup();
  }
  logMainProcessEvent('bootstrap:license-config', licenseService.getPublicKeyInfo());
  await licenseService.bootstrapLicenseMonitoring();

  ipcMain.handle('dashboard:summary', async () => dashboardRepo.getDashboardSummary());
  ipcMain.handle('license:getStatus', async () => getMergedLicenseStatus());
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

  ipcMain.handle('diagnostics:logRendererEvent', async (_, payload = {}) => {
    if (payload.type === 'nav-perf') {
      logMainProcessEvent('nav-perf', {
        route: payload.route || '/',
        loadMs: payload.loadMs || 0,
        timestamp: payload.timestamp || new Date().toISOString(),
      });
    }
    return { success: true };
  });

  ipcMain.handle('backups:list', async () => backupService.listBackups());
  ipcMain.handle('backups:create', async (_, type) => {
    requireWritableLicense('La creazione dei backup');
    settingsService.requireAdmin();
    const result = await backupService.createBackup(type || 'manual');
    try { authService.audit('backup:create', 'backup', null, { type: type || 'manual' }); } catch {}
    return result;
  });
  ipcMain.handle('backups:openDirectory', async () => backupService.openBackupDirectory());
  ipcMain.handle('backups:chooseRestore', async () => {
    requireWritableLicense('Il ripristino dei backup');
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
  ipcMain.handle('employees:getDocumentsSummary', async (_, id) => {
    const startedAt = Date.now();
    logMainProcessEvent('employees:getDocumentsSummary:start', { id: Number(id) });
    const result = employeeRepo.getEmployeeDocumentsSummary(id);
    const resultCount = result
      ? [
          result.hire_document,
          result.legacy_hire_document,
          result.art37_document,
          result.medical_visit_document,
          result.dpi_delivery_document,
          ...(result.other_documents || []),
          ...((result.employment_periods || []).map((period) => period.hire_document).filter(Boolean)),
        ].filter(Boolean).length
      : 0;
    console.info('[docs-debug:ipc] employeeId=%d resultCount=%d', Number(id), resultCount);
    logMainProcessEvent('employees:getDocumentsSummary:end', {
      id: Number(id),
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
  ipcMain.handle('employees:closeEarly', async (_, employeeIds = [], terminationDate, reason = '') => {
    requireWritableLicense('La chiusura anticipata dei dipendenti');
    const startedAt = Date.now();
    logMainProcessEvent('employees:close-early:start', {
      requested_count: Array.isArray(employeeIds) ? employeeIds.length : 0,
      termination_date: terminationDate || '',
    });
    const result = employeeRepo.closeEmployeesEarly(employeeIds, terminationDate, reason);
    logMainProcessEvent('employees:close-early:end', {
      archived_count: result?.archived_count || 0,
      duration_ms: Date.now() - startedAt,
    });
    return result;
  });
  ipcMain.handle('employees:archiveExpiredContracts', async (_, today) => {
    const startedAt = Date.now();
    logMainProcessEvent('employees:archive-expired-contracts:start', {
      today: today || '',
    });
    const result = employeeRepo.archiveExpiredContracts(today);
    logMainProcessEvent('employees:archive-expired-contracts:end', {
      archived_count: result?.archived_count || 0,
      duration_ms: Date.now() - startedAt,
    });
    return result;
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
  ipcMain.handle('employees:openDocumentById', async (_, documentId) =>
    employeeRepo.openEmployeeDocumentById(documentId)
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
  ipcMain.handle('employees:uploadDpiDeliveryDocument', async (_, employeeId) => {
    requireWritableLicense('La modifica dei dipendenti');
    return employeeRepo.uploadDpiDeliveryDocument(mainWindow, employeeId);
  });
  ipcMain.handle('employees:openDpiDeliveryDocument', async (_, employeeId) =>
    employeeRepo.openDpiDeliveryDocument(employeeId)
  );
  ipcMain.handle('employees:deleteDpiDeliveryDocument', async (_, employeeId) => {
    requireWritableLicense('La modifica dei dipendenti');
    return employeeRepo.deleteDpiDeliveryDocument(employeeId);
  });
  ipcMain.handle('dpi:listItems', async (_, options) => dpiRepo.listItems(options));
  ipcMain.handle('dpi:createItem', async (_, payload) => {
    requireWritableLicense('La modifica del magazzino DPI');
    return dpiRepo.createItem(payload);
  });
  ipcMain.handle('dpi:updateItem', async (_, id, payload) => {
    requireWritableLicense('La modifica del magazzino DPI');
    return dpiRepo.updateItem(id, payload);
  });
  ipcMain.handle('dpi:archiveItem', async (_, id) => {
    requireWritableLicense('La modifica del magazzino DPI');
    return dpiRepo.archiveItem(id);
  });
  ipcMain.handle('dpi:deleteItem', async (_, id) => {
    requireWritableLicense('La modifica del magazzino DPI');
    return dpiRepo.deleteItem(id);
  });
  ipcMain.handle('dpi:listAssignments', async (_, options) => dpiRepo.listAssignments(options));
  ipcMain.handle('dpi:createAssignment', async (_, payload) => {
    requireWritableLicense('La modifica del magazzino DPI');
    return dpiRepo.createAssignment(payload);
  });
  ipcMain.handle('dpi:updateAssignment', async (_, id, payload) => {
    requireWritableLicense('La modifica del magazzino DPI');
    return dpiRepo.updateAssignment(id, payload);
  });
  ipcMain.handle('dpi:deleteAssignment', async (_, id) => {
    requireWritableLicense('La modifica del magazzino DPI');
    return dpiRepo.deleteAssignment(id);
  });
  ipcMain.handle('dpi:getEmployeeAssignments', async (_, employeeId) =>
    dpiRepo.getEmployeeAssignments(employeeId)
  );
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
  ipcMain.handle('teamPayroll:listAdvances', async (_, teamId, month, options) => {
    return teamPayrollRepo.listTeamAdvances(teamId, month, options);
  });
  ipcMain.handle('teamPayroll:listAvailableAdvances', async (_, teamId, month) => {
    return teamPayrollRepo.listAvailableTeamAdvances(teamId, month);
  });
  ipcMain.handle('teamPayroll:listAllAdvances', async (_, options) => {
    return teamPayrollRepo.listAllTeamAdvances(options);
  });
  ipcMain.handle('teamPayroll:createAdvance', async (_, payload) => {
    requireWritableLicense('La modifica delle squadre');
    return teamPayrollRepo.createTeamAdvance(payload);
  });
  ipcMain.handle('teamPayroll:updateAdvance', async (_, id, payload) => {
    requireWritableLicense('La modifica delle squadre');
    return teamPayrollRepo.updateTeamAdvance(id, payload);
  });
  ipcMain.handle('teamPayroll:deleteAdvance', async (_, id) => {
    requireWritableLicense('La modifica delle squadre');
    return teamPayrollRepo.deleteTeamAdvance(id);
  });
  ipcMain.handle('teamPayroll:setAdvancesImported', async (_, ids, includeInReport) => {
    requireWritableLicense('La modifica delle squadre');
    return teamPayrollRepo.setTeamAdvancesImported(ids, includeInReport);
  });
  ipcMain.handle('teamPayroll:getReportRecord', async (_, teamId, month) => {
    return teamPayrollRepo.getTeamReportRecord(teamId, month);
  });
  ipcMain.handle('teamPayroll:saveReportRecord', async (_, payload) => {
    requireWritableLicense('La modifica delle squadre');
    return teamPayrollRepo.saveTeamReportRecord(payload);
  });
  ipcMain.handle('teamPayroll:listPayrollComponents', async (_, teamId, month) => {
    return teamPayrollRepo.listPayrollComponents(teamId, month);
  });
  ipcMain.handle('teamPayroll:createPayrollComponent', async (_, payload) => {
    requireWritableLicense('La modifica delle squadre');
    return teamPayrollRepo.createPayrollComponent(payload);
  });
  ipcMain.handle('teamPayroll:updatePayrollComponent', async (_, id, payload) => {
    requireWritableLicense('La modifica delle squadre');
    return teamPayrollRepo.updatePayrollComponent(id, payload);
  });
  ipcMain.handle('teamPayroll:deletePayrollComponent', async (_, id) => {
    requireWritableLicense('La modifica delle squadre');
    return teamPayrollRepo.deletePayrollComponent(id);
  });
  ipcMain.handle('teamPayroll:replacePayrollComponents', async (_, teamId, month, items) => {
    requireWritableLicense('La modifica delle squadre');
    return teamPayrollRepo.replacePayrollComponents(teamId, month, items);
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
  ipcMain.handle('communications:getById', async (_, id) => communicationRepo.getCommunicationById(id));
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

  ipcMain.handle('printDocuments:listDocuments', async (_, filters) =>
    printDocumentsRepo.listPrintableDocuments(filters)
  );
  ipcMain.handle('printDocuments:openDocument', async (_, relativePath) =>
    printDocumentsRepo.openPrintableDocument(relativePath)
  );
  ipcMain.handle('printDocuments:printDocument', async (_, relativePath) =>
    printDocumentsRepo.printPrintableDocument(relativePath)
  );
  ipcMain.handle('printDocuments:exportDocument', async (_, relativePath, suggestedFileName) =>
    printDocumentsRepo.exportPrintableDocument(mainWindow, relativePath, suggestedFileName)
  );

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
  ipcMain.handle('attendance:teamBulkUpsert', async (_, payload) => {
    requireWritableLicense("L'inserimento di nuove presenze");
    return attendanceRepo.bulkUpsertTeamAttendance(payload);
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
  ipcMain.handle('attendance:listTeamByMonth', async (_, year, month) => {
    const startedAt = Date.now();
    logMainProcessEvent('attendance:listTeamByMonth:start', {
      year: Number(year),
      month: Number(month),
    });
    const result = attendanceRepo.listTeamAttendanceByMonth(year, month);
    logMainProcessEvent('attendance:listTeamByMonth:end', {
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
  ipcMain.handle('payroll:listByEmployees', async (_, options) => {
    console.log(`[buste-perf-main] IPC handler called with ${(options?.employeeIds || []).length} employees`);
    try {
      const result = payrollRepo.listPayrollRecordsForEmployees(options);
      console.log(`[buste-perf-main] IPC handler returning result with ${Object.keys(result).length} employee keys`);
      return result;
    } catch (error) {
      console.error(`[buste-perf-main] IPC handler error:`, error);
      throw error;
    }
  });
  ipcMain.handle('payroll:listHistory', async (_, options) =>
    payrollRepo.listPayrollHistory(options)
  );
  ipcMain.handle('payroll:getRecord', async (_, employeeId, month) =>
    payrollRepo.getPayrollRecord(employeeId, month)
  );
  ipcMain.handle('payroll:getRecordById', async (_, id) =>
    payrollRepo.getPayrollRecordById(id)
  );
  ipcMain.handle('payroll:updatePaymentStatus', async (_, id, paymentStatus, paymentDate, partialPaidAmount, remainingBalance) => {
    requireWritableLicense('La modifica dello stato pagamento dei report storici');
    return payrollRepo.updatePayrollReportPaymentStatus(id, paymentStatus, paymentDate, partialPaidAmount, remainingBalance);
  });
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

  ipcMain.handle('reports:savePdfToFolder', async (_, payload) => {
    const html = payload?.html || '';
    if (!html.trim()) {
      throw new Error('HTML report mancante');
    }

    const selected = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleziona cartella base per i report',
      defaultPath: getDocumentsDir(),
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selected.canceled || !selected.filePaths?.[0]) {
      return { canceled: true };
    }

    const monthFolderName = String(payload?.monthFolderName || 'Report').replace(/[\\/:*?"<>|]/g, '').trim() || 'Report';
    const safeFileName = String(payload?.fileName || 'report.pdf').replace(/[\\/:*?"<>|]/g, '').trim() || 'report.pdf';
    const targetDir = path.join(selected.filePaths[0], 'Report operai', monthFolderName);
    fs.mkdirSync(targetDir, { recursive: true });
    const filePath = buildUniquePdfPath(targetDir, safeFileName);
    await renderPdfToFile({
      html,
      filePath,
      landscape: !!payload?.landscape,
      debugRenderLabel: payload?.debugRenderLabel || '',
    });
    return { canceled: false, file_path: filePath };
  });

  ipcMain.handle('teamReport:previewTemplate', async (_, payload) => {
    try {
      const result = buildTeamTemplateRenderResult(payload || {});
      return result;
    } catch (error) {
      console.error('[team-print-template] error', error);
      throw error;
    }
  });

  ipcMain.handle('teamReport:generatePdfTemplate', async (_, payload) => {
    try {
      return runExclusiveOperation({
        type: 'report-export',
        startMessage: 'Preparazione report squadra template...',
        fn: async (progress) => {
          const result = buildTeamTemplateRenderResult(payload || {});
          const defaultFileName = payload?.fileName || 'report-squadra-template.pdf';
          progress({
            status: 'running',
            step: 'document_generation',
            percent: 35,
            message: 'Generazione template report squadra...',
            file_name: defaultFileName,
            concurrent_error_message: "Generazione report giÃ  in corso. Attendi il completamento prima di avviarne un'altra.",
          });
          const tempPdfPath = buildTempPdfPath(defaultFileName);
          await renderPdfToFile({
            html: result.html,
            filePath: tempPdfPath,
            landscape: false,
            debugRenderLabel: 'team-template',
            onProgress: progress,
          });

          const openResult = await shell.openPath(tempPdfPath);
          if (openResult) {
            throw new Error(openResult);
          }

          console.info('[team-print-template] pdf');
          return {
            canceled: false,
            preview_file_path: tempPdfPath,
            data: result.data,
          };
        },
      });
    } catch (error) {
      console.error('[team-print-template] error', error);
      throw error;
    }
  });

  ipcMain.handle('employeeReport:previewTemplate', async (_, payload) => {
    try {
      return buildEmployeeTemplateRenderResult(payload || {});
    } catch (error) {
      console.error('[employee-template-fallback]', error);
      throw error;
    }
  });

  ipcMain.handle('employeeReport:generatePdfTemplate', async (_, payload) => {
    try {
      return runExclusiveOperation({
        type: 'report-export',
        startMessage: 'Preparazione report dipendente template...',
        fn: async (progress) => {
          const result = buildEmployeeTemplateRenderResult(payload || {});
          const defaultFileName = payload?.fileName || 'report-dipendente-template.pdf';
          progress({
            status: 'running',
            step: 'document_generation',
            percent: 35,
            message: 'Generazione template report dipendente...',
            file_name: defaultFileName,
            concurrent_error_message: "Generazione report già in corso. Attendi il completamento prima di avviarne un'altra.",
          });
          const tempPdfPath = buildTempPdfPath(defaultFileName);
          await renderPdfToFile({
            html: result.html,
            filePath: tempPdfPath,
            landscape: false,
            debugRenderLabel: '',
            onProgress: progress,
          });

          const openResult = await shell.openPath(tempPdfPath);
          if (openResult) {
            throw new Error(openResult);
          }

          console.info('[employee-template-pdf]');
          return {
            canceled: false,
            preview_file_path: tempPdfPath,
            data: result.data,
          };
        },
      });
    } catch (error) {
      console.error('[employee-template-fallback]', error);
      throw error;
    }
  });

  ipcMain.handle('reports:printHtml', async (_, payload) => {
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

  await buildAndSetApplicationMenu();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((error) => {
  destroySplashWindow();
  appendMainProcessLog('startup-failure', error);
  dialog.showErrorBox(APP_ERROR_TITLE, String(error?.message || error || 'Errore sconosciuto'));
  app.exit(1);
});

app.on('before-quit', (event) => {
  if (isQuittingAfterExitBackup || sharedAccessState.readOnlyMode) {
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

app.on('will-quit', () => {
  destroySplashWindow();
  releaseSharedLockFile();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
