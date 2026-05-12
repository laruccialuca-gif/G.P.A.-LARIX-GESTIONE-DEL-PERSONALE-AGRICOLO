const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { getVariantConfig, isDemoVariant } = require('./runtimeContext');

const { appDataDirName, legacyAppDataDirName, legacyPackageUserDataDirName } = getVariantConfig();
const STABLE_APP_DATA_DIRNAME = appDataDirName;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function copyDirRecursive(sourceDir, targetDir) {
  if (!fs.existsSync(sourceDir)) return;

  ensureDir(targetDir);
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(sourcePath, targetPath);
    } else if (entry.isFile() && !fs.existsSync(targetPath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function getLegacyElectronUserDataRoot() {
  return app.getPath('userData');
}

function getPackageLegacyUserDataRoot() {
  return path.join(app.getPath('appData'), legacyPackageUserDataDirName);
}

function getUserDataRoot() {
  const envOverride = process.env.GPA_USER_DATA_PATH
    ? String(process.env.GPA_USER_DATA_PATH).trim()
    : '';
  if (envOverride) {
    return envOverride;
  }

  const stableRoot = path.join(app.getPath('appData'), STABLE_APP_DATA_DIRNAME);
  const legacyRoot = getLegacyElectronUserDataRoot();
  const namedLegacyRoot = path.join(app.getPath('appData'), legacyAppDataDirName);
  const packageLegacyRoot = getPackageLegacyUserDataRoot();

  if (stableRoot !== namedLegacyRoot && !fs.existsSync(stableRoot) && fs.existsSync(namedLegacyRoot)) {
    return namedLegacyRoot;
  }

  if (stableRoot !== packageLegacyRoot && !fs.existsSync(stableRoot) && fs.existsSync(packageLegacyRoot)) {
    return packageLegacyRoot;
  }

  if (stableRoot !== legacyRoot && !fs.existsSync(stableRoot) && fs.existsSync(legacyRoot)) {
    return legacyRoot;
  }

  return stableRoot;
}

function getDataDir() {
  return ensureDir(path.join(getUserDataRoot(), 'data'));
}

function getConfigDir() {
  return ensureDir(path.join(getUserDataRoot(), 'config'));
}

function getDocumentsDir() {
  return ensureDir(path.join(getUserDataRoot(), 'documents'));
}

function getBackupsDir() {
  return ensureDir(path.join(getUserDataRoot(), 'backups'));
}

function getUpdatesDir() {
  return ensureDir(path.join(getUserDataRoot(), 'updates'));
}

function getStorageLayout() {
  return {
    userDataRoot: getUserDataRoot(),
    dataDir: getDataDir(),
    configDir: getConfigDir(),
    documentsDir: getDocumentsDir(),
    backupsDir: getBackupsDir(),
    updatesDir: getUpdatesDir(),
  };
}

function ensureAppStorageStructure() {
  const layout = getStorageLayout();
  const userDataRoot = ensureDir(layout.userDataRoot);
  const legacyRoot = getLegacyElectronUserDataRoot();
  const namedLegacyRoot = path.join(app.getPath('appData'), legacyAppDataDirName);
  const packageLegacyRoot = getPackageLegacyUserDataRoot();

  if (namedLegacyRoot !== userDataRoot && fs.existsSync(namedLegacyRoot)) {
    copyDirRecursive(path.join(namedLegacyRoot, 'data'), path.join(userDataRoot, 'data'));
    copyDirRecursive(path.join(namedLegacyRoot, 'config'), path.join(userDataRoot, 'config'));
    copyDirRecursive(path.join(namedLegacyRoot, 'documents'), path.join(userDataRoot, 'documents'));
    copyDirRecursive(path.join(namedLegacyRoot, 'backups'), path.join(userDataRoot, 'backups'));
    copyDirRecursive(path.join(namedLegacyRoot, 'updates'), path.join(userDataRoot, 'updates'));
  }

  if (packageLegacyRoot !== userDataRoot && fs.existsSync(packageLegacyRoot)) {
    copyDirRecursive(path.join(packageLegacyRoot, 'data'), path.join(userDataRoot, 'data'));
    copyDirRecursive(path.join(packageLegacyRoot, 'config'), path.join(userDataRoot, 'config'));
    copyDirRecursive(path.join(packageLegacyRoot, 'documents'), path.join(userDataRoot, 'documents'));
    copyDirRecursive(path.join(packageLegacyRoot, 'backups'), path.join(userDataRoot, 'backups'));
    copyDirRecursive(path.join(packageLegacyRoot, 'updates'), path.join(userDataRoot, 'updates'));
  }

  if (legacyRoot !== userDataRoot && fs.existsSync(legacyRoot)) {
    copyDirRecursive(path.join(legacyRoot, 'data'), path.join(userDataRoot, 'data'));
    copyDirRecursive(path.join(legacyRoot, 'config'), path.join(userDataRoot, 'config'));
    copyDirRecursive(path.join(legacyRoot, 'documents'), path.join(userDataRoot, 'documents'));
    copyDirRecursive(path.join(legacyRoot, 'backups'), path.join(userDataRoot, 'backups'));
    copyDirRecursive(path.join(legacyRoot, 'updates'), path.join(userDataRoot, 'updates'));
  }

  return {
    ...layout,
    userDataRoot,
    isDemo: isDemoVariant(),
  };
}

module.exports = {
  ensureAppStorageStructure,
  getBackupsDir,
  getConfigDir,
  getDataDir,
  getDocumentsDir,
  getLegacyElectronUserDataRoot,
  getPackageLegacyUserDataRoot,
  getStorageLayout,
  STABLE_APP_DATA_DIRNAME,
  getUpdatesDir,
  getUserDataRoot,
};
