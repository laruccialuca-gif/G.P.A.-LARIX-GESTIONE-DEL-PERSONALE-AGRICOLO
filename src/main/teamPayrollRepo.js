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

function normalizePayload(payload = {}) {
  const teamId = Number(payload.team_id || payload.teamId || 0);
  const month = normalizeMonth(payload.month);
  const advanceDate = normalizeDate(payload.advance_date || payload.advanceDate);
  const amount = normalizeAmount(payload.amount);
  const notes = String(payload.notes || '').trim();

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
    notes: notes || null,
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
    notes: row.notes || '',
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

function listTeamAdvances(teamId, month) {
  const db = getDb();
  return db.prepare(`
    SELECT *
    FROM team_advances
    WHERE team_id = ?
      AND month = ?
    ORDER BY advance_date ASC, id ASC
  `).all(Number(teamId), normalizeMonth(month)).map(mapTeamAdvance);
}

function createTeamAdvance(payload) {
  const db = getDb();
  const data = normalizePayload(payload);
  const result = db.prepare(`
    INSERT INTO team_advances (
      team_id, month, advance_date, amount, notes
    ) VALUES (
      @team_id, @month, @advance_date, @amount, @notes
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
  });

  db.prepare(`
    UPDATE team_advances
    SET team_id = @team_id,
        month = @month,
        advance_date = @advance_date,
        amount = @amount,
        notes = @notes,
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
  `).get(Number(teamId), normalizeMonth(month));
  return Number(row?.total || 0);
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
  createTeamAdvance,
  updateTeamAdvance,
  deleteTeamAdvance,
  getTeamAdvanceTotal,
  listPayrollComponents,
  createPayrollComponent,
  updatePayrollComponent,
  deletePayrollComponent,
};
