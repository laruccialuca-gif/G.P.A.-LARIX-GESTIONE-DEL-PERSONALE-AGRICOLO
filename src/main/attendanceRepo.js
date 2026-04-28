const { getDb } = require('./db');

function parseMonthInput(monthOrYear, maybeMonth) {
  if (typeof monthOrYear === 'string' && monthOrYear.includes('-')) {
    const [year, month] = monthOrYear.split('-');
    return { year: Number(year), month: Number(month) };
  }

  return { year: Number(monthOrYear), month: Number(maybeMonth) };
}

function listAttendanceByMonth(monthOrYear, maybeMonth) {
  const db = getDb();
  const { year, month } = parseMonthInput(monthOrYear, maybeMonth);

  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = `${year}-${String(month).padStart(2, '0')}-31`;

  return db.prepare(`
    SELECT a.*, e.first_name, e.last_name, e.daily_pay, e.standard_hours, e.role
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.date BETWEEN ? AND ?
      AND e.is_deleted = 0
    ORDER BY a.date ASC, e.last_name, e.first_name
  `).all(from, to);
}

function saveAttendance(entry) {
  const db = getDb();

  db.prepare(`
    INSERT INTO attendance (employee_id, date, status, marker_code, entry_code, hours_worked, overtime_hours, notes)
    VALUES (@employee_id, @date, @status, @marker_code, @entry_code, @hours_worked, @overtime_hours, @notes)
    ON CONFLICT(employee_id, date)
    DO UPDATE SET
      status = excluded.status,
      marker_code = excluded.marker_code,
      entry_code = excluded.entry_code,
      hours_worked = excluded.hours_worked,
      overtime_hours = excluded.overtime_hours,
      notes = excluded.notes,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    employee_id: entry.employee_id,
    date: entry.date,
    status: entry.status || 'presente',
    marker_code: entry.marker_code || null,
    entry_code: entry.entry_code || null,
    hours_worked: entry.hours_worked === '' || entry.hours_worked === undefined ? null : entry.hours_worked,
    overtime_hours: entry.overtime_hours ?? 0,
    notes: entry.notes || null,
  });

  return db.prepare(`
    SELECT *
    FROM attendance
    WHERE employee_id = ? AND date = ?
  `).get(entry.employee_id, entry.date);
}

function bulkUpsertAttendance(entries) {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO attendance (employee_id, date, status, marker_code, entry_code, hours_worked, overtime_hours, notes)
    VALUES (@employee_id, @date, @status, @marker_code, @entry_code, @hours_worked, @overtime_hours, @notes)
    ON CONFLICT(employee_id, date)
    DO UPDATE SET
      status = excluded.status,
      marker_code = excluded.marker_code,
      entry_code = excluded.entry_code,
      hours_worked = excluded.hours_worked,
      overtime_hours = excluded.overtime_hours,
      notes = excluded.notes,
      updated_at = CURRENT_TIMESTAMP
  `);

  const tx = db.transaction((rows) => {
    for (const entry of rows) {
      insert.run({
        employee_id: entry.employee_id,
        date: entry.date,
        status: entry.status || 'presente',
        marker_code: entry.marker_code || null,
        entry_code: entry.entry_code || null,
        hours_worked: entry.hours_worked === '' || entry.hours_worked === undefined ? null : entry.hours_worked,
        overtime_hours: entry.overtime_hours ?? 0,
        notes: entry.notes || null,
      });
    }
  });

  tx(entries);
  return { success: true, count: entries.length };
}

function getMonthlySummary(monthOrYear, maybeMonth) {
  const db = getDb();
  const { year, month } = parseMonthInput(monthOrYear, maybeMonth);

  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = `${year}-${String(month).padStart(2, '0')}-31`;

  const records = db.prepare(`
    SELECT 
      e.id AS employee_id,
      e.first_name,
      e.last_name,
      e.role,
      e.daily_pay,
      e.standard_hours,
      a.date,
      a.status,
      a.marker_code,
      a.entry_code,
      a.hours_worked,
      a.overtime_hours,
      a.notes
    FROM employees e
    LEFT JOIN attendance a
      ON a.employee_id = e.id
      AND a.date BETWEEN ? AND ?
    WHERE e.status = 'attivo'
      AND e.is_deleted = 0
    ORDER BY e.last_name, e.first_name, a.date
  `).all(from, to);

  return { records };
}

function getAttendanceMatrix(monthOrYear, maybeMonth) {
  const db = getDb();
  const { year, month } = parseMonthInput(monthOrYear, maybeMonth);

  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = `${year}-${String(month).padStart(2, '0')}-31`;

  const employees = db.prepare(`
    SELECT id, first_name, last_name, role, standard_hours
    FROM employees
    WHERE status = 'attivo'
      AND is_deleted = 0
    ORDER BY last_name, first_name
  `).all();

  const attendance = db.prepare(`
    SELECT employee_id, date, status, marker_code, entry_code, hours_worked, overtime_hours
    FROM attendance
    WHERE date BETWEEN ? AND ?
    ORDER BY date ASC
  `).all(from, to);

  return { employees, attendance, year, month };
}

function listAttendanceYears() {
  const db = getDb();
  return db.prepare(`
    SELECT DISTINCT CAST(substr(date, 1, 4) AS INTEGER) AS year
    FROM attendance
    WHERE date IS NOT NULL
      AND length(date) >= 4
    ORDER BY year DESC
  `).all()
    .map((row) => Number(row.year))
    .filter((year) => Number.isInteger(year) && year > 1900);
}

module.exports = {
  listAttendanceByMonth,
  saveAttendance,
  bulkUpsertAttendance,
  getMonthlySummary,
  getAttendanceMatrix,
  listAttendanceYears,
};
