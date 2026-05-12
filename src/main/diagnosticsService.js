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

function getInstallmentsHistoricDebug() {
  const db = getDb();

  const safeGet = (sql, ...params) => {
    try {
      return db.prepare(sql).get(...params) || {};
    } catch {
      return {};
    }
  };
  const safeAll = (sql, ...params) => {
    try {
      return db.prepare(sql).all(...params) || [];
    } catch {
      return [];
    }
  };

  const activePlans = safeGet(`
    SELECT COUNT(*) AS total
    FROM payroll_debt_plans
    WHERE status = 'active'
  `);
  const archivedPlans = safeGet(`
    SELECT COUNT(*) AS total
    FROM payroll_debt_plans
    WHERE status <> 'active'
  `);
  const openInstallments = safeGet(`
    SELECT COUNT(*) AS total
    FROM payroll_debt_installments i
    JOIN payroll_debt_plans p ON p.id = i.plan_id
    WHERE p.status = 'active' AND COALESCE(i.is_paid, 0) = 0
  `);
  const closedInstallments = safeGet(`
    SELECT COUNT(*) AS total
    FROM payroll_debt_installments i
    JOIN payroll_debt_plans p ON p.id = i.plan_id
    WHERE p.status = 'active' AND COALESCE(i.is_paid, 0) = 1
  `);
  const orphanInstallments = safeGet(`
    SELECT COUNT(*) AS total
    FROM payroll_debt_installments i
    LEFT JOIN payroll_debt_plans p ON p.id = i.plan_id
    WHERE p.id IS NULL OR p.status <> 'active'
  `);

  const pendingMovements = safeGet(`
    SELECT COUNT(*) AS total
    FROM employee_financial_movements
    WHERE status = 'pending'
  `);
  const insertedMovements = safeGet(`
    SELECT COUNT(*) AS total
    FROM employee_financial_movements
    WHERE status = 'inserted'
  `);
  const unlinkedMovements = safeGet(`
    SELECT COUNT(*) AS total
    FROM employee_financial_movements
    WHERE status = 'inserted' AND inserted_report_id IS NULL
  `);

  const snapshotRecords = safeAll(`
    SELECT pr.id, pr.employee_id, pr.month, pr.report_snapshot_json,
           pr.archived_at, e.first_name, e.last_name
    FROM payroll_records pr
    LEFT JOIN employees e ON e.id = pr.employee_id
    WHERE pr.report_snapshot_json IS NOT NULL
      AND pr.report_snapshot_json LIKE '%current_installments_total%'
  `);

  const mismatches = [];
  let snapshotsWithInstallments = 0;

  for (const row of snapshotRecords) {
    let snapshotValue = 0;
    try {
      const parsed = JSON.parse(row.report_snapshot_json);
      snapshotValue = Number(parsed?.current_installments_total || 0);
    } catch {
      continue;
    }
    if (Math.abs(snapshotValue) <= 0.009) {
      continue;
    }
    snapshotsWithInstallments += 1;

    const liveRow = safeGet(`
      SELECT COALESCE(SUM(i.amount), 0) AS total, COUNT(*) AS count
      FROM payroll_debt_installments i
      JOIN payroll_debt_plans p ON p.id = i.plan_id
      WHERE i.paid_record_id = ? AND p.status = 'active'
    `, row.id);
    const liveValue = Number(liveRow?.total || 0);
    const liveCount = Number(liveRow?.count || 0);

    if (Math.abs(snapshotValue - liveValue) > 0.009) {
      mismatches.push({
        employee_id: row.employee_id,
        employee_name: `${row.last_name || ''} ${row.first_name || ''}`.trim() || '—',
        month: row.month,
        record_id: row.id,
        archived_record: !!row.archived_at,
        snapshot_installments: snapshotValue,
        live_installments: liveValue,
        live_count: liveCount,
        diff: snapshotValue - liveValue,
      });
    }
  }

  mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  return {
    active_plans: Number(activePlans?.total || 0),
    archived_plans: Number(archivedPlans?.total || 0),
    open_installments: Number(openInstallments?.total || 0),
    closed_installments: Number(closedInstallments?.total || 0),
    orphan_installments: Number(orphanInstallments?.total || 0),
    pending_movements: Number(pendingMovements?.total || 0),
    inserted_movements: Number(insertedMovements?.total || 0),
    unlinked_inserted_movements: Number(unlinkedMovements?.total || 0),
    snapshots_with_installments: snapshotsWithInstallments,
    mismatches,
  };
}

function formatInstallmentsHistoricDebug(debug) {
  const lines = [
    `piani attivi: ${debug.active_plans}`,
    `piani archiviati: ${debug.archived_plans}`,
    `rate aperte (piani attivi): ${debug.open_installments}`,
    `rate chiuse (piani attivi): ${debug.closed_installments}`,
    `rate orfane (piani archiviati o senza piano): ${debug.orphan_installments}`,
    `movimenti finanziari attivi (pending): ${debug.pending_movements}`,
    `movimenti finanziari inseriti: ${debug.inserted_movements}`,
    `movimenti inseriti scollegati dal report: ${debug.unlinked_inserted_movements}`,
    `report snapshot con rate/trattenute (>0): ${debug.snapshots_with_installments}`,
    `differenze snapshot ↔ DB attuale: ${debug.mismatches.length}`,
  ];

  if (debug.mismatches.length) {
    lines.push('dettaglio differenze (snapshot € → DB attuale €):');
    for (const m of debug.mismatches.slice(0, 50)) {
      lines.push(
        `  - ${m.employee_name} (id ${m.employee_id}) · ${m.month}` +
          ` · snapshot € ${m.snapshot_installments.toFixed(2)}` +
          ` → DB € ${m.live_installments.toFixed(2)} (rate attive: ${m.live_count})` +
          ` · diff € ${m.diff.toFixed(2)}` +
          (m.archived_record ? ' · report archiviato' : '')
      );
    }
    if (debug.mismatches.length > 50) {
      lines.push(`  ... e altri ${debug.mismatches.length - 50} report con differenze.`);
    }
  } else {
    lines.push('nessuna differenza rilevata.');
  }

  return lines;
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
  let installmentsDebug;
  try {
    installmentsDebug = getInstallmentsHistoricDebug();
  } catch (err) {
    installmentsDebug = { error: err?.message || String(err), mismatches: [] };
  }
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
      '[DEBUG RATE/TRATTENUTE STORICO]',
      ...(installmentsDebug?.error
        ? [`errore raccolta diagnostica: ${installmentsDebug.error}`]
        : formatInstallmentsHistoricDebug(installmentsDebug)),
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
