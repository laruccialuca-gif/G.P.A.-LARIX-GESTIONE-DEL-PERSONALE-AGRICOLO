export function formatTodayLabel(date) {
  return date.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function parseIsoDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

export function diffDaysFromToday(dateValue, today = startOfToday()) {
  const date = parseIsoDate(dateValue);
  if (!date) return null;
  const normalized = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((normalized.getTime() - today.getTime()) / 86400000);
}

export function getExpiryVisualState(daysLeft) {
  if (daysLeft == null) return 'unknown';
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= 30) return 'warning';
  return 'ok';
}

export function buildExpiryItem({
  employee,
  label,
  expiry,
  required,
  done,
  today,
}) {
  if (!required && !done) return null;
  if (!expiry) return null;

  const daysLeft = diffDaysFromToday(expiry, today);

  return {
    employeeId: employee.id,
    employeeName: `${employee.first_name} ${employee.last_name}`.trim(),
    role: employee.role || '',
    label,
    expiry,
    daysLeft,
    state: getExpiryVisualState(daysLeft),
  };
}

export function sortExpiryItems(items) {
  return [...items].sort((a, b) => {
    if (a.daysLeft == null && b.daysLeft == null) return a.employeeName.localeCompare(b.employeeName);
    if (a.daysLeft == null) return 1;
    if (b.daysLeft == null) return -1;
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    return a.employeeName.localeCompare(b.employeeName);
  });
}

export function filterExpiryItems(items, filter) {
  if (filter === 'expired') {
    return items.filter((item) => item.daysLeft != null && item.daysLeft < 0);
  }
  if (filter === '30days') {
    return items.filter((item) => item.daysLeft != null && item.daysLeft <= 30);
  }
  return items;
}

export function buildMedicalExpiries(employees, today = startOfToday()) {
  return sortExpiryItems(
    employees
      .map((employee) =>
        buildExpiryItem({
          employee,
          label: 'Visita medica',
          expiry: employee.medical_visit_expiry,
          required: !!employee.medical_visit_required,
          done: !!employee.medical_visit_done,
          today,
        })
      )
      .filter(Boolean)
  );
}

export function buildTrainingExpiries(employees, today = startOfToday()) {
  return sortExpiryItems(
    employees
      .map((employee) =>
        buildExpiryItem({
          employee,
          label: 'Formazione Art. 37',
          expiry: employee.art37_expiry,
          required: !!employee.art37_required,
          done: !!employee.art37_done,
          today,
        })
      )
      .filter(Boolean)
  );
}

export function buildBalanceRows(rows) {
  return [...rows]
    .map((row) => {
      const totalCredit = Number(row.total_credit || 0);
      const totalDebit = Number(row.total_debit || 0);
      const finalBalance = Number(row.final_balance || 0);

      return {
        employeeId: row.employee_id,
        employeeName: `${row.first_name} ${row.last_name}`.trim(),
        totalCredit,
        totalDebit,
        finalBalance,
      };
    })
    .sort((a, b) => Math.abs(b.finalBalance) - Math.abs(a.finalBalance) || a.employeeName.localeCompare(b.employeeName));
}

export function filterBalanceRows(rows, filter) {
  if (filter === 'nonzero') {
    return rows.filter((row) => row.finalBalance !== 0);
  }
  return rows;
}

export function formatDaysLeft(daysLeft) {
  if (daysLeft == null) return 'Data non valida';
  if (daysLeft < 0) return `${Math.abs(daysLeft)} gg fa`;
  if (daysLeft === 0) return 'Oggi';
  return `Tra ${daysLeft} gg`;
}

export function getBalanceVisualState(finalBalance) {
  if (finalBalance > 0) return 'credit';
  if (finalBalance < 0) return 'debit';
  return 'neutral';
}
