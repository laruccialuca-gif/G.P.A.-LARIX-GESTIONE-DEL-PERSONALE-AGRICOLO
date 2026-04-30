const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');
const settingsService = require('./settingsService');
const { getConfigDir } = require('./storagePaths');
const { isDemoVariant } = require('./runtimeContext');

const LICENSE_FILE_NAME = 'license.json';
const LICENSE_PUBLIC_KEY_FILE = 'license-public.pem';
const LOCAL_TEST_LICENSE_KEY = 'GPA-TEST-2026';
const LOCAL_LICENSE_SCHEMA_VERSION = 2;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function getLicenseFilePath() {
  return path.join(getConfigDir(), LICENSE_FILE_NAME);
}

function getPublicKeyPath() {
  return path.join(getConfigDir(), LICENSE_PUBLIC_KEY_FILE);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = canonicalize(value[key]);
        return acc;
      }, {});
  }

  return value;
}

function createCanonicalString(payload) {
  return JSON.stringify(canonicalize(payload));
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function getMachineFingerprint() {
  const interfaces = os.networkInterfaces();
  const macAddresses = Object.values(interfaces)
    .flat()
    .filter(Boolean)
    .map((item) => item.mac)
    .filter((mac) => mac && mac !== '00:00:00:00:00:00')
    .sort()
    .join('|');

  const raw = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.release(),
    os.cpus().length,
    macAddresses,
  ].join('|');

  return hash(raw);
}

function getInstallContext() {
  const settings = settingsService.getSettings();
  return {
    install_id: settings.licensing.install_id,
    machine_fingerprint: getMachineFingerprint(),
    app_version: app.getVersion(),
    packaged: app.isPackaged,
  };
}

function createActivationRequest() {
  const settings = settingsService.getSettings();
  const context = getInstallContext();
  const payload = {
    request_version: 1,
    install_id: context.install_id,
    machine_fingerprint: context.machine_fingerprint,
    company_name: settings.company.name,
    document_header: settings.company.document_header,
    app_version: context.app_version,
    generated_at: new Date().toISOString(),
  };

  return {
    ...payload,
    request_code: Buffer.from(JSON.stringify(payload)).toString('base64url'),
  };
}

function getConfiguredPublicKeyPem() {
  const envKey = process.env.GESTIONALE_LICENSE_PUBLIC_KEY;
  if (envKey && envKey.includes('BEGIN PUBLIC KEY')) {
    return envKey;
  }

  const filePath = getPublicKeyPath();
  if (fs.existsSync(filePath)) {
    return fs.readFileSync(filePath, 'utf8');
  }

  return null;
}

function readStoredLicense() {
  const filePath = getLicenseFilePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeStoredLicense(data) {
  const filePath = getLicenseFilePath();
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function removeStoredLicense() {
  const filePath = getLicenseFilePath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function addDays(date, amount) {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + amount);
  return next;
}

function normalizeIsoDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString();
}

function normalizeActivationCode(value) {
  return String(value || '').trim().toUpperCase();
}

function isLocalTestActivationCode(value) {
  return normalizeActivationCode(value) === LOCAL_TEST_LICENSE_KEY;
}

function mapStatusLabel(code) {
  if (code === 'active') return 'Attiva';
  if (code === 'expired') return 'Scaduta';
  return 'Demo';
}

function buildLicensePayload({
  license_key = '',
  license_id = '',
  company_name = '',
  activation_date = '',
  expires_at = '',
  license_status = 'demo',
  activation_method = 'local',
  customer_name = '',
  admin_notes = '',
} = {}) {
  return {
    license_key,
    license_id,
    customer_name,
    company_name,
    license_status,
    activation_date,
    expires_at,
    max_installations: 1,
    installation_id: getInstallContext().install_id,
    machine_fingerprint: getInstallContext().machine_fingerprint,
    admin_notes,
    activation_method,
  };
}

function syncSettingsLicenseMetadata(status) {
  const settings = settingsService.getSettings();
  const license = status?.license || null;

  settingsService.writeSettings({
    ...settings,
    licensing: {
      ...settings.licensing,
      license_key: String(license?.license_key || '').trim(),
      activation_status: status?.code || 'demo',
      license_id: String(license?.license_id || '').trim(),
      customer_name: String(license?.customer_name || '').trim(),
      company_name: String(license?.company_name || '').trim(),
      activated_at: String(license?.activation_date || '').trim(),
      expires_at: String(license?.expires_at || '').trim(),
      max_installations: Number(license?.max_installations || 1) || 1,
      notes_admin: String(license?.admin_notes || '').trim(),
    },
  });
}

function touchStoredLicense(stored) {
  if (!stored || typeof stored !== 'object') {
    return stored;
  }

  const next = {
    ...stored,
    last_checked_at: new Date().toISOString(),
  };
  writeStoredLicense(next);
  return next;
}

function buildStatus({
  code,
  message,
  license = null,
  activationRequest = null,
}) {
  const context = getInstallContext();
  const settings = settingsService.getSettings();

  const status = {
    code,
    label: mapStatusLabel(code),
    message,
    is_active: code !== 'expired',
    is_blocking: false,
    is_write_blocked: code === 'expired',
    install_context: context,
    activation_request: activationRequest,
    license,
    is_admin: settings.security.current_role === 'admin',
  };

  syncSettingsLicenseMetadata(status);
  return status;
}

function buildDemoStatus(messageOverride = '') {
  const settings = settingsService.getSettings();
  const message = messageOverride || (
    isDemoVariant()
      ? 'Versione demo attiva. Nessuna licenza richiesta.'
      : 'Modalita demo attiva. Inserisci una licenza annuale per sbloccare la versione completa.'
  );

  return buildStatus({
    code: 'demo',
    message,
    activationRequest: isDemoVariant() ? null : createActivationRequest(),
    license: buildLicensePayload({
      license_key: '',
      license_id: isDemoVariant() ? 'DEMO' : '',
      company_name: settings.company.name || '',
      activation_date: '',
      expires_at: '',
      license_status: 'demo',
      activation_method: isDemoVariant() ? 'demo_builtin' : 'local_demo',
      customer_name: isDemoVariant() ? 'Demo' : '',
      admin_notes: isDemoVariant() ? 'Demo mode' : 'Licenza non ancora attivata',
    }),
  });
}

function buildActiveStatus(license, message = 'Licenza attiva.') {
  return buildStatus({
    code: 'active',
    message,
    activationRequest: createActivationRequest(),
    license: {
      ...license,
      license_status: 'active',
    },
  });
}

function buildExpiredStatus(license, message = 'Licenza scaduta. Consultazione e backup restano disponibili, ma le nuove modifiche sono bloccate.') {
  return buildStatus({
    code: 'expired',
    message,
    activationRequest: createActivationRequest(),
    license: {
      ...license,
      license_status: 'expired',
    },
  });
}

function createLocalTestLicense(activationCode) {
  const activatedAt = new Date();
  const expiresAt = addDays(activatedAt, 365);

  return {
    schema_version: LOCAL_LICENSE_SCHEMA_VERSION,
    mode: 'local_test',
    license_key: LOCAL_TEST_LICENSE_KEY,
    license_status: 'active',
    company_name: 'Licenza test',
    license_id: 'LOCAL-TEST-2026',
    activated_at: activatedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    last_checked_at: activatedAt.toISOString(),
  };
}

function parseActivationInput(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    throw new Error('Codice attivazione mancante.');
  }

  try {
    return JSON.parse(raw);
  } catch {
    try {
      const decoded = Buffer.from(raw, 'base64url').toString('utf8');
      return JSON.parse(decoded);
    } catch {
      throw new Error('Codice attivazione non valido.');
    }
  }
}

function verifyEnvelope(envelope) {
  const publicKeyPem = getConfiguredPublicKeyPem();
  if (!publicKeyPem) {
    return {
      valid: false,
      code: 'public_key_missing',
      message: 'Chiave pubblica licenza non configurata.',
    };
  }

  const payload = envelope?.payload;
  const signature = envelope?.signature;
  if (!payload || !signature) {
    return {
      valid: false,
      code: 'activation_structure_invalid',
      message: 'Struttura attivazione non valida.',
    };
  }

  const canonical = createCanonicalString(payload);

  let verified = false;
  try {
    verified = crypto.verify(
      null,
      Buffer.from(canonical, 'utf8'),
      publicKeyPem,
      Buffer.from(signature, 'base64')
    );
  } catch {
    verified = false;
  }

  if (!verified) {
    return {
      valid: false,
      code: 'invalid_signature',
      message: 'Firma licenza non valida.',
    };
  }

  const context = getInstallContext();

  if (payload.installation_id !== context.install_id) {
    return {
      valid: false,
      code: 'installation_mismatch',
      message: 'La licenza non corrisponde a questa installazione.',
    };
  }

  if (payload.machine_fingerprint !== context.machine_fingerprint) {
    return {
      valid: false,
      code: 'machine_mismatch',
      message: 'La licenza non corrisponde a questo dispositivo.',
    };
  }

  if (payload.license_status === 'suspended') {
    return {
      valid: false,
      code: 'license_suspended',
      message: 'Licenza sospesa.',
    };
  }

  if (payload.license_status === 'disabled') {
    return {
      valid: false,
      code: 'license_disabled',
      message: 'Licenza disattivata.',
    };
  }

  if (payload.expires_at) {
    const expiresAt = new Date(payload.expires_at);
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      return {
        valid: false,
        code: 'license_expired',
        message: 'Licenza scaduta.',
      };
    }
  }

  return {
    valid: true,
    code: 'active',
    message: 'Licenza attiva.',
    payload,
  };
}

function buildStatusFromStoredLicense() {
  if (isDemoVariant()) {
    return buildDemoStatus('Versione demo attiva. Nessuna licenza richiesta.');
  }

  const stored = readStoredLicense();
  if (!stored) {
    return buildDemoStatus();
  }

  const touched = touchStoredLicense(stored);

  if (touched.mode === 'local_test') {
    const expiresAt = new Date(touched.expires_at);
    const baseLicense = buildLicensePayload({
      license_key: touched.license_key || '',
      license_id: touched.license_id || 'LOCAL-TEST-2026',
      company_name: touched.company_name || '',
      activation_date: touched.activated_at || '',
      expires_at: touched.expires_at || '',
      license_status: touched.license_status || 'active',
      activation_method: 'local_test_code',
      admin_notes: 'Attivazione locale di test',
    });

    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      return buildExpiredStatus(baseLicense);
    }

    return buildActiveStatus(baseLicense);
  }

  if (touched.envelope) {
    const verification = verifyEnvelope(touched.envelope);
    const payload = verification.payload || {};
    const baseLicense = buildLicensePayload({
      license_key: touched.license_key || hash(JSON.stringify(touched.envelope)).slice(0, 24).toUpperCase(),
      license_id: payload.license_id || '',
      company_name: payload.company_name || '',
      activation_date: payload.activation_date || '',
      expires_at: payload.expires_at || '',
      license_status: payload.license_status || (verification.valid ? 'active' : 'expired'),
      activation_method: payload.activation_method || 'offline_code',
      customer_name: payload.customer_name || '',
      admin_notes: payload.admin_notes || '',
    });

    if (verification.valid) {
      return buildActiveStatus(baseLicense, 'Licenza attiva.');
    }

    return buildExpiredStatus(baseLicense, verification.message || 'Licenza non valida o scaduta.');
  }

  const fallbackLicense = buildLicensePayload({
    license_key: String(touched.license_key || '').trim(),
    license_id: String(touched.license_id || '').trim(),
    company_name: String(touched.company_name || '').trim(),
    activation_date: String(touched.activated_at || '').trim(),
    expires_at: String(touched.expires_at || '').trim(),
    license_status: 'expired',
    activation_method: String(touched.mode || 'legacy_local'),
    admin_notes: 'Stato licenza non riconosciuto',
  });

  return buildExpiredStatus(fallbackLicense, 'Licenza non valida o non riconosciuta.');
}

function activate(activationInput) {
  const normalizedInput = String(activationInput || '').trim();
  if (!normalizedInput) {
    throw new Error('Codice licenza mancante.');
  }

  if (isLocalTestActivationCode(normalizedInput)) {
    writeStoredLicense(createLocalTestLicense(LOCAL_TEST_LICENSE_KEY));
    return buildStatusFromStoredLicense();
  }

  const envelope = parseActivationInput(normalizedInput);
  const verification = verifyEnvelope(envelope);
  if (!verification.valid) {
    throw new Error(verification.message);
  }

  writeStoredLicense({
    schema_version: LOCAL_LICENSE_SCHEMA_VERSION,
    mode: 'signed_envelope',
    license_key: hash(JSON.stringify(envelope)).slice(0, 24).toUpperCase(),
    license_status: verification.payload?.license_status || 'active',
    company_name: verification.payload?.company_name || '',
    license_id: verification.payload?.license_id || '',
    activated_at: verification.payload?.activation_date || new Date().toISOString(),
    expires_at: verification.payload?.expires_at || '',
    last_checked_at: new Date().toISOString(),
    activated_locally_at: new Date().toISOString(),
    envelope,
  });

  return buildStatusFromStoredLicense();
}

function deactivate() {
  settingsService.requireAdmin();
  removeStoredLicense();
  return buildStatusFromStoredLicense();
}

function getLicenseStatus() {
  return buildStatusFromStoredLicense();
}

function requireWritableLicense(actionLabel = 'questa operazione') {
  const status = getLicenseStatus();
  if (!status?.is_write_blocked) {
    return status;
  }

  const error = new Error(
    `Licenza scaduta. ${actionLabel} non e disponibile finche non riattivi la licenza. ` +
    'Puoi comunque consultare i dati, stampare lo storico e creare backup.'
  );
  error.code = 'LICENSE_EXPIRED';
  throw error;
}

module.exports = {
  activate,
  createActivationRequest,
  deactivate,
  getInstallContext,
  getLicenseFilePath,
  getLicenseStatus,
  getPublicKeyPath,
  requireWritableLicense,
};
