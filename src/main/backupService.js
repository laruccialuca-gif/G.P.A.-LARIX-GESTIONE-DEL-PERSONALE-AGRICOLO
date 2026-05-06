const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dialog, app, shell } = require('electron');
const { getDataDir, getConfigDir, getDocumentsDir, getBackupsDir, getUserDataRoot } = require('./storagePaths');
const settingsService = require('./settingsService');
const { getDb, getDbPath } = require('./db');

const MAX_AUTO_BACKUPS = 20;
let logWriter = () => {};

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function setLogger(logger) {
  logWriter = typeof logger === 'function' ? logger : () => {};
}

function logBackupEvent(event, details = {}) {
  try {
    logWriter(`backup:${event}`, details);
  } catch {
    // Best effort.
  }
}

function logBackupMessage(message, details = {}) {
  console.log(message);

  try {
    logWriter(message, {
      message,
      ...details,
    });
  } catch {
    // Best effort.
  }
}

async function withRetry(fn, { attempts = 4, delayMs = 250 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastErr;
}

function formatTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}-${hours}${minutes}${seconds}`;
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function copyDirRecursive(sourceDir, targetDir, relativeBase = '', files = [], options = {}) {
  ensureDir(targetDir);

  if (!fs.existsSync(sourceDir)) {
    return files;
  }

  const skipAbsolutePaths = options.skipAbsolutePaths || new Set();

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    if (skipAbsolutePaths.has(sourcePath)) {
      continue;
    }
    const relativePath = path.join(relativeBase, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(sourcePath, targetPath, relativePath, files, options);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(targetPath));
      fs.copyFileSync(sourcePath, targetPath);
      const stats = fs.statSync(targetPath);
      files.push({
        relative_path: relativePath,
        size_bytes: stats.size,
        sha256: hashFile(targetPath),
      });
    }
  }

  return files;
}

function escapeSqlitePath(filePath) {
  return String(filePath).replace(/'/g, "''");
}

function backupSqliteDatabase(targetPath, files = [], relativePath = 'data/presenze.sqlite') {
  const db = getDb();
  const sourceDbPath = getDbPath();

  ensureDir(path.dirname(targetPath));
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true });
  }

  db.exec(`VACUUM INTO '${escapeSqlitePath(targetPath)}'`);

  const stats = fs.statSync(targetPath);
  files.push({
    relative_path: relativePath,
    size_bytes: stats.size,
    sha256: hashFile(targetPath),
  });

  return {
    sourceDbPath,
    sourceWalPath: `${sourceDbPath}-wal`,
    sourceShmPath: `${sourceDbPath}-shm`,
  };
}

async function copyDirRecursiveWithRetry(sourceDir, targetDir, relativeBase = '', files = []) {
  ensureDir(targetDir);

  if (!fs.existsSync(sourceDir)) {
    return files;
  }

  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const relativePath = path.join(relativeBase, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursiveWithRetry(sourcePath, targetPath, relativePath, files);
    } else if (entry.isFile()) {
      ensureDir(path.dirname(targetPath));
      await withRetry(() => fs.copyFileSync(sourcePath, targetPath));
      const stats = fs.statSync(targetPath);
      files.push({
        relative_path: relativePath,
        size_bytes: stats.size,
        sha256: hashFile(targetPath),
      });
    }
  }

  return files;
}

function removeDirContents(targetDir) {
  if (!fs.existsSync(targetDir)) return;
  for (const entry of fs.readdirSync(targetDir)) {
    fs.rmSync(path.join(targetDir, entry), { recursive: true, force: true });
  }
}

function getEffectiveBackupDir(settings = settingsService.getSettings()) {
  return ensureDir(settings.backup.directory || getBackupsDir());
}

function buildBackupFolderName(type) {
  return `backup-${formatTimestamp()}-${type}`;
}

function buildManifest({ type, folderName, files }) {
  const settings = settingsService.getSettings();
  return {
    backup_id: crypto.randomUUID(),
    folder_name: folderName,
    type,
    created_at: new Date().toISOString(),
    app_version: app.getVersion(),
    install_id: settings.licensing.install_id,
    cloud: {
      enabled: settings.cloud.enabled,
      provider: settings.cloud.provider,
      compression_enabled: settings.cloud.compression_enabled,
      encrypt_archives: settings.cloud.encrypt_archives,
      sync_mode: settings.cloud.sync_mode,
      versioning_strategy: settings.cloud.versioning_strategy,
      conflict_strategy: settings.cloud.conflict_strategy,
    },
    files,
  };
}

function getManifestPath(backupDir) {
  return path.join(backupDir, 'manifest.json');
}

function getBackupStats(backupDir) {
  const manifest = readBackupManifest(backupDir);
  const totalSize = (manifest.files || []).reduce((sum, file) => sum + Number(file.size_bytes || 0), 0);
  return {
    backup_dir: backupDir,
    created_at: manifest.created_at,
    file_name: path.basename(backupDir),
    size_bytes: totalSize,
    type: manifest.type,
    file_count: (manifest.files || []).length,
    is_valid: true,
  };
}

function getAutomaticBackupsSorted(backupRoot) {
  if (!fs.existsSync(backupRoot)) {
    return [];
  }

  const automaticBackups = fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(backupRoot, e.name))
    .filter((d) => fs.existsSync(getManifestPath(d)))
    .map((d) => {
      try {
        const manifest = readBackupManifest(d);
        return {
          dir: d,
          fileName: path.basename(d),
          type: manifest.type,
          created_at: manifest.created_at || '',
        };
      } catch {
        return null;
      }
    })
    .filter((backup) => backup && backup.type === 'automatic');

  automaticBackups.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return automaticBackups;
}

async function rotateAutomaticBackups(backupRoot = getEffectiveBackupDir()) {
  logBackupMessage('ROTATION START');

  const automaticBackups = getAutomaticBackupsSorted(backupRoot);
  logBackupMessage(`Backup automatici trovati: ${automaticBackups.length}`, {
    count: automaticBackups.length,
  });

  const toDelete = automaticBackups.slice(0, Math.max(0, automaticBackups.length - MAX_AUTO_BACKUPS));
  for (const backup of toDelete) {
    try {
      await withRetry(() => fs.rmSync(backup.dir, { recursive: true, force: true }));
      logBackupMessage(`Backup eliminato: ${backup.fileName}`, {
        backup_dir: backup.dir,
        file_name: backup.fileName,
      });
    } catch {}
  }
}

function createBackup(type = 'manual') {
  const settings = settingsService.getSettings();
  const backupRoot = getEffectiveBackupDir(settings);
  const folderName = buildBackupFolderName(type);
  const backupDir = ensureDir(path.join(backupRoot, folderName));

  const files = [];
  const targetDataDir = path.join(backupDir, 'data');
  const dbBackupTargetPath = path.join(targetDataDir, path.basename(getDbPath()));
  const { sourceDbPath, sourceWalPath, sourceShmPath } = backupSqliteDatabase(
    dbBackupTargetPath,
    files,
    path.join('data', path.basename(getDbPath()))
  );
  copyDirRecursive(getDataDir(), targetDataDir, 'data', files, {
    skipAbsolutePaths: new Set([sourceDbPath, sourceWalPath, sourceShmPath]),
  });
  copyDirRecursive(getConfigDir(), path.join(backupDir, 'config'), 'config', files);
  copyDirRecursive(getDocumentsDir(), path.join(backupDir, 'documents'), 'documents', files);

  const manifest = buildManifest({ type, folderName, files });
  fs.writeFileSync(getManifestPath(backupDir), JSON.stringify(manifest, null, 2), 'utf8');

  let validation;
  try {
    validation = validateBackup(backupDir);
  } catch (error) {
    logBackupEvent('failed', {
      type,
      folder_name: folderName,
      backup_dir: backupDir,
      message: error?.message || String(error),
    });
    throw error;
  }

  if (validation.valid) {
    logBackupEvent('created', {
      type,
      folder_name: folderName,
      backup_dir: backupDir,
      file_count: files.length,
      created_at: manifest.created_at,
    });
  } else {
    logBackupEvent('failed', {
      type,
      folder_name: folderName,
      backup_dir: backupDir,
      message: validation.message,
    });
  }

  if (type === 'automatic' && validation.valid) {
    settingsService.writeSettings({
      ...settings,
      backup: {
        ...settings.backup,
        last_auto_backup_at: manifest.created_at,
      },
    });
  }

  return {
    ...getBackupStats(backupDir),
    is_valid: validation.valid,
    validation_message: validation.message,
  };
}

function readBackupManifest(backupDir) {
  const manifestPath = getManifestPath(backupDir);
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Manifest backup non trovato.');
  }
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function validateBackup(backupDir) {
  const manifest = readBackupManifest(backupDir);
  const files = Array.isArray(manifest.files) ? manifest.files : [];

  for (const file of files) {
    const absolutePath = path.join(backupDir, file.relative_path);
    if (!fs.existsSync(absolutePath)) {
      return {
        valid: false,
        message: `File mancante nel backup: ${file.relative_path}`,
      };
    }

    const stats = fs.statSync(absolutePath);
    if (Number(file.size_bytes || 0) !== stats.size) {
      return {
        valid: false,
        message: `Dimensione non valida per ${file.relative_path}`,
      };
    }

    if (file.sha256 && hashFile(absolutePath) !== file.sha256) {
      return {
        valid: false,
        message: `Checksum non valido per ${file.relative_path}`,
      };
    }
  }

  return {
    valid: true,
    message: null,
    manifest,
  };
}

function listBackups() {
  const backupRoot = getEffectiveBackupDir();
  if (!fs.existsSync(backupRoot)) {
    return [];
  }

  return fs.readdirSync(backupRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(backupRoot, entry.name))
    .filter((dirPath) => fs.existsSync(getManifestPath(dirPath)))
    .map((dirPath) => {
      try {
        return getBackupStats(dirPath);
      } catch {
        return {
          backup_dir: dirPath,
          created_at: null,
          file_name: path.basename(dirPath),
          size_bytes: 0,
          type: 'unknown',
          file_count: 0,
          is_valid: false,
        };
      }
    })
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function chooseRestoreBackup(browserWindow) {
  settingsService.requireAdmin();
  return dialog.showOpenDialog(browserWindow, {
    title: 'Seleziona cartella backup da ripristinare',
    properties: ['openDirectory'],
    defaultPath: getEffectiveBackupDir(),
  });
}

async function openBackupDirectory() {
  const targetDir = getEffectiveBackupDir();
  const result = await shell.openPath(targetDir);
  if (result) {
    throw new Error(result);
  }

  return {
    success: true,
    backup_dir: targetDir,
  };
}

async function restoreBackup(backupDir) {
  settingsService.requireAdmin();

  const validation = validateBackup(backupDir);
  if (!validation.valid) {
    throw new Error(validation.message || 'Backup non valido.');
  }

  // Pre-restore backup: must succeed before touching any existing data.
  let preRestoreStats;
  try {
    preRestoreStats = createBackup('pre-restore');
  } catch (err) {
    throw new Error(
      `Impossibile creare il backup di sicurezza pre-restore. Il ripristino è stato annullato.\n` +
      `I tuoi dati non sono stati modificati.\n\nDettaglio: ${err.message}`
    );
  }

  // Use raw paths (no ensureDir side-effects during swap phase).
  const userDataRoot = getUserDataRoot();
  const dataDir = path.join(userDataRoot, 'data');
  const configDir = path.join(userDataRoot, 'config');
  const documentsDir = path.join(userDataRoot, 'documents');

  const ts = Date.now();
  const stagingRoot = path.join(userDataRoot, `restore-staging-${ts}`);
  const tombstoneRoot = path.join(userDataRoot, `restore-tombstone-${ts}`);

  // ── Phase 1: copy backup → staging (originals untouched) ────────────────
  try {
    ensureDir(stagingRoot);
    await copyDirRecursiveWithRetry(path.join(backupDir, 'data'), path.join(stagingRoot, 'data'), 'data', []);
    await copyDirRecursiveWithRetry(path.join(backupDir, 'config'), path.join(stagingRoot, 'config'), 'config', []);
    await copyDirRecursiveWithRetry(path.join(backupDir, 'documents'), path.join(stagingRoot, 'documents'), 'documents', []);
  } catch (err) {
    try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch {}
    throw new Error(
      `Errore durante la copia in staging: ${err.message}\n\n` +
      `I tuoi dati originali sono intatti.\n` +
      `Backup di sicurezza disponibile in:\n${preRestoreStats.backup_dir}`
    );
  }

  // ── Phase 2: rename originals → tombstone ────────────────────────────────
  ensureDir(tombstoneRoot);
  try {
    if (fs.existsSync(dataDir)) await withRetry(() => fs.renameSync(dataDir, path.join(tombstoneRoot, 'data')));
    if (fs.existsSync(configDir)) await withRetry(() => fs.renameSync(configDir, path.join(tombstoneRoot, 'config')));
    if (fs.existsSync(documentsDir)) await withRetry(() => fs.renameSync(documentsDir, path.join(tombstoneRoot, 'documents')));
  } catch (err) {
    // Rollback: restore any already-renamed dirs back to their original location.
    if (fs.existsSync(path.join(tombstoneRoot, 'data')) && !fs.existsSync(dataDir)) {
      try { await withRetry(() => fs.renameSync(path.join(tombstoneRoot, 'data'), dataDir)); } catch {}
    }
    if (fs.existsSync(path.join(tombstoneRoot, 'config')) && !fs.existsSync(configDir)) {
      try { await withRetry(() => fs.renameSync(path.join(tombstoneRoot, 'config'), configDir)); } catch {}
    }
    if (fs.existsSync(path.join(tombstoneRoot, 'documents')) && !fs.existsSync(documentsDir)) {
      try { await withRetry(() => fs.renameSync(path.join(tombstoneRoot, 'documents'), documentsDir)); } catch {}
    }
    try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(tombstoneRoot, { recursive: true, force: true }); } catch {}
    throw new Error(
      `Errore durante lo spostamento tombstone: ${err.message}\n\n` +
      `I tuoi dati originali sono intatti.\n` +
      `Backup di sicurezza disponibile in:\n${preRestoreStats.backup_dir}`
    );
  }

  // ── Phase 3: rename staging → final ─────────────────────────────────────
  try {
    if (fs.existsSync(path.join(stagingRoot, 'data'))) {
      await withRetry(() => fs.renameSync(path.join(stagingRoot, 'data'), dataDir));
    }
    if (fs.existsSync(path.join(stagingRoot, 'config'))) {
      await withRetry(() => fs.renameSync(path.join(stagingRoot, 'config'), configDir));
    }
    if (fs.existsSync(path.join(stagingRoot, 'documents'))) {
      await withRetry(() => fs.renameSync(path.join(stagingRoot, 'documents'), documentsDir));
    }
  } catch (err) {
    // Critical rollback: restore tombstones to original locations (best effort).
    if (fs.existsSync(path.join(tombstoneRoot, 'data')) && !fs.existsSync(dataDir)) {
      try { await withRetry(() => fs.renameSync(path.join(tombstoneRoot, 'data'), dataDir)); } catch {}
    }
    if (fs.existsSync(path.join(tombstoneRoot, 'config')) && !fs.existsSync(configDir)) {
      try { await withRetry(() => fs.renameSync(path.join(tombstoneRoot, 'config'), configDir)); } catch {}
    }
    if (fs.existsSync(path.join(tombstoneRoot, 'documents')) && !fs.existsSync(documentsDir)) {
      try { await withRetry(() => fs.renameSync(path.join(tombstoneRoot, 'documents'), documentsDir)); } catch {}
    }
    try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch {}
    throw new Error(
      `Errore durante la sostituzione finale: ${err.message}\n\n` +
      `Recovery automatico disponibile al prossimo avvio dell'app.\n` +
      `Backup di sicurezza disponibile in:\n${preRestoreStats.backup_dir}`
    );
  }

  // ── Phase 4: cleanup (non-critical) ─────────────────────────────────────
  try { fs.rmSync(tombstoneRoot, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch {}

  logBackupEvent('restored', {
    backup_dir: backupDir,
    restored_at: new Date().toISOString(),
    manifest_type: validation.manifest?.type || '',
  });

  return {
    success: true,
    backup_dir: backupDir,
    manifest: validation.manifest,
    pre_restore_backup_dir: preRestoreStats?.backup_dir || '',
  };
}

function shouldRunScheduledBackup(settings, now = new Date()) {
  const last = settings.backup.last_auto_backup_at ? new Date(settings.backup.last_auto_backup_at) : null;
  if (!last || Number.isNaN(last.getTime())) return true;
  const todayKey = now.toISOString().slice(0, 10);
  const lastKey = last.toISOString().slice(0, 10);
  return todayKey !== lastKey;
}

async function createBackupSafe(type = 'automatic') {
  if (type !== 'automatic') {
    return createBackup(type);
  }

  const settings = settingsService.getSettings();
  if (!shouldRunScheduledBackup(settings)) {
    logBackupMessage('Backup saltato: già eseguito oggi');
    await rotateAutomaticBackups();
    return null;
  }

  const backup = createBackup('automatic');
  await rotateAutomaticBackups();
  logBackupMessage('Backup eseguito');
  return backup;
}

async function maybeRunAutomaticBackup() {
  try {
    return await createBackupSafe('automatic');
  } catch (error) {
    logBackupEvent('failed', {
      type: 'automatic',
      message: error?.message || String(error),
    });
    return null;
  }
}

async function maybeRunExitBackup() {
  const settings = settingsService.getSettings();
  if (!settings.backup.backup_on_exit) {
    return null;
  }

  try {
    return await createBackupSafe('automatic');
  } catch (error) {
    logBackupEvent('failed', {
      type: 'automatic-exit',
      message: error?.message || String(error),
    });
    return null;
  }
}

function createOperationSafetyBackup(reason = 'operazione_critica') {
  const normalizedReason = String(reason || 'operazione_critica').trim().replace(/\s+/g, '_').toLowerCase();
  return createBackup(`pre-operation-${normalizedReason}`);
}

async function checkAndHandleIncompleteRestore() {
  const userDataRoot = getUserDataRoot();
  if (!fs.existsSync(userDataRoot)) return;

  let entries;
  try {
    entries = fs.readdirSync(userDataRoot, { withFileTypes: true });
  } catch {
    return;
  }

  const stagingDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith('restore-staging-'))
    .map((e) => path.join(userDataRoot, e.name))
    .sort();

  const tombstoneDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith('restore-tombstone-'))
    .map((e) => path.join(userDataRoot, e.name))
    .sort();

  if (stagingDirs.length === 0 && tombstoneDirs.length === 0) return;

  const dataDir = path.join(userDataRoot, 'data');
  const configDir = path.join(userDataRoot, 'config');
  const documentsDir = path.join(userDataRoot, 'documents');

  // If all three main dirs are present the restore completed (or never started).
  // Clean up orphaned staging/tombstone silently and proceed.
  if (fs.existsSync(dataDir) && fs.existsSync(configDir) && fs.existsSync(documentsDir)) {
    for (const dir of [...stagingDirs, ...tombstoneDirs]) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
    return;
  }

  const newestTombstone = tombstoneDirs[tombstoneDirs.length - 1] || null;
  const newestStaging = stagingDirs[stagingDirs.length - 1] || null;

  const hasTombstone = newestTombstone !== null;
  const hasStaging = newestStaging !== null;

  let detail = 'Un tentativo di ripristino precedente non è stato completato.\n\n';
  if (hasTombstone) detail += `Dati originali (pre-restore): ${newestTombstone}\n`;
  if (hasStaging) detail += `Dati dal backup: ${newestStaging}\n`;
  detail += '\nL\'azione consigliata è "Ripristina dati precedenti" per annullare il restore fallito.';

  const buttons = [];
  if (hasTombstone) buttons.push('Ripristina dati precedenti (consigliato)');
  if (hasStaging && !hasTombstone) buttons.push('Completa il ripristino dal backup');
  buttons.push('Ignora e avvia (avanzato)');

  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: 'Ripristino incompleto rilevato',
    message: 'Ripristino incompleto rilevato',
    detail,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  });

  const chosen = buttons[response];

  if (chosen === 'Ripristina dati precedenti (consigliato)' && hasTombstone) {
    try {
      const td = path.join(newestTombstone, 'data');
      const tc = path.join(newestTombstone, 'config');
      const tdoc = path.join(newestTombstone, 'documents');

      if (fs.existsSync(td) && !fs.existsSync(dataDir)) {
        await withRetry(() => fs.renameSync(td, dataDir));
      }
      if (fs.existsSync(tc) && !fs.existsSync(configDir)) {
        await withRetry(() => fs.renameSync(tc, configDir));
      }
      if (fs.existsSync(tdoc) && !fs.existsSync(documentsDir)) {
        await withRetry(() => fs.renameSync(tdoc, documentsDir));
      }

      for (const dir of [...stagingDirs, ...tombstoneDirs]) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      }
    } catch (err) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Errore recovery',
        message: `Errore durante il recovery: ${err.message}`,
        detail: `Cartella tombstone: ${newestTombstone}\nSposta manualmente le sottocartelle data/, config/, documents/ nella cartella principale dati dell'app.`,
        buttons: ['OK'],
      });
    }
  } else if (chosen === 'Completa il ripristino dal backup' && hasStaging) {
    try {
      const sd = path.join(newestStaging, 'data');
      const sc = path.join(newestStaging, 'config');
      const sdoc = path.join(newestStaging, 'documents');

      if (fs.existsSync(sd) && !fs.existsSync(dataDir)) {
        await withRetry(() => fs.renameSync(sd, dataDir));
      }
      if (fs.existsSync(sc) && !fs.existsSync(configDir)) {
        await withRetry(() => fs.renameSync(sc, configDir));
      }
      if (fs.existsSync(sdoc) && !fs.existsSync(documentsDir)) {
        await withRetry(() => fs.renameSync(sdoc, documentsDir));
      }

      for (const dir of [...stagingDirs, ...tombstoneDirs]) {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      }
    } catch (err) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Errore recovery',
        message: `Errore durante il completamento del ripristino: ${err.message}`,
        detail: `Cartella staging: ${newestStaging}\nSposta manualmente le sottocartelle data/, config/, documents/ nella cartella principale dati dell'app.`,
        buttons: ['OK'],
      });
    }
  } else {
    // 'Ignora e avvia': clean up orphaned dirs so the dialog does not reappear.
    for (const dir of [...stagingDirs, ...tombstoneDirs]) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  }
}

module.exports = {
  checkAndHandleIncompleteRestore,
  chooseRestoreBackup,
  createBackup,
  createBackupSafe,
  createOperationSafetyBackup,
  getEffectiveBackupDir,
  listBackups,
  maybeRunAutomaticBackup,
  maybeRunExitBackup,
  openBackupDirectory,
  rotateAutomaticBackups,
  restoreBackup,
  setLogger,
  validateBackup,
};
