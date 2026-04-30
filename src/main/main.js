const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { getAppVariant, getVariantConfig } = require('./runtimeContext');

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
  app.setPath('userData', getResolvedUserDataPath());
}

configureAppIdentity();

const LOG_MAX_BYTES = 5 * 1024 * 1024;

function appendMainProcessLog(context, errorLike) {
  try {
    const targetDir = app.isReady() ? app.getPath('userData') : getResolvedUserDataPath();
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
  return {
    variant: getAppVariant(),
    product_name: variantConfig.productName,
    app_name: app.getName(),
    user_data_path: app.getPath('userData'),
    log_file: path.join(app.getPath('userData'), 'main-process.log'),
    executable_path: app.getPath('exe'),
    app_path: app.getAppPath(),
    cwd: process.cwd(),
    packaged: app.isPackaged,
    known_user_data_paths: getKnownUserDataPaths(),
  };
}

const employeeRepo = require('./employeeRepo');
const pdfImportService = require('./pdfImportService');
const attendanceRepo = require('./attendanceRepo');
const payrollRepo = require('./payrollRepo');
const dashboardRepo = require('./dashboardRepo');
const teamsRepo = require('./teamsRepo');
const communicationRepo = require('./communicationRepo');
const occupationRepo = require('./occupationRepo');
const settingsService = require('./settingsService');
const backupService = require('./backupService');
const licenseService = require('./licenseService');
const demoService = require('./demoService');
const { getDb, getDbPath, closeDb } = require('./db');
const { ensureAppStorageStructure } = require('./storagePaths');

const isDev = !app.isPackaged;

function getAppIconPath() {
  return path.join(__dirname, '..', 'assets', 'larix-icon.png');
}
let mainWindow = null;

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

  if (isDev) {
    const devUrl = 'http://localhost:5173';
    logMainProcessEvent('renderer:load-url', { target: devUrl });
    await mainWindow.loadURL(devUrl);
  } else {
    logMainProcessEvent('renderer:load-file', { target: rendererEntryPath });
    await mainWindow.loadFile(rendererEntryPath);
  }

  mainWindow.show();
}

function buildPdfHtml(contentHtml, landscape = false) {
  return `
  <!doctype html>
  <html lang="it">
    <head>
      <meta charset="UTF-8" />
      <title>Report PDF</title>
      <style>
        @page {
          size: A4 ${landscape ? 'landscape' : 'portrait'};
          margin: 10mm;
        }

        html, body {
          margin: 0;
          padding: 0;
          background: white;
          font-family: Arial, Helvetica, sans-serif;
          color: #111827;
          font-size: 10px;
          line-height: 1.35;
        }

        * {
          box-sizing: border-box;
        }

        .print-root {
          width: 100%;
          padding: 0;
          margin: 0;
        }

        .print-area {
          width: 100%;
          margin: 0 auto;
        }

        .print-sheet {
          width: 100%;
          max-width: 200mm;
          margin: 0 auto;
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .print-block {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .employee-print-layout {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
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
        ${contentHtml}
      </div>
    </body>
  </html>
  `;
}

async function createPrintWindow({ html, landscape = false, show = false }) {
  const printWindow = new BrowserWindow({
    show,
    width: landscape ? 1400 : 794,
    height: landscape ? 900 : 1123,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const finalHtml = buildPdfHtml(html, landscape);

  await printWindow.loadURL(
    `data:text/html;charset=UTF-8,${encodeURIComponent(finalHtml)}`
  );

  await new Promise((resolve) => setTimeout(resolve, 500));

  if (show) {
    printWindow.show();
    printWindow.focus();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return printWindow;
}

async function renderPdfToFile({ html, filePath, landscape = false }) {
  const pdfWindow = await createPrintWindow({ html, landscape, show: false });

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

async function printHtmlDocument({ html, landscape = false, fileName }) {
  const tempPdfPath = buildTempPdfPath(fileName);
  await renderPdfToFile({
    html,
    filePath: tempPdfPath,
    landscape,
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
    excel_relative_path: fileTargets.excel.relativePath,
  });
}

app.whenReady().then(async () => {
  configureAppIdentity();
  cleanDemoBootstrapData();
  const storageLayout = ensureAppStorageStructure();
  await backupService.checkAndHandleIncompleteRestore();
  getDb();
  pdfImportService.init({ userDataDir: app.getPath('userData') });
  logMainProcessEvent('bootstrap:runtime-info', {
    ...buildAppIdentitySnapshot(),
    resolved_user_data_path: getResolvedUserDataPath(),
    storage_layout: storageLayout,
    database_path: getDbPath(),
    preload_path: getPreloadPath(),
    preload_exists: fs.existsSync(getPreloadPath()),
    renderer: getRendererAssetInfo(),
  });
  if (variantConfig.variant === 'demo') {
    demoService.ensureDemoInitialized();
  }
  backupService.maybeRunAutomaticBackup();

  ipcMain.handle('dashboard:summary', async () => dashboardRepo.getDashboardSummary());
  ipcMain.handle('license:getStatus', async () => licenseService.getLicenseStatus());
  ipcMain.handle('license:activate', async (_, activationCode) => licenseService.activate(activationCode));
  ipcMain.handle('license:deactivate', async () => licenseService.deactivate());
  ipcMain.handle('license:getActivationRequest', async () => licenseService.createActivationRequest());
  ipcMain.handle('appRuntime:getInfo', async () => buildAppRuntimeInfo());
  ipcMain.handle('appRuntime:getAvailableYears', async () => buildAvailableYears());
  if (variantConfig.variant === 'demo') {
    ipcMain.handle('demo:markWelcomeSeen', async () => demoService.markWelcomeSeen());
    ipcMain.handle('demo:reset', async () => demoService.resetDemoData());
  }

  ipcMain.handle('settings:get', async () => settingsService.buildSettingsSummary());
  ipcMain.handle('settings:save', async (_, payload) => settingsService.buildSettingsSummary(settingsService.saveSettings(payload)));
  ipcMain.handle('settings:unlockAdmin', async (_, pin) => settingsService.buildSettingsSummary(settingsService.unlockAdmin(pin)));
  ipcMain.handle('settings:setRole', async (_, role) => settingsService.buildSettingsSummary(settingsService.setCurrentRole(role)));
  ipcMain.handle('settings:chooseBackupDirectory', async () => {
    const result = await settingsService.chooseBackupDirectory(mainWindow);
    return result.canceled ? result : { ...result, settings: settingsService.buildSettingsSummary(result.settings) };
  });
  ipcMain.handle('settings:uploadLogo', async () => {
    const result = await settingsService.uploadCompanyLogo(mainWindow);
    return result.canceled ? result : { ...result, settings: settingsService.buildSettingsSummary(result.settings) };
  });
  ipcMain.handle('settings:chooseLogoFile', async () => settingsService.chooseCompanyLogoFile(mainWindow));
  ipcMain.handle('settings:uploadMarkerAsset', async () => settingsService.uploadMarkerAsset(mainWindow));
  ipcMain.handle('settings:removeLogo', async () => settingsService.buildSettingsSummary(settingsService.removeCompanyLogo()));

  ipcMain.handle('backups:list', async () => backupService.listBackups());
  ipcMain.handle('backups:create', async (_, type) => {
    settingsService.requireAdmin();
    return backupService.createBackup(type || 'manual');
  });
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
      if (isDev) {
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

  ipcMain.handle('employees:list', async (_, options) => employeeRepo.listEmployees(options));
  ipcMain.handle('employees:getById', async (_, id, options) => employeeRepo.getEmployeeById(id, options));
  ipcMain.handle('employees:findHistoryMatches', async (_, criteria) =>
    employeeRepo.findEmployeeHistoryMatches(criteria)
  );
  ipcMain.handle('employees:create', async (_, payload) => employeeRepo.createEmployee(payload));
  ipcMain.handle('employees:update', async (_, id, payload) => employeeRepo.updateEmployee(id, payload));
  ipcMain.handle('employees:archive', async (_, id) => employeeRepo.archiveEmployee(id));
  ipcMain.handle('employees:restore', async (_, id) => employeeRepo.restoreEmployee(id));
  ipcMain.handle('employees:uploadHireDocument', async (_, employeeId) =>
    employeeRepo.uploadHireDocument(mainWindow, employeeId)
  );
  ipcMain.handle('employees:uploadHireDocumentForPeriod', async (_, employeeId, employmentPeriodId) =>
    employeeRepo.uploadHireDocumentForEmploymentPeriod(mainWindow, employeeId, employmentPeriodId)
  );
  ipcMain.handle('employees:openHireDocument', async (_, employeeId) =>
    employeeRepo.openHireDocument(employeeId)
  );
  ipcMain.handle('employees:openHireDocumentForPeriod', async (_, employeeId, employmentPeriodId) =>
    employeeRepo.openHireDocumentForEmploymentPeriod(employeeId, employmentPeriodId)
  );
  ipcMain.handle('employees:deleteHireDocument', async (_, employeeId) =>
    employeeRepo.deleteHireDocument(employeeId)
  );
  ipcMain.handle('employees:deleteHireDocumentForPeriod', async (_, employeeId, employmentPeriodId) =>
    employeeRepo.deleteHireDocumentForEmploymentPeriod(employeeId, employmentPeriodId)
  );
  ipcMain.handle('employees:uploadArt37Document', async (_, employeeId) =>
    employeeRepo.uploadArt37Document(mainWindow, employeeId)
  );
  ipcMain.handle('employees:openArt37Document', async (_, employeeId) =>
    employeeRepo.openArt37Document(employeeId)
  );
  ipcMain.handle('employees:deleteArt37Document', async (_, employeeId) =>
    employeeRepo.deleteArt37Document(employeeId)
  );
  ipcMain.handle('employees:uploadMedicalVisitDocument', async (_, employeeId) =>
    employeeRepo.uploadMedicalVisitDocument(mainWindow, employeeId)
  );
  ipcMain.handle('employees:openMedicalVisitDocument', async (_, employeeId) =>
    employeeRepo.openMedicalVisitDocument(employeeId)
  );
  ipcMain.handle('employees:deleteMedicalVisitDocument', async (_, employeeId) =>
    employeeRepo.deleteMedicalVisitDocument(employeeId)
  );
  ipcMain.handle('occupations:list', async () => occupationRepo.listOccupations());
  ipcMain.handle('occupations:create', async (_, name) => occupationRepo.ensureOccupation(name));

  ipcMain.handle('teams:list', async (_, options) => teamsRepo.listTeams(options));
  ipcMain.handle('teams:getById', async (_, id, options) => teamsRepo.getTeamById(id, options));
  ipcMain.handle('teams:create', async (_, payload) => teamsRepo.createTeam(payload));
  ipcMain.handle('teams:update', async (_, id, payload) => teamsRepo.updateTeam(id, payload));
  ipcMain.handle('teams:archive', async (_, id) => teamsRepo.archiveTeam(id));
  ipcMain.handle('teams:restore', async (_, id) => teamsRepo.restoreTeam(id));
  ipcMain.handle('employees:deletePermanently', async (_, id) => employeeRepo.deleteEmployeePermanently(id));
  ipcMain.handle('teams:deletePermanently', async (_, id) => teamsRepo.deleteTeamPermanently(id));

  ipcMain.handle('employees:parsePdfImport', async (_, options = {}) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Seleziona PDF assunzioni',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths[0]) return { canceled: true };
    const records = await pdfImportService.parsePdfAssunzioni(filePaths[0]);
    const enriched = pdfImportService.checkDuplicates(records, {
      targetYear: getTargetYear(options),
    });
    return { canceled: false, filePath: filePaths[0], records: enriched };
  });

  ipcMain.handle('employees:confirmPdfImport', async (_, { filePath, rows }) => {
    const results = [];
    for (const row of rows) {
      if (!row.selected) continue;
      const datori = row.hired_by === 'entrambi' ? ['LC', 'LG'] : [row.hired_by];
      const normDate = pdfImportService.normDateToISO;
      try {
        if (row.import_action === 'già_presente') {
          results.push({ fiscal_code: row.fiscal_code, action: 'saltato', employee_id: row.existing_employee_id });
        } else if (row.import_action === 'esistente') {
          const periodTargets = [];
          for (const datore of datori) {
            const period = employeeRepo.addEmploymentPeriodToEmployee(row.existing_employee_id, {
              hire_date_from: normDate(row.hire_date_from),
              hire_date_to: normDate(row.hire_date_to),
              hired_by: datore,
            });
            periodTargets.push({
              employmentPeriodId: period.id,
              hiredBy: datore,
            });
          }
          await pdfImportService.attachEmployeePages(
            filePath,
            row.page_index,
            row.existing_employee_id,
            row.first_name,
            row.last_name,
            periodTargets
          );
          results.push({ fiscal_code: row.fiscal_code, action: 'aggiornato', employee_id: row.existing_employee_id });
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
            periodTargets.push({
              employmentPeriodId: firstPeriod.id,
              hiredBy: datori[0],
            });
          }
          if (datori.length > 1) {
            const secondPeriod = employeeRepo.addEmploymentPeriodToEmployee(emp.id, {
              hire_date_from: normDate(row.hire_date_from),
              hire_date_to: normDate(row.hire_date_to),
              hired_by: datori[1],
            });
            periodTargets.push({
              employmentPeriodId: secondPeriod.id,
              hiredBy: datori[1],
            });
          }
          await pdfImportService.attachEmployeePages(
            filePath,
            row.page_index,
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
    return results;
  });

  ipcMain.handle('communications:list', async () => communicationRepo.listCommunications());
  ipcMain.handle('communications:save', async (_, payload) => {
    const communication = communicationRepo.saveCommunication(payload);
    return persistCommunicationArtifacts(communication.id);
  });
  ipcMain.handle('communications:delete', async (_, id) =>
    communicationRepo.deleteCommunication(id)
  );
  ipcMain.handle('communications:openFile', async (_, id, type) =>
    communicationRepo.openCommunicationFile(id, type)
  );
  ipcMain.handle('communications:sendEmail', async (_, id, options) => {
    await persistCommunicationArtifacts(id);
    return communicationRepo.openCommunicationEmail(id, options);
  });

  ipcMain.handle('attendance:save', async (_, payload) => attendanceRepo.saveAttendance(payload));
  ipcMain.handle('attendance:bulkUpsert', async (_, payload) => attendanceRepo.bulkUpsertAttendance(payload));
  ipcMain.handle('attendance:listByMonth', async (_, year, month) =>
    attendanceRepo.listAttendanceByMonth(year, month)
  );
  ipcMain.handle('attendance:monthlySummary', async (_, month) =>
    attendanceRepo.getMonthlySummary(month)
  );
  ipcMain.handle('attendance:getMatrix', async (_, month) =>
    attendanceRepo.getAttendanceMatrix(month)
  );

  ipcMain.handle('payroll:saveRecord', async (_, payload) =>
    payrollRepo.upsertPayrollRecord(payload)
  );
  ipcMain.handle('payroll:listByEmployee', async (_, employeeId) =>
    payrollRepo.listPayrollRecordsByEmployee(employeeId)
  );
  ipcMain.handle('payroll:listHistory', async () =>
    payrollRepo.listPayrollHistory()
  );
  ipcMain.handle('payroll:getRecord', async (_, employeeId, month) =>
    payrollRepo.getPayrollRecord(employeeId, month)
  );
  ipcMain.handle('payroll:getPreviousBalance', async (_, employeeId, month) =>
    payrollRepo.getPreviousBalance(employeeId, month)
  );
  ipcMain.handle('payroll:uploadDocument', async (_, employeeId, month) =>
    payrollRepo.uploadPayrollDocument(mainWindow, employeeId, month)
  );
  ipcMain.handle('payroll:openDocument', async (_, employeeId, month) =>
    payrollRepo.openPayrollDocument(employeeId, month)
  );
  ipcMain.handle('payroll:deleteDocument', async (_, employeeId, month) =>
    payrollRepo.deletePayrollDocument(employeeId, month)
  );
  ipcMain.handle('payroll:archiveRecord', async (_, id) =>
    payrollRepo.archivePayrollRecord(id)
  );
  ipcMain.handle('payroll:restoreRecord', async (_, id) =>
    payrollRepo.restorePayrollRecord(id)
  );
  ipcMain.handle('payroll:deleteRecord', async (_, id) =>
    payrollRepo.deletePayrollRecord(id)
  );

  ipcMain.handle('reports:savePdf', async (_, payload) => {
    const defaultFileName = payload?.fileName || 'report.pdf';
    const html = payload?.html || '';
    const landscape = !!payload?.landscape;

    if (!html.trim()) {
      throw new Error('HTML report mancante');
    }

    const tempPdfPath = buildTempPdfPath(defaultFileName);
    await renderPdfToFile({
      html,
      filePath: tempPdfPath,
      landscape,
    });

    const openResult = await shell.openPath(tempPdfPath);
    if (openResult) {
      throw new Error(openResult);
    }

    return {
      canceled: false,
      preview_file_path: tempPdfPath,
    };
  });

  ipcMain.handle('reports:printHtml', async (_, payload) => {
    const html = payload?.html || '';
    const landscape = !!payload?.landscape;
    const fileName = payload?.fileName || 'stampa.pdf';

    if (!html.trim()) {
      throw new Error('HTML report mancante');
    }

    return printHtmlDocument({
      html,
      landscape,
      fileName,
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

app.on('before-quit', () => {
  backupService.maybeRunExitBackup();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
