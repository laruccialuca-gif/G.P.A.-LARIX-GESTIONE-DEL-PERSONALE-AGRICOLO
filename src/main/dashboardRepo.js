const { getDb } = require('./db');

function getTodayString() {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentMonthString() {
  return getTodayString().slice(0, 7);
}

function listActiveEmployees() {
  const db = getDb();

  return db.prepare(`
    SELECT *
    FROM employees
    WHERE is_deleted = 0
      AND status <> 'inattivo'
    ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE
  `).all();
}

function listTodayAttendance(today) {
  const db = getDb();

  return db.prepare(`
    SELECT a.*, e.first_name, e.last_name, e.role
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    WHERE a.date = ?
      AND e.is_deleted = 0
      AND e.status <> 'inattivo'
    ORDER BY e.last_name COLLATE NOCASE, e.first_name COLLATE NOCASE
  `).all(today);
}

function listPayrollBalanceRows() {
  const db = getDb();

  return db.prepare(`
    SELECT
      e.id AS employee_id,
      e.first_name,
      e.last_name,
      SUM(CASE WHEN pr.differenza_finale < 0 THEN ABS(pr.differenza_finale) ELSE 0 END) AS total_credit,
      SUM(CASE WHEN pr.differenza_finale > 0 THEN pr.differenza_finale ELSE 0 END) AS total_debit,
      SUM(CASE WHEN pr.differenza_finale IS NOT NULL THEN -pr.differenza_finale ELSE 0 END) AS final_balance
    FROM employees e
    LEFT JOIN payroll_records pr ON pr.employee_id = e.id
    WHERE e.is_deleted = 0
      AND e.status <> 'inattivo'
    GROUP BY e.id, e.first_name, e.last_name
    ORDER BY e.last_name COLLATE NOCASE, e.first_name COLLATE NOCASE
  `).all();
}

function getDashboardSummary() {
  const today = getTodayString();

  return {
    today,
    month: getCurrentMonthString(),
    employees: listActiveEmployees(),
    todayAttendance: listTodayAttendance(today),
    payrollBalances: listPayrollBalanceRows(),
  };
}

module.exports = {
  getDashboardSummary,
};
