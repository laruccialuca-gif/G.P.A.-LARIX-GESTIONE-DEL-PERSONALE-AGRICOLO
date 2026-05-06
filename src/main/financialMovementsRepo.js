const { getDb } = require('./db');

const VALID_TYPES = new Set(['advance', 'installment']);
const VALID_STATUSES = new Set(['pending', 'inserted']);

function normalizeMovementPayload(payload = {}) {
  const type = VALID_TYPES.has(payload.type) ? payload.type : 'advance';
  const status = VALID_STATUSES.has(payload.status) ? payload.status : 'pending';
  const employeeId = Number(payload.employee_id || payload.employeeId || 0);
  const amount = Number(payload.amount || 0);
  const movementDate = String(payload.movement_date || payload.movementDate || '').slice(0, 10);

  if (!employeeId) {
    throw new Error('Dipendente obbligatorio');
  }
  if (!movementDate) {
    throw new Error('Data movimento obbligatoria');
  }
  if (!(amount > 0)) {
    throw new Error('Importo movimento non valido');
  }

  return {
    type,
    employee_id: employeeId,
    team_id: payload.team_id || payload.teamId ? Number(payload.team_id || payload.teamId) : null,
    employer_key: String(payload.employer_key || payload.employerKey || '').trim().toUpperCase() || null,
    movement_date: movementDate,
    amount,
    notes: String(payload.notes || '').trim() || null,
    status,
    inserted_report_id: payload.inserted_report_id || payload.insertedReportId
      ? Number(payload.inserted_report_id || payload.insertedReportId)
      : null,
    inserted_month: String(payload.inserted_month || payload.insertedMonth || '').slice(0, 7) || null,
  };
}

function mapMovement(row) {
  if (!row) return null;
  const employeeName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return {
    id: row.id,
    type: row.type,
    employee_id: row.employee_id,
    team_id: row.team_id || null,
    employer_key: row.employer_key || '',
    movement_date: row.movement_date,
    amount: Number(row.amount || 0),
    notes: row.notes || '',
    status: row.status || 'pending',
    inserted_report_id: row.inserted_report_id || null,
    inserted_month: row.inserted_month || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    employee_name: employeeName,
    team_name: row.team_name || '',
  };
}

function buildWhere(options = {}) {
  const conditions = [];
  const params = [];

  if (options.type && VALID_TYPES.has(options.type)) {
    conditions.push('m.type = ?');
    params.push(options.type);
  }
  if (options.status && VALID_STATUSES.has(options.status)) {
    conditions.push('m.status = ?');
    params.push(options.status);
  }
  if (options.employee_id || options.employeeId) {
    conditions.push('m.employee_id = ?');
    params.push(Number(options.employee_id || options.employeeId));
  }
  if (options.team_id || options.teamId) {
    conditions.push('m.team_id = ?');
    params.push(Number(options.team_id || options.teamId));
  }
  if (options.employer_key || options.employerKey) {
    conditions.push('m.employer_key = ?');
    params.push(String(options.employer_key || options.employerKey).trim().toUpperCase());
  }
  if (options.month) {
    conditions.push("substr(m.movement_date, 1, 7) = ?");
    params.push(String(options.month).slice(0, 7));
  }
  if (options.year) {
    conditions.push("substr(m.movement_date, 1, 4) = ?");
    params.push(String(options.year));
  }

  return {
    whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

function listMovements(options = {}) {
  const db = getDb();
  const { whereClause, params } = buildWhere(options);
  return db.prepare(`
    SELECT
      m.*,
      e.first_name,
      e.last_name,
      t.name AS team_name
    FROM employee_financial_movements m
    JOIN employees e ON e.id = m.employee_id
    LEFT JOIN teams t ON t.id = m.team_id
    ${whereClause}
    ORDER BY m.movement_date DESC, m.id DESC
  `).all(...params).map(mapMovement);
}

function listAvailableForReport(options = {}) {
  return listMovements({
    employee_id: options.employee_id || options.employeeId,
    type: options.type,
    status: 'pending',
  });
}

function countAvailableForReport(employeeId) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT type, COUNT(*) AS count
    FROM employee_financial_movements
    WHERE employee_id = ?
      AND status = 'pending'
    GROUP BY type
  `).all(Number(employeeId));

  return rows.reduce(
    (acc, row) => ({
      ...acc,
      [row.type]: Number(row.count || 0),
    }),
    { advance: 0, installment: 0 }
  );
}

function countPendingForMonth(employeeId, month) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT type, COUNT(*) AS count
    FROM employee_financial_movements
    WHERE employee_id = ?
      AND status = 'pending'
      AND substr(movement_date, 1, 7) = ?
    GROUP BY type
  `).all(Number(employeeId), String(month || '').slice(0, 7));

  return rows.reduce(
    (acc, row) => ({
      ...acc,
      [row.type]: Number(row.count || 0),
      total: acc.total + Number(row.count || 0),
    }),
    { advance: 0, installment: 0, total: 0 }
  );
}

function saveMovement(payload) {
  const db = getDb();
  const data = normalizeMovementPayload(payload);
  const id = payload.id ? Number(payload.id) : null;

  if (id) {
    db.prepare(`
      UPDATE employee_financial_movements
      SET type = @type,
          employee_id = @employee_id,
          team_id = @team_id,
          employer_key = @employer_key,
          movement_date = @movement_date,
          amount = @amount,
          notes = @notes,
          status = @status,
          inserted_report_id = @inserted_report_id,
          inserted_month = @inserted_month,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ id, ...data });
    return getMovement(id);
  }

  const result = db.prepare(`
    INSERT INTO employee_financial_movements (
      type, employee_id, team_id, employer_key, movement_date, amount, notes,
      status, inserted_report_id, inserted_month
    ) VALUES (
      @type, @employee_id, @team_id, @employer_key, @movement_date, @amount, @notes,
      @status, @inserted_report_id, @inserted_month
    )
  `).run(data);

  return getMovement(Number(result.lastInsertRowid));
}

function createManyForEmployees(payload = {}) {
  const employeeIds = Array.isArray(payload.employee_ids)
    ? payload.employee_ids.map(Number).filter(Boolean)
    : [];
  if (!employeeIds.length) {
    return [];
  }

  const db = getDb();
  const tx = db.transaction(() => {
    const ids = [];
    for (const employeeId of employeeIds) {
      const saved = saveMovement({
        ...payload,
        employee_id: employeeId,
      });
      ids.push(saved.id);
    }
    return ids;
  });

  return tx().map(getMovement);
}

function getMovement(id) {
  const db = getDb();
  const row = db.prepare(`
    SELECT
      m.*,
      e.first_name,
      e.last_name,
      t.name AS team_name
    FROM employee_financial_movements m
    JOIN employees e ON e.id = m.employee_id
    LEFT JOIN teams t ON t.id = m.team_id
    WHERE m.id = ?
    LIMIT 1
  `).get(Number(id));
  return mapMovement(row);
}

function deleteMovement(id) {
  const db = getDb();
  db.prepare('DELETE FROM employee_financial_movements WHERE id = ?').run(Number(id));
  return { success: true };
}

function markInserted(ids = [], context = {}) {
  const movementIds = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Boolean);
  if (!movementIds.length) return [];

  const db = getDb();
  const placeholders = movementIds.map(() => '?').join(', ');
  db.prepare(`
    UPDATE employee_financial_movements
    SET status = 'inserted',
        inserted_report_id = COALESCE(?, inserted_report_id),
        inserted_month = COALESCE(?, inserted_month),
        updated_at = CURRENT_TIMESTAMP
    WHERE id IN (${placeholders})
  `).run(
    context.report_id || context.reportId || null,
    String(context.month || '').slice(0, 7) || null,
    ...movementIds
  );

  return movementIds.map(getMovement).filter(Boolean);
}

module.exports = {
  countAvailableForReport,
  countPendingForMonth,
  createManyForEmployees,
  deleteMovement,
  getMovement,
  listAvailableForReport,
  listMovements,
  markInserted,
  saveMovement,
};
