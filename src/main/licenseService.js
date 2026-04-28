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

function syncSettingsLicenseMetadata(result, envelope) {
  const settings = settingsService.getSettings();
  settingsService.writeSettings({
    ...settings,
    licensing: {
      ...settings.licensing,
      license_key: envelope ? hash(JSON.stringify(envelope)).slice(0, 24).toUpperCase() : '',
      activation_status: result.code,
      license_id: result.payload?.license_id || '',
      customer_name: result.payload?.customer_name || '',
      company_name: result.payload?.company_name || '',
      activated_at: result.payload?.activation_date || '',
      expires_at: result.payload?.expires_at || '',
      max_installations: result.payload?.max_installations || 1,
      notes_admin: result.payload?.admin_notes || '',
    },
  });
}

function buildStatusFromStoredLicense() {
  const context = getInstallContext();
  const settings = settingsService.getSettings();

  if (isDemoVariant()) {
        return {
          code: 'demo_mode',
          label: 'Demo',
          message: 'Versione demo attiva. Nessuna licenza richiesta.',
      is_active: true,
      is_blocking: false,
      install_context: context,
      activation_request: null,
        license: {
          license_id: 'DEMO',
          customer_name: 'Demo',
          company_name: settings.company.name || 'Gestionale Demo',
          license_status: 'demo',
          activation_date: '',
          expires_at: '',
        max_installations: 1,
        installation_id: context.install_id,
        machine_fingerprint: context.machine_fingerprint,
        admin_notes: 'Demo mode',
        activation_method: 'demo_builtin',
      },
      is_admin: settings.security.current_role === 'admin',
    };
  }

  if (!app.isPackaged) {
    return {
      code: 'development_mode',
      label: 'Sviluppo',
      message: 'Controllo licenza non bloccante in ambiente di sviluppo.',
      is_active: true,
      is_blocking: false,
      install_context: context,
      activation_request: createActivationRequest(),
      license: null,
      is_admin: settings.security.current_role === 'admin',
    };
  }

  const stored = readStoredLicense();
  if (!stored) {
    syncSettingsLicenseMetadata({ code: 'not_activated', payload: null }, null);
    return {
      code: 'not_activated',
      label: 'Non attivato',
      message: 'Attivazione software da completare.',
      is_active: false,
      is_blocking: true,
      install_context: context,
      activation_request: createActivationRequest(),
      license: null,
      is_admin: settings.security.current_role === 'admin',
    };
  }

  const verification = verifyEnvelope(stored.envelope);
  syncSettingsLicenseMetadata(verification, stored.envelope);

  return {
    code: verification.code,
    label:
      verification.code === 'active'
        ? 'Attiva'
        : verification.code === 'license_expired'
        ? 'Scaduta'
        : verification.code === 'license_suspended'
        ? 'Sospesa'
        : verification.code === 'license_disabled'
        ? 'Disattivata'
        : verification.code === 'installation_mismatch'
        ? 'Installazione non valida'
        : verification.code === 'machine_mismatch'
        ? 'Dispositivo non valido'
        : verification.code === 'public_key_missing'
        ? 'Chiave pubblica mancante'
        : 'Non valida',
    message: verification.message,
    is_active: verification.valid,
    is_blocking: !verification.valid,
    install_context: context,
    activation_request: createActivationRequest(),
    license: verification.payload
      ? {
          license_id: verification.payload.license_id,
          customer_name: verification.payload.customer_name,
          company_name: verification.payload.company_name,
          license_status: verification.payload.license_status,
          activation_date: verification.payload.activation_date,
          expires_at: verification.payload.expires_at,
          max_installations: verification.payload.max_installations,
          installation_id: verification.payload.installation_id,
          machine_fingerprint: verification.payload.machine_fingerprint,
          admin_notes: verification.payload.admin_notes || '',
          activation_method: verification.payload.activation_method || 'offline_code',
        }
      : null,
    is_admin: settings.security.current_role === 'admin',
  };
}

function activate(activationInput) {
  const envelope = parseActivationInput(activationInput);
  const verification = verifyEnvelope(envelope);
  if (!verification.valid) {
    throw new Error(verification.message);
  }

  writeStoredLicense({
    schema_version: 1,
    activated_locally_at: new Date().toISOString(),
    envelope,
  });

  syncSettingsLicenseMetadata(verification, envelope);
  return buildStatusFromStoredLicense();
}

function deactivate() {
  settingsService.requireAdmin();
  removeStoredLicense();
  syncSettingsLicenseMetadata({ code: 'not_activated', payload: null }, null);
  return buildStatusFromStoredLicense();
}

function getLicenseStatus() {
  return buildStatusFromStoredLicense();
}

module.exports = {
  activate,
  createActivationRequest,
  deactivate,
  getInstallContext,
  getLicenseFilePath,
  getLicenseStatus,
  getPublicKeyPath,
};
