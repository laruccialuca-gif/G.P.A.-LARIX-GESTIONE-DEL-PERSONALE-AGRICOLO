const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { app } = require('electron');
const settingsService = require('./settingsService');
const { getConfigDir } = require('./storagePaths');
const { getRawAppVariant, getRuntimeContext, isDemoVariant, isDevelopmentVariant } = require('./runtimeContext');

const LICENSE_FILE_NAME = 'license.dat';
const LICENSE_PUBLIC_KEY_FILE = 'license-public.pem';
const LOCAL_TEST_LICENSE_KEY = 'GPA-TEST-2026';
const LOCAL_LICENSE_SCHEMA_VERSION = 3;
const STORAGE_PREFIX = 'GPA-LICENSE-V1:';
const OFFLINE_GRACE_DAYS = 15;
const VERIFY_INTERVAL_HOURS = 24;
const CLOCK_ROLLBACK_TOLERANCE_MS = 10 * 60 * 1000;
const PERIODIC_VERIFY_MS = 6 * 60 * 60 * 1000;
const LICENSE_WRITE_BLOCK_MESSAGE =
  'Abbonamento scaduto o non verificato. Rinnova la licenza per continuare a modificare i dati.';

let logWriter = () => {};
let periodicVerifyTimer = null;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function logLicenseEvent(event, details = {}) {
  try {
    logWriter(`license:${event}`, details);
  } catch {
    // Best effort logging only.
  }
}

function setLogger(logger) {
  logWriter = typeof logger === 'function' ? logger : () => {};
}

function isDevLicenseBypassEnabled() {
  const runtime = getRuntimeContext();
  return runtime.isDev && !runtime.isDemo;
}

function getDevBypassStatus() {
  const context = getInstallContext();
  const settings = settingsService.getSettings();
  const runtime = getRuntimeContext();
  const status = {
    status: 'active',
    reason: 'dev-bypass',
    isValid: true,
    expires_at: null,
    daysOfflineRemaining: null,
    code: 'active',
    label: 'Attiva',
    environment: 'development',
    license_state: 'active',
    message: 'DEV MODE - license bypass attivo',
    is_active: true,
    is_blocking: false,
    is_write_blocked: false,
    block_reason: 'dev-bypass',
    install_context: context,
    activation_request: null,
    verification: {
      backend_configured: false,
      backend_provider: 'dev-bypass',
      backend_mandatory: false,
      last_checked_at: new Date().toISOString(),
      last_successful_at: new Date().toISOString(),
      last_remote_at: '',
      offline_grace_days: OFFLINE_GRACE_DAYS,
      offline_days_remaining: null,
      offline_grace_until: '',
      last_error: '',
      clock_tampering_detected_at: '',
      local_fallback_allowed: true,
      local_fallback_reason: 'development_variant',
    },
    license: buildLicensePayload({
      company_name: settings.company.name || '',
      activation_method: 'dev_bypass',
      license_status: 'active',
      admin_notes: 'dev-bypass',
    }),
    is_admin: true,
    runtime,
  };

  syncSettingsLicenseMetadata(status);
  return status;
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

function safeExec(command) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function getStableMachineId() {
  if (process.platform === 'darwin') {
    const raw = safeExec("ioreg -rd1 -c IOPlatformExpertDevice | awk -F'\\\"' '/IOPlatformUUID/{print $(NF-1)}'");
    if (raw) return raw;
  }

  if (process.platform === 'win32') {
    const raw = safeExec('reg query HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography /v MachineGuid');
    const match = raw.match(/MachineGuid\s+REG_\w+\s+([^\r\n]+)/i);
    if (match?.[1]) return match[1].trim();
  }

  if (process.platform === 'linux') {
    const candidates = ['/etc/machine-id', '/var/lib/dbus/machine-id'];
    for (const candidate of candidates) {
      try {
        const value = fs.readFileSync(candidate, 'utf8').trim();
        if (value) return value;
      } catch {
        // Ignore.
      }
    }
  }

  const interfaces = os.networkInterfaces();
  const macAddresses = Object.values(interfaces)
    .flat()
    .filter(Boolean)
    .map((item) => item.mac)
    .filter((mac) => mac && mac !== '00:00:00:00:00:00')
    .sort()
    .join('|');

  return [os.hostname(), os.platform(), os.arch(), os.cpus().length, macAddresses].join('|');
}

function getMachineFingerprint() {
  return hash([getStableMachineId(), os.platform(), os.arch()].join('|'));
}

function getInstallContext() {
  const settings = settingsService.getSettings();
  const machineId = getStableMachineId();
  return {
    install_id: settings.licensing.install_id,
    machine_fingerprint: getMachineFingerprint(),
    machine_id_hash: hash(machineId),
    app_version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
  };
}

function createActivationRequest() {
  const settings = settingsService.getSettings();
  const context = getInstallContext();
  const payload = {
    request_version: 2,
    install_id: context.install_id,
    machine_fingerprint: context.machine_fingerprint,
    machine_id_hash: context.machine_id_hash,
    company_name: settings.company.name,
    document_header: settings.company.document_header,
    app_version: context.app_version,
    platform: context.platform,
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

function getPublicKeyInfo() {
  const envKey = process.env.GESTIONALE_LICENSE_PUBLIC_KEY;
  const hasEnvKey = Boolean(envKey && envKey.includes('BEGIN PUBLIC KEY'));
  const filePath = getPublicKeyPath();
  const hasFileKey = !hasEnvKey && fs.existsSync(filePath);
  return {
    configured: hasEnvKey || hasFileKey,
    algorithm: 'Ed25519',
    source: hasEnvKey
      ? 'env:GESTIONALE_LICENSE_PUBLIC_KEY'
      : hasFileKey
        ? `file:${filePath}`
        : 'none',
  };
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

function isTruthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function buildStorageEncryptionKeyMaterial(context, appName = app.getName()) {
  const material = [
    context.install_id,
    context.machine_id_hash,
    appName,
    'gpa-license-state-v1',
  ].join('|');

  return crypto.scryptSync(material, 'gpa-license-salt-v1', 32);
}

function getStorageEncryptionKey(contextOverride, appNameOverride) {
  const context = contextOverride || getInstallContext();
  return buildStorageEncryptionKeyMaterial(context, appNameOverride);
}

function serializeEncryptedState(state, contextOverride, appNameOverride) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getStorageEncryptionKey(contextOverride, appNameOverride), iv);
  const plaintext = Buffer.from(JSON.stringify(state), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, ciphertext]).toString('base64');
  return `${STORAGE_PREFIX}${payload}`;
}

function deserializeEncryptedState(raw, contextOverride, appNameOverride) {
  if (!raw.startsWith(STORAGE_PREFIX)) {
    return null;
  }

  const packed = Buffer.from(raw.slice(STORAGE_PREFIX.length), 'base64');
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', getStorageEncryptionKey(contextOverride, appNameOverride), iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  return JSON.parse(plaintext);
}

function readLegacyStoredLicense(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const context = getInstallContext();
    return {
      schema_version: LOCAL_LICENSE_SCHEMA_VERSION,
      mode: parsed.mode || 'legacy_local',
      status: parsed.license_status || 'active',
      license_key: parsed.license_key || '',
      license_id: parsed.license_id || '',
      customer_name: parsed.customer_name || '',
      company_name: parsed.company_name || '',
      activated_at: normalizeIsoDate(parsed.activated_at || parsed.activation_date || new Date().toISOString()),
      expires_at: normalizeIsoDate(parsed.expires_at),
      install_id: context.install_id,
      machine_fingerprint: context.machine_fingerprint,
      machine_id_hash: context.machine_id_hash,
      activation_source: parsed.mode || 'legacy_local',
      envelope: parsed.envelope || null,
      last_seen_at: normalizeIsoDate(parsed.last_checked_at || parsed.activated_locally_at || new Date().toISOString()),
      max_seen_at: normalizeIsoDate(parsed.last_checked_at || parsed.activated_locally_at || new Date().toISOString()),
      last_verified_at: normalizeIsoDate(parsed.last_checked_at || parsed.activated_locally_at || new Date().toISOString()),
      last_successful_verification_at: normalizeIsoDate(parsed.last_checked_at || parsed.activated_locally_at || new Date().toISOString()),
      last_remote_verification_at: '',
      last_verification_attempt_at: normalizeIsoDate(parsed.last_checked_at || parsed.activated_locally_at || new Date().toISOString()),
      last_verification_result: 'success',
      last_verification_error: '',
      clock_tampering_detected_at: '',
      clock_tampering_reason: '',
      backend: {
        provider: 'legacy_local',
        endpoint: '',
      },
      updated_at: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function readStoredLicenseState() {
  const filePath = getLicenseFilePath();
  if (!fs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8').trim();
    if (!raw) {
      return null;
    }

    if (raw.startsWith(STORAGE_PREFIX)) {
      return deserializeEncryptedState(raw);
    }

    const migrated = readLegacyStoredLicense(raw);
    if (migrated) {
      writeStoredLicenseState(migrated);
      logLicenseEvent('state-migrated', {
        from: 'legacy-json',
        file_path: filePath,
      });
      return migrated;
    }
  } catch (error) {
    logLicenseEvent('state-read-failed', {
      message: error?.message || String(error),
      file_path: filePath,
    });
  }

  return null;
}

function writeStoredLicenseState(data) {
  const filePath = getLicenseFilePath();
  ensureDir(path.dirname(filePath));
  const normalized = {
    ...data,
    schema_version: LOCAL_LICENSE_SCHEMA_VERSION,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, serializeEncryptedState(normalized), 'utf8');
  return normalized;
}

function removeStoredLicense() {
  const filePath = getLicenseFilePath();
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function mapStatusLabel(code) {
  if (code === 'active') return 'Attiva';
  if (code === 'active_grace') return 'Attiva (grace offline)';
  if (code === 'expired') return 'Scaduta';
  if (code === 'suspended') return 'Sospesa';
  if (code === 'verification_overdue') return 'Non verificata';
  if (code === 'unlicensed') return 'Da attivare';
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
      notes_admin: String(status?.block_reason || license?.admin_notes || '').trim(),
    },
  });
}

function getBackendConfig() {
  const baseUrl = String(process.env.GESTIONALE_LICENSE_API_URL || '').trim();
  const apiKey = String(process.env.GESTIONALE_LICENSE_API_KEY || '').trim();
  return {
    enabled: !!baseUrl,
    provider: baseUrl ? 'http-api' : 'none',
    base_url: baseUrl,
    api_key: apiKey,
  };
}

function getVerificationPolicy(overrides = {}) {
  const context = overrides.context || getInstallContext();
  const backendConfig = overrides.backendConfig || getBackendConfig();
  const demoVariant = typeof overrides.demoVariant === 'boolean' ? overrides.demoVariant : isDemoVariant();
  const developmentVariant = typeof overrides.developmentVariant === 'boolean'
    ? overrides.developmentVariant
    : (isDevelopmentVariant() || context.packaged === false);
  const explicitLocalFallback = typeof overrides.explicitLocalFallback === 'boolean'
    ? overrides.explicitLocalFallback
    : isTruthyEnv(process.env.GESTIONALE_ALLOW_OFFLINE_LOCAL_LICENSE);
  const backendMandatory = Boolean(backendConfig.enabled && !demoVariant && context.packaged);
  const localFallbackAllowed = Boolean(demoVariant || developmentVariant || explicitLocalFallback);
  const localFallbackEffective = Boolean(localFallbackAllowed && !backendMandatory);

  return {
    raw_variant: overrides.rawVariant || getRawAppVariant(),
    demo_variant: demoVariant,
    development_variant: developmentVariant,
    packaged: context.packaged,
    backend_enabled: backendConfig.enabled,
    backend_mandatory: backendMandatory,
    explicit_local_fallback: explicitLocalFallback,
    local_fallback_allowed: localFallbackAllowed,
    local_fallback_effective: localFallbackEffective,
    local_fallback_reason: demoVariant
      ? 'demo_variant'
      : developmentVariant
        ? 'development_variant'
        : explicitLocalFallback
          ? 'env_override'
          : backendMandatory
            ? 'disabled_by_backend_requirement'
            : 'disabled',
  };
}

async function postJson(url, payload, headers = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    let body = {};
    try {
      body = await response.json();
    } catch {
      body = {};
    }

    return {
      ok: response.ok,
      status: response.status,
      body,
    };
  } finally {
    clearTimeout(timeoutId);
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

function verifyEnvelope(envelope, contextOverride) {
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

  const context = contextOverride || getInstallContext();

  if (payload.installation_id && payload.installation_id !== context.install_id) {
    return {
      valid: false,
      code: 'installation_mismatch',
      message: 'La licenza non corrisponde a questa installazione.',
    };
  }

  if (payload.machine_fingerprint && payload.machine_fingerprint !== context.machine_fingerprint) {
    return {
      valid: false,
      code: 'machine_mismatch',
      message: 'La licenza non corrisponde a questo dispositivo.',
    };
  }

  if (payload.machine_id_hash && payload.machine_id_hash !== context.machine_id_hash) {
    return {
      valid: false,
      code: 'machine_id_mismatch',
      message: 'La licenza non corrisponde a questo PC.',
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

function createLocalTestLicense(activationCode) {
  const now = new Date();
  const expiresAt = addDays(now, 365);
  const context = getInstallContext();

  return {
    schema_version: LOCAL_LICENSE_SCHEMA_VERSION,
    mode: 'local_test',
    status: 'active',
    license_key: normalizeActivationCode(activationCode),
    license_id: 'LOCAL-TEST-2026',
    customer_name: 'Licenza test',
    company_name: 'Licenza test',
    activated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    install_id: context.install_id,
    machine_fingerprint: context.machine_fingerprint,
    machine_id_hash: context.machine_id_hash,
    activation_source: 'local_test_code',
    envelope: null,
    last_seen_at: now.toISOString(),
    max_seen_at: now.toISOString(),
    last_verified_at: now.toISOString(),
    last_successful_verification_at: now.toISOString(),
    last_remote_verification_at: '',
    last_verification_attempt_at: now.toISOString(),
    last_verification_result: 'success',
    last_verification_error: '',
    clock_tampering_detected_at: '',
    clock_tampering_reason: '',
    backend: {
      provider: 'local_test',
      endpoint: '',
    },
  };
}

function createStateFromEnvelope(envelope) {
  const now = new Date();
  const context = getInstallContext();
  const payload = envelope?.payload || {};

  return {
    schema_version: LOCAL_LICENSE_SCHEMA_VERSION,
    mode: 'signed_envelope',
    status: payload.license_status || 'active',
    license_key: hash(JSON.stringify(envelope)).slice(0, 24).toUpperCase(),
    license_id: payload.license_id || '',
    customer_name: payload.customer_name || '',
    company_name: payload.company_name || '',
    activated_at: normalizeIsoDate(payload.activation_date || now.toISOString()),
    expires_at: normalizeIsoDate(payload.expires_at),
    install_id: context.install_id,
    machine_fingerprint: context.machine_fingerprint,
    machine_id_hash: context.machine_id_hash,
    activation_source: payload.activation_method || 'signed_envelope',
    envelope,
    last_seen_at: now.toISOString(),
    max_seen_at: now.toISOString(),
    last_verified_at: now.toISOString(),
    last_successful_verification_at: now.toISOString(),
    last_remote_verification_at: '',
    last_verification_attempt_at: now.toISOString(),
    last_verification_result: 'success',
    last_verification_error: '',
    clock_tampering_detected_at: '',
    clock_tampering_reason: '',
    backend: {
      provider: 'signed_envelope',
      endpoint: '',
    },
  };
}

function applyRemoteLicenseResult(previousState, result) {
  const now = new Date().toISOString();
  const context = getInstallContext();
  const remoteStatus = String(result?.status || '').trim().toLowerCase();
  const nextStatus = remoteStatus === 'suspended'
    ? 'suspended'
    : remoteStatus === 'expired'
      ? 'expired'
      : 'active';

  return {
    ...(previousState || {}),
    schema_version: LOCAL_LICENSE_SCHEMA_VERSION,
    mode: 'remote_subscription',
    status: nextStatus,
    license_key: String(result?.license_key || previousState?.license_key || '').trim(),
    license_id: String(result?.license_id || previousState?.license_id || '').trim(),
    customer_name: String(result?.customer_name || previousState?.customer_name || '').trim(),
    company_name: String(result?.company_name || previousState?.company_name || '').trim(),
    activated_at: normalizeIsoDate(result?.activation_date || previousState?.activated_at || now),
    expires_at: normalizeIsoDate(result?.expires_at || previousState?.expires_at),
    install_id: context.install_id,
    machine_fingerprint: context.machine_fingerprint,
    machine_id_hash: context.machine_id_hash,
    activation_source: 'remote_subscription',
    envelope: previousState?.envelope || null,
    last_seen_at: now,
    max_seen_at: now,
    last_verified_at: now,
    last_successful_verification_at: now,
    last_remote_verification_at: now,
    last_verification_attempt_at: now,
    last_verification_result: 'success',
    last_verification_error: '',
    clock_tampering_detected_at: '',
    clock_tampering_reason: '',
    backend: {
      provider: getBackendConfig().provider,
      endpoint: getBackendConfig().base_url,
    },
  };
}

function isClockTampered(state, now = new Date()) {
  const checkpoints = [
    state?.last_seen_at,
    state?.max_seen_at,
    state?.last_verified_at,
    state?.last_successful_verification_at,
    state?.last_remote_verification_at,
  ]
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));

  if (!checkpoints.length) {
    return { tampered: false, reference: null };
  }

  const latest = checkpoints.reduce((max, current) => (
    current.getTime() > max.getTime() ? current : max
  ));

  if (now.getTime() + CLOCK_ROLLBACK_TOLERANCE_MS < latest.getTime()) {
    return {
      tampered: true,
      reference: latest.toISOString(),
      reason: 'system_clock_rollback',
    };
  }

  return {
    tampered: false,
    reference: latest.toISOString(),
  };
}

function touchLastSeen(state, now = new Date()) {
  if (!state) return state;

  const clockCheck = isClockTampered(state, now);
  const currentSeenIso = now.toISOString();
  const previousMaxSeen = new Date(state.max_seen_at || state.last_seen_at || '');
  const maxSeenIso = !Number.isNaN(previousMaxSeen.getTime()) && previousMaxSeen.getTime() > now.getTime()
    ? previousMaxSeen.toISOString()
    : currentSeenIso;
  const next = {
    ...state,
    last_seen_at: currentSeenIso,
    max_seen_at: maxSeenIso,
  };

  if (clockCheck.tampered && !state.clock_tampering_detected_at) {
    next.clock_tampering_detected_at = now.toISOString();
    next.clock_tampering_reason = clockCheck.reason || 'system_clock_rollback';
    logLicenseEvent('clock-tampering-detected', {
      detected_at: next.clock_tampering_detected_at,
      reference_time: clockCheck.reference,
      reason: next.clock_tampering_reason,
    });
  }

  return writeStoredLicenseState(next);
}

function getOfflineReferenceDate(state, backendConfig = getBackendConfig()) {
  if (backendConfig.enabled) {
    return new Date(state?.last_remote_verification_at || state?.activated_at || '');
  }
  return new Date(state?.last_successful_verification_at || state?.activated_at || '');
}

function computeDaysRemaining(fromDate) {
  if (Number.isNaN(fromDate.getTime())) return 0;
  const graceUntil = addDays(fromDate, OFFLINE_GRACE_DAYS);
  const diffMs = graceUntil.getTime() - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

function usesLocalLicenseEvidence(state) {
  if (!state) return false;
  return state.mode === 'local_test' || state.mode === 'signed_envelope' || state.mode === 'legacy_local' || !!state.envelope;
}

function buildStatusFromState(stateInput, overrides = {}) {
  const context = overrides.context || getInstallContext();
  const settings = overrides.settings || settingsService.getSettings();
  const backendConfig = overrides.backendConfig || getBackendConfig();
  const policy = overrides.policy || getVerificationPolicy({
    context,
    backendConfig,
    demoVariant: overrides.demoVariant,
    developmentVariant: overrides.developmentVariant,
    explicitLocalFallback: overrides.explicitLocalFallback,
    rawVariant: overrides.rawVariant,
  });
  const activationRequest = createActivationRequest();
  const demoMode = typeof overrides.demoVariant === 'boolean' ? overrides.demoVariant : isDemoVariant();
  const now = overrides.now instanceof Date ? overrides.now : new Date();

  if (demoMode) {
    const status = {
      code: 'demo',
      label: 'Demo',
      environment: 'demo',
      license_state: 'demo',
      message: 'Versione demo attiva. Nessuna licenza richiesta.',
      is_active: true,
      is_blocking: false,
      is_write_blocked: false,
      block_reason: '',
      install_context: context,
      activation_request: null,
      verification: {
        backend_configured: false,
        backend_provider: 'demo',
        backend_mandatory: false,
        last_checked_at: '',
        last_successful_at: '',
        last_remote_at: '',
        offline_grace_days: OFFLINE_GRACE_DAYS,
        offline_days_remaining: OFFLINE_GRACE_DAYS,
        offline_grace_until: '',
        last_error: '',
        clock_tampering_detected_at: '',
        local_fallback_allowed: true,
        local_fallback_reason: 'demo_variant',
      },
      license: buildLicensePayload({
        license_key: '',
        license_id: 'DEMO',
        company_name: settings.company.name || '',
        activation_date: '',
        expires_at: '',
        license_status: 'demo',
        activation_method: 'demo_builtin',
        customer_name: 'Demo',
        admin_notes: 'Demo mode',
      }),
      is_admin: settings.security.current_role === 'admin',
    };

    syncSettingsLicenseMetadata(status);
    return status;
  }

  if (!stateInput) {
    const status = {
      code: 'unlicensed',
      label: mapStatusLabel('unlicensed'),
      environment: policy.development_variant ? 'development' : 'production',
      license_state: 'unlicensed',
      message: 'Licenza non ancora attivata. Inserisci un codice licenza per usare il gestionale.',
      is_active: false,
      is_blocking: true,
      is_write_blocked: true,
      block_reason: 'license_missing',
      install_context: context,
      activation_request: activationRequest,
      verification: {
        backend_configured: backendConfig.enabled,
        backend_provider: backendConfig.provider,
        backend_mandatory: policy.backend_mandatory,
        last_checked_at: '',
        last_successful_at: '',
        last_remote_at: '',
        offline_grace_days: OFFLINE_GRACE_DAYS,
        offline_days_remaining: 0,
        offline_grace_until: '',
        last_error: '',
        clock_tampering_detected_at: '',
        local_fallback_allowed: policy.local_fallback_effective,
        local_fallback_reason: policy.local_fallback_reason,
      },
      license: buildLicensePayload({
        company_name: settings.company.name || '',
        activation_method: backendConfig.enabled ? 'remote_pending' : 'local_pending',
        license_status: 'unlicensed',
        admin_notes: 'Licenza non attivata',
      }),
      is_admin: settings.security.current_role === 'admin',
    };

    syncSettingsLicenseMetadata(status);
    return status;
  }

  const clockCheck = isClockTampered(stateInput, now);
  const expiresAt = new Date(stateInput.expires_at || '');
  const offlineReference = getOfflineReferenceDate(stateInput, backendConfig);
  const offlineGraceUntil = !Number.isNaN(offlineReference.getTime())
    ? addDays(offlineReference, OFFLINE_GRACE_DAYS)
    : null;
  const offlineDaysRemaining = !offlineGraceUntil
    ? 0
    : Math.max(0, Math.ceil((offlineGraceUntil.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));

  let code = 'active';
  let licenseState = 'active';
  let message = 'Licenza attiva.';
  let blockReason = '';
  let isBlocking = false;
  let isWriteBlocked = false;

  if (stateInput.install_id && stateInput.install_id !== context.install_id) {
    code = 'suspended';
    licenseState = 'suspended';
    message = LICENSE_WRITE_BLOCK_MESSAGE;
    blockReason = 'install_id_mismatch';
    isWriteBlocked = true;
  } else if (stateInput.machine_fingerprint && stateInput.machine_fingerprint !== context.machine_fingerprint) {
    code = 'suspended';
    licenseState = 'suspended';
    message = LICENSE_WRITE_BLOCK_MESSAGE;
    blockReason = 'machine_fingerprint_mismatch';
    isWriteBlocked = true;
  } else if (stateInput.machine_id_hash && stateInput.machine_id_hash !== context.machine_id_hash) {
    code = 'suspended';
    licenseState = 'suspended';
    message = LICENSE_WRITE_BLOCK_MESSAGE;
    blockReason = 'machine_id_mismatch';
    isWriteBlocked = true;
  } else if (usesLocalLicenseEvidence(stateInput) && !policy.local_fallback_effective) {
    code = 'suspended';
    licenseState = 'suspended';
    message = LICENSE_WRITE_BLOCK_MESSAGE;
    blockReason = policy.backend_mandatory ? 'backend_verification_required' : 'local_license_not_permitted';
    isWriteBlocked = true;
  } else if (clockCheck.tampered || stateInput.clock_tampering_detected_at) {
    code = 'suspended';
    licenseState = 'suspended';
    message = LICENSE_WRITE_BLOCK_MESSAGE;
    blockReason = stateInput.clock_tampering_reason || clockCheck.reason || 'system_clock_rollback';
    isWriteBlocked = true;
  } else if (String(stateInput.status || '').toLowerCase() === 'suspended') {
    code = 'suspended';
    licenseState = 'suspended';
    message = LICENSE_WRITE_BLOCK_MESSAGE;
    blockReason = 'license_suspended';
    isWriteBlocked = true;
  } else if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < now.getTime()) {
    code = 'expired';
    licenseState = 'expired';
    message = LICENSE_WRITE_BLOCK_MESSAGE;
    blockReason = 'license_expired';
    isWriteBlocked = true;
  } else if (
    backendConfig.enabled &&
    offlineGraceUntil &&
    offlineGraceUntil.getTime() < now.getTime()
  ) {
    code = 'verification_overdue';
    licenseState = 'verification_overdue';
    message = LICENSE_WRITE_BLOCK_MESSAGE;
    blockReason = 'verification_overdue';
    isWriteBlocked = true;
  } else if (
    backendConfig.enabled &&
    (!stateInput.last_remote_verification_at || offlineDaysRemaining < OFFLINE_GRACE_DAYS)
  ) {
    code = 'active_grace';
    licenseState = 'active';
    message = `Licenza attiva, ma l'ultima verifica online non e recente. Giorni offline rimanenti: ${offlineDaysRemaining}.`;
  }

  const license = buildLicensePayload({
    license_key: stateInput.license_key || '',
    license_id: stateInput.license_id || '',
    company_name: stateInput.company_name || '',
    activation_date: stateInput.activated_at || '',
    expires_at: stateInput.expires_at || '',
    license_status: licenseState,
    activation_method: stateInput.activation_source || stateInput.mode || 'local',
    customer_name: stateInput.customer_name || '',
    admin_notes: blockReason || '',
  });

  const status = {
    code,
    label: mapStatusLabel(code),
    environment: policy.development_variant ? 'development' : 'production',
    license_state: licenseState,
    message,
    is_active: !isWriteBlocked,
    is_blocking: isBlocking,
    is_write_blocked: isWriteBlocked,
    block_reason: blockReason,
    install_context: context,
    activation_request: activationRequest,
    verification: {
      backend_configured: backendConfig.enabled,
      backend_provider: backendConfig.provider,
      backend_mandatory: policy.backend_mandatory,
      last_checked_at: stateInput.last_verification_attempt_at || stateInput.last_verified_at || '',
      last_successful_at: stateInput.last_successful_verification_at || '',
      last_remote_at: stateInput.last_remote_verification_at || '',
      offline_grace_days: OFFLINE_GRACE_DAYS,
      offline_days_remaining: offlineDaysRemaining,
      offline_grace_until: offlineGraceUntil ? offlineGraceUntil.toISOString() : '',
      last_error: stateInput.last_verification_error || '',
      clock_tampering_detected_at: stateInput.clock_tampering_detected_at || '',
      local_fallback_allowed: policy.local_fallback_effective,
      local_fallback_reason: policy.local_fallback_reason,
    },
    license,
    is_admin: settings.security.current_role === 'admin',
    ...overrides,
  };

  syncSettingsLicenseMetadata(status);
  return status;
}

async function activateWithBackend(activationCode, context) {
  const backendConfig = getBackendConfig();
  if (!backendConfig.enabled) {
    return null;
  }

  const result = await postJson(
    `${backendConfig.base_url.replace(/\/+$/, '')}/activate`,
    {
      activation_code: activationCode,
      install_context: context,
      activation_request: createActivationRequest(),
    },
    backendConfig.api_key
      ? { authorization: `Bearer ${backendConfig.api_key}` }
      : {}
  );

  if (!result.ok) {
    throw new Error(result.body?.message || 'Attivazione licenza fallita.');
  }

  return applyRemoteLicenseResult(null, {
    ...result.body,
    license_key: activationCode,
  });
}

async function verifyWithBackend(state) {
  const backendConfig = getBackendConfig();
  if (!backendConfig.enabled || !state) {
    return null;
  }

  try {
    const result = await postJson(
      `${backendConfig.base_url.replace(/\/+$/, '')}/verify`,
      {
        license_id: state.license_id,
        license_key: state.license_key,
        install_context: getInstallContext(),
        last_remote_verification_at: state.last_remote_verification_at || '',
        app_version: app.getVersion(),
      },
      backendConfig.api_key
        ? { authorization: `Bearer ${backendConfig.api_key}` }
        : {}
    );

    if (!result.ok) {
      return {
        ok: false,
        offline: false,
        code: 'remote_verify_rejected',
        message: result.body?.message || 'Verifica licenza non valida.',
      };
    }

    return {
      ok: true,
      state: applyRemoteLicenseResult(state, {
        ...result.body,
        license_key: result.body?.license_key || state.license_key,
      }),
    };
  } catch (error) {
    return {
      ok: false,
      offline: true,
      code: 'remote_verify_unreachable',
      message: error?.name === 'AbortError'
        ? 'Timeout verifica licenza.'
        : (error?.message || 'Verifica licenza non raggiungibile.'),
    };
  }
}

function verifyWithLocalEvidence(state) {
  if (!state) {
    return {
      ok: false,
      code: 'license_missing',
      message: 'Licenza mancante.',
    };
  }

  if (state.mode === 'local_test') {
    const expiresAt = new Date(state.expires_at || '');
    if (!Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() < Date.now()) {
      return {
        ok: false,
        code: 'license_expired',
        message: 'Licenza scaduta.',
      };
    }

    return {
      ok: true,
      code: 'local_test_valid',
      message: 'Licenza di test valida.',
    };
  }

  if (state.envelope) {
    const verification = verifyEnvelope(state.envelope);
    if (!verification.valid) {
      return {
        ok: false,
        code: verification.code,
        message: verification.message,
      };
    }

    return {
      ok: true,
      code: 'signed_envelope_valid',
      message: 'Licenza locale valida.',
    };
  }

  return {
    ok: false,
    code: 'license_state_unknown',
    message: 'Stato licenza non riconosciuto.',
  };
}

function shouldVerify(state) {
  if (!state) return false;
  const lastCheck = new Date(state.last_verification_attempt_at || state.last_verified_at || state.activated_at || '');
  if (Number.isNaN(lastCheck.getTime())) return true;
  return (Date.now() - lastCheck.getTime()) >= VERIFY_INTERVAL_HOURS * 60 * 60 * 1000;
}

async function activateLicense(activationInput) {
  const normalizedInput = String(activationInput || '').trim();
  if (!normalizedInput) {
    throw new Error('Codice licenza mancante.');
  }

  const context = getInstallContext();
  const backendConfig = getBackendConfig();
  const policy = getVerificationPolicy({ context, backendConfig });

  if (isLocalTestActivationCode(normalizedInput)) {
    if (!policy.local_fallback_effective) {
      throw new Error(
        policy.backend_mandatory
          ? 'In questa build commerciale la licenza deve essere attivata e verificata dal backend.'
          : 'La licenza locale di test e consentita solo in demo, sviluppo o con GESTIONALE_ALLOW_OFFLINE_LOCAL_LICENSE=true.'
      );
    }
    const state = writeStoredLicenseState(createLocalTestLicense(LOCAL_TEST_LICENSE_KEY));
    const status = buildStatusFromState(state);
    logLicenseEvent('activated', {
      code: status.code,
      license_id: status.license?.license_id,
      activation_source: state.activation_source,
      machine_fingerprint: context.machine_fingerprint,
    });
    return status;
  }

  let state = null;

  try {
    state = await activateWithBackend(normalizedInput, context);
  } catch (error) {
    logLicenseEvent('activate-remote-failed', {
      message: error?.message || String(error),
    });
  }

  if (!state) {
    if (!policy.local_fallback_effective) {
      throw new Error(
        policy.backend_mandatory
          ? 'Backend licenze obbligatorio: impossibile attivare una licenza locale in questa build commerciale.'
          : 'Fallback locale disabilitato: usa demo/dev oppure abilita GESTIONALE_ALLOW_OFFLINE_LOCAL_LICENSE=true.'
      );
    }
    const envelope = parseActivationInput(normalizedInput);
    const verification = verifyEnvelope(envelope, context);
    if (!verification.valid) {
      throw new Error(verification.message);
    }
    state = createStateFromEnvelope(envelope);
  }

  const persisted = writeStoredLicenseState(state);
  const status = buildStatusFromState(persisted);
  logLicenseEvent('activated', {
    code: status.code,
    license_id: status.license?.license_id,
    activation_source: persisted.activation_source,
    expires_at: persisted.expires_at,
    machine_fingerprint: context.machine_fingerprint,
  });
  return status;
}

async function verifyLicense(options = {}) {
  const runtime = getRuntimeContext();
  if (isDevLicenseBypassEnabled()) {
    logLicenseEvent('dev-bypass', {
      message: 'DEV MODE - license bypass attivo',
      app_variant: runtime.appVariant,
      is_dev: runtime.isDev,
      is_demo: runtime.isDemo,
      is_production: runtime.isProduction,
      reason: options.reason || 'dev-bypass',
    });
    return getDevBypassStatus();
  }

  if (isDemoVariant()) {
    const status = buildStatusFromState(null);
    logLicenseEvent('status', {
      code: status.code,
      last_online_verification: '',
      offline_days_remaining: status.verification.offline_days_remaining,
      block_reason: status.block_reason,
      reason: options.reason || 'demo',
    });
    return status;
  }

  const now = new Date().toISOString();
  let state = readStoredLicenseState();
  if (!state) {
    const status = buildStatusFromState(null);
    logLicenseEvent('status', {
      code: status.code,
      last_online_verification: '',
      offline_days_remaining: status.verification.offline_days_remaining,
      block_reason: status.block_reason,
      reason: options.reason || 'missing-state',
    });
    return status;
  }

  state = writeStoredLicenseState({
    ...state,
    last_verification_attempt_at: now,
  });
  const backendConfig = getBackendConfig();
  const policy = getVerificationPolicy({ context: getInstallContext(), backendConfig });

  const clockCheck = isClockTampered(state, new Date());
  if (clockCheck.tampered) {
    state = writeStoredLicenseState({
      ...state,
      clock_tampering_detected_at: state.clock_tampering_detected_at || now,
      clock_tampering_reason: state.clock_tampering_reason || clockCheck.reason || 'system_clock_rollback',
      last_verification_result: 'blocked',
      last_verification_error: 'Rilevata possibile manomissione della data di sistema.',
    });

    const status = buildStatusFromState(state);
    logLicenseEvent('status', {
      code: status.code,
      last_online_verification: status.verification.last_remote_at,
      offline_days_remaining: status.verification.offline_days_remaining,
      block_reason: status.block_reason,
      reason: options.reason || 'clock-tampering',
    });
    return status;
  }

  const remoteVerification = await verifyWithBackend(state);
  if (remoteVerification?.ok) {
    state = writeStoredLicenseState(remoteVerification.state);
  } else if (remoteVerification?.offline) {
    state = writeStoredLicenseState({
      ...state,
      last_verified_at: now,
      last_verification_result: 'offline',
      last_verification_error: remoteVerification.message,
    });
  } else if (remoteVerification && !remoteVerification.ok) {
    state = writeStoredLicenseState({
      ...state,
      status: remoteVerification.code === 'remote_verify_rejected' ? 'suspended' : state.status,
      last_verified_at: now,
      last_verification_result: 'failed',
      last_verification_error: remoteVerification.message,
    });
  } else if (policy.local_fallback_effective) {
    const localVerification = verifyWithLocalEvidence(state);
    state = writeStoredLicenseState({
      ...state,
      status: localVerification.ok ? state.status : 'suspended',
      last_verified_at: now,
      last_successful_verification_at: localVerification.ok ? now : state.last_successful_verification_at,
      last_verification_result: localVerification.ok ? 'success' : 'failed',
      last_verification_error: localVerification.ok ? '' : localVerification.message,
    });
  } else {
    state = writeStoredLicenseState({
      ...state,
      status: 'suspended',
      last_verified_at: now,
      last_verification_result: 'failed',
      last_verification_error: policy.backend_mandatory
        ? 'Backend licenze obbligatorio: nessun fallback locale consentito.'
        : 'Verifica locale disabilitata in questa build.',
    });
  }

  state = touchLastSeen(state, new Date());
  const status = buildStatusFromState(state);
  logLicenseEvent('status', {
    code: status.code,
    last_online_verification: status.verification.last_remote_at,
    last_checked_at: status.verification.last_checked_at,
    offline_days_remaining: status.verification.offline_days_remaining,
    block_reason: status.block_reason,
    reason: options.reason || 'manual',
  });
  return status;
}

function getLicenseStatus() {
  const runtime = getRuntimeContext();
  if (isDevLicenseBypassEnabled()) {
    logLicenseEvent('dev-bypass', {
      message: 'DEV MODE - license bypass attivo',
      app_variant: runtime.appVariant,
      is_dev: runtime.isDev,
      is_demo: runtime.isDemo,
      is_production: runtime.isProduction,
      reason: 'read-status',
    });
    return getDevBypassStatus();
  }

  const state = readStoredLicenseState();
  const nextState = state ? touchLastSeen(state, new Date()) : null;
  const status = buildStatusFromState(nextState);
  logLicenseEvent('status', {
    code: status.code,
    last_online_verification: status.verification.last_remote_at,
    last_checked_at: status.verification.last_checked_at,
    offline_days_remaining: status.verification.offline_days_remaining,
    block_reason: status.block_reason,
    reason: 'read-status',
  });
  return status;
}

function enforceLicenseGuard(actionLabel = 'questa operazione') {
  if (isDevLicenseBypassEnabled()) {
    return getDevBypassStatus();
  }

  const status = getLicenseStatus();
  if (!status?.is_write_blocked) {
    return status;
  }

  logLicenseEvent('guard-blocked', {
    requested_action: actionLabel,
    license_status: status.code,
    license_label: status.label,
    block_reason: status.block_reason,
    offline_days_remaining: status.verification?.offline_days_remaining,
    expires_at: status.license?.expires_at || '',
    last_online_verification: status.verification?.last_remote_at || '',
  });

  const error = new Error(
    `${LICENSE_WRITE_BLOCK_MESSAGE} ${actionLabel} non e disponibile in modalita sola lettura.`
  );
  error.code = 'LICENSE_READ_ONLY';
  error.license_status = status;
  throw error;
}

function requireWritableLicense(actionLabel = 'questa operazione') {
  return enforceLicenseGuard(actionLabel);
}

function deactivate() {
  settingsService.requireAdmin();
  removeStoredLicense();
  const status = getLicenseStatus();
  logLicenseEvent('deactivated', {
    code: status.code,
  });
  return status;
}

async function bootstrapLicenseMonitoring() {
  logLicenseEvent('bootstrap:public-key', getPublicKeyInfo());
  await verifyLicense({ reason: 'startup' });

  if (periodicVerifyTimer) {
    clearInterval(periodicVerifyTimer);
  }

  periodicVerifyTimer = setInterval(() => {
    const state = readStoredLicenseState();
    if (!state || !shouldVerify(state)) {
      return;
    }

    verifyLicense({ reason: 'periodic' }).catch((error) => {
      logLicenseEvent('periodic-verify-failed', {
        message: error?.message || String(error),
      });
    });
  }, PERIODIC_VERIFY_MS);

  if (typeof periodicVerifyTimer.unref === 'function') {
    periodicVerifyTimer.unref();
  }
}

module.exports = {
  activate: activateLicense,
  activateLicense,
  bootstrapLicenseMonitoring,
  createActivationRequest,
  deactivate,
  enforceLicenseGuard,
  getInstallContext,
  getLicenseFilePath,
  getLicenseStatus,
  getPublicKeyInfo,
  getPublicKeyPath,
  requireWritableLicense,
  setLogger,
  verifyLicense,
  __internal: {
    buildStatusFromState,
    createCanonicalString,
    deserializeEncryptedState,
    getVerificationPolicy,
    isClockTampered,
    serializeEncryptedState,
    usesLocalLicenseEvidence,
    verifyEnvelope,
  },
};
