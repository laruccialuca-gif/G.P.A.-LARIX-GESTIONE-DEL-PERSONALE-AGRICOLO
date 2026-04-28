function parseDateOnly(value, endOfDay = false) {
  const normalized = String(value || '').split('T')[0];
  if (!normalized) return null;
  const parsed = new Date(`${normalized}T${endOfDay ? '23:59:59' : '00:00:00'}`);
  const timestamp = parsed.getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function isDateRangeActiveInYear(startDate, endDate, year) {
  const yearStart = new Date(Number(year), 0, 1).getTime();
  const yearEnd = new Date(Number(year), 11, 31, 23, 59, 59, 999).getTime();
  const startRaw = String(startDate || '').trim();
  const endRaw = String(endDate || '').trim();
  const start = parseDateOnly(startDate, false);
  const end = parseDateOnly(endDate, true);

  if (startRaw && start === null) return false;
  if (endRaw && end === null) return false;

  return (start === null || start <= yearEnd) && (end === null || end >= yearStart);
}

export function getEmployeeYearPeriods(employee) {
  if (Array.isArray(employee?.employment_periods) && employee.employment_periods.length) {
    return employee.employment_periods;
  }

  return [{
    hire_date_from: employee?.hire_date_from || null,
    hire_date_to: employee?.hire_date_to || null,
  }];
}

export function employeeIsActiveInYear(employee, year) {
  return getEmployeeYearPeriods(employee).some((period) =>
    isDateRangeActiveInYear(period?.hire_date_from, period?.hire_date_to, year)
  );
}

function getPeriodSortStart(period) {
  return parseDateOnly(period?.hire_date_from, false) ?? Number.MIN_SAFE_INTEGER;
}

function getPeriodSortEnd(period) {
  return parseDateOnly(period?.hire_date_to, true) ?? Number.MAX_SAFE_INTEGER;
}

export function getEmployeePeriodsActiveInYear(employee, year) {
  return getEmployeeYearPeriods(employee).filter((period) =>
    isDateRangeActiveInYear(period?.hire_date_from, period?.hire_date_to, year)
  );
}

export function getEmployeePrimaryPeriodInYear(employee, year) {
  const periods = getEmployeePeriodsActiveInYear(employee, year);
  if (!periods.length) return null;

  return [...periods].sort((a, b) => {
    const endDiff = getPeriodSortEnd(b) - getPeriodSortEnd(a);
    if (endDiff !== 0) return endDiff;
    return getPeriodSortStart(b) - getPeriodSortStart(a);
  })[0];
}
