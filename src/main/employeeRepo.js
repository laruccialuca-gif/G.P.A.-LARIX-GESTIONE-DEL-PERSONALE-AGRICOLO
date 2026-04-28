const { getDb } = require('./db');
const occupationRepo = require('./occupationRepo');
const {
  describeStoredFile,
  openStoredDocument,
  removeStoredFile,
  selectLocalFile,
  storeSelectedFile,
} = require('./documentService');

const DOCUMENT_CATEGORIES = {
  hire: 'hire_attachment',
  art37: 'art37_attachment',
  medicalVisit: 'medical_visit_attachment',
};
const HIRE_PERIOD_CATEGORY_PREFIX = `${DOCUMENT_CATEGORIES.hire}__period__`;

const EMPLOYEE_DOCUMENT_META = {
  [DOCUMENT_CATEGORIES.hire]: {
    key: 'hire_document',
    dialogTitle: 'Seleziona allegato assunzione',
    subdir: 'hire-documents',
    nameSuffix: 'assunzione',
  },
  [DOCUMENT_CATEGORIES.art37]: {
    key: 'art37_document',
    dialogTitle: 'Seleziona allegato formazione art. 37',
    subdir: 'art37-documents',
    nameSuffix: 'formazione-art37',
  },
  [DOCUMENT_CATEGORIES.medicalVisit]: {
    key: 'medical_visit_document',
    dialogTitle: 'Seleziona allegato visita medica',
    subdir: 'medical-visit-documents',
    nameSuffix: 'visita-medica',
  },
};

function normalizeBool(value) {
  return value ? 1 : 0;
}

function normalizeString(value) {
  return String(value || '').trim();
}

function normalizeFiscalCode(value) {
  return normalizeString(value).toUpperCase() || null;
}

function mapEmployeeInput(employee) {
  const normalizedRole = normalizeString(employee.role);

  if (normalizedRole) {
    occupationRepo.ensureOccupation(normalizedRole);
  }

  return {
    first_name: normalizeString(employee.first_name),
    last_name: normalizeString(employee.last_name),
    fiscal_code: normalizeFiscalCode(employee.fiscal_code),
    role: normalizedRole || null,
    contract_type: employee.contract_type || 'tempo_indeterminato',
    daily_pay: employee.daily_pay ?? null,
    standard_hours: employee.standard_hours ?? 7,
    overtime_use_general_rate: employee.overtime_use_general_rate !== false ? 1 : 0,
    overtime_hourly_rate:
      employee.overtime_use_general_rate === false
        ? (employee.overtime_hourly_rate ?? null)
        : null,
    phone: employee.phone || null,
    email: employee.email || null,
    hire_date: employee.hire_date || null,
    hire_date_from: employee.hire_date_from || null,
    hire_date_to: employee.hire_date_to || null,
    hired_by: employee.hired_by || null,
    status: employee.status || 'attivo',
    medical_visit_required: normalizeBool(employee.medical_visit_required),
    medical_visit_done: normalizeBool(employee.medical_visit_done),
    medical_visit_done_with_us: normalizeBool(employee.medical_visit_done_with_us),
    medical_visit_date: employee.medical_visit_date || null,
    medical_visit_expiry: employee.medical_visit_expiry || null,
    medical_visit_notes: employee.medical_visit_notes || null,
    art37_required: normalizeBool(employee.art37_required),
    art37_done: normalizeBool(employee.art37_done),
    art37_done_with_us: normalizeBool(employee.art37_done_with_us),
    art37_date: employee.art37_date || null,
    art37_expiry: employee.art37_expiry || null,
    art37_notes: employee.art37_notes || null,
    notes: employee.notes || null,
  };
}

function loadEmploymentPeriods(employeeIds) {
  const db = getDb();
  if (!employeeIds.length) return new Map();

  const placeholders = employeeIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT id, employee_id, hire_date_from, hire_date_to, hired_by, status, is_current, created_at, updated_at
    FROM employee_employment_periods
    WHERE employee_id IN (${placeholders})
    ORDER BY employee_id ASC, is_current DESC, COALESCE(hire_date_from, created_at) DESC, id DESC
  `).all(...employeeIds);

  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.employee_id) || [];
    list.push({
      id: row.id,
      hire_date_from: row.hire_date_from || null,
      hire_date_to: row.hire_date_to || null,
      hired_by: row.hired_by || null,
      status: row.status || 'attivo',
      is_current: !!row.is_current,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    map.set(row.employee_id, list);
  }

  return map;
}

function buildEmploymentPeriodDocumentCategory(periodId) {
  return `${HIRE_PERIOD_CATEGORY_PREFIX}${Number(periodId)}`;
}

function parseEmploymentPeriodIdFromCategory(category) {
  if (!String(category || '').startsWith(HIRE_PERIOD_CATEGORY_PREFIX)) {
    return null;
  }

  const periodId = Number(String(category).slice(HIRE_PERIOD_CATEGORY_PREFIX.length));
  return Number.isFinite(periodId) ? periodId : null;
}

function loadEmploymentPeriodDocuments(employeeIds) {
  const db = getDb();
  if (!employeeIds.length) return new Map();

  const placeholders = employeeIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT *
    FROM employee_documents
    WHERE employee_id IN (${placeholders})
      AND category LIKE ?
    ORDER BY uploaded_at DESC, id DESC
  `).all(...employeeIds, `${HIRE_PERIOD_CATEGORY_PREFIX}%`);

  const map = new Map();
  for (const row of rows) {
    const periodId = parseEmploymentPeriodIdFromCategory(row.category);
    if (!periodId) continue;
    map.set(periodId, describeStoredFile(row));
  }

  return map;
}

function loadTeamHistory(employeeIds) {
  const db = getDb();
  if (!employeeIds.length) return new Map();

  const placeholders = employeeIds.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT tm.employee_id, t.id AS team_id, t.name, t.is_archived
    FROM team_members tm
    JOIN teams t ON t.id = tm.team_id
    WHERE tm.employee_id IN (${placeholders})
    ORDER BY t.name COLLATE NOCASE ASC
  `).all(...employeeIds);

  const map = new Map();
  for (const row of rows) {
    const list = map.get(row.employee_id) || [];
    list.push({
      team_id: row.team_id,
      name: row.name,
      is_archived: !!row.is_archived,
    });
    map.set(row.employee_id, list);
  }

  return map;
}

function attachEmployeeRelations(rows) {
  const periodsMap = loadEmploymentPeriods(rows.map((row) => row.id));
  const periodDocsMap = loadEmploymentPeriodDocuments(rows.map((row) => row.id));
  const teamsMap = loadTeamHistory(rows.map((row) => row.id));

  return rows.map((row) => {
    const employmentPeriods = (periodsMap.get(row.id) || []).map((period) => ({
      ...period,
      hire_document: periodDocsMap.get(period.id) || null,
    }));
    const legacyHireDocument = buildDocumentFromRow(row, 'hire_document');
    const currentPeriodHireDocument =
      employmentPeriods.find((period) => period.is_current && period.hire_document)?.hire_document ||
      employmentPeriods.find((period) => period.hire_document)?.hire_document ||
      null;

    return {
      ...row,
      is_deleted: !!row.is_deleted,
      overtime_use_general_rate: row.overtime_use_general_rate !== 0,
      overtime_hourly_rate:
        row.overtime_hourly_rate !== null && row.overtime_hourly_rate !== undefined
          ? Number(row.overtime_hourly_rate)
          : null,
      employment_periods: employmentPeriods,
      team_history: teamsMap.get(row.id) || [],
      hire_document: legacyHireDocument || currentPeriodHireDocument,
      legacy_hire_document: legacyHireDocument,
      art37_document: buildDocumentFromRow(row, 'art37_document'),
      medical_visit_document: buildDocumentFromRow(row, 'medical_visit_document'),
    };
  });
}

function buildDocumentFromRow(row, prefix) {
  return row[`${prefix}_id`]
    ? describeStoredFile({
        id: row[`${prefix}_id`],
        file_name: row[`${prefix}_file_name`],
        stored_name: row[`${prefix}_stored_name`],
        relative_path: row[`${prefix}_relative_path`],
        mime_type: row[`${prefix}_mime_type`],
        size_bytes: row[`${prefix}_size_bytes`],
        uploaded_at: row[`${prefix}_uploaded_at`],
        updated_at: row[`${prefix}_updated_at`],
      })
    : null;
}

function getEmployeeBaseSql(whereClause) {
  return `
    SELECT
      e.*,
      hire_doc.id AS hire_document_id,
      hire_doc.file_name AS hire_document_file_name,
      hire_doc.stored_name AS hire_document_stored_name,
      hire_doc.relative_path AS hire_document_relative_path,
      hire_doc.mime_type AS hire_document_mime_type,
      hire_doc.size_bytes AS hire_document_size_bytes,
      hire_doc.uploaded_at AS hire_document_uploaded_at,
      hire_doc.updated_at AS hire_document_updated_at,
      art37_doc.id AS art37_document_id,
      art37_doc.file_name AS art37_document_file_name,
      art37_doc.stored_name AS art37_document_stored_name,
      art37_doc.relative_path AS art37_document_relative_path,
      art37_doc.mime_type AS art37_document_mime_type,
      art37_doc.size_bytes AS art37_document_size_bytes,
      art37_doc.uploaded_at AS art37_document_uploaded_at,
      art37_doc.updated_at AS art37_document_updated_at,
      medical_doc.id AS medical_visit_document_id,
      medical_doc.file_name AS medical_visit_document_file_name,
      medical_doc.stored_name AS medical_visit_document_stored_name,
      medical_doc.relative_path AS medical_visit_document_relative_path,
      medical_doc.mime_type AS medical_visit_document_mime_type,
      medical_doc.size_bytes AS medical_visit_document_size_bytes,
      medical_doc.uploaded_at AS medical_visit_document_uploaded_at,
      medical_doc.updated_at AS medical_visit_document_updated_at
    FROM employees e
    LEFT JOIN employee_documents hire_doc
      ON hire_doc.employee_id = e.id
      AND hire_doc.category = '${DOCUMENT_CATEGORIES.hire}'
    LEFT JOIN employee_documents art37_doc
      ON art37_doc.employee_id = e.id
      AND art37_doc.category = '${DOCUMENT_CATEGORIES.art37}'
    LEFT JOIN employee_documents medical_doc
      ON medical_doc.employee_id = e.id
      AND medical_doc.category = '${DOCUMENT_CATEGORIES.medicalVisit}'
    ${whereClause}
  `;
}

function listEmployees(options = {}) {
  const db = getDb();
  const includeDeleted = !!options.includeDeleted;
  const whereClause = includeDeleted ? '' : 'WHERE e.is_deleted = 0';

  const rows = db.prepare(`
    ${getEmployeeBaseSql(whereClause)}
    ORDER BY e.is_deleted ASC, e.last_name COLLATE NOCASE, e.first_name COLLATE NOCASE
  `).all();

  return attachEmployeeRelations(rows);
}

function getEmployeeById(id, options = {}) {
  const db = getDb();
  const includeDeleted = !!options.includeDeleted;
  const row = db.prepare(`
    ${getEmployeeBaseSql(`
      WHERE e.id = ?
        ${includeDeleted ? '' : 'AND e.is_deleted = 0'}
      LIMIT 1
    `)}
  `).get(id);

  return attachEmployeeRelations(row ? [row] : [])[0] || null;
}

function setCurrentPeriodsInactive(employeeId) {
  const db = getDb();
  db.prepare(`
    UPDATE employee_employment_periods
    SET is_current = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE employee_id = ?
      AND is_current = 1
  `).run(employeeId);
}

function upsertCurrentEmploymentPeriod(employeeId, employeeData, { forceNewPeriod = false } = {}) {
  const db = getDb();
  const hireFrom = employeeData.hire_date_from || null;
  const hireTo = employeeData.hire_date_to || null;
  const hiredBy = employeeData.hired_by || null;
  const status = employeeData.status || 'attivo';

  if (!hireFrom && !hireTo && !hiredBy) {
    return;
  }

  const currentPeriod = db.prepare(`
    SELECT id
    FROM employee_employment_periods
    WHERE employee_id = ?
      AND is_current = 1
    ORDER BY id DESC
    LIMIT 1
  `).get(employeeId);

  if (currentPeriod && !forceNewPeriod) {
    db.prepare(`
      UPDATE employee_employment_periods
      SET hire_date_from = ?,
          hire_date_to = ?,
          hired_by = ?,
          status = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(hireFrom, hireTo, hiredBy, status, currentPeriod.id);
    return {
      id: currentPeriod.id,
      employee_id: Number(employeeId),
      hire_date_from: hireFrom,
      hire_date_to: hireTo,
      hired_by: hiredBy,
      status,
      is_current: true,
    };
  }

  if (forceNewPeriod) {
    setCurrentPeriodsInactive(employeeId);
  }

  const result = db.prepare(`
    INSERT INTO employee_employment_periods (
      employee_id, hire_date_from, hire_date_to, hired_by, status, is_current
    ) VALUES (
      ?, ?, ?, ?, ?, 1
    )
  `).run(employeeId, hireFrom, hireTo, hiredBy, status);

  return {
    id: Number(result.lastInsertRowid),
    employee_id: Number(employeeId),
    hire_date_from: hireFrom,
    hire_date_to: hireTo,
    hired_by: hiredBy,
    status,
    is_current: true,
  };
}

function findEmployeeHistoryMatches(criteria = {}) {
  const db = getDb();
  const normalizedFiscalCode = normalizeFiscalCode(criteria.fiscal_code);
  const firstName = normalizeString(criteria.first_name);
  const lastName = normalizeString(criteria.last_name);
  const params = [];
  const clauses = [];

  if (normalizedFiscalCode) {
    clauses.push('UPPER(COALESCE(e.fiscal_code, \'\')) = ?');
    params.push(normalizedFiscalCode);
  }

  if (firstName && lastName) {
    clauses.push('(LOWER(e.first_name) = LOWER(?) AND LOWER(e.last_name) = LOWER(?))');
    params.push(firstName, lastName);
  }

  if (!clauses.length) {
    return [];
  }

  const rows = db.prepare(`
    ${getEmployeeBaseSql(`WHERE ${clauses.join(' OR ')}`)}
    ORDER BY e.is_deleted DESC, e.updated_at DESC, e.id DESC
  `).all(...params);

  return attachEmployeeRelations(rows).map((employee) => ({
    id: employee.id,
    first_name: employee.first_name,
    last_name: employee.last_name,
    fiscal_code: employee.fiscal_code,
    status: employee.status,
    is_deleted: employee.is_deleted,
    hire_date_from: employee.hire_date_from,
    hire_date_to: employee.hire_date_to,
    hired_by: employee.hired_by,
    employment_periods: employee.employment_periods,
    team_history: employee.team_history,
  }));
}

function ensureNoDuplicateActiveEmployee(employeeData, excludedId = null) {
  const db = getDb();
  const matches = findEmployeeHistoryMatches(employeeData);
  const duplicate = matches.find(
    (employee) => !employee.is_deleted && Number(employee.id) !== Number(excludedId || 0)
  );

  if (duplicate) {
    const error = new Error('Esiste gia una scheda attiva per questo dipendente.');
    error.code = 'EMPLOYEE_ALREADY_ACTIVE';
    error.employee = duplicate;
    throw error;
  }
}

function insertEmployeeRow(employeeData) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO employees (
      first_name, last_name, fiscal_code, role, contract_type, daily_pay, standard_hours, overtime_use_general_rate, overtime_hourly_rate,
      phone, email, hire_date, hire_date_from, hire_date_to, hired_by, status,
      medical_visit_required, medical_visit_done, medical_visit_done_with_us,
      medical_visit_date, medical_visit_expiry, medical_visit_notes,
      art37_required, art37_done, art37_done_with_us,
      art37_date, art37_expiry, art37_notes, notes, is_deleted, deleted_at
    ) VALUES (
      @first_name, @last_name, @fiscal_code, @role, @contract_type, @daily_pay, @standard_hours, @overtime_use_general_rate, @overtime_hourly_rate,
      @phone, @email, @hire_date, @hire_date_from, @hire_date_to, @hired_by, @status,
      @medical_visit_required, @medical_visit_done, @medical_visit_done_with_us,
      @medical_visit_date, @medical_visit_expiry, @medical_visit_notes,
      @art37_required, @art37_done, @art37_done_with_us,
      @art37_date, @art37_expiry, @art37_notes, @notes, 0, NULL
    )
  `).run(employeeData);

  return result.lastInsertRowid;
}

function updateEmployeeRow(id, employeeData, { restore = false } = {}) {
  const db = getDb();
  db.prepare(`
    UPDATE employees SET
      first_name=@first_name,
      last_name=@last_name,
      fiscal_code=@fiscal_code,
      role=@role,
      contract_type=@contract_type,
      daily_pay=@daily_pay,
      standard_hours=@standard_hours,
      overtime_use_general_rate=@overtime_use_general_rate,
      overtime_hourly_rate=@overtime_hourly_rate,
      phone=@phone,
      email=@email,
      hire_date=@hire_date,
      hire_date_from=@hire_date_from,
      hire_date_to=@hire_date_to,
      hired_by=@hired_by,
      status=@status,
      medical_visit_required=@medical_visit_required,
      medical_visit_done=@medical_visit_done,
      medical_visit_done_with_us=@medical_visit_done_with_us,
      medical_visit_date=@medical_visit_date,
      medical_visit_expiry=@medical_visit_expiry,
      medical_visit_notes=@medical_visit_notes,
      art37_required=@art37_required,
      art37_done=@art37_done,
      art37_done_with_us=@art37_done_with_us,
      art37_date=@art37_date,
      art37_expiry=@art37_expiry,
      art37_notes=@art37_notes,
      notes=@notes,
      is_deleted=${restore ? '0,' : 'is_deleted,'}
      deleted_at=${restore ? 'NULL,' : 'deleted_at,'}
      updated_at=CURRENT_TIMESTAMP
    WHERE id=@id
  `).run({
    ...employeeData,
    id,
  });
}

function createEmployee(employee) {
  const db = getDb();
  const employeeData = mapEmployeeInput(employee);
  const reactivateEmployeeId = employee.reactivate_employee_id ? Number(employee.reactivate_employee_id) : null;

  const tx = db.transaction(() => {
    if (reactivateEmployeeId) {
      ensureNoDuplicateActiveEmployee(employeeData, reactivateEmployeeId);
      updateEmployeeRow(reactivateEmployeeId, employeeData, { restore: true });
      upsertCurrentEmploymentPeriod(reactivateEmployeeId, employeeData, { forceNewPeriod: true });
      return reactivateEmployeeId;
    }

    ensureNoDuplicateActiveEmployee(employeeData);
    const employeeId = insertEmployeeRow(employeeData);
    upsertCurrentEmploymentPeriod(employeeId, employeeData, { forceNewPeriod: false });
    return employeeId;
  });

  const employeeId = tx();
  return getEmployeeById(employeeId, { includeDeleted: true });
}

function updateEmployee(id, employee) {
  const db = getDb();
  const employeeId = Number(id);
  const employeeData = mapEmployeeInput(employee);
  const tx = db.transaction(() => {
    ensureNoDuplicateActiveEmployee(employeeData, employeeId);
    updateEmployeeRow(employeeId, employeeData);
    upsertCurrentEmploymentPeriod(employeeId, employeeData, { forceNewPeriod: false });
  });

  tx();
  return getEmployeeById(employeeId, { includeDeleted: true });
}

function archiveEmployee(id) {
  const db = getDb();
  db.prepare(`
    UPDATE employees
    SET is_deleted = 1,
        deleted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);

  setCurrentPeriodsInactive(Number(id));
  return getEmployeeById(id, { includeDeleted: true });
}

function restoreEmployee(id) {
  const db = getDb();
  db.prepare(`
    UPDATE employees
    SET is_deleted = 0,
        deleted_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(id);

  const employee = getEmployeeById(id, { includeDeleted: true });
  upsertCurrentEmploymentPeriod(Number(id), employee || {}, { forceNewPeriod: false });
  return getEmployeeById(id, { includeDeleted: true });
}

function getHireDocument(employeeId) {
  return getEmployeeById(employeeId, { includeDeleted: true })?.hire_document || null;
}

function getEmploymentPeriodHireDocument(employeeId, employmentPeriodId) {
  const employee = getEmployeeById(employeeId, { includeDeleted: true });
  const period = (employee?.employment_periods || []).find((item) => Number(item.id) === Number(employmentPeriodId));
  return period?.hire_document || null;
}

function getEmployeeDocumentByCategory(employeeId, category) {
  const documentKey = EMPLOYEE_DOCUMENT_META[category]?.key;
  if (!documentKey) {
    throw new Error('Categoria documento non supportata.');
  }

  return getEmployeeById(employeeId, { includeDeleted: true })?.[documentKey] || null;
}

function deleteEmployeeDocumentByCategory(employeeId, category) {
  const db = getDb();
  const existing = db.prepare(`
    SELECT id, relative_path
    FROM employee_documents
    WHERE employee_id = ? AND category = ?
    LIMIT 1
  `).get(employeeId, category);

  if (!existing) {
    return {
      success: false,
      message: 'Nessun allegato da eliminare.',
      document: null,
    };
  }

  removeStoredFile(existing.relative_path);

  db.prepare(`
    DELETE FROM employee_documents
    WHERE id = ?
  `).run(existing.id);

  return {
    success: true,
    document: getEmployeeDocumentByCategory(employeeId, category),
  };
}

async function uploadEmployeeDocumentByCategory(browserWindow, employeeId, category) {
  const db = getDb();
  const employee = getEmployeeById(employeeId, { includeDeleted: true });
  if (!employee) {
    throw new Error('Dipendente non trovato');
  }

  const meta = EMPLOYEE_DOCUMENT_META[category];
  if (!meta) {
    throw new Error('Categoria documento non supportata');
  }

  const selectedPath = await selectLocalFile(browserWindow, meta.dialogTitle);
  if (!selectedPath) {
    return { canceled: true };
  }

  const stored = storeSelectedFile(
    selectedPath,
    ['employees', String(employeeId), meta.subdir],
    `${employee.last_name}-${employee.first_name}-${meta.nameSuffix}`
  );

  const existing = db.prepare(`
    SELECT *
    FROM employee_documents
    WHERE employee_id = ? AND category = ?
    LIMIT 1
  `).get(employeeId, category);

  if (existing?.relative_path && existing.relative_path !== stored.relative_path) {
    removeStoredFile(existing.relative_path);
  }

  if (existing) {
    db.prepare(`
      UPDATE employee_documents
      SET file_name = @file_name,
          stored_name = @stored_name,
          relative_path = @relative_path,
          mime_type = @mime_type,
          size_bytes = @size_bytes,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({
      id: existing.id,
      ...stored,
    });
  } else {
    db.prepare(`
      INSERT INTO employee_documents (
        employee_id, category, file_name, stored_name, relative_path, mime_type, size_bytes
      ) VALUES (
        @employee_id, @category, @file_name, @stored_name, @relative_path, @mime_type, @size_bytes
      )
    `).run({
      employee_id: employeeId,
      category,
      ...stored,
    });
  }

  return {
    canceled: false,
    document: getEmployeeDocumentByCategory(employeeId, category),
  };
}

function getEmploymentPeriodOrThrow(employeeId, employmentPeriodId) {
  const employee = getEmployeeById(employeeId, { includeDeleted: true });
  if (!employee) {
    throw new Error('Dipendente non trovato');
  }

  const period = (employee.employment_periods || []).find((item) => Number(item.id) === Number(employmentPeriodId));
  if (!period) {
    throw new Error('Rapporto di lavoro non trovato');
  }

  return { employee, period };
}

function upsertEmploymentPeriodHireDocument(employeeId, employmentPeriodId, stored) {
  const db = getDb();
  const category = buildEmploymentPeriodDocumentCategory(employmentPeriodId);
  const existing = db.prepare(`
    SELECT *
    FROM employee_documents
    WHERE employee_id = ? AND category = ?
    LIMIT 1
  `).get(employeeId, category);

  if (existing?.relative_path && existing.relative_path !== stored.relative_path) {
    removeStoredFile(existing.relative_path);
  }

  if (existing) {
    db.prepare(`
      UPDATE employee_documents
      SET file_name = @file_name,
          stored_name = @stored_name,
          relative_path = @relative_path,
          mime_type = @mime_type,
          size_bytes = @size_bytes,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({
      id: existing.id,
      ...stored,
    });
  } else {
    db.prepare(`
      INSERT INTO employee_documents (
        employee_id, category, file_name, stored_name, relative_path, mime_type, size_bytes
      ) VALUES (
        @employee_id, @category, @file_name, @stored_name, @relative_path, @mime_type, @size_bytes
      )
    `).run({
      employee_id: employeeId,
      category,
      ...stored,
    });
  }

  return getEmploymentPeriodHireDocument(employeeId, employmentPeriodId);
}

async function openEmployeeDocumentByCategory(employeeId, category) {
  const db = getDb();
  const row = db.prepare(`
    SELECT relative_path
    FROM employee_documents
    WHERE employee_id = ? AND category = ?
    LIMIT 1
  `).get(employeeId, category);

  return openStoredDocument(row?.relative_path || null);
}

function deleteHireDocument(employeeId) {
  return deleteEmployeeDocumentByCategory(employeeId, DOCUMENT_CATEGORIES.hire);
}

function deleteArt37Document(employeeId) {
  return deleteEmployeeDocumentByCategory(employeeId, DOCUMENT_CATEGORIES.art37);
}

function deleteMedicalVisitDocument(employeeId) {
  return deleteEmployeeDocumentByCategory(employeeId, DOCUMENT_CATEGORIES.medicalVisit);
}

async function uploadHireDocument(browserWindow, employeeId) {
  return uploadEmployeeDocumentByCategory(browserWindow, employeeId, DOCUMENT_CATEGORIES.hire);
}

async function uploadArt37Document(browserWindow, employeeId) {
  return uploadEmployeeDocumentByCategory(browserWindow, employeeId, DOCUMENT_CATEGORIES.art37);
}

async function uploadMedicalVisitDocument(browserWindow, employeeId) {
  return uploadEmployeeDocumentByCategory(browserWindow, employeeId, DOCUMENT_CATEGORIES.medicalVisit);
}

async function openHireDocument(employeeId) {
  return openEmployeeDocumentByCategory(employeeId, DOCUMENT_CATEGORIES.hire);
}

async function uploadHireDocumentForEmploymentPeriod(browserWindow, employeeId, employmentPeriodId) {
  const { employee, period } = getEmploymentPeriodOrThrow(employeeId, employmentPeriodId);
  const selectedPath = await selectLocalFile(browserWindow, 'Seleziona allegato assunzione rapporto');
  if (!selectedPath) {
    return { canceled: true };
  }

  const employerLabel = String(period.hired_by || 'rapporto').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const stored = storeSelectedFile(
    selectedPath,
    ['employees', String(employeeId), 'hire-documents', `period-${employmentPeriodId}`],
    `${employee.last_name}-${employee.first_name}-assunzione-${employerLabel}`
  );

  return {
    canceled: false,
    document: upsertEmploymentPeriodHireDocument(employeeId, employmentPeriodId, stored),
  };
}

async function openHireDocumentForEmploymentPeriod(employeeId, employmentPeriodId) {
  const category = buildEmploymentPeriodDocumentCategory(employmentPeriodId);
  const row = getDb().prepare(`
    SELECT relative_path
    FROM employee_documents
    WHERE employee_id = ? AND category = ?
    LIMIT 1
  `).get(employeeId, category);

  return openStoredDocument(row?.relative_path || null);
}

function deleteHireDocumentForEmploymentPeriod(employeeId, employmentPeriodId) {
  const db = getDb();
  const category = buildEmploymentPeriodDocumentCategory(employmentPeriodId);
  const existing = db.prepare(`
    SELECT id, relative_path
    FROM employee_documents
    WHERE employee_id = ? AND category = ?
    LIMIT 1
  `).get(employeeId, category);

  if (!existing) {
    return {
      success: false,
      message: 'Nessun allegato assunzione per questo rapporto.',
      document: null,
    };
  }

  removeStoredFile(existing.relative_path);
  db.prepare(`DELETE FROM employee_documents WHERE id = ?`).run(existing.id);

  return {
    success: true,
    document: null,
  };
}

async function openArt37Document(employeeId) {
  return openEmployeeDocumentByCategory(employeeId, DOCUMENT_CATEGORIES.art37);
}

async function openMedicalVisitDocument(employeeId) {
  return openEmployeeDocumentByCategory(employeeId, DOCUMENT_CATEGORIES.medicalVisit);
}

function addEmploymentPeriodToEmployee(employeeId, { hire_date_from, hire_date_to, hired_by }) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO employee_employment_periods
      (employee_id, hire_date_from, hire_date_to, hired_by, status, is_current)
    VALUES (?, ?, ?, ?, 'attivo', 0)
  `).run(Number(employeeId), hire_date_from || null, hire_date_to || null, hired_by || null);

  return {
    id: Number(result.lastInsertRowid),
    employee_id: Number(employeeId),
    hire_date_from: hire_date_from || null,
    hire_date_to: hire_date_to || null,
    hired_by: hired_by || null,
    status: 'attivo',
    is_current: false,
  };
}

function listEmploymentYears() {
  const db = getDb();
  const rows = db.prepare(`
    SELECT hire_date_from, hire_date_to FROM employees
    UNION ALL
    SELECT hire_date_from, hire_date_to FROM employee_employment_periods
  `).all();

  const years = new Set();
  for (const row of rows) {
    const values = [row.hire_date_from, row.hire_date_to];
    for (const value of values) {
      const year = Number(String(value || '').slice(0, 4));
      if (Number.isInteger(year) && year > 1900) {
        years.add(year);
      }
    }
  }

  return [...years].sort((a, b) => b - a);
}

function deleteEmployeePermanently(id) {
  const db = getDb();
  const employeeId = Number(id);

  const docs = db.prepare('SELECT relative_path FROM employee_documents WHERE employee_id = ?').all(employeeId);
  for (const doc of docs) {
    removeStoredFile(doc.relative_path);
  }

  const payrollDocuments = db.prepare(`
    SELECT pd.relative_path
    FROM payroll_documents pd
    JOIN payroll_records pr ON pr.id = pd.payroll_record_id
    WHERE pr.employee_id = ?
  `).all(employeeId);
  for (const doc of payrollDocuments) {
    removeStoredFile(doc.relative_path);
  }

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE payroll_debt_installments
      SET is_paid = 0,
          paid_record_id = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE paid_record_id IN (
        SELECT id
        FROM payroll_records
        WHERE employee_id = ?
      )
    `).run(employeeId);

    db.prepare(`
      DELETE FROM payroll_documents
      WHERE payroll_record_id IN (
        SELECT id
        FROM payroll_records
        WHERE employee_id = ?
      )
    `).run(employeeId);

    db.prepare(`
      DELETE FROM payroll_advances
      WHERE payroll_record_id IN (
        SELECT id
        FROM payroll_records
        WHERE employee_id = ?
      )
    `).run(employeeId);

    db.prepare('DELETE FROM communication_details WHERE employee_id = ?').run(employeeId);
    db.prepare('DELETE FROM payroll_debt_installments WHERE employee_id = ?').run(employeeId);
    db.prepare('DELETE FROM payroll_debt_plans WHERE employee_id = ?').run(employeeId);
    db.prepare('DELETE FROM attendance WHERE employee_id = ?').run(employeeId);
    db.prepare('DELETE FROM team_members WHERE employee_id = ?').run(employeeId);
    db.prepare('DELETE FROM employee_employment_periods WHERE employee_id = ?').run(employeeId);
    db.prepare('DELETE FROM employee_documents WHERE employee_id = ?').run(employeeId);
    db.prepare('DELETE FROM payroll_records WHERE employee_id = ?').run(employeeId);
    db.prepare('DELETE FROM employees WHERE id = ?').run(employeeId);
  });

  tx();
}

module.exports = {
  addEmploymentPeriodToEmployee,
  archiveEmployee,
  deleteArt37Document,
  createEmployee,
  deleteEmployeePermanently,
  deleteHireDocument,
  deleteMedicalVisitDocument,
  findEmployeeHistoryMatches,
  getEmployeeDocumentByCategory,
  getEmployeeById,
  getEmploymentPeriodHireDocument,
  getHireDocument,
  listEmploymentYears,
  listEmployees,
  openArt37Document,
  openHireDocument,
  openHireDocumentForEmploymentPeriod,
  openMedicalVisitDocument,
  restoreEmployee,
  updateEmployee,
  uploadArt37Document,
  uploadHireDocument,
  uploadHireDocumentForEmploymentPeriod,
  uploadMedicalVisitDocument,
  deleteHireDocumentForEmploymentPeriod,
  buildEmploymentPeriodDocumentCategory,
  upsertEmploymentPeriodHireDocument,
};
