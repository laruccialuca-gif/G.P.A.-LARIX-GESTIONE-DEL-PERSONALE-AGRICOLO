export function getSafeStandardHours(value) {
  const hours = Number(value || 7);
  return Number.isFinite(hours) && hours > 0 ? hours : 7;
}

export function formatHoursValue(totalHours, hoursFormat = 'decimal') {
  const safeHours = Number(totalHours || 0);

  if (safeHours <= 0) {
    return hoursFormat === 'hours_minutes' ? '0 h' : '0 h';
  }

  if (hoursFormat === 'hours_minutes') {
    const totalMinutes = Math.round(safeHours * 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!minutes) {
      return `${hours} h`;
    }
    return `${hours} h ${minutes} min`;
  }

  const normalized = Number.isInteger(safeHours) ? String(safeHours) : safeHours.toFixed(2).replace(/\.?0+$/, '');
  return `${normalized} h`;
}

export function formatWorkedSummary(totalHours, standardHours, hoursFormat = 'decimal') {
  const safeHours = Number(totalHours || 0);
  const safeStandardHours = getSafeStandardHours(standardHours);

  if (safeHours <= 0) {
    return '0 gg';
  }

  const fullDays = Math.floor(safeHours / safeStandardHours);
  const remainingHours = Number((safeHours % safeStandardHours).toFixed(2));

  if (remainingHours <= 0) {
    return `${fullDays} gg`;
  }

  if (fullDays <= 0) {
    return formatHoursValue(remainingHours, hoursFormat);
  }

  return `${fullDays} gg + ${formatHoursValue(remainingHours, hoursFormat)}`;
}

export function calculateAttendanceTotals(records = [], standardHours) {
  const safeStandardHours = getSafeStandardHours(standardHours);
  const totalRegularHours = records.reduce((sum, item) => sum + Number(item?.hours_worked || 0), 0);
  const totalOvertimeHours = records.reduce((sum, item) => sum + Number(item?.overtime_hours || 0), 0);
  const totalHours = totalRegularHours + totalOvertimeHours;

  return {
    standardHours: safeStandardHours,
    totalRegularHours,
    totalOvertimeHours,
    totalHours,
    completeDaysRegular: Math.floor(totalRegularHours / safeStandardHours),
    completeDaysOvertime: Math.floor(totalOvertimeHours / safeStandardHours),
    completeDaysTotal: Math.floor(totalHours / safeStandardHours),
    remainingRegularHours: Number((totalRegularHours % safeStandardHours).toFixed(2)),
    remainingOvertimeHours: Number((totalOvertimeHours % safeStandardHours).toFixed(2)),
    remainingTotalHours: Number((totalHours % safeStandardHours).toFixed(2)),
    workedSummary: formatWorkedSummary(totalHours, safeStandardHours),
  };
}
