const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

function isoDaysFrom(baseDate, dayOffset) {
  const next = new Date(baseDate.getTime());
  next.setUTCDate(next.getUTCDate() + dayOffset);
  return next.toISOString();
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gpa-license-scenarios-'));
const fakeSettings = {
  company: { name: 'Azienda Test', document_header: '' },
  security: { current_role: 'admin' },
  licensing: {
    install_id: 'install-A',
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

const fakeElectron = {
  app: {
    getName: () => 'Gestionale',
    getVersion: () => '1.0.0-test',
    getPath: (key) => {
      if (key === 'appData' || key === 'userData') return tempRoot;
      if (key === 'exe') return path.join(tempRoot, 'Gestionale');
      return tempRoot;
    },
    getAppPath: () => process.cwd(),
    isPackaged: true,
  },
};

const settingsServiceMock = {
  getSettings: () => fakeSettings,
  writeSettings: (next) => {
    Object.assign(fakeSettings, next || {});
    return fakeSettings;
  },
};

const storagePathsMock = {
  getConfigDir: () => {
    const target = path.join(tempRoot, 'config');
    fs.mkdirSync(target, { recursive: true });
    return target;
  },
};

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'electron') {
    return fakeElectron;
  }

  if (request === './settingsService' && parent?.filename?.endsWith(path.join('src', 'main', 'licenseService.js'))) {
    return settingsServiceMock;
  }

  if (request === './storagePaths' && parent?.filename?.endsWith(path.join('src', 'main', 'licenseService.js'))) {
    return storagePathsMock;
  }

  return originalLoad.call(this, request, parent, isMain);
};

const licenseService = require('../src/main/licenseService');
const { __internal } = licenseService;
Module._load = originalLoad;

const now = new Date('2026-05-01T10:00:00.000Z');
const context = {
  install_id: 'install-A',
  machine_fingerprint: 'fingerprint-A',
  machine_id_hash: 'machine-A',
  app_version: '1.0.0-test',
  packaged: true,
  platform: process.platform,
};
const settings = {
  company: { name: 'Azienda Test', document_header: '' },
  security: { current_role: 'admin' },
};
const backendConfig = {
  enabled: true,
  provider: 'http-api',
  base_url: 'https://licenses.example.test',
  api_key: '',
};
const productionPolicy = __internal.getVerificationPolicy({
  context,
  backendConfig,
  demoVariant: false,
  developmentVariant: false,
  explicitLocalFallback: false,
  rawVariant: 'standard',
});
const devPolicy = __internal.getVerificationPolicy({
  context: { ...context, packaged: false },
  backendConfig: { enabled: false, provider: 'none', base_url: '', api_key: '' },
  demoVariant: false,
  developmentVariant: true,
  explicitLocalFallback: false,
  rawVariant: 'dev',
});

const baseRemoteState = {
  schema_version: 3,
  mode: 'remote_subscription',
  status: 'active',
  license_key: 'LIC-001',
  license_id: 'SUB-001',
  customer_name: 'Cliente Test',
  company_name: 'Azienda Test',
  activated_at: isoDaysFrom(now, -10),
  expires_at: isoDaysFrom(now, 30),
  install_id: context.install_id,
  machine_fingerprint: context.machine_fingerprint,
  machine_id_hash: context.machine_id_hash,
  activation_source: 'remote_subscription',
  envelope: null,
  last_seen_at: now.toISOString(),
  max_seen_at: now.toISOString(),
  last_verified_at: now.toISOString(),
  last_successful_verification_at: now.toISOString(),
  last_remote_verification_at: now.toISOString(),
  last_verification_attempt_at: now.toISOString(),
  last_verification_result: 'success',
  last_verification_error: '',
  clock_tampering_detected_at: '',
  clock_tampering_reason: '',
};
const baseLocalState = {
  ...baseRemoteState,
  mode: 'signed_envelope',
  activation_source: 'signed_envelope',
  envelope: {
    payload: {
      installation_id: context.install_id,
      machine_fingerprint: context.machine_fingerprint,
      machine_id_hash: context.machine_id_hash,
    },
    signature: 'fake',
  },
};

function evaluate(state, options = {}) {
  return __internal.buildStatusFromState(state, {
    now: options.now || now,
    context: options.context || context,
    settings,
    backendConfig: options.backendConfig || backendConfig,
    policy: options.policy || productionPolicy,
    demoVariant: !!options.demoVariant,
    developmentVariant: !!options.developmentVariant,
    explicitLocalFallback: !!options.explicitLocalFallback,
    rawVariant: options.rawVariant || 'standard',
  });
}

const scenarios = [
  {
    name: 'licenza valida',
    run: () => evaluate(baseRemoteState),
    expect: (status) => status.code === 'active' && status.is_write_blocked === false,
  },
  {
    name: 'licenza scaduta',
    run: () => evaluate({ ...baseRemoteState, expires_at: isoDaysFrom(now, -1) }),
    expect: (status) => status.code === 'expired' && status.block_reason === 'license_expired',
  },
  {
    name: 'licenza sospesa',
    run: () => evaluate({ ...baseRemoteState, status: 'suspended' }),
    expect: (status) => status.code === 'suspended' && status.block_reason === 'license_suspended',
  },
  {
    name: 'macchina diversa',
    run: () => evaluate({ ...baseRemoteState, machine_id_hash: 'machine-B' }),
    expect: (status) => status.code === 'suspended' && status.block_reason === 'machine_id_mismatch',
  },
  {
    name: 'offline entro grace period',
    run: () => evaluate({
      ...baseRemoteState,
      last_remote_verification_at: isoDaysFrom(now, -10),
      last_successful_verification_at: isoDaysFrom(now, -10),
    }),
    expect: (status) => status.code === 'active_grace' && status.verification.offline_days_remaining === 5,
  },
  {
    name: 'offline oltre grace period',
    run: () => evaluate({
      ...baseRemoteState,
      last_remote_verification_at: isoDaysFrom(now, -16),
      last_successful_verification_at: isoDaysFrom(now, -16),
    }),
    expect: (status) => status.code === 'verification_overdue' && status.block_reason === 'verification_overdue',
  },
  {
    name: 'data sistema riportata indietro',
    run: () => evaluate({
      ...baseRemoteState,
      max_seen_at: isoDaysFrom(now, 1),
      clock_tampering_detected_at: now.toISOString(),
      clock_tampering_reason: 'system_clock_rollback',
    }),
    expect: (status) => status.code === 'suspended' && status.block_reason === 'system_clock_rollback',
  },
  {
    name: 'fallback locale bloccato in produzione',
    run: () => evaluate(baseLocalState),
    expect: (status) => status.code === 'suspended' && status.block_reason === 'backend_verification_required',
  },
  {
    name: 'fallback locale consentito in dev',
    run: () => __internal.buildStatusFromState(baseLocalState, {
      now,
      context: { ...context, packaged: false },
      settings,
      backendConfig: { enabled: false, provider: 'none', base_url: '', api_key: '' },
      policy: devPolicy,
      demoVariant: false,
      developmentVariant: true,
      rawVariant: 'dev',
    }),
    expect: (status) => status.code === 'active' && status.is_write_blocked === false,
  },
  {
    name: 'license.dat copiato su altro PC',
    run: () => {
      const serialized = __internal.serializeEncryptedState(baseRemoteState, context, 'Gestionale');
      try {
        __internal.deserializeEncryptedState(serialized, {
          ...context,
          machine_id_hash: 'machine-B',
        }, 'Gestionale');
        return { ok: false, reason: 'decrypt_unexpected_success' };
      } catch (error) {
        return { ok: true, reason: error.message };
      }
    },
    expect: (result) => result.ok === true,
  },
];

let failures = 0;
console.log('Verifica scenari licenza');
console.log('========================');

for (const scenario of scenarios) {
  try {
    const result = scenario.run();
    const passed = scenario.expect(result);
    if (!passed) {
      failures += 1;
    }
    console.log(`${passed ? 'PASS' : 'FAIL'}  ${scenario.name}`);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${scenario.name}`);
    console.log(String(error?.stack || error));
  }
}

if (failures > 0) {
  console.error(`Scenario falliti: ${failures}`);
  process.exitCode = 1;
} else {
  console.log('Tutti gli scenari sono passati.');
}
