import { MAIN_DAY_TYPES, LEGACY_DAY_TYPES } from './attendancePrintUtils';

function normalizeDecimalString(value) {
  return String(value || '').replace(',', '.').trim();
}

function parseSingleBoxHoursExpression(rawValue, attendanceSettings) {
  const value = String(rawValue || '').trim().toUpperCase();
  if (!value) {
    return { kind: 'empty' };
  }

  const parts = value
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);

  if (!parts.length) {
    return { kind: 'empty' };
  }

  let totalHours = 0;
  let usedSymbol = false;

  for (const part of parts) {
    if (
      attendanceSettings?.inputMode === 'hours_and_symbol' &&
      part === attendanceSettings.quickSymbol
    ) {
      totalHours += attendanceSettings.baseHours;
      usedSymbol = true;
      continue;
    }

    const numeric = Number(normalizeDecimalString(part));
    if (!Number.isFinite(numeric) || numeric < 0) {
      return { kind: 'invalid' };
    }

    totalHours += numeric;
  }

  if (totalHours <= 0) {
    return { kind: 'empty' };
  }

  return {
    kind: 'hours',
    hours: totalHours,
    usedSymbol,
    isComposite: parts.length > 1,
  };
}

export function parseMainInputValue(rawValue, attendanceSettings) {
  const value = String(rawValue || '').trim().toUpperCase();

  if (!value) {
    return { kind: 'empty' };
  }

  const mainType = MAIN_DAY_TYPES.find((item) => item.code === value);
  if (mainType) {
    return { kind: 'type', status: mainType.value };
  }

  if (
    attendanceSettings?.inputMode === 'hours_and_symbol' &&
    value === attendanceSettings.quickSymbol
  ) {
    return {
      kind: 'symbol',
      symbol: attendanceSettings.quickSymbol,
      hours: attendanceSettings.baseHours,
    };
  }

  const parsedExpression = parseSingleBoxHoursExpression(value, attendanceSettings);
  if (parsedExpression.kind === 'hours') {
    if (
      attendanceSettings?.inputMode === 'hours_and_symbol' &&
      attendanceSettings?.autoSymbolizeBaseHours &&
      !parsedExpression.isComposite &&
      !parsedExpression.usedSymbol &&
      parsedExpression.hours === attendanceSettings.baseHours
    ) {
      return {
        kind: 'symbol',
        symbol: attendanceSettings.quickSymbol,
        hours: attendanceSettings.baseHours,
      };
    }
    return { kind: 'hours', hours: parsedExpression.hours };
  }

  if (parsedExpression.kind === 'empty') {
    return { kind: 'empty' };
  }

  return { kind: 'invalid' };
}

export function formatDecimalPreview(value) {
  const normalized = normalizeDecimalString(value);
  if (!normalized) return '';
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) return '';

  const totalMinutes = Math.round(numeric * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return '0m';
}

export function getMainTypeMeta(status) {
  return [...MAIN_DAY_TYPES, ...LEGACY_DAY_TYPES].find((item) => item.value === status) || null;
}

export function selectAllInputText(event) {
  const input = event.currentTarget;
  if (!input?.value) return;
  input.select();
}

export function getAttendanceHoursTone(inputValue, attendanceSettings) {
  const parsed = parseMainInputValue(inputValue, attendanceSettings);
  if (parsed.kind === 'type') return 'special';
  if (parsed.kind !== 'hours' && parsed.kind !== 'symbol') return '';

  const baseHours = Number(attendanceSettings?.baseHours || 0);
  const hours = Number(parsed.hours || 0);
  const diff = hours - baseHours;

  if (hours === baseHours) return 'standard';
  if (diff === 1) return 'plus-one';
  if (diff >= 3 && diff <= 24) return 'high';
  return '';
}

export function getMainInputValue(att) {
  if (!att) return '';

  if (att.status && att.status !== 'presente' && att.status !== 'assente') {
    return getMainTypeMeta(att.status)?.code || '';
  }

  if (att.hours_worked === '' || att.hours_worked === null || att.hours_worked === undefined) {
    return '';
  }

  return att.entry_code ? String(att.entry_code) : String(att.hours_worked);
}

export function getCalendarHeaderStyle(dayInfo) {
  if (!dayInfo?.isSpecialDay) {
    return {};
  }

  return {
    background: dayInfo.isHoliday ? '#fee2e2' : '#fef2f2',
    color: '#991b1b',
    borderBottomColor: '#fecaca',
  };
}

export function getCalendarCellStyle(dayInfo) {
  if (!dayInfo?.isSpecialDay) {
    return {};
  }

  return {
    background: dayInfo.isHoliday ? '#fef2f2' : '#fff5f5',
  };
}

export function getDisplayedInputValue(inputDrafts, employeeId, date, field, fallbackValue) {
  const draftKey = `${employeeId}_${date}_${field}`;
  return inputDrafts[draftKey] ?? fallbackValue;
}
