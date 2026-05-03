const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog } = require('electron');
const { getConfigDir, getBackupsDir, getStorageLayout, getUpdatesDir } = require('./storagePaths');
const { getDbPath, getDatabaseRuntimeInfo } = require('./db');
const { defaultUpdateSettings, normalizeUpdateSettings, buildUpdateRuntimeSummary } = require('./updateService');
const { getAppVariant, getRuntimeContext, isDemoVariant } = require('./runtimeContext');

const SETTINGS_FILE_NAME = 'settings.json';
const LOGO_FILE_PREFIX = 'company-logo';
const MARKER_ASSETS_DIR_NAME = 'markers';
const MARKER_FILE_PREFIX = 'marker-image';
const LICENSE_FILE_NAME = 'license.dat';
const DEFAULT_ATTENDANCE_MARKERS = [
  {
    value: 'P',
    text: 'Piselli',
    symbol: '🌱',
    image: '',
    color: '#166534',
    background: 'rgba(34, 197, 94, 0.16)',
    active: true,
  },
  {
    value: 'C',
    text: 'Ciliegie',
    symbol: '🍒',
    image: '',
    color: '#b91c1c',
    background: 'rgba(239, 68, 68, 0.16)',
    active: true,
  },
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function getSettingsFilePath() {
  return path.join(getConfigDir(), SETTINGS_FILE_NAME);
}

function defaultSettings() {
  const currentYear = new Date().getFullYear();
  return {
    setup: {
      completed: false,
      completed_at: '',
      initial_year: currentYear,
    },
    company: {
      name: 'Gestionale Presenze',
      logo_path: null,
      logo_file_name: null,
      document_header: 'Gestionale Presenze',
      email: '',
      contacts: '',
    },
    employers: {
      mode: 'two',
      items: [
        { key: 'employer_1', name: 'Laruccia Cosimo', short_name: 'LC' },
        { key: 'employer_2', name: 'Laruccia Giuseppe', short_name: 'LG' },
      ],
      pdf_import_mappings: [],
    },
    general: {
      standard_day_hours: 7,
      attendance_entry_mode: 'hours_and_symbol',
      attendance_hours_format: 'decimal',
      overtime_enabled: false,
      overtime_hourly_rate: 0,
      overtime_display_mode: 'included',
      overtime_show_hourly_rate: true,
      attendance_quick_symbol: 'X',
      attendance_auto_symbolize_base_hours: false,
      legend_colors: {
        ferie: '#3b82f6',
        permesso: '#8b5cf6',
        malattia: '#f59e0b',
        marker_p: '#16a34a',
        marker_c: '#dc2626',
      },
      custom_labels: {},
      print_options: {
        show_transport: true,
        show_advances: true,
        show_compensation: true,
      },
    },
    security: {
      current_role: 'standard',
      admin_pin: '1234',
    },
    backup: {
      directory: getBackupsDir(),
      automatic_mode: 'none',
      backup_on_exit: false,
      last_auto_backup_at: null,
    },
    cloud: {
      enabled: false,
      provider: 'future',
      bucket_name: '',
      folder: '',
      encrypt_archives: false,
      compression_enabled: true,
      sync_mode: 'backup_only',
      versioning_strategy: 'timestamped',
      conflict_strategy: 'manual_review',
    },
    software: {
      updates: defaultUpdateSettings(),
    },
    licensing: {
      install_id: crypto.randomUUID(),
      license_key: '',
      activation_status: 'not_activated',
      license_id: '',
      customer_name: '',
      company_name: '',
      activated_at: '',
      expires_at: '',
      max_installations: 1,
      notes_admin: '',
    },
  };
}

function deepMerge(base, override) {
  if (Array.isArray(base)) {
    return Array.isArray(override) ? override : base;
  }

  if (base && typeof base === 'object') {
    const result = { ...base };
    for (const key of Object.keys(override || {})) {
      if (override[key] === undefined) continue;
      result[key] = deepMerge(base[key], override[key]);
    }
    return result;
  }

  return override !== undefined ? override : base;
}

function normalizeEmployerItem(item, index) {
  const fallbackShort = index === 0 ? 'LC' : index === 1 ? 'LG' : `D${index + 1}`;
  return {
    key: item?.key || `employer_${index + 1}`,
    name: String(item?.name || '').trim() || `Datore ${index + 1}`,
    short_name: String(item?.short_name || '').trim().toUpperCase() || fallbackShort,
    tax_id: String(item?.tax_id || '').trim().toUpperCase(),
    workplace: String(item?.workplace || '').trim(),
  };
}

function normalizeEmployerMatchToken(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function normalizePdfEmployerMapping(mapping, index) {
  return {
    id: String(mapping?.id || crypto.randomUUID()),
    pdf_name: String(mapping?.pdf_name || '').trim(),
    pdf_tax_id: String(mapping?.pdf_tax_id || '').trim().toUpperCase(),
    pdf_workplace: String(mapping?.pdf_workplace || '').trim(),
    employer_short_name: String(mapping?.employer_short_name || '').trim().toUpperCase(),
    created_at: String(mapping?.created_at || new Date().toISOString()),
  };
}

function slugifyMarkerValue(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 16);
}

function normalizeAttendanceMarkers(markers) {
  const source = Array.isArray(markers) && markers.length ? markers : DEFAULT_ATTENDANCE_MARKERS;
  const usedValues = new Set();

  return source.map((marker, index) => {
    const baseValue =
      slugifyMarkerValue(marker?.value) ||
      slugifyMarkerValue(marker?.text) ||
      `MARKER_${index + 1}`;

    let nextValue = baseValue;
    let suffix = 2;
    while (usedValues.has(nextValue)) {
      nextValue = `${baseValue}_${suffix}`;
      suffix += 1;
    }
    usedValues.add(nextValue);

    return {
      value: nextValue,
      text: String(marker?.text || `Marker ${index + 1}`).trim() || `Marker ${index + 1}`,
      symbol: String(marker?.symbol || '•').trim() || '•',
      image: String(marker?.image || '').trim(),
      color: String(marker?.color || '#27445f').trim() || '#27445f',
      background: String(marker?.background || 'rgba(20, 33, 61, 0.08)').trim() || 'rgba(20, 33, 61, 0.08)',
      active: marker?.active !== false,
    };
  });
}

function normalizeSettings(input = {}) {
  const currentYear = new Date().getFullYear();
  const hasExistingPayload = !!input && typeof input === 'object' && Object.keys(input).length > 0;
  const merged = deepMerge(defaultSettings(), input || {});

  const mode = merged.employers?.mode === 'one' ? 'one' : 'two';
  const sourceItems = Array.isArray(merged.employers?.items) ? merged.employers.items : [];
  const minimumItems = mode === 'one' ? 1 : 2;
  const targetItemsCount = mode === 'one' ? 1 : Math.max(sourceItems.length, minimumItems);
  const items = sourceItems.slice(0, targetItemsCount).map(normalizeEmployerItem);
  const pdfImportMappings = Array.isArray(merged.employers?.pdf_import_mappings)
    ? merged.employers.pdf_import_mappings
        .map(normalizePdfEmployerMapping)
        .filter((item) => item.employer_short_name)
    : [];

  while (items.length < minimumItems) {
    items.push(normalizeEmployerItem({}, items.length));
  }

  return {
    setup: {
      completed: typeof merged.setup?.completed === 'boolean' ? merged.setup.completed : hasExistingPayload,
      completed_at: String(merged.setup?.completed_at || '').trim(),
      initial_year: Number(merged.setup?.initial_year || currentYear) || currentYear,
    },
    company: {
      name: String(merged.company?.name || '').trim() || 'Gestionale Presenze',
      logo_path: merged.company?.logo_path || null,
      logo_file_name: merged.company?.logo_file_name || null,
      document_header: String(merged.company?.document_header || '').trim() || String(merged.company?.name || '').trim() || 'Gestionale Presenze',
      email: String(merged.company?.email || '').trim(),
      contacts: String(merged.company?.contacts || '').trim(),
    },
    employers: {
      mode,
      items,
      pdf_import_mappings: pdfImportMappings,
    },
    general: {
      standard_day_hours: Number(merged.general?.standard_day_hours || 7) || 7,
      attendance_entry_mode: merged.general?.attendance_entry_mode === 'hours_only'
        ? 'hours_only'
        : 'hours_and_symbol',
      attendance_hours_format: 'decimal',
      overtime_enabled: !!merged.general?.overtime_enabled,
      overtime_hourly_rate: Number(merged.general?.overtime_hourly_rate || 0) || 0,
      overtime_display_mode: merged.general?.overtime_display_mode === 'separate'
        ? 'separate'
        : 'included',
      overtime_show_hourly_rate: merged.general?.overtime_show_hourly_rate !== false,
      attendance_quick_symbol: String(merged.general?.attendance_quick_symbol || 'X')
        .trim()
        .toUpperCase()
        .slice(0, 3) || 'X',
      attendance_auto_symbolize_base_hours: !!merged.general?.attendance_auto_symbolize_base_hours,
      attendance_markers: normalizeAttendanceMarkers(merged.general?.attendance_markers),
      legend_colors: {
        ...defaultSettings().general.legend_colors,
        ...(merged.general?.legend_colors || {}),
      },
      custom_labels: merged.general?.custom_labels || {},
      print_options: {
        ...defaultSettings().general.print_options,
        ...(merged.general?.print_options || {}),
      },
    },
    security: {
      current_role: merged.security?.current_role === 'standard' ? 'standard' : 'admin',
      admin_pin: String(merged.security?.admin_pin || '1234').trim() || '1234',
    },
    backup: {
      directory: String(merged.backup?.directory || getBackupsDir()).trim() || getBackupsDir(),
      automatic_mode: ['none', 'daily', 'weekly'].includes(merged.backup?.automatic_mode)
        ? merged.backup.automatic_mode
        : 'none',
      backup_on_exit: !!merged.backup?.backup_on_exit,
      last_auto_backup_at: merged.backup?.last_auto_backup_at || null,
    },
    cloud: {
      enabled: !!merged.cloud?.enabled,
      provider: String(merged.cloud?.provider || 'future').trim() || 'future',
      bucket_name: String(merged.cloud?.bucket_name || '').trim(),
      folder: String(merged.cloud?.folder || '').trim(),
      encrypt_archives: !!merged.cloud?.encrypt_archives,
      compression_enabled: merged.cloud?.compression_enabled !== false,
      sync_mode: String(merged.cloud?.sync_mode || 'backup_only').trim() || 'backup_only',
      versioning_strategy: String(merged.cloud?.versioning_strategy || 'timestamped').trim() || 'timestamped',
      conflict_strategy: String(merged.cloud?.conflict_strategy || 'manual_review').trim() || 'manual_review',
    },
    software: {
      updates: normalizeUpdateSettings(merged.software?.updates),
    },
    licensing: {
      install_id: String(merged.licensing?.install_id || crypto.randomUUID()),
      license_key: String(merged.licensing?.license_key || '').trim(),
      activation_status: String(merged.licensing?.activation_status || 'not_activated').trim() || 'not_activated',
      license_id: String(merged.licensing?.license_id || '').trim(),
      customer_name: String(merged.licensing?.customer_name || '').trim(),
      company_name: String(merged.licensing?.company_name || '').trim(),
      activated_at: String(merged.licensing?.activated_at || '').trim(),
      expires_at: String(merged.licensing?.expires_at || '').trim(),
      max_installations: Number(merged.licensing?.max_installations || 1) || 1,
      notes_admin: String(merged.licensing?.notes_admin || '').trim(),
    },
  };
}

function readSettings() {
  const filePath = getSettingsFilePath();
  if (!fs.existsSync(filePath)) {
    const settings = normalizeSettings();
    writeSettings(settings);
    return settings;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const settings = normalizeSettings(raw);
    writeSettings(settings);
    return settings;
  } catch {
    const settings = normalizeSettings();
    writeSettings(settings);
    return settings;
  }
}

function writeSettings(settings) {
  const filePath = getSettingsFilePath();
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(normalizeSettings(settings), null, 2), 'utf8');
}

function getSettings() {
  return readSettings();
}

function requireAdmin() {
  const settings = readSettings();
  if (!isDemoVariant()) {
    return settings;
  }
  if (!settings.setup?.completed) {
    return settings;
  }
  if (settings.security.current_role !== 'admin') {
    const error = new Error("Operazione consentita solo all'amministratore.");
    error.code = 'ADMIN_REQUIRED';
    throw error;
  }
  return settings;
}

function saveSettings(partialSettings = {}) {
  requireAdmin();
  const current = readSettings();
  const next = normalizeSettings(deepMerge(current, partialSettings));
  writeSettings(next);
  return next;
}

function applyCurrentRole(role) {
  const current = readSettings();
  const next = normalizeSettings({
    ...current,
    security: {
      ...current.security,
      current_role: role === 'standard' ? 'standard' : 'admin',
    },
  });
  writeSettings(next);
  return next;
}

function setCurrentRole(role) {
  if (role === 'admin') {
    const error = new Error('Per passare al ruolo amministratore serve lo sblocco con PIN.');
    error.code = 'ADMIN_UNLOCK_REQUIRED';
    throw error;
  }
  return applyCurrentRole(role);
}

function unlockAdmin(pin) {
  const settings = readSettings();
  if (String(pin || '').trim() !== settings.security.admin_pin) {
    const error = new Error('PIN amministratore non valido.');
    error.code = 'INVALID_ADMIN_PIN';
    throw error;
  }

  return applyCurrentRole('admin');
}

function chooseBackupDirectory(browserWindow) {
  requireAdmin();
  return dialog.showOpenDialog(browserWindow, {
    title: 'Seleziona cartella backup',
    properties: ['openDirectory', 'createDirectory'],
  }).then((result) => {
    if (result.canceled || !result.filePaths?.length) {
      return { canceled: true };
    }

    const directory = result.filePaths[0];
    const settings = saveSettings({
      backup: {
        ...readSettings().backup,
        directory,
      },
    });

    return {
      canceled: false,
      directory,
      settings,
    };
  });
}

function chooseCompanyLogoFile(browserWindow) {
  requireAdmin();

  return dialog.showOpenDialog(browserWindow, {
    title: 'Seleziona logo azienda',
    properties: ['openFile'],
    filters: [
      { name: 'Immagini', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
    ],
  }).then((result) => {
    if (result.canceled || !result.filePaths?.length) {
      return { canceled: true };
    }

    const sourcePath = result.filePaths[0];
    const extension = path.extname(sourcePath).toLowerCase() || '.png';
    const targetFileName = `${LOGO_FILE_PREFIX}${extension}`;
    const relativePath = targetFileName;
    const absolutePath = path.join(getConfigDir(), relativePath);

    fs.copyFileSync(sourcePath, absolutePath);

    return {
      canceled: false,
      logo_path: relativePath,
      logo_file_name: path.basename(sourcePath),
      absolute_path: absolutePath,
    };
  });
}

function getCompanyLogoAbsolutePath() {
  const settings = readSettings();
  return settings.company.logo_path ? path.join(getConfigDir(), settings.company.logo_path) : null;
}

function uploadCompanyLogo(browserWindow) {
  return chooseCompanyLogoFile(browserWindow).then((result) => {
    if (result.canceled) {
      return result;
    }
    const settings = saveSettings({
      company: {
        ...readSettings().company,
        logo_path: result.logo_path,
        logo_file_name: result.logo_file_name,
      },
    });

    return {
      canceled: false,
      settings,
    };
  });
}

function uploadMarkerAsset(browserWindow) {
  requireAdmin();

  return dialog.showOpenDialog(browserWindow, {
    title: 'Seleziona immagine marker',
    properties: ['openFile'],
    filters: [
      { name: 'Marker', extensions: ['svg', 'png'] },
    ],
  }).then((result) => {
    if (result.canceled || !result.filePaths?.length) {
      return { canceled: true };
    }

    const sourcePath = result.filePaths[0];
    const extension = path.extname(sourcePath).toLowerCase();
    if (!['.svg', '.png'].includes(extension)) {
      const error = new Error('Seleziona solo file SVG o PNG.');
      error.code = 'INVALID_MARKER_FILE';
      throw error;
    }

    const targetDir = ensureDir(path.join(getConfigDir(), MARKER_ASSETS_DIR_NAME));
    const targetFileName = `${MARKER_FILE_PREFIX}-${Date.now()}-${crypto.randomUUID()}${extension || '.png'}`;
    const absolutePath = path.join(targetDir, targetFileName);

    fs.copyFileSync(sourcePath, absolutePath);

    return {
      canceled: false,
      imagePath: absolutePath,
      fileName: path.basename(sourcePath),
    };
  });
}

function removeCompanyLogo() {
  requireAdmin();
  const current = readSettings();
  if (current.company.logo_path) {
    const absolutePath = path.join(getConfigDir(), current.company.logo_path);
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  }

  return saveSettings({
    company: {
      ...current.company,
      logo_path: null,
      logo_file_name: null,
    },
  });
}

function getEmployerOptions(settings = readSettings()) {
  return settings.employers.items.map((item) => ({
    value: item.short_name,
    label: `${item.short_name} · ${item.name}`,
    short_name: item.short_name,
    name: item.name,
    tax_id: item.tax_id || '',
    workplace: item.workplace || '',
  }));
}

function findEmployerByShortName(settings, shortName) {
  const target = String(shortName || '').trim().toUpperCase();
  if (!target) return null;
  return (settings.employers.items || []).find((item) => String(item.short_name || '').trim().toUpperCase() === target) || null;
}

function resolvePdfEmployer(pdfEmployer = {}, settings = readSettings()) {
  const normalizedName = normalizeEmployerMatchToken(pdfEmployer.name);
  const normalizedTaxId = normalizeEmployerMatchToken(pdfEmployer.tax_id);
  const employerOptions = getEmployerOptions(settings);
  const mappings = Array.isArray(settings.employers?.pdf_import_mappings) ? settings.employers.pdf_import_mappings : [];

  const mapped = mappings.find((item) => {
    const sameTaxId = normalizedTaxId && normalizeEmployerMatchToken(item.pdf_tax_id) === normalizedTaxId;
    const sameName = normalizedName && normalizeEmployerMatchToken(item.pdf_name) === normalizedName;
    return sameTaxId || sameName;
  });

  if (mapped) {
    const employer = findEmployerByShortName(settings, mapped.employer_short_name);
    if (employer) {
      return {
        status: 'mapped',
        employer_short_name: employer.short_name,
        employer_name: employer.name,
        pdf_employer: pdfEmployer,
        employer_options: employerOptions,
      };
    }
  }

  const matchedEmployer = (settings.employers.items || []).find((item) => {
    const sameTaxId = normalizedTaxId && normalizeEmployerMatchToken(item.tax_id) === normalizedTaxId;
    const sameName = normalizedName && normalizeEmployerMatchToken(item.name) === normalizedName;
    const sameShort = normalizedName && normalizeEmployerMatchToken(item.short_name) === normalizedName;
    return sameTaxId || sameName || sameShort;
  });

  if (matchedEmployer) {
    return {
      status: 'matched',
      employer_short_name: matchedEmployer.short_name,
      employer_name: matchedEmployer.name,
      pdf_employer: pdfEmployer,
      employer_options: employerOptions,
    };
  }

  return {
    status: 'mismatch',
    employer_short_name: '',
    employer_name: '',
    pdf_employer: pdfEmployer,
    employer_options: employerOptions,
  };
}

function savePdfEmployerMapping(pdfEmployer = {}, employerShortName) {
  requireAdmin();
  const current = readSettings();
  const normalizedShortName = String(employerShortName || '').trim().toUpperCase();
  if (!normalizedShortName) {
    throw new Error('Datore interno non specificato.');
  }

  const nextMappings = [
    ...(Array.isArray(current.employers?.pdf_import_mappings) ? current.employers.pdf_import_mappings : []),
  ];
  const normalizedName = normalizeEmployerMatchToken(pdfEmployer.name);
  const normalizedTaxId = normalizeEmployerMatchToken(pdfEmployer.tax_id);
  const existingIndex = nextMappings.findIndex((item) => {
    const sameTaxId = normalizedTaxId && normalizeEmployerMatchToken(item.pdf_tax_id) === normalizedTaxId;
    const sameName = normalizedName && normalizeEmployerMatchToken(item.pdf_name) === normalizedName;
    return sameTaxId || sameName;
  });

  const nextMapping = normalizePdfEmployerMapping({
    ...(existingIndex >= 0 ? nextMappings[existingIndex] : {}),
    pdf_name: pdfEmployer.name,
    pdf_tax_id: pdfEmployer.tax_id,
    pdf_workplace: pdfEmployer.workplace,
    employer_short_name: normalizedShortName,
  }, existingIndex >= 0 ? existingIndex : nextMappings.length);

  if (existingIndex >= 0) {
    nextMappings[existingIndex] = nextMapping;
  } else {
    nextMappings.push(nextMapping);
  }

  const next = saveSettings({
    employers: {
      ...current.employers,
      pdf_import_mappings: nextMappings,
    },
  });

  return {
    settings: next,
    mapping: nextMapping,
    employer: findEmployerByShortName(next, normalizedShortName),
  };
}

function createEmployerFromPdfEmployer(pdfEmployer = {}) {
  requireAdmin();
  const current = readSettings();
  const baseShortName = `D${(current.employers.items || []).length + 1}`;
  const usedShortNames = new Set((current.employers.items || []).map((item) => String(item.short_name || '').trim().toUpperCase()));
  let shortName = baseShortName;
  let suffix = (current.employers.items || []).length + 1;
  while (usedShortNames.has(shortName)) {
    suffix += 1;
    shortName = `D${suffix}`;
  }

  const newEmployer = normalizeEmployerItem({
    key: `employer_${Date.now()}`,
    name: String(pdfEmployer.name || '').trim() || `Datore ${suffix}`,
    short_name: shortName,
    tax_id: String(pdfEmployer.tax_id || '').trim().toUpperCase(),
    workplace: String(pdfEmployer.workplace || '').trim(),
  }, (current.employers.items || []).length);
  newEmployer.tax_id = String(pdfEmployer.tax_id || '').trim().toUpperCase();
  newEmployer.workplace = String(pdfEmployer.workplace || '').trim();

  const next = saveSettings({
    employers: {
      ...current.employers,
      items: [...(current.employers.items || []), newEmployer],
    },
  });
  const mappingResult = savePdfEmployerMapping(pdfEmployer, newEmployer.short_name);

  return {
    settings: mappingResult.settings || next,
    employer: newEmployer,
    mapping: mappingResult.mapping,
  };
}

function buildSettingsSummary(settings = readSettings()) {
  const storageLayout = getStorageLayout();
  const dbInfo = getDatabaseRuntimeInfo();
  const normalizedSettings = normalizeSettings(settings);

  return {
    ...normalizedSettings,
    general: {
      ...normalizedSettings.general,
      attendance_entry_mode: normalizedSettings.general?.attendance_entry_mode === 'hours_only'
        ? 'hours_only'
        : 'hours_and_symbol',
      attendance_hours_format: 'decimal',
      overtime_enabled: !!normalizedSettings.general?.overtime_enabled,
      overtime_hourly_rate: Number(normalizedSettings.general?.overtime_hourly_rate || 0) || 0,
      overtime_display_mode: normalizedSettings.general?.overtime_display_mode === 'separate'
        ? 'separate'
        : 'included',
      overtime_show_hourly_rate: normalizedSettings.general?.overtime_show_hourly_rate !== false,
      attendance_quick_symbol: normalizedSettings.general?.attendance_quick_symbol || 'X',
      attendance_auto_symbolize_base_hours: !!normalizedSettings.general?.attendance_auto_symbolize_base_hours,
      attendance_markers: normalizeAttendanceMarkers(normalizedSettings.general?.attendance_markers),
    },
    employer_options: getEmployerOptions(normalizedSettings),
    pdf_import_employer_mappings: normalizedSettings.employers?.pdf_import_mappings || [],
    is_admin: !isDemoVariant() || normalizedSettings.security.current_role === 'admin',
    backup_directory_effective: normalizedSettings.backup.directory || getBackupsDir(),
    cloud_ready: false,
    runtime_info: {
      app_name: app.getName(),
      app_version: app.getVersion(),
      app_variant: getAppVariant(),
      is_demo: getRuntimeContext().isDemo,
      is_dev: getRuntimeContext().isDev,
      is_production: getRuntimeContext().isProduction,
      packaged: getRuntimeContext().isPackaged,
      program_path: app.getAppPath(),
      install_strategy: 'program-files-separated-from-user-data',
    },
    storage_paths: {
      user_data_root: storageLayout.userDataRoot,
      data_dir: storageLayout.dataDir,
      config_dir: storageLayout.configDir,
      documents_dir: storageLayout.documentsDir,
      backups_dir: storageLayout.backupsDir,
      updates_dir: storageLayout.updatesDir || getUpdatesDir(),
      database_file: getDbPath(),
      settings_file: getSettingsFilePath(),
      license_file: path.join(getConfigDir(), LICENSE_FILE_NAME),
    },
    database_runtime: dbInfo,
    update_runtime: buildUpdateRuntimeSummary(normalizedSettings.software?.updates),
    should_show_initial_setup: !normalizedSettings.setup?.completed,
  };
}

module.exports = {
  buildSettingsSummary,
  chooseCompanyLogoFile,
  chooseBackupDirectory,
  defaultSettings,
  DEFAULT_ATTENDANCE_MARKERS,
  getCompanyLogoAbsolutePath,
  getEmployerOptions,
  resolvePdfEmployer,
  savePdfEmployerMapping,
  createEmployerFromPdfEmployer,
  getSettings,
  getSettingsFilePath,
  readSettings,
  removeCompanyLogo,
  requireAdmin,
  saveSettings,
  setCurrentRole,
  unlockAdmin,
  uploadCompanyLogo,
  uploadMarkerAsset,
  writeSettings,
};
