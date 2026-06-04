function normalizeAttendanceNamePart(value) {
  return String(value || '').trim();
}

export function formatAttendanceEmployeeDisplayName(employee) {
  if (!employee) return '';

  const lastName = normalizeAttendanceNamePart(employee.last_name);
  const firstName = normalizeAttendanceNamePart(employee.first_name);
  const combined = `${lastName} ${firstName}`.trim();
  if (combined) {
    return combined;
  }

  return String(employee.full_name || employee.name || '').trim();
}

export function compareAttendanceEmployees(left, right) {
  const leftLastName = normalizeAttendanceNamePart(left?.last_name);
  const rightLastName = normalizeAttendanceNamePart(right?.last_name);
  const lastNameCompare = leftLastName.localeCompare(rightLastName, 'it', { sensitivity: 'base' });
  if (lastNameCompare !== 0) {
    return lastNameCompare;
  }

  const leftFirstName = normalizeAttendanceNamePart(left?.first_name);
  const rightFirstName = normalizeAttendanceNamePart(right?.first_name);
  const firstNameCompare = leftFirstName.localeCompare(rightFirstName, 'it', { sensitivity: 'base' });
  if (firstNameCompare !== 0) {
    return firstNameCompare;
  }

  return formatAttendanceEmployeeDisplayName(left).localeCompare(
    formatAttendanceEmployeeDisplayName(right),
    'it',
    { sensitivity: 'base' }
  );
}
