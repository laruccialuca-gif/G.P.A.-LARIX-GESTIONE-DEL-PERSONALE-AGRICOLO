const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const settingsService = require('./settingsService');
const backupService = require('./backupService');
const licenseService = require('./licenseService');
const { getDb, getDbPath, runIntegrityCheck, getDatabaseRuntimeInfo } = require('./db');
const { getVariantConfig } = require('./runtimeContext');
const {
  getStorageLayout,
  getBackupsDir,
  getDocumentsDir,
  getDataDir,
  getConfigDir,
  getUpdatesDir,
  getUserDataRoot,
} = require('./storagePaths');

let logWriter = () => {};
let contextProviders = {
  getAppRuntimeInfo: () => null,
  getLicenseStatus: () => licenseService.getLicenseStatus(),
};

const MAX_LOG_LINES = 500;
const SHARED_LOCK_STALE_MS = 12 * 60 * 60 * 1000;
const ERROR_PATTERNS = [
  /Error/i,
  /SqliteError/i,
  /SQLITE_/i,
  /database is locked/i,
  /attempt to write a readonly database/i,
  /ENOENT/i,
  /EACCES/i,
  /EPERM/i,
  /Access is denied/i,
  /license/i,
  /backup failed/i,
  /migration/i,
  /\bpdf\b/i,
  /\bprint/i,
  /\bOCR\b/i,
  /\bfailed\b/i,
  /\btimeout\b/i,
];
const PERF_TAGS = [
  'nav-perf',
  'report-perf',
  'attendance-perf',
  'employee-open-perf',
  'employee-docs-perf',
  'employee-doc-upload-perf',
  'communication-perf',
  'backup-perf',
];

function setLogger(logger) {
  logWriter = typeof logger === 'function' ? logger : () => {};
}

function setContextProviders(providers = {}) {
  contextProviders = {
    ...contextProviders,
    ...(providers && typeof providers === 'object' ? providers : {}),
  };
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

function formatFilenameDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}-${hours}-${minutes}`;
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

function sanitizeSensitiveText(value) {
  return String(value || '')
    .replace(/("license_key"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
    .replace(/("activationCode"\s*:\s*")[^"]*(")/gi, '$1[REDACTED]$2')
    .replace(/(GPA_DEV_BYPASS=)[^\s]+/gi, '$1[REDACTED]')
    .replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1[REDACTED]');
}

function safeCall(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function readJsonFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readTailLines(filePath, maxLines = MAX_LOG_LINES) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { found: false, lines: ['non trovato'] };
  }

  const content = sanitizeSensitiveText(fs.readFileSync(filePath, 'utf8'));
  const lines = content.split(/\r?\n/).filter(Boolean);
  return {
    found: true,
    lines: lines.slice(-maxLines),
  };
}

function readLogBlocks(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }

  const content = sanitizeSensitiveText(fs.readFileSync(filePath, 'utf8'));
  return content
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function parseMainLogBlock(block) {
  const lines = String(block || '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return null;
  const first = lines[0];
  const match = first.match(/^\[(.+?)\]\s+(.+)$/);
  const timestamp = match?.[1] || '';
  const context = match?.[2] || first;
  const bodyLines = lines.slice(1);
  let details = null;
  try {
    details = JSON.parse(bodyLines.join('\n'));
  } catch {
    details = null;
  }
  return {
    raw: block,
    timestamp,
    context,
    details,
    bodyText: bodyLines.join('\n'),
  };
}

function getRecentRendererErrorBlocks(filePath, maxBlocks = 10) {
  return readLogBlocks(filePath)
    .map(parseMainLogBlock)
    .filter(Boolean)
    .filter((block) => block.context.includes('renderer:react-error') || block.context.includes('diagnostics:renderer-error'))
    .slice(-maxBlocks)
    .map((block) => block.raw);
}

function fileExistsReadableWritable(filePath) {
  const result = {
    exists: false,
    readable: false,
    writable: false,
  };

  try {
    result.exists = !!filePath && fs.existsSync(filePath);
    if (!result.exists) return result;
    fs.accessSync(filePath, fs.constants.R_OK);
    result.readable = true;
  } catch {
    result.readable = false;
  }

  try {
    if (result.exists) {
      fs.accessSync(filePath, fs.constants.W_OK);
      result.writable = true;
    }
  } catch {
    result.writable = false;
  }

  return result;
}

function directoryCheck(dirPath) {
  const status = fileExistsReadableWritable(dirPath);
  return {
    path: dirPath,
    ...status,
  };
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

function getDatabaseCounts() {
  const db = getDb();
  const getCount = (sql) => Number(db.prepare(sql).get()?.total || 0);
  return {
    attendance: getCount('SELECT COUNT(*) AS total FROM attendance'),
    reports: getCount('SELECT COUNT(*) AS total FROM payroll_records'),
    employee_documents: getCount('SELECT COUNT(*) AS total FROM employee_documents'),
    payroll_documents: getCount('SELECT COUNT(*) AS total FROM payroll_documents'),
    communications: getCount('SELECT COUNT(*) AS total FROM communications'),
  };
}

function getRecentMigrations(limit = 10) {
  const db = getDb();
  return db.prepare(`
    SELECT id, applied_at, app_version
    FROM schema_migrations
    ORDER BY applied_at DESC, id DESC
    LIMIT ?
  `).all(limit);
}

function getBackupSummary() {
  const backups = safeCall(() => backupService.listBackups(), []) || [];
  const grouped = {
    automatic: 0,
    manual: 0,
    'pre-operation': 0,
    unknown: 0,
  };
  for (const backup of backups) {
    const type = String(backup?.type || 'unknown');
    grouped[type] = (grouped[type] || 0) + 1;
  }

  return {
    backups,
    grouped,
    latest: backups[0] || null,
    backupDir: safeCall(() => backupService.getEffectiveBackupDir(), getBackupsDir()),
  };
}

function getFreeSpaceSummary(targetPath) {
  try {
    const stats = fs.statfsSync(targetPath);
    const available = Number(stats.bavail || stats.available || 0) * Number(stats.bsize || stats.blockSize || 1);
    return {
      available_bytes: available,
      available_human: formatBytes(available),
    };
  } catch (error) {
    return {
      error: error?.message || String(error),
      available_bytes: null,
      available_human: 'non disponibile',
    };
  }
}

function isLockStale(lockInfo) {
  if (!lockInfo?.opened_at) return false;
  const openedAt = Date.parse(lockInfo.opened_at);
  if (!Number.isFinite(openedAt)) return false;
  return (Date.now() - openedAt) > SHARED_LOCK_STALE_MS;
}

function getLockSummary(runtimeInfo = {}, licenseStatus = {}) {
  const accessMode = runtimeInfo?.access_mode || {};
  const lockPath = accessMode.lock_file_path || '';
  const rawLock = readJsonFile(lockPath);
  const safeLock = rawLock
    ? {
        machine: rawLock.machine || '',
        user: rawLock.user || '',
        opened_at: rawLock.opened_at || '',
        pid: rawLock.pid || '',
      }
    : (accessMode.lock_info || null);

  return {
    read_only: !!licenseStatus.read_only_mode || !!accessMode.read_only,
    reason: licenseStatus.message || accessMode.message || '',
    lock_file_path: lockPath,
    lock_file_exists: !!lockPath && fs.existsSync(lockPath),
    lock_owned: !!accessMode.lock_owned,
    lock_info: safeLock,
    stale: isLockStale(safeLock),
    single_instance_active: true,
  };
}

function collectLogSources() {
  const userData = app.getPath('userData');
  return [
    { label: 'main-process.log', path: path.join(userData, 'main-process.log') },
    { label: 'main-process.old.log', path: path.join(userData, 'main-process.old.log') },
    { label: 'renderer.log', path: path.join(userData, 'renderer.log') },
    { label: 'backup.log', path: path.join(userData, 'backup.log') },
    { label: 'license.log', path: path.join(userData, 'license.log') },
    { label: 'performance.log', path: path.join(userData, 'performance.log') },
  ];
}

function extractErrorHighlights(logSources) {
  const matches = [];
  for (const source of logSources) {
    const tail = readTailLines(source.path, MAX_LOG_LINES).lines;
    for (const line of tail) {
      if (ERROR_PATTERNS.some((pattern) => pattern.test(line))) {
        matches.push(`[${source.label}] ${line}`);
      }
    }
  }

  return [...new Set(matches)].slice(-120);
}

function extractPerformanceSummary(logSources) {
  const events = [];
  for (const source of logSources) {
    const blocks = readLogBlocks(source.path).map(parseMainLogBlock).filter(Boolean);
    for (const block of blocks) {
      const context = String(block.context || '');
      if (context === 'nav-perf' && block.details) {
        events.push({
          tag: 'nav-perf',
          route: String(block.details.route || ''),
          loadMs: Number(block.details.loadMs || 0),
          timestamp: block.details.timestamp || block.timestamp || '',
          source: source.label,
        });
      }

      const raw = String(block.raw || '');
      for (const tag of PERF_TAGS) {
        const match = raw.match(new RegExp(`\\[${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\].*?(?:route=([^\\s]+))?.*?ms=(\\d+)`, 'i'));
        if (match) {
          events.push({
            tag,
            route: match[1] || '',
            loadMs: Number(match[2] || 0),
            timestamp: block.timestamp || '',
            source: source.label,
          });
        }
      }
    }
  }

  const pageEvents = events.filter((event) => event.tag === 'nav-perf' && Number.isFinite(event.loadMs));
  const slowEvents = pageEvents.filter((event) => event.loadMs > 1500);
  const slowest = pageEvents.reduce((best, current) => (
    !best || current.loadMs > best.loadMs ? current : best
  ), null);
  const last = pageEvents[pageEvents.length - 1] || null;

  return {
    events,
    pageEvents,
    slowEvents,
    slowest,
    last,
  };
}

function buildAutomaticSuggestions({ errorHighlights, perfSummary, lockSummary }) {
  const suggestions = [];
  const haystack = errorHighlights.join('\n');

  if (/SQLITE_READONLY|readonly database|APP_READ_ONLY_MODE/i.test(haystack) || lockSummary.read_only) {
    suggestions.push('Rilevata modalità sola lettura o SQLITE_READONLY: controllare lock NAS, permessi del database e stato read-only corrente.');
  }
  if (/database is locked|SQLITE_BUSY/i.test(haystack)) {
    suggestions.push('Rilevato database bloccato: verificare altre istanze aperte, lock NAS e condivisione del database.');
  }
  if (/d3dcompiler_47\.dll|win-unpacked|Access is denied/i.test(haystack)) {
    suggestions.push('Rilevato Access is denied su build/release: chiudere GPA.exe o processi Electron aperti prima di rebuild/dist.');
  }
  if (perfSummary.slowEvents.length) {
    suggestions.push(`Rilevate route lente oltre 1500 ms (${perfSummary.slowEvents.length}): valutare ottimizzazione query/IPC delle pagine coinvolte.`);
  }
  if (/backup failed|backup:.*error|restore failed/i.test(haystack)) {
    suggestions.push('Rilevati errori backup/ripristino: controllare spazio disponibile, permessi cartella backup e file aperti.');
  }
  if (/license|licenza/i.test(haystack)) {
    suggestions.push('Rilevati errori licenza: verificare stato attivazione, backend licenza e file licenza locale.');
  }

  if (!suggestions.length) {
    suggestions.push('Nessun problema ricorrente rilevato automaticamente nei log recenti.');
  }

  return suggestions;
}

function formatKeyValueLines(objectEntries = []) {
  return objectEntries.map(([label, value]) => `${label}: ${value}`);
}

function buildReportContent() {
  const variantConfig = getVariantConfig();
  const settingsSummary = settingsService.buildSettingsSummary();
  const runtimeInfo = safeCall(() => contextProviders.getAppRuntimeInfo?.(), null) || {};
  const licenseStatus = safeCall(() => contextProviders.getLicenseStatus?.(), null) || licenseService.getLicenseStatus();
  const backupSummary = getBackupSummary();
  const dbInfo = safeCall(() => getDatabaseRuntimeInfo(), {});
  const dbPath = getDbPath();
  const dbExists = fs.existsSync(dbPath);
  const dbSize = dbExists ? fs.statSync(dbPath).size : 0;
  const integrity = safeCall(() => runIntegrityCheck(), { ok: false, messages: ['integrity check non disponibile'] });
  const employeeCounts = getEmployeeCounts();
  const databaseCounts = getDatabaseCounts();
  const migrations = safeCall(() => getRecentMigrations(10), []) || [];
  const logSources = collectLogSources();
  const errorHighlights = extractErrorHighlights(logSources);
  const perfSummary = extractPerformanceSummary(logSources);
  const lockSummary = getLockSummary(runtimeInfo, licenseStatus);
  const storageLayout = getStorageLayout();
  const dbChecks = fileExistsReadableWritable(dbPath);
  const documentsCheck = directoryCheck(getDocumentsDir());
  const backupsCheck = directoryCheck(getBackupsDir());
  const tempCheck = directoryCheck(app.getPath('temp'));
  const configCheck = directoryCheck(getConfigDir());
  const updatesCheck = directoryCheck(getUpdatesDir());
  const userDataCheck = directoryCheck(getUserDataRoot());
  const backupSpace = getFreeSpaceSummary(backupSummary.backupDir || getBackupsDir());
  const recentRendererErrors = getRecentRendererErrorBlocks(path.join(app.getPath('userData'), 'main-process.log'), 10);
  const suggestions = buildAutomaticSuggestions({ errorHighlights, perfSummary, lockSummary });
  const latestBackup = backupSummary.latest;

  const appSection = formatKeyValueLines([
    ['Versione GPA', settingsSummary.runtime_info?.app_version || app.getVersion()],
    ['Variante app', settingsSummary.runtime_info?.app_variant || 'standard'],
    ['Nome prodotto', variantConfig.productName],
    ['Sistema operativo', `${os.platform()} ${os.release()}`],
    ['Architettura', os.arch()],
    ['Modalità read-only', lockSummary.read_only ? 'si' : 'no'],
    ['Lock NAS presente', lockSummary.lock_file_exists ? 'si' : 'no'],
    ['Single instance attivo', lockSummary.single_instance_active ? 'si' : 'no'],
    ['Generato il', formatLocalDateTime(new Date())],
  ]);

  const pathsSection = formatKeyValueLines([
    ['userData', app.getPath('userData')],
    ['Database', dbPath],
    ['Log principale', path.join(app.getPath('userData'), 'main-process.log')],
    ['Documenti', storageLayout.documentsDir],
    ['Backup', storageLayout.backupsDir],
    ['Temp', app.getPath('temp')],
  ]);

  const databaseSection = [
    ...formatKeyValueLines([
      ['Database esiste', dbExists ? 'si' : 'no'],
      ['Dimensione database', dbExists ? `${formatBytes(dbSize)} (${dbSize} bytes)` : 'non trovato'],
      ['Journal mode', dbInfo.journal_mode || 'non disponibile'],
      ['Schema version', dbInfo.schema_version || 'non disponibile'],
      ['Migration count', dbInfo.migration_count ?? 'non disponibile'],
      ['Dipendenti attivi', employeeCounts.active],
      ['Dipendenti archiviati', employeeCounts.archived],
      ['Presenze', databaseCounts.attendance],
      ['Report', databaseCounts.reports],
      ['Documenti allegati dipendente', databaseCounts.employee_documents],
      ['Documenti busta paga', databaseCounts.payroll_documents],
      ['Comunicazioni', databaseCounts.communications],
      ['Integrity check', integrity?.ok ? 'ok' : (integrity?.messages || []).join(' | ')],
    ]),
    '',
    'Ultime migration:',
    ...(migrations.length
      ? migrations.map((item) => `- ${item.id} | ${item.applied_at || 'n/d'} | app ${item.app_version || 'n/d'}`)
      : ['- non disponibili']),
  ];

  const lockSection = [
    ...formatKeyValueLines([
      ['Modalità corrente', lockSummary.read_only ? 'RO' : 'RW'],
      ['Motivo read-only', lockSummary.reason || 'n/d'],
      ['Lock file', lockSummary.lock_file_path || 'n/d'],
      ['Lock file esiste', lockSummary.lock_file_exists ? 'si' : 'no'],
      ['Lock owned', lockSummary.lock_owned ? 'si' : 'no'],
      ['Lock stale', lockSummary.stale ? 'si' : 'no'],
      ['Macchina lock', lockSummary.lock_info?.machine || 'n/d'],
      ['Utente lock', lockSummary.lock_info?.user || 'n/d'],
      ['Opened at', lockSummary.lock_info?.opened_at || 'n/d'],
      ['PID lock', lockSummary.lock_info?.pid || 'n/d'],
    ]),
    '',
    'Contenuto lock sicuro:',
    JSON.stringify(lockSummary.lock_info || {}, null, 2),
  ];

  const backupSection = [
    ...formatKeyValueLines([
      ['Cartella backup', backupSummary.backupDir],
      ['Ultimo backup', latestBackup?.created_at || 'n/d'],
      ['Tipo ultimo backup', latestBackup?.type || 'n/d'],
      ['Backup automatici', backupSummary.grouped.automatic || 0],
      ['Backup manuali', backupSummary.grouped.manual || 0],
      ['Backup pre-operation', backupSummary.grouped['pre-operation'] || 0],
      ['Backup unknown', backupSummary.grouped.unknown || 0],
      ['Spazio disponibile backup', backupSpace.available_human || 'n/d'],
    ]),
  ];

  const performanceSection = [
    ...formatKeyValueLines([
      ['Pagina più lenta', perfSummary.slowest ? `${perfSummary.slowest.route || '(route sconosciuta)'} (${perfSummary.slowest.loadMs} ms)` : 'n/d'],
      ['Ultima pagina caricata', perfSummary.last ? `${perfSummary.last.route || '(route sconosciuta)'} (${perfSummary.last.loadMs} ms)` : 'n/d'],
      ['Eventi route > 1500 ms', perfSummary.slowEvents.length],
    ]),
    '',
    'Eventi performance recenti:',
    ...(perfSummary.events.length
      ? perfSummary.events.slice(-80).map((event) => `- [${event.tag}] ${event.route || ''} ${event.loadMs} ms ${event.timestamp || ''}`.trim())
      : ['- non trovati']),
  ];

  const permissionSection = [
    `Database: exists=${dbChecks.exists} readable=${dbChecks.readable} writable=${dbChecks.writable}`,
    `Documenti: exists=${documentsCheck.exists} readable=${documentsCheck.readable} writable=${documentsCheck.writable}`,
    `Backup: exists=${backupsCheck.exists} readable=${backupsCheck.readable} writable=${backupsCheck.writable}`,
    `Temp: exists=${tempCheck.exists} readable=${tempCheck.readable} writable=${tempCheck.writable}`,
    `Config: exists=${configCheck.exists} readable=${configCheck.readable} writable=${configCheck.writable}`,
    `Updates: exists=${updatesCheck.exists} readable=${updatesCheck.readable} writable=${updatesCheck.writable}`,
    `UserData: exists=${userDataCheck.exists} readable=${userDataCheck.readable} writable=${userDataCheck.writable}`,
  ];

  const recentLogsSection = logSources.flatMap((source) => ([
    `--- ${source.label} (${source.path}) ---`,
    ...readTailLines(source.path, source.label === 'main-process.log' ? 500 : 200).lines,
    '',
  ]));

  return {
    desktopPath: app.getPath('desktop'),
    fileName: `GPA-Diagnostic-${formatFilenameDate()}.txt`,
    text: [
      'GPA Diagnostic Report',
      '',
      '[APP]',
      ...appSection,
      '',
      '[PERCORSI]',
      ...pathsSection,
      '',
      '[DATABASE]',
      ...databaseSection,
      '',
      '[LOCK / READONLY]',
      ...lockSection,
      '',
      '[BACKUP]',
      ...backupSection,
      '',
      '[PERFORMANCE]',
      ...performanceSection,
      '',
      '[ERRORI RECENTI]',
      ...(errorHighlights.length ? errorHighlights : ['nessun errore recente rilevato']),
      '',
      '[LOG RENDERER RECENTI]',
      ...(recentRendererErrors.length ? recentRendererErrors : ['non trovati']),
      '',
      '[LOG RECENTI]',
      ...recentLogsSection,
      '',
      '[CHECK PERMESSI]',
      ...permissionSection,
      '',
      '[SUGGERIMENTI AUTOMATICI]',
      ...suggestions.map((item) => `- ${item}`),
      '',
    ].join('\n'),
    summary: {
      errorHighlights,
      perfSummary,
      lockSummary,
      backupSummary,
    },
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
    summary: report.summary,
  };
}

module.exports = {
  generateReport,
  logRendererError,
  setContextProviders,
  setLogger,
};
