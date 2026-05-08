const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const settingsService = require('./settingsService');
const backupService = require('./backupService');
const licenseService = require('./licenseService');
const { getDb, getDbPath, runIntegrityCheck } = require('./db');
const { getVariantConfig } = require('./runtimeContext');

let logWriter = () => {};

function setLogger(logger) {
  logWriter = typeof logger === 'function' ? logger : () => {};
}

function logDiagnosticsEvent(event, details = {}) {
  try {
    logWriter(`diagnostics:${event}`, details);
  } catch {
    // Best effort.
  }
}

function formatDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildUniqueDesktopReportPath(desktopPath, fileName) {
  const extension = path.extname(fileName) || '.txt';
  const baseName = path.basename(fileName, extension);
  let candidate = path.join(desktopPath, fileName);
  let suffix = 2;

  while (fs.existsSync(candidate)) {
    candidate = path.join(desktopPath, `${baseName}-${suffix}${extension}`);
    suffix += 1;
  }

  return candidate;
}

function formatLocalDateTime(date = new Date()) {
  return new Intl.DateTimeFormat('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

function formatBytes(sizeBytes) {
  const size = Number(sizeBytes || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function readTailLines(filePath, maxLines = 100) {
  if (!filePath || !fs.existsSync(filePath)) {
    return ['Log non disponibile.'];
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/).filter(Boolean);
  return lines.slice(-maxLines);
}

function readLogBlocks(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function getRecentRendererErrorBlocks(filePath, maxBlocks = 10) {
  return readLogBlocks(filePath)
    .filter((block) => block.includes('renderer:react-error') || block.includes('diagnostics:renderer-error'))
    .slice(-maxBlocks);
}

function getEmployeeCounts() {
  const db = getDb();
  const active = db.prepare('SELECT COUNT(*) AS total FROM employees WHERE is_deleted = 0').get();
  const archived = db.prepare('SELECT COUNT(*) AS total FROM employees WHERE is_deleted = 1').get();
  return {
    active: Number(active?.total || 0),
    archived: Number(archived?.total || 0),
  };
}

function buildReportContent() {
  const variantConfig = getVariantConfig();
  const settingsSummary = settingsService.buildSettingsSummary();
  const licenseStatus = licenseService.getLicenseStatus();
  const backups = backupService.listBackups();
  const dbPath = getDbPath();
  const dbExists = fs.existsSync(dbPath);
  const dbSize = dbExists ? fs.statSync(dbPath).size : 0;
  const integrity = runIntegrityCheck();
  const employeeCounts = getEmployeeCounts();
  const logPath = path.join(app.getPath('userData'), 'main-process.log');
  const logLines = readTailLines(logPath, 100);
  const rendererErrorBlocks = getRecentRendererErrorBlocks(logPath, 10);
  const lastBackup = backups[0] || null;
  const desktopPath = app.getPath('desktop');
  const licensePath = settingsSummary.storage_paths?.license_file || '';
  const backupPath = settingsSummary.storage_paths?.backups_dir || settingsSummary.backup_directory_effective || '';

  return {
    desktopPath,
    fileName: `GPA-Diagnostic-${formatDate()}.txt`,
    text: [
      'GPA Diagnostic Report',
      `Generato il: ${formatLocalDateTime(new Date())}`,
      '',
      '[DATI GENERALI]',
      `Versione app: ${settingsSummary.runtime_info?.app_version || app.getVersion()}`,
      `App variant: ${settingsSummary.runtime_info?.app_variant || 'standard'}`,
      `App name: ${app.getName()}`,
      `Product name: ${variantConfig.productName}`,
      `App ID: ${variantConfig.appId || '—'}`,
      `Sistema operativo: ${os.platform()} ${os.release()} (${os.arch()})`,
      `Data e ora: ${formatLocalDateTime(new Date())}`,
      '',
      '[PERCORSI]',
      `userData path: ${app.getPath('userData')}`,
      `database path: ${dbPath}`,
      `backup path: ${backupPath}`,
      `log path: ${logPath}`,
      `license path: ${licensePath}`,
      `developer-machine path: ${licenseService.getDeveloperMachineConfigPath()}`,
      '',
      '[STATO LICENZA]',
      `status: ${licenseStatus?.code || 'non disponibile'}${licenseStatus?.label ? ` (${licenseStatus.label})` : ''}`,
      `scadenza: ${licenseStatus?.license?.expires_at || '—'}`,
      `ultima verifica: ${licenseStatus?.verification?.last_remote_at || '—'}`,
      `giorni offline residui: ${licenseStatus?.verification?.offline_days_remaining ?? '—'}`,
      `backend attivo: ${process.env.GESTIONALE_LICENSE_API_URL ? 'si' : 'no'}`,
      '',
      '[DATABASE]',
      `esistenza file DB: ${dbExists ? 'si' : 'no'}`,
      `dimensione DB: ${dbExists ? `${formatBytes(dbSize)} (${dbSize} bytes)` : '—'}`,
      `risultato PRAGMA integrity_check: ${integrity?.ok ? 'ok' : (integrity?.messages || []).join(' | ') || 'errore sconosciuto'}`,
      '',
      '[BACKUP]',
      `numero backup presenti: ${backups.length}`,
      `ultimo backup data: ${lastBackup?.created_at || '—'}`,
      `cartella backup: ${backupPath}`,
      '',
      '[ARCHIVI]',
      `numero dipendenti attivi: ${employeeCounts.active}`,
      `numero dipendenti archiviati: ${employeeCounts.archived}`,
      '',
      '[ULTIMI ERRORI RENDERER]',
      ...(rendererErrorBlocks.length ? rendererErrorBlocks : ['Nessun errore renderer recente registrato.']),
      '',
      '[LOG - ultime 100 righe]',
      ...logLines,
      '',
    ].join('\n'),
  };
}

function logRendererError(payload = {}) {
  logDiagnosticsEvent('renderer-error', {
    message: payload.message || '',
    stack: payload.stack || '',
    component_stack: payload.componentStack || '',
    route: payload.route || '',
    boundary: payload.boundary || '',
    timestamp: payload.timestamp || new Date().toISOString(),
  });

  return { success: true };
}

function generateReport() {
  logDiagnosticsEvent('generate-requested', {
    requested_at: new Date().toISOString(),
  });

  const report = buildReportContent();
  const targetPath = buildUniqueDesktopReportPath(report.desktopPath, report.fileName);
  fs.writeFileSync(targetPath, report.text, 'utf8');

  logDiagnosticsEvent('generate-created', {
    file_path: targetPath,
  });

  return {
    success: true,
    filePath: targetPath,
    fileName: report.fileName,
  };
}

module.exports = {
  generateReport,
  logRendererError,
  setLogger,
};
