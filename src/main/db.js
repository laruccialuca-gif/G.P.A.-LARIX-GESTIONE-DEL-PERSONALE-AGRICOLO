const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { app } = require('electron');
const {
  ensureAppStorageStructure,
  getBackupsDir,
  getDataDir,
  getLegacyElectronUserDataRoot,
  getUserDataRoot,
} = require('./storagePaths');

let db;
const DB_SCHEMA_VERSION = '1.0.0';
let logWriter = () => {};
let integrityCheckTimer = null;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function setLogger(logger) {
  logWriter = typeof logger === 'function' ? logger : () => {};
}

function logDbEvent(event, details = {}) {
  try {
    logWriter(`db:${event}`, details);
  } catch {
    // Best effort only.
  }
}

function ensureColumn(database, tableName, columnName, definition) {
  const columns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = columns.some((column) => column.name === columnName);

  if (!exists) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition};`);
    return true;
  }

  return false;
}

function ensureColumnsWithLogging(database, tableName, columns) {
  const existingColumns = database.prepare(`PRAGMA table_info(${tableName})`).all();
  const existingNames = new Set(existingColumns.map((column) => column.name));
  const missingColumns = columns.filter((column) => !existingNames.has(column.name));

  if (!missingColumns.length) {
    logDbEvent('schema-migration-skipped', {
      table_name: tableName,
      reason: 'all-columns-present',
      checked_columns: columns.map((column) => column.name),
    });
    return [];
  }

  for (const column of missingColumns) {
    database.exec(`ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${column.definition};`);
  }

  logDbEvent('schema-table-updated', {
    table_name: tableName,
    columns_added: missingColumns.map((column) => column.name),
  });

  return missingColumns.map((column) => column.name);
}

function ensureMigrationInfrastructure(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT DEFAULT CURRENT_TIMESTAMP,
      app_version TEXT
    );

    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function setMetadata(database, key, value) {
  database.prepare(`
    INSERT INTO app_metadata (key, value, updated_at)
    VALUES (@key, @value, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    key,
    value: value === undefined || value === null ? '' : String(value),
  });
}

function getMetadata(database, key) {
  return database.prepare(`
    SELECT value
    FROM app_metadata
    WHERE key = ?
  `).get(key)?.value || null;
}

function hasMigration(database, migrationId) {
  return !!database.prepare(`
    SELECT 1
    FROM schema_migrations
    WHERE id = ?
  `).get(migrationId);
}

function recordMigration(database, migrationId) {
  database.prepare(`
    INSERT INTO schema_migrations (id, app_version)
    VALUES (?, ?)
  `).run(migrationId, app.getVersion());
}

function runCoreSchemaMigration(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      fiscal_code TEXT,
      role TEXT,
      contract_type TEXT,
      daily_pay REAL,
      standard_hours REAL DEFAULT 7,
      overtime_use_general_rate INTEGER DEFAULT 1,
      overtime_hourly_rate REAL,
      phone TEXT,
      email TEXT,
      hire_date TEXT,
      hire_date_from TEXT,
      hire_date_to TEXT,
      hired_by TEXT,
      status TEXT DEFAULT 'attivo',
      medical_visit_required INTEGER DEFAULT 0,
      medical_visit_done INTEGER DEFAULT 0,
      medical_visit_done_with_us INTEGER DEFAULT 0,
      medical_visit_date TEXT,
      medical_visit_expiry TEXT,
      medical_visit_notes TEXT,
      art37_required INTEGER DEFAULT 0,
      art37_done INTEGER DEFAULT 0,
      art37_done_with_us INTEGER DEFAULT 0,
      art37_date TEXT,
      art37_expiry TEXT,
      art37_notes TEXT,
      notes TEXT,
      is_deleted INTEGER DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'presente',
      marker_code TEXT,
      entry_code TEXT,
      hours_worked REAL DEFAULT 0,
      overtime_hours REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      UNIQUE(employee_id, date)
    );

    CREATE TABLE IF NOT EXISTS team_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      headcount REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      UNIQUE(team_id, date)
    );

    CREATE TABLE IF NOT EXISTS payroll_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      datore TEXT,
      giornate_effettuate REAL DEFAULT 0,
      ore_totali REAL DEFAULT 0,
      retribuzione_calcolata REAL DEFAULT 0,
      giornate_busta_paga REAL DEFAULT 0,
      importo_busta_paga REAL DEFAULT 0,
      acconti REAL DEFAULT 0,
      acconti_details TEXT,
      resto_precedente REAL DEFAULT 0,
      differenza_finale REAL DEFAULT 0,
      n_macchine_mese REAL DEFAULT 0,
      prezzo_per_macchina REAL DEFAULT 0,
      totale_trasporto REAL DEFAULT 0,
      regalo_importo REAL DEFAULT 0,
      regalo_descrizione TEXT,
      is_pagato INTEGER DEFAULT 0,
      resto_pagato INTEGER DEFAULT 0,
      processed_at TEXT,
      archived_at TEXT,
      report_html_snapshot TEXT,
      report_snapshot_json TEXT,
      note TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      UNIQUE(employee_id, month)
    );

    CREATE TABLE IF NOT EXISTS employee_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      file_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER DEFAULT 0,
      sha256 TEXT,
      file_created_at TEXT,
      uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      UNIQUE(employee_id, category)
    );

    CREATE TABLE IF NOT EXISTS payroll_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payroll_record_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      file_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      mime_type TEXT,
      size_bytes INTEGER DEFAULT 0,
      sha256 TEXT,
      file_created_at TEXT,
      uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payroll_record_id) REFERENCES payroll_records(id),
      UNIQUE(payroll_record_id, category)
    );

    CREATE TABLE IF NOT EXISTS payroll_advances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payroll_record_id INTEGER NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      advance_date TEXT,
      include_in_report INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (payroll_record_id) REFERENCES payroll_records(id)
    );

    CREATE TABLE IF NOT EXISTS employee_financial_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('advance', 'installment')),
      employee_id INTEGER NOT NULL,
      team_id INTEGER,
      employer_key TEXT,
      movement_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'inserted')),
      inserted_report_id INTEGER,
      inserted_month TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (inserted_report_id) REFERENCES payroll_records(id)
    );

    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      notes TEXT,
      attendance_mode TEXT NOT NULL DEFAULT 'details',
      team_daily_rate REAL DEFAULT 0,
      is_archived INTEGER DEFAULT 0,
      archived_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      compensation REAL,
      manage_by_days INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      UNIQUE(team_id, employee_id)
    );

    CREATE TABLE IF NOT EXISTS team_advances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      month TEXT NOT NULL,
      advance_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS employee_employment_periods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      hire_date_from TEXT,
      hire_date_to TEXT,
      hired_by TEXT,
      source_document_id TEXT,
      status TEXT DEFAULT 'attivo',
      is_current INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS occupations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS communications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      period_mode TEXT NOT NULL DEFAULT 'monthly',
      period_start TEXT NOT NULL,
      period_end TEXT NOT NULL,
      month_reference TEXT,
      company_name TEXT,
      title TEXT,
      employer_labels_json TEXT,
      recipient_email TEXT,
      selected_employee_ids_json TEXT DEFAULT '[]',
      employee_dates_json TEXT DEFAULT '{}',
      show_compensation_in_pdf INTEGER DEFAULT 1,
      notes TEXT,
      pdf_relative_path TEXT,
      pdf_sha256 TEXT,
      pdf_created_at TEXT,
      excel_relative_path TEXT,
      excel_sha256 TEXT,
      excel_created_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS communication_details (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      communication_id INTEGER NOT NULL,
      employee_id INTEGER,
      employee_label TEXT NOT NULL,
      giornate_primo REAL DEFAULT 0,
      giornate_secondo REAL DEFAULT 0,
      detail_note TEXT,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (communication_id) REFERENCES communications(id) ON DELETE CASCADE,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS payroll_debt_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      label TEXT,
      total_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_from_month TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS payroll_debt_installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      target_month TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      note TEXT,
      sort_order INTEGER DEFAULT 0,
      is_paid INTEGER DEFAULT 0,
      paid_record_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_id) REFERENCES payroll_debt_plans(id) ON DELETE CASCADE,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (paid_record_id) REFERENCES payroll_records(id)
    );
  `);

  ensureColumn(database, 'employees', 'hire_date_from', 'TEXT');
  ensureColumn(database, 'employees', 'hire_date_to', 'TEXT');
  ensureColumn(database, 'employees', 'hired_by', 'TEXT');
  ensureColumn(database, 'employees', 'fiscal_code', 'TEXT');
  ensureColumn(database, 'employees', 'role', 'TEXT');
  ensureColumn(database, 'employees', 'contract_type', 'TEXT');
  ensureColumn(database, 'employees', 'daily_pay', 'REAL');
  ensureColumn(database, 'employees', 'standard_hours', 'REAL DEFAULT 7');
  ensureColumn(database, 'employees', 'overtime_use_general_rate', 'INTEGER DEFAULT 1');
  ensureColumn(database, 'employees', 'overtime_hourly_rate', 'REAL');
  ensureColumn(database, 'employees', 'phone', 'TEXT');
  ensureColumn(database, 'employees', 'email', 'TEXT');
  ensureColumn(database, 'employees', 'hire_date', 'TEXT');
  ensureColumn(database, 'employees', 'status', "TEXT DEFAULT 'attivo'");
  ensureColumn(database, 'employees', 'medical_visit_required', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'employees', 'medical_visit_done', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'employees', 'medical_visit_done_with_us', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'employees', 'medical_visit_date', 'TEXT');
  ensureColumn(database, 'employees', 'medical_visit_expiry', 'TEXT');
  ensureColumn(database, 'employees', 'medical_visit_notes', 'TEXT');
  ensureColumn(database, 'employees', 'art37_required', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'employees', 'art37_done', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'employees', 'art37_done_with_us', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'employees', 'art37_date', 'TEXT');
  ensureColumn(database, 'employees', 'art37_expiry', 'TEXT');
  ensureColumn(database, 'employees', 'art37_notes', 'TEXT');
  ensureColumn(database, 'employees', 'notes', 'TEXT');
  ensureColumn(database, 'employees', 'is_deleted', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'employees', 'deleted_at', 'TEXT');
  ensureColumn(database, 'attendance', 'marker_code', 'TEXT');
  ensureColumn(database, 'attendance', 'entry_code', 'TEXT');
  ensureColumn(database, 'teams', 'is_archived', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'teams', 'archived_at', 'TEXT');
  ensureColumn(database, 'teams', 'team_daily_rate', 'REAL DEFAULT 0');
  ensureColumn(database, 'employee_employment_periods', 'source_document_id', 'TEXT');
  ensureColumn(database, 'employee_documents', 'sha256', 'TEXT');
  ensureColumn(database, 'employee_documents', 'file_created_at', 'TEXT');
  ensureColumn(database, 'payroll_documents', 'sha256', 'TEXT');
  ensureColumn(database, 'payroll_documents', 'file_created_at', 'TEXT');
  ensureColumn(database, 'communications', 'pdf_sha256', 'TEXT');
  ensureColumn(database, 'communications', 'pdf_created_at', 'TEXT');
  ensureColumn(database, 'communications', 'excel_sha256', 'TEXT');
  ensureColumn(database, 'communications', 'excel_created_at', 'TEXT');
  ensureColumn(database, 'communications', 'selected_employee_ids_json', "TEXT DEFAULT '[]'");
  ensureColumn(database, 'communications', 'employee_dates_json', "TEXT DEFAULT '{}'");
  ensureColumn(database, 'communications', 'show_compensation_in_pdf', 'INTEGER DEFAULT 1');

  ensureColumn(database, 'payroll_records', 'datore', 'TEXT');
  ensureColumn(database, 'payroll_records', 'acconti_details', 'TEXT');
  ensureColumn(database, 'payroll_records', 'n_macchine_mese', 'REAL DEFAULT 0');
  ensureColumn(database, 'payroll_records', 'prezzo_per_macchina', 'REAL DEFAULT 0');
  ensureColumn(database, 'payroll_records', 'totale_trasporto', 'REAL DEFAULT 0');
  ensureColumn(database, 'payroll_records', 'regalo_importo', 'REAL DEFAULT 0');
  ensureColumn(database, 'payroll_records', 'regalo_descrizione', 'TEXT');
  ensureColumn(database, 'payroll_records', 'resto_pagato', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'payroll_records', 'resto_pagato_data', 'TEXT');
  ensureColumn(database, 'payroll_records', 'processed_at', 'TEXT');
  ensureColumn(database, 'payroll_records', 'archived_at', 'TEXT');
  ensureColumn(database, 'payroll_records', 'report_html_snapshot', 'TEXT');
  ensureColumn(database, 'payroll_records', 'report_snapshot_json', 'TEXT');
  ensureColumn(database, 'communications', 'employer_labels_json', 'TEXT');
  ensureColumn(database, 'communication_details', 'detail_note', 'TEXT');

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance(employee_id, date);
    CREATE INDEX IF NOT EXISTS idx_attendance_employee_month ON attendance(employee_id, substr(date, 1, 7));
    CREATE INDEX IF NOT EXISTS idx_attendance_year_month ON attendance(substr(date, 1, 4), substr(date, 1, 7));
    CREATE INDEX IF NOT EXISTS idx_occupations_name ON occupations(name);
    CREATE INDEX IF NOT EXISTS idx_employees_fiscal_code ON employees(fiscal_code);
    CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status, is_deleted);
    CREATE INDEX IF NOT EXISTS idx_payroll_employee_month ON payroll_records(employee_id, month);
    CREATE INDEX IF NOT EXISTS idx_payroll_employee_year ON payroll_records(employee_id, substr(month, 1, 4));
    CREATE INDEX IF NOT EXISTS idx_payroll_archived ON payroll_records(archived_at, processed_at, month);
    CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id, category);
    CREATE INDEX IF NOT EXISTS idx_payroll_documents_record ON payroll_documents(payroll_record_id, category);
    CREATE INDEX IF NOT EXISTS idx_payroll_advances_record ON payroll_advances(payroll_record_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_employee_financial_movements_lookup ON employee_financial_movements(employee_id, type, status, movement_date, id);
    CREATE INDEX IF NOT EXISTS idx_employee_financial_movements_team ON employee_financial_movements(team_id, movement_date, id);
    CREATE INDEX IF NOT EXISTS idx_employee_financial_movements_report ON employee_financial_movements(inserted_report_id, inserted_month);
    CREATE INDEX IF NOT EXISTS idx_payroll_debt_plans_employee ON payroll_debt_plans(employee_id, status, id);
    CREATE INDEX IF NOT EXISTS idx_payroll_debt_installments_employee_month ON payroll_debt_installments(employee_id, target_month, is_paid, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_team_members_team ON team_members(team_id, sort_order, id);
    CREATE INDEX IF NOT EXISTS idx_team_members_employee ON team_members(employee_id);
    CREATE INDEX IF NOT EXISTS idx_team_advances_lookup ON team_advances(team_id, month, advance_date, id);
    CREATE INDEX IF NOT EXISTS idx_team_attendance_lookup ON team_attendance(team_id, date, id);
    CREATE INDEX IF NOT EXISTS idx_teams_archived ON teams(is_archived, name);
    CREATE INDEX IF NOT EXISTS idx_employee_periods_employee ON employee_employment_periods(employee_id, is_current, id);
    CREATE INDEX IF NOT EXISTS idx_employee_periods_range ON employee_employment_periods(employee_id, hire_date_from, hire_date_to);
    CREATE INDEX IF NOT EXISTS idx_communications_period ON communications(period_start, period_end, created_at);
    CREATE INDEX IF NOT EXISTS idx_communication_details_comm ON communication_details(communication_id, sort_order, id);
  `);

  backfillLegacyAdvances(database);
  backfillEmploymentPeriods(database);
  seedOccupations(database);
}

function runPayrollHistoryExtensionMigration(database) {
  ensureColumn(database, 'payroll_records', 'regalo_importo', 'REAL DEFAULT 0');
  ensureColumn(database, 'payroll_records', 'regalo_descrizione', 'TEXT');
  ensureColumn(database, 'payroll_records', 'resto_pagato', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'payroll_records', 'resto_pagato_data', 'TEXT');
  ensureColumn(database, 'payroll_records', 'processed_at', 'TEXT');
  ensureColumn(database, 'payroll_records', 'archived_at', 'TEXT');
  ensureColumn(database, 'payroll_records', 'report_html_snapshot', 'TEXT');
  ensureColumn(database, 'payroll_records', 'report_snapshot_json', 'TEXT');

  database.exec(`
    CREATE TABLE IF NOT EXISTS payroll_debt_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      label TEXT,
      total_amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_from_month TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id)
    );

    CREATE TABLE IF NOT EXISTS payroll_debt_installments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      target_month TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      note TEXT,
      sort_order INTEGER DEFAULT 0,
      is_paid INTEGER DEFAULT 0,
      paid_record_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_id) REFERENCES payroll_debt_plans(id) ON DELETE CASCADE,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (paid_record_id) REFERENCES payroll_records(id)
    );

    CREATE INDEX IF NOT EXISTS idx_payroll_archived ON payroll_records(archived_at, processed_at, month);
    CREATE INDEX IF NOT EXISTS idx_payroll_debt_plans_employee ON payroll_debt_plans(employee_id, status, id);
    CREATE INDEX IF NOT EXISTS idx_payroll_debt_installments_employee_month ON payroll_debt_installments(employee_id, target_month, is_paid, sort_order, id);
  `);
}

function runPayrollRestoStatusMigration(database) {
  ensureColumn(database, 'payroll_records', 'resto_pagato', 'INTEGER DEFAULT 0');
  ensureColumn(database, 'payroll_records', 'resto_pagato_data', 'TEXT');
}

function runPayrollRestoPaidDateMigration(database) {
  ensureColumn(database, 'payroll_records', 'resto_pagato_data', 'TEXT');
}

function runAttendanceEntryCodeMigration(database) {
  ensureColumn(database, 'attendance', 'entry_code', 'TEXT');
}

function runEmployeeOvertimeRateMigration(database) {
  ensureColumn(database, 'employees', 'overtime_use_general_rate', 'INTEGER DEFAULT 1');
  ensureColumn(database, 'employees', 'overtime_hourly_rate', 'REAL');
}

function runDocumentArtifactMetadataMigration(database) {
  ensureColumnsWithLogging(database, 'employee_documents', [
    { name: 'sha256', definition: 'TEXT' },
    { name: 'file_created_at', definition: 'TEXT' },
  ]);
  ensureColumnsWithLogging(database, 'payroll_documents', [
    { name: 'sha256', definition: 'TEXT' },
    { name: 'file_created_at', definition: 'TEXT' },
  ]);
  ensureColumnsWithLogging(database, 'communications', [
    { name: 'pdf_sha256', definition: 'TEXT' },
    { name: 'pdf_created_at', definition: 'TEXT' },
    { name: 'excel_sha256', definition: 'TEXT' },
    { name: 'excel_created_at', definition: 'TEXT' },
    { name: 'selected_employee_ids_json', definition: "TEXT DEFAULT '[]'" },
    { name: 'employee_dates_json', definition: "TEXT DEFAULT '{}'" },
  ]);
}

function runEmploymentPeriodSourceDocumentMigration(database) {
  logDbEvent('migration-started', {
    migration_id: '2026-05-02-employee-period-source-document',
    table_name: 'employee_employment_periods',
    column_name: 'source_document_id',
  });

  const columns = database.prepare("PRAGMA table_info('employee_employment_periods')").all();
  const hasSourceDocumentId = columns.some((column) => column.name === 'source_document_id');

  if (hasSourceDocumentId) {
    logDbEvent('schema-migration-skipped', {
      table_name: 'employee_employment_periods',
      column_name: 'source_document_id',
      reason: 'column-already-present',
    });
    return;
  }

  database.exec('ALTER TABLE employee_employment_periods ADD COLUMN source_document_id TEXT;');
  logDbEvent('schema-table-updated', {
    table_name: 'employee_employment_periods',
    columns_added: ['source_document_id'],
  });
}

function runUsersAndAuditMigration(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operatore',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by_user_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username_snapshot TEXT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      details_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active);
    CREATE INDEX IF NOT EXISTS idx_users_created_by_user_id ON users(created_by_user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action, created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id, created_at);
  `);
}

function runUsersCreatedByMigration(database) {
  logDbEvent('schema-migration-started', {
    migration_id: '2026-05-02-users-created-by-user-id',
    table_name: 'users',
    column_name: 'created_by_user_id',
  });

  const userColumns = database.prepare("PRAGMA table_info('users')").all();
  const hasCreatedByUserId = userColumns.some((column) => column.name === 'created_by_user_id');
  if (hasCreatedByUserId) {
    logDbEvent('schema-migration-skipped', {
      table_name: 'users',
      column_name: 'created_by_user_id',
      reason: 'column-already-present',
    });
    return;
  }

  database.exec('ALTER TABLE users ADD COLUMN created_by_user_id INTEGER;');
  database.exec('CREATE INDEX IF NOT EXISTS idx_users_created_by_user_id ON users(created_by_user_id);');
  logDbEvent('schema-table-updated', {
    table_name: 'users',
    columns_added: ['created_by_user_id'],
  });
}

function runEmployeeFinancialMovementsMigration(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS employee_financial_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('advance', 'installment')),
      employee_id INTEGER NOT NULL,
      team_id INTEGER,
      employer_key TEXT,
      movement_date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'inserted')),
      inserted_report_id INTEGER,
      inserted_month TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (employee_id) REFERENCES employees(id),
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (inserted_report_id) REFERENCES payroll_records(id)
    );

    CREATE INDEX IF NOT EXISTS idx_employee_financial_movements_lookup
      ON employee_financial_movements(employee_id, type, status, movement_date, id);
    CREATE INDEX IF NOT EXISTS idx_employee_financial_movements_team
      ON employee_financial_movements(team_id, movement_date, id);
    CREATE INDEX IF NOT EXISTS idx_employee_financial_movements_report
      ON employee_financial_movements(inserted_report_id, inserted_month);
  `);

  logDbEvent('schema-table-updated', {
    table_name: 'employee_financial_movements',
    columns_added: ['initial_schema'],
  });
}

function runTeamAttendanceModeMigration(database) {
  ensureColumn(database, 'teams', 'attendance_mode', "TEXT NOT NULL DEFAULT 'details'");
  ensureColumn(database, 'teams', 'team_daily_rate', 'REAL DEFAULT 0');

  database.exec(`
    CREATE TABLE IF NOT EXISTS team_attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      team_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      headcount REAL DEFAULT 0,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
      UNIQUE(team_id, date)
    );

    CREATE INDEX IF NOT EXISTS idx_team_attendance_lookup ON team_attendance(team_id, date, id);
  `);
}

function runTeamAttendanceHoursPerPersonMigration(database) {
  ensureColumn(database, 'team_attendance', 'hours_per_person', 'REAL DEFAULT NULL');
}

const MIGRATIONS = [
  {
    id: '2026-04-20-core-schema',
    run: runCoreSchemaMigration,
  },
  {
    id: '2026-04-20-payroll-history-extension',
    run: runPayrollHistoryExtensionMigration,
  },
  {
    id: '2026-04-20-payroll-resto-status',
    run: runPayrollRestoStatusMigration,
  },
  {
    id: '2026-04-20-payroll-resto-paid-date',
    run: runPayrollRestoPaidDateMigration,
  },
  {
    id: '2026-04-22-attendance-entry-code',
    run: runAttendanceEntryCodeMigration,
  },
  {
    id: '2026-04-23-employee-overtime-rate',
    run: runEmployeeOvertimeRateMigration,
  },
  {
    id: '2026-05-01-document-artifact-metadata',
    run: runDocumentArtifactMetadataMigration,
  },
  {
    id: '2026-05-02-employee-period-source-document',
    run: runEmploymentPeriodSourceDocumentMigration,
  },
  {
    id: '2026-05-02-users-and-audit',
    run: runUsersAndAuditMigration,
  },
  {
    id: '2026-05-02-users-created-by-user-id',
    run: runUsersCreatedByMigration,
  },
  {
    id: '2026-05-06-employee-financial-movements',
    run: runEmployeeFinancialMovementsMigration,
  },
  {
    id: '2026-05-14-team-attendance-mode',
    run: runTeamAttendanceModeMigration,
  },
  {
    id: '2026-05-14-team-attendance-hours-per-person',
    run: runTeamAttendanceHoursPerPersonMigration,
  },
];

function escapeSqlitePath(filePath) {
  return String(filePath).replace(/'/g, "''");
}

function createPreMigrationBackup(databasePath) {
  if (!fs.existsSync(databasePath)) {
    return null;
  }

  const backupRoot = path.join(getBackupsDir(), 'migration-safety');
  ensureDir(backupRoot);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const targetPath = path.join(backupRoot, `pre-migration-${stamp}.sqlite`);
  const sourceDb = new Database(databasePath, { readonly: true });
  try {
    sourceDb.exec(`VACUUM INTO '${escapeSqlitePath(targetPath)}'`);
  } finally {
    sourceDb.close();
  }

  logDbEvent('migration-backup-created', {
    source_db: databasePath,
    backup_path: targetPath,
  });
  return targetPath;
}

function executeIntegrityCheck(database, context = 'manual') {
  const checkedAt = new Date().toISOString();
  const rows = database.prepare('PRAGMA integrity_check').all();
  const messages = rows.map((row) => row.integrity_check || Object.values(row)[0]).filter(Boolean);
  const success = messages.length === 1 && messages[0] === 'ok';

  setMetadata(database, 'last_integrity_check_at', checkedAt);
  setMetadata(database, 'last_integrity_check_result', success ? 'ok' : messages.join(' | '));

  if (!success) {
    logDbEvent('integrity-failed', {
      context,
      checked_at: checkedAt,
      messages,
    });
  } else {
    logDbEvent('integrity-ok', {
      context,
      checked_at: checkedAt,
    });
  }

  return {
    ok: success,
    checked_at: checkedAt,
    messages,
  };
}

function runMigrations(database) {
  ensureMigrationInfrastructure(database);
  const pendingMigrations = MIGRATIONS.filter((migration) => !hasMigration(database, migration.id));

  if (pendingMigrations.length) {
    createPreMigrationBackup(getDbPath());
  }

  const tx = database.transaction((migration) => {
    migration.run(database);
    recordMigration(database, migration.id);
    logDbEvent('migration-applied', {
      migration_id: migration.id,
      app_version: app.getVersion(),
    });
  });

  for (const migration of pendingMigrations) {
    if (!hasMigration(database, migration.id)) {
      tx(migration);
    }
  }

  if (pendingMigrations.length) {
    const integrity = executeIntegrityCheck(database, 'post-migration');
    if (!integrity.ok) {
      throw new Error(`Integrity check fallito dopo la migrazione: ${integrity.messages.join(' | ')}`);
    }
  }

  setMetadata(database, 'db_schema_version', DB_SCHEMA_VERSION);
  setMetadata(database, 'last_app_version', app.getVersion());
  setMetadata(database, 'last_started_at', new Date().toISOString());
  setMetadata(database, 'data_root', getUserDataRoot());
  setMetadata(database, 'database_path', getDbPath());
}

function seedOccupations(database) {
  const defaultOccupations = ['operaio semplice', 'potatore', 'trattorista'];
  const insert = database.prepare(`
    INSERT INTO occupations (name)
    VALUES (?)
    ON CONFLICT(name) DO UPDATE SET
      updated_at = CURRENT_TIMESTAMP
  `);

  const tx = database.transaction((items) => {
    for (const item of items) {
      insert.run(item);
    }

    const employeeRoles = database.prepare(`
      SELECT DISTINCT TRIM(COALESCE(role, '')) AS role_name
      FROM employees
      WHERE TRIM(COALESCE(role, '')) <> ''
    `).all();

    for (const row of employeeRoles) {
      insert.run(row.role_name);
    }
  });

  tx(defaultOccupations);
}

function backfillEmploymentPeriods(database) {
  const existingCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM employee_employment_periods
  `).get()?.count || 0;

  if (existingCount > 0) {
    return;
  }

  const employees = database.prepare(`
    SELECT id, hire_date_from, hire_date_to, hired_by, status, created_at, updated_at
    FROM employees
  `).all();

  const insert = database.prepare(`
    INSERT INTO employee_employment_periods (
      employee_id, hire_date_from, hire_date_to, hired_by, status, is_current, created_at, updated_at
    ) VALUES (
      @employee_id, @hire_date_from, @hire_date_to, @hired_by, @status, @is_current, @created_at, @updated_at
    )
  `);

  const tx = database.transaction((rows) => {
    for (const employee of rows) {
      if (!employee.hire_date_from && !employee.hire_date_to && !employee.hired_by) {
        continue;
      }

      insert.run({
        employee_id: employee.id,
        hire_date_from: employee.hire_date_from || null,
        hire_date_to: employee.hire_date_to || null,
        hired_by: employee.hired_by || null,
        status: employee.status || 'attivo',
        is_current: employee.status === 'attivo' ? 1 : 0,
        created_at: employee.created_at || null,
        updated_at: employee.updated_at || null,
      });
    }
  });

  tx(employees);
}

function backfillLegacyAdvances(database) {
  const legacyRows = database.prepare(`
    SELECT id, acconti, acconti_details
    FROM payroll_records
    WHERE COALESCE(acconti, 0) > 0 OR COALESCE(acconti_details, '') <> ''
  `).all();

  const countStmt = database.prepare(`
    SELECT COUNT(*) AS count
    FROM payroll_advances
    WHERE payroll_record_id = ?
  `);
  const insertStmt = database.prepare(`
    INSERT INTO payroll_advances (
      payroll_record_id, amount, advance_date, include_in_report, sort_order
    ) VALUES (
      @payroll_record_id, @amount, @advance_date, @include_in_report, @sort_order
    )
  `);

  const tx = database.transaction((rows) => {
    for (const row of rows) {
      const existingCount = countStmt.get(row.id)?.count || 0;
      if (existingCount > 0) continue;

      let legacyAdvances = [];
      if (row.acconti_details) {
        try {
          legacyAdvances = JSON.parse(row.acconti_details);
        } catch {
          legacyAdvances = [];
        }
      }

      if (!Array.isArray(legacyAdvances) || legacyAdvances.length === 0) {
        if (Number(row.acconti || 0) > 0) {
          legacyAdvances = [
            {
              amount: Number(row.acconti || 0),
              date: '',
              includeInReport: true,
            },
          ];
        } else {
          legacyAdvances = [];
        }
      }

      legacyAdvances.forEach((advance, index) => {
        const amount = Number(advance.amount || 0);
        if (amount <= 0) return;

        insertStmt.run({
          payroll_record_id: row.id,
          amount,
          advance_date: advance.date || '',
          include_in_report:
            advance.includeInReport !== undefined
              ? advance.includeInReport
                ? 1
                : 0
              : advance.showDate !== undefined
              ? advance.showDate
                ? 1
                : 0
              : 1,
          sort_order: index,
        });
      });
    }
  });

  tx(legacyRows);
}

function getDbPath() {
  const dataDir = getDataDir();
  return path.join(dataDir, 'presenze.sqlite');
}

function migrateLegacyDatabaseIfNeeded() {
  ensureAppStorageStructure();

  const newDbPath = getDbPath();
  const legacyDbPath = path.join(getUserDataRoot(), 'presenze.db');
  const legacyElectronDbPath = path.join(getLegacyElectronUserDataRoot(), 'presenze.db');

  if (!fs.existsSync(newDbPath) && fs.existsSync(legacyDbPath)) {
    fs.copyFileSync(legacyDbPath, newDbPath);
  } else if (!fs.existsSync(newDbPath) && fs.existsSync(legacyElectronDbPath)) {
    fs.copyFileSync(legacyElectronDbPath, newDbPath);
  }
}

function getDb() {
  if (db) return db;

  migrateLegacyDatabaseIfNeeded();
  db = new Database(getDbPath());
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  runMigrations(db);
  return db;
}

function closeDb() {
  if (!db) return;
  db.close();
  db = null;
}

function getDatabaseRuntimeInfo() {
  const database = getDb();
  const migrationCount = database.prepare(`
    SELECT COUNT(*) AS count
    FROM schema_migrations
  `).get()?.count || 0;
  const lastMigration = database.prepare(`
    SELECT id, applied_at, app_version
    FROM schema_migrations
    ORDER BY applied_at DESC, id DESC
    LIMIT 1
  `).get();

  return {
    schema_version: getMetadata(database, 'db_schema_version') || DB_SCHEMA_VERSION,
    migration_count: migrationCount,
    last_migration_id: lastMigration?.id || '',
    last_migration_at: lastMigration?.applied_at || '',
    last_migration_app_version: lastMigration?.app_version || '',
    database_path: getDbPath(),
    journal_mode: 'WAL',
  };
}

function runIntegrityCheck() {
  const database = getDb();

  try {
    return executeIntegrityCheck(database, 'manual');
  } catch (error) {
    logDbEvent('error', {
      context: 'integrity_check',
      message: error?.message || String(error),
    });
    throw error;
  }
}

function bootstrapIntegrityChecks(onFailure = () => {}) {
  try {
    const result = runIntegrityCheck();
    if (!result.ok) {
      onFailure(result);
    }
  } catch (error) {
    onFailure({
      ok: false,
      checked_at: new Date().toISOString(),
      messages: [error?.message || String(error)],
    });
  }

  if (integrityCheckTimer) {
    clearInterval(integrityCheckTimer);
  }

  integrityCheckTimer = setInterval(() => {
    try {
      const result = runIntegrityCheck();
      if (!result.ok) {
        onFailure(result);
      }
    } catch (error) {
      onFailure({
        ok: false,
        checked_at: new Date().toISOString(),
        messages: [error?.message || String(error)],
      });
    }
  }, 12 * 60 * 60 * 1000);

  if (typeof integrityCheckTimer.unref === 'function') {
    integrityCheckTimer.unref();
  }
}

module.exports = {
  DB_SCHEMA_VERSION,
  bootstrapIntegrityChecks,
  closeDb,
  getDb,
  getDatabaseRuntimeInfo,
  getDbPath,
  runIntegrityCheck,
  setLogger,
};
