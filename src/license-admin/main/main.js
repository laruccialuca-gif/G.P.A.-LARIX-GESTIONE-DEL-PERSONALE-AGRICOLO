const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const APP_NAME = 'GPA License Admin';
const DATA_DIR_NAME = 'GPA-License-Admin';
const DB_FILE_NAME = 'license-admin.sqlite';

let mainWindow = null;
let db = null;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function getDataDir() {
  return ensureDir(path.join(app.getPath('appData'), DATA_DIR_NAME));
}

function getDbPath() {
  return path.join(getDataDir(), DB_FILE_NAME);
}

function getSecret() {
  return String(process.env.GESTIONALE_LICENSE_SECRET || '').trim();
}

function getSignatureMode() {
  const secret = getSecret();
  if (!secret) return 'missing';
  return secret.includes('BEGIN PRIVATE KEY') ? 'ed25519' : 'hmac-sha256';
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
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

function signPayload(payload) {
  const secret = getSecret();
  if (!secret) {
    throw new Error('GESTIONALE_LICENSE_SECRET non configurata. Impostala per generare licenze firmate.');
  }

  if (getSignatureMode() === 'ed25519') {
    return crypto.sign(null, Buffer.from(createCanonicalString(payload), 'utf8'), secret).toString('base64');
  }

  return crypto
    .createHmac('sha256', secret)
    .update(createCanonicalString(payload), 'utf8')
    .digest('base64');
}

function createLicenseCode(payload) {
  const envelope = {
    schema_version: 1,
    algorithm: getSignatureMode(),
    payload,
    signature: signPayload(payload),
  };

  return {
    envelope,
    code: Buffer.from(JSON.stringify(envelope), 'utf8').toString('base64url'),
  };
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeFeatures(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map(normalizeText)
    .filter(Boolean);
}

function getDb() {
  if (db) return db;

  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_name TEXT NOT NULL,
      contact_name TEXT,
      email TEXT,
      phone TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS licenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id TEXT NOT NULL UNIQUE,
      customer_id INTEGER NOT NULL,
      plan TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      max_machines INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      features_json TEXT NOT NULL DEFAULT '[]',
      license_code TEXT,
      envelope_json TEXT,
      issued_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS license_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      license_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      details_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_customers_search ON customers(company_name, email, contact_name);
    CREATE INDEX IF NOT EXISTS idx_licenses_customer ON licenses(customer_id, status, expires_at);
    CREATE INDEX IF NOT EXISTS idx_licenses_license_id ON licenses(license_id);
  `);

  return db;
}

function mapCustomer(row) {
  return row
    ? {
        id: row.id,
        company_name: row.company_name || '',
        contact_name: row.contact_name || '',
        email: row.email || '',
        phone: row.phone || '',
        notes: row.notes || '',
        created_at: row.created_at || '',
        updated_at: row.updated_at || '',
      }
    : null;
}

function mapLicense(row) {
  if (!row) return null;
  let features = [];
  try {
    features = JSON.parse(row.features_json || '[]');
  } catch {
    features = [];
  }

  return {
    id: row.id,
    license_id: row.license_id || '',
    customer_id: row.customer_id,
    customer_name: row.customer_name || '',
    customer_email: row.customer_email || '',
    plan: row.plan || 'monthly',
    starts_at: row.starts_at || '',
    expires_at: row.expires_at || '',
    max_machines: Number(row.max_machines || 1),
    status: row.status || 'active',
    features,
    license_code: row.license_code || '',
    issued_at: row.issued_at || '',
    created_at: row.created_at || '',
    updated_at: row.updated_at || '',
  };
}

function recordEvent(licenseRowId, eventType, details = {}) {
  getDb().prepare(`
    INSERT INTO license_events (license_id, event_type, details_json)
    VALUES (?, ?, ?)
  `).run(licenseRowId, eventType, JSON.stringify(details));
}

function buildLicensePayload(input, customer) {
  const issuedAt = nowIso();
  const status = normalizeText(input.status || 'active');
  return {
    license_id: normalizeText(input.license_id),
    customer_name: normalizeText(customer.company_name),
    customer_email: normalizeText(customer.email),
    issued_at: issuedAt,
    starts_at: normalizeText(input.starts_at),
    expires_at: normalizeText(input.expires_at),
    max_machines: Number(input.max_machines || 1) || 1,
    max_installations: Number(input.max_machines || 1) || 1,
    plan: normalizeText(input.plan || 'monthly'),
    status,
    license_status: status,
    features: normalizeFeatures(input.features),
    activation_method: getSignatureMode() === 'ed25519' ? 'license_admin_ed25519' : 'license_admin_hmac',
  };
}

function generateAndPersistLicenseCode(licenseRow, customer, eventType) {
  const payload = buildLicensePayload(licenseRow, customer);
  const generated = createLicenseCode(payload);
  const database = getDb();

  database.prepare(`
    UPDATE licenses
    SET license_code = @license_code,
        envelope_json = @envelope_json,
        issued_at = @issued_at,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    id: licenseRow.id,
    license_code: generated.code,
    envelope_json: JSON.stringify(generated.envelope, null, 2),
    issued_at: payload.issued_at,
  });

  recordEvent(licenseRow.id, eventType, {
    license_id: payload.license_id,
    status: payload.status,
    expires_at: payload.expires_at,
    plan: payload.plan,
  });

  return generated.code;
}

function requireCustomer(customerId) {
  const row = getDb().prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!row) throw new Error('Cliente non trovato.');
  return mapCustomer(row);
}

function requireLicense(rowId) {
  const row = getDb().prepare(`
    SELECT l.*, c.company_name AS customer_name, c.email AS customer_email
    FROM licenses l
    JOIN customers c ON c.id = l.customer_id
    WHERE l.id = ?
  `).get(rowId);
  if (!row) throw new Error('Licenza non trovata.');
  return mapLicense(row);
}

function listCustomers(search = '') {
  const term = `%${normalizeText(search)}%`;
  const rows = getDb().prepare(`
    SELECT *
    FROM customers
    WHERE @search = ''
       OR company_name LIKE @term
       OR contact_name LIKE @term
       OR email LIKE @term
       OR phone LIKE @term
    ORDER BY company_name COLLATE NOCASE ASC, id DESC
  `).all({ search: normalizeText(search), term });
  return rows.map(mapCustomer);
}

function listLicenses(search = '', customerId = null) {
  const term = `%${normalizeText(search)}%`;
  const rows = getDb().prepare(`
    SELECT l.*, c.company_name AS customer_name, c.email AS customer_email
    FROM licenses l
    JOIN customers c ON c.id = l.customer_id
    WHERE (@customer_id IS NULL OR l.customer_id = @customer_id)
      AND (
        @search = ''
        OR l.license_id LIKE @term
        OR l.status LIKE @term
        OR l.plan LIKE @term
        OR c.company_name LIKE @term
        OR c.email LIKE @term
      )
    ORDER BY l.updated_at DESC, l.id DESC
  `).all({
    customer_id: customerId || null,
    search: normalizeText(search),
    term,
  });
  return rows.map(mapLicense);
}

function setupIpc() {
  ipcMain.handle('license-admin:bootstrap', () => ({
    app_name: APP_NAME,
    data_dir: getDataDir(),
    db_path: getDbPath(),
    secret_configured: !!getSecret(),
    signature_algorithm: getSignatureMode(),
    ed25519_compatible: getSignatureMode() === 'ed25519',
    backend_ready: false,
  }));

  ipcMain.handle('license-admin:open-data-dir', async () => {
    await shell.openPath(getDataDir());
    return { ok: true };
  });

  ipcMain.handle('license-admin:customers:list', (_event, search) => listCustomers(search));

  ipcMain.handle('license-admin:customers:create', (_event, input) => {
    const companyName = normalizeText(input?.company_name);
    if (!companyName) throw new Error('Nome azienda obbligatorio.');

    const result = getDb().prepare(`
      INSERT INTO customers (company_name, contact_name, email, phone, notes)
      VALUES (@company_name, @contact_name, @email, @phone, @notes)
    `).run({
      company_name: companyName,
      contact_name: normalizeText(input?.contact_name),
      email: normalizeText(input?.email),
      phone: normalizeText(input?.phone),
      notes: normalizeText(input?.notes),
    });

    return requireCustomer(result.lastInsertRowid);
  });

  ipcMain.handle('license-admin:licenses:list', (_event, options = {}) =>
    listLicenses(options.search, options.customer_id)
  );

  ipcMain.handle('license-admin:licenses:create', (_event, input) => {
    const customer = requireCustomer(input?.customer_id);
    const licenseId = normalizeText(input?.license_id) || `GPA-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const features = normalizeFeatures(input?.features);
    const startsAt = normalizeText(input?.starts_at);
    const expiresAt = normalizeText(input?.expires_at);
    if (!startsAt || !expiresAt) throw new Error('Data inizio e data scadenza sono obbligatorie.');

    const database = getDb();
    const tx = database.transaction(() => {
      const result = database.prepare(`
        INSERT INTO licenses (
          license_id, customer_id, plan, starts_at, expires_at, max_machines, status, features_json
        ) VALUES (
          @license_id, @customer_id, @plan, @starts_at, @expires_at, @max_machines, @status, @features_json
        )
      `).run({
        license_id: licenseId,
        customer_id: customer.id,
        plan: normalizeText(input?.plan || 'monthly'),
        starts_at: startsAt,
        expires_at: expiresAt,
        max_machines: Number(input?.max_machines || 1) || 1,
        status: normalizeText(input?.status || 'active'),
        features_json: JSON.stringify(features),
      });

      const row = {
        id: result.lastInsertRowid,
        license_id: licenseId,
        customer_id: customer.id,
        plan: normalizeText(input?.plan || 'monthly'),
        starts_at: startsAt,
        expires_at: expiresAt,
        max_machines: Number(input?.max_machines || 1) || 1,
        status: normalizeText(input?.status || 'active'),
        features,
      };
      generateAndPersistLicenseCode(row, customer, 'created');
      return result.lastInsertRowid;
    });

    return requireLicense(tx());
  });

  ipcMain.handle('license-admin:licenses:renew', (_event, input) => {
    const license = requireLicense(input?.id);
    const expiresAt = normalizeText(input?.expires_at);
    if (!expiresAt) throw new Error('Nuova data scadenza obbligatoria.');
    const database = getDb();
    const customer = requireCustomer(license.customer_id);

    database.prepare(`
      UPDATE licenses
      SET expires_at = @expires_at,
          status = 'active',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ id: license.id, expires_at: expiresAt });

    const updated = requireLicense(license.id);
    generateAndPersistLicenseCode(updated, customer, 'renewed');
    return requireLicense(license.id);
  });

  ipcMain.handle('license-admin:licenses:set-status', (_event, input) => {
    const license = requireLicense(input?.id);
    const status = normalizeText(input?.status);
    if (!['active', 'suspended', 'expired'].includes(status)) {
      throw new Error('Stato licenza non valido.');
    }
    const customer = requireCustomer(license.customer_id);
    getDb().prepare(`
      UPDATE licenses
      SET status = @status,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ id: license.id, status });

    const updated = requireLicense(license.id);
    generateAndPersistLicenseCode(updated, customer, `status:${status}`);
    return requireLicense(license.id);
  });

  ipcMain.handle('license-admin:licenses:verify-compatibility', (_event, code) => {
    if (!code) throw new Error('Codice licenza mancante.');

    let envelope;
    try {
      const json = Buffer.from(code, 'base64url').toString('utf8');
      envelope = JSON.parse(json);
    } catch {
      return { compatible: false, algorithm: 'unknown', reason: 'Codice licenza non valido o corrotto.' };
    }

    const { algorithm, payload, signature } = envelope;

    if (algorithm === 'hmac-sha256') {
      return {
        compatible: false,
        algorithm,
        reason: 'Firma HMAC-SHA256: non compatibile con la verifica locale Ed25519 del gestionale cliente.',
      };
    }

    if (algorithm === 'ed25519') {
      const secret = getSecret();
      if (!secret || getSignatureMode() !== 'ed25519') {
        return {
          compatible: false,
          algorithm,
          reason: 'Chiave privata Ed25519 non disponibile per verificare la firma.',
        };
      }
      try {
        const privateKey = crypto.createPrivateKey(secret);
        const publicKey = crypto.createPublicKey(privateKey);
        const payloadStr = createCanonicalString(payload);
        const valid = crypto.verify(
          null,
          Buffer.from(payloadStr, 'utf8'),
          publicKey,
          Buffer.from(signature, 'base64')
        );
        return {
          compatible: valid,
          algorithm,
          reason: valid
            ? 'Firma Ed25519 valida: compatibile con la verifica locale del gestionale cliente.'
            : 'Firma Ed25519 non valida: corrotta o firmata con chiave diversa.',
        };
      } catch (err) {
        return {
          compatible: false,
          algorithm,
          reason: `Errore verifica firma Ed25519: ${err.message}`,
        };
      }
    }

    return {
      compatible: false,
      algorithm: algorithm || 'unknown',
      reason: `Algoritmo non riconosciuto: "${algorithm}". Non compatibile con il gestionale.`,
    };
  });

  ipcMain.handle('license-admin:licenses:copy-code', (_event, id) => {
    const license = requireLicense(id);
    if (!license.license_code) throw new Error('Codice licenza non generato.');
    clipboard.writeText(license.license_code);
    recordEvent(license.id, 'copied');
    return { ok: true };
  });

  ipcMain.handle('license-admin:licenses:export-code', async (_event, id) => {
    const license = requireLicense(id);
    if (!license.license_code) throw new Error('Codice licenza non generato.');

    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Esporta licenza',
      defaultPath: `${license.license_id}.txt`,
      filters: [{ name: 'Licenza GPA', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { canceled: true };

    fs.writeFileSync(
      filePath,
      [
        `GPA License Admin`,
        `License ID: ${license.license_id}`,
        `Cliente: ${license.customer_name}`,
        `Email: ${license.customer_email}`,
        `Scadenza: ${license.expires_at}`,
        '',
        license.license_code,
        '',
      ].join('\n'),
      'utf8'
    );
    recordEvent(license.id, 'exported', { file_path: filePath });
    return { canceled: false, file_path: filePath };
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 620,
    title: APP_NAME,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devUrl = process.env.LICENSE_ADMIN_DEV_URL || 'http://localhost:5176';
  if (!app.isPackaged && process.env.LICENSE_ADMIN_DEV === '1') {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../../dist-license-admin/index-license-admin.html'));
  }
}

if (!app || typeof app.whenReady !== 'function') {
  throw new Error('Electron main process non disponibile per GPA License Admin.');
}

app.setName(APP_NAME);
app.setPath('userData', getDataDir());
setupIpc();

app.whenReady().then(() => {
  getDb();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (db) {
    db.close();
    db = null;
  }
});
