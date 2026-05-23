const { getDb } = require('./db');

function normalizeMonth(value) {
  return String(value || '').slice(0, 7);
}

function normalizeDate(value) {
  return String(value || '').slice(0, 10);
}

function normalizeAmount(value) {
  const normalized = String(value ?? '')
    .replace(',', '.')
    .trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeNullableId(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeBooleanFlag(value) {
  if (value === true || value === 1 || value === '1') return 1;
  return 0;
}

function normalizePayload(payload = {}) {
  const teamId = Number(payload.team_id || payload.teamId || 0);
  const month = normalizeMonth(payload.month);
  const advanceDate = normalizeDate(payload.advance_date || payload.advanceDate);
  const amount = normalizeAmount(payload.amount);
  const employerKey = String(payload.employer_key || payload.employerKey || '').trim().toUpperCase() || null;
  const notes = String(payload.notes || '').trim();
  const includeInReport = payload.include_in_report ?? payload.includeInReport;
  const sourceType = String(payload.source_type || payload.sourceType || 'report').trim() || 'report';

  if (!teamId) {
    throw new Error('Squadra obbligatoria');
  }
  if (!month) {
    throw new Error('Mese obbligatorio');
  }
  if (!advanceDate) {
    throw new Error('Data acconto obbligatoria');
  }
  if (!(amount > 0)) {
    throw new Error('Importo acconto non valido');
  }

  return {
    team_id: teamId,
    month,
    advance_date: advanceDate,
    amount,
    employer_key: employerKey,
    notes: notes || null,
    include_in_report: includeInReport === undefined ? 1 : includeInReport ? 1 : 0,
    source_type: sourceType,
  };
}

function normalizePayrollComponentPayload(payload = {}) {
  const teamId = Number(payload.team_id || payload.teamId || 0);
  const month = normalizeMonth(payload.month);
  const employeeId = normalizeNullableId(payload.employee_id || payload.employeeId);
  const employeeLabel = String(payload.employee_label || payload.employeeLabel || '').trim();
  const days = normalizeAmount(payload.days);
  const amount = normalizeAmount(payload.amount);
  const notes = String(payload.notes || '').trim();
  const sortOrder = Number(payload.sort_order ?? payload.sortOrder ?? 0) || 0;

  if (!teamId) {
    throw new Error('Squadra obbligatoria');
  }
  if (!month) {
    throw new Error('Mese obbligatorio');
  }
  if (!employeeId && !employeeLabel) {
    throw new Error('Dipendente o nome componente obbligatorio');
  }
  if (!(amount >= 0)) {
    throw new Error('Importo componente non valido');
  }

  return {
    team_id: teamId,
    month,
    employee_id: employeeId,
    employee_label: employeeLabel || null,
    days,
    amount,
    notes: notes || null,
    sort_order: sortOrder,
  };
}

function mapTeamAdvance(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    team_id: Number(row.team_id),
    month: row.month,
    advance_date: row.advance_date,
    amount: Number(row.amount || 0),
    employer_key: row.employer_key || '',
    notes: row.notes || '',
    include_in_report: Number(row.include_in_report || 0) === 1,
    source_type: row.source_type || 'report',
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function mapPayrollComponent(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    team_id: Number(row.team_id),
    month: row.month,
    employee_id: row.employee_id ? Number(row.employee_id) : null,
    employee_label: row.employee_label || '',
    days: Number(row.days || 0),
    amount: Number(row.amount || 0),
    notes: row.notes || '',
    sort_order: Number(row.sort_order || 0),
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function mapTeamReportRecord(row) {
  if (!row) return null;
  let snapshot = null;
  if (row.report_snapshot_json) {
    try {
      snapshot = JSON.parse(row.report_snapshot_json);
    } catch {
      snapshot = null;
    }
  }

  return {
    id: Number(row.id),
    team_id: Number(row.team_id),
    month: row.month,
    transport_enabled: Number(row.transport_enabled || 0) === 1,
    transport_description: row.transport_description || '',
    transport_amount: Number(row.transport_amount || 0),
    note: row.note || '',
    processed_at: row.processed_at || null,
    archived_at: row.archived_at || null,
    report_html_snapshot: row.report_html_snapshot || null,
    report_snapshot_json: snapshot,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function getTeamAdvanceById(id) {
  const db = getDb();
  const row = db.prepare(`
    SELECT *
    FROM team_advances
    WHERE id = ?
    LIMIT 1
  `).get(Number(id));
  return mapTeamAdvance(row);
}

function getPayrollComponentById(id) {
  const db = getDb();
  const row = db.prepare(`
    SELECT *
    FROM team_payroll_components
    WHERE id = ?
    LIMIT 1
  `).get(Number(id));
  return mapPayrollComponent(row);
}

function getTeamReportRecord(teamId, month) {
  const db = getDb();
  const row = db.prepare(`
    SELECT *
    FROM team_report_records
    WHERE team_id = ?
      AND month = ?
    LIMIT 1
  `).get(Number(teamId), normalizeMonth(month));
  return mapTeamReportRecord(row);
}

function listTeamAdvances(teamId, month, options = {}) {
  const db = getDb();
  const params = [Number(teamId), normalizeMonth(month)];
  const includeClause = options.include_in_report === undefined
    ? ''
    : ' AND include_in_report = ?';
  if (options.include_in_report !== undefined) {
    params.push(options.include_in_report ? 1 : 0);
  }
  return db.prepare(`
    SELECT *
    FROM team_advances
    WHERE team_id = ?
      AND month = ?
      ${includeClause}
    ORDER BY advance_date ASC, id ASC
  `).all(...params).map(mapTeamAdvance);
}

function listAvailableTeamAdvances(teamId, month) {
  return listTeamAdvances(teamId, month, { include_in_report: false })
    .filter((row) => row.source_type === 'financial_movement');
}

function listAllTeamAdvances(options = {}) {
  const db = getDb();
  const conditions = [];
  const params = [];

  if (options.team_id || options.teamId) {
    conditions.push('a.team_id = ?');
    params.push(Number(options.team_id || options.teamId));
  }
  if (options.month) {
    conditions.push('substr(a.advance_date, 1, 7) = ?');
    params.push(normalizeMonth(options.month));
  }
  if (options.employer_key || options.employerKey) {
    conditions.push('a.employer_key = ?');
    params.push(String(options.employer_key || options.employerKey).trim().toUpperCase());
  }
  if (options.status === 'pending') {
    conditions.push('a.include_in_report = 0');
  }
  if (options.status === 'inserted') {
    conditions.push('a.include_in_report = 1');
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db.prepare(`
    SELECT
      a.*,
      t.name AS team_name
    FROM team_advances a
    JOIN teams t ON t.id = a.team_id
    ${whereClause}
    ORDER BY a.advance_date DESC, a.id DESC
  `).all(...params).map((row) => ({
    ...mapTeamAdvance(row),
    team_name: row.team_name || '',
  }));
}

function createTeamAdvance(payload) {
  const db = getDb();
  const data = normalizePayload(payload);
  const result = db.prepare(`
    INSERT INTO team_advances (
      team_id, month, advance_date, amount, employer_key, notes, include_in_report, source_type
    ) VALUES (
      @team_id, @month, @advance_date, @amount, @employer_key, @notes, @include_in_report, @source_type
    )
  `).run(data);
  return getTeamAdvanceById(Number(result.lastInsertRowid));
}

function updateTeamAdvance(id, payload) {
  const db = getDb();
  const advanceId = Number(id);
  const existing = getTeamAdvanceById(advanceId);
  if (!existing) {
    throw new Error('Acconto squadra non trovato');
  }

  const data = normalizePayload({
    ...existing,
    ...payload,
    team_id: payload.team_id || payload.teamId || existing.team_id,
    month: payload.month || existing.month,
    advance_date: payload.advance_date || payload.advanceDate || existing.advance_date,
    employer_key: payload.employer_key || payload.employerKey || existing.employer_key,
    include_in_report: payload.include_in_report ?? payload.includeInReport ?? existing.include_in_report,
    source_type: payload.source_type || payload.sourceType || existing.source_type,
  });

  db.prepare(`
    UPDATE team_advances
    SET team_id = @team_id,
        month = @month,
        advance_date = @advance_date,
        amount = @amount,
        employer_key = @employer_key,
        notes = @notes,
        include_in_report = @include_in_report,
        source_type = @source_type,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    id: advanceId,
    ...data,
  });

  return getTeamAdvanceById(advanceId);
}

function deleteTeamAdvance(id) {
  const db = getDb();
  db.prepare(`
    DELETE FROM team_advances
    WHERE id = ?
  `).run(Number(id));
  return { success: true };
}

function getTeamAdvanceTotal(teamId, month) {
  const db = getDb();
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM team_advances
    WHERE team_id = ?
      AND month = ?
      AND include_in_report = 1
  `).get(Number(teamId), normalizeMonth(month));
  return Number(row?.total || 0);
}

function setTeamAdvancesImported(ids = [], includeInReport = true) {
  const advanceIds = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);
  if (!advanceIds.length) return [];

  const db = getDb();
  const placeholders = advanceIds.map(() => '?').join(', ');
  db.prepare(`
    UPDATE team_advances
    SET include_in_report = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id IN (${placeholders})
  `).run(includeInReport ? 1 : 0, ...advanceIds);

  return advanceIds.map(getTeamAdvanceById).filter(Boolean);
}

function listPayrollComponents(teamId, month) {
  const db = getDb();
  return db.prepare(`
    SELECT *
    FROM team_payroll_components
    WHERE team_id = ?
      AND month = ?
    ORDER BY sort_order ASC, id ASC
  `).all(Number(teamId), normalizeMonth(month)).map(mapPayrollComponent);
}

function createPayrollComponent(payload) {
  const db = getDb();
  const data = normalizePayrollComponentPayload(payload);
  const result = db.prepare(`
    INSERT INTO team_payroll_components (
      team_id, month, employee_id, employee_label, days, amount, notes, sort_order
    ) VALUES (
      @team_id, @month, @employee_id, @employee_label, @days, @amount, @notes, @sort_order
    )
  `).run(data);
  return getPayrollComponentById(Number(result.lastInsertRowid));
}

function replacePayrollComponents(teamId, month, items = []) {
  const db = getDb();
  const normalizedTeamId = Number(teamId || 0);
  const normalizedMonth = normalizeMonth(month);
  if (!normalizedTeamId) {
    throw new Error('Squadra obbligatoria');
  }
  if (!normalizedMonth) {
    throw new Error('Mese obbligatorio');
  }

  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((item, index) =>
      normalizePayrollComponentPayload({
        ...item,
        team_id: normalizedTeamId,
        month: normalizedMonth,
        sort_order: index,
      })
    )
    .filter((item) =>
      item.employee_id ||
      item.employee_label ||
      item.days > 0 ||
      item.amount > 0 ||
      item.notes
    );

  const tx = db.transaction(() => {
    db.prepare(`
      DELETE FROM team_payroll_components
      WHERE team_id = ?
        AND month = ?
    `).run(normalizedTeamId, normalizedMonth);

    const insertStatement = db.prepare(`
      INSERT INTO team_payroll_components (
        team_id, month, employee_id, employee_label, days, amount, notes, sort_order
      ) VALUES (
        @team_id, @month, @employee_id, @employee_label, @days, @amount, @notes, @sort_order
      )
    `);

    normalizedItems.forEach((item) => insertStatement.run(item));
  });

  tx();
  return listPayrollComponents(normalizedTeamId, normalizedMonth);
}

function saveTeamReportRecord(payload = {}) {
  const db = getDb();
  const teamId = Number(payload.team_id || payload.teamId || 0);
  const month = normalizeMonth(payload.month);
  if (!teamId) {
    throw new Error('Squadra obbligatoria');
  }
  if (!month) {
    throw new Error('Mese obbligatorio');
  }

  const data = {
    team_id: teamId,
    month,
    transport_enabled: normalizeBooleanFlag(payload.transport_enabled ?? payload.transportEnabled),
    transport_description: String(payload.transport_description || payload.transportDescription || '').trim() || null,
    transport_amount: normalizeAmount(payload.transport_amount ?? payload.transportAmount),
    note: String(payload.note || '').trim() || null,
    processed_at: String(payload.processed_at || payload.processedAt || '').trim() || null,
    archived_at: String(payload.archived_at || payload.archivedAt || '').trim() || null,
    report_html_snapshot: payload.report_html_snapshot || payload.reportHtmlSnapshot || null,
    report_snapshot_json: payload.report_snapshot_json || payload.reportSnapshotJson
      ? JSON.stringify(payload.report_snapshot_json || payload.reportSnapshotJson)
      : null,
  };

  const existing = getTeamReportRecord(teamId, month);
  if (existing) {
    db.prepare(`
      UPDATE team_report_records
      SET transport_enabled = @transport_enabled,
          transport_description = @transport_description,
          transport_amount = @transport_amount,
          note = @note,
          processed_at = @processed_at,
          archived_at = @archived_at,
          report_html_snapshot = @report_html_snapshot,
          report_snapshot_json = @report_snapshot_json,
          updated_at = CURRENT_TIMESTAMP
      WHERE team_id = @team_id
        AND month = @month
    `).run(data);
  } else {
    db.prepare(`
      INSERT INTO team_report_records (
        team_id, month, transport_enabled, transport_description, transport_amount, note,
        processed_at, archived_at, report_html_snapshot, report_snapshot_json
      ) VALUES (
        @team_id, @month, @transport_enabled, @transport_description, @transport_amount, @note,
        @processed_at, @archived_at, @report_html_snapshot, @report_snapshot_json
      )
    `).run(data);
  }

  return getTeamReportRecord(teamId, month);
}

function updatePayrollComponent(id, payload) {
  const db = getDb();
  const componentId = Number(id);
  const existing = getPayrollComponentById(componentId);
  if (!existing) {
    throw new Error('Busta componente non trovata');
  }

  const data = normalizePayrollComponentPayload({
    ...existing,
    ...payload,
    team_id: payload.team_id || payload.teamId || existing.team_id,
    month: payload.month || existing.month,
    employee_id: payload.employee_id ?? payload.employeeId ?? existing.employee_id,
    employee_label: payload.employee_label ?? payload.employeeLabel ?? existing.employee_label,
    sort_order: payload.sort_order ?? payload.sortOrder ?? existing.sort_order,
  });

  db.prepare(`
    UPDATE team_payroll_components
    SET team_id = @team_id,
        month = @month,
        employee_id = @employee_id,
        employee_label = @employee_label,
        days = @days,
        amount = @amount,
        notes = @notes,
        sort_order = @sort_order,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = @id
  `).run({
    id: componentId,
    ...data,
  });

  return getPayrollComponentById(componentId);
}

function deletePayrollComponent(id) {
  const db = getDb();
  db.prepare(`
    DELETE FROM team_payroll_components
    WHERE id = ?
  `).run(Number(id));
  return { success: true };
}

module.exports = {
  listTeamAdvances,
  listAvailableTeamAdvances,
  listAllTeamAdvances,
  createTeamAdvance,
  updateTeamAdvance,
  deleteTeamAdvance,
  getTeamAdvanceTotal,
  setTeamAdvancesImported,
  listPayrollComponents,
  createPayrollComponent,
  updatePayrollComponent,
  deletePayrollComponent,
  replacePayrollComponents,
  getTeamReportRecord,
  saveTeamReportRecord,
};
