import { formatHoursValue, formatWorkedSummary } from './attendanceSummary';

export const MAIN_DAY_TYPES = [
  { value: 'ferie', code: 'F', text: 'Ferie' },
  { value: 'permesso', code: 'P', text: 'Permesso' },
  { value: 'malattia', code: 'M', text: 'Malattia' },
];

export const LEGACY_DAY_TYPES = [
  { value: 'infortunio', code: 'I', text: 'Infortunio' },
  { value: 'riposo', code: 'R', text: 'Riposo/Festivo' },
];

export const DEFAULT_DAY_MARKERS = [
  {
    value: 'P',
    text: 'Piselli',
    symbol: '🌱',
    image: '',
    color: '#166534',
    background: 'rgba(34, 197, 94, 0.16)',
  },
  {
    value: 'C',
    text: 'Ciliegie',
    symbol: '🍒',
    image: '',
    color: '#b91c1c',
    background: 'rgba(239, 68, 68, 0.16)',
  },
];

export function resolveMarkerImageSrc(imagePath) {
  const value = String(imagePath || '').trim();
  if (!value) return '';
  if (/^(https?:|data:|file:|blob:)/i.test(value)) return value;
  if (value.startsWith('/assets/')) return `.${value}`;
  if (/^[A-Za-z]:\\/.test(value)) {
    return encodeURI(`file:///${value.replace(/\\/g, '/')}`);
  }
  if (value.startsWith('/')) {
    return encodeURI(`file://${value}`);
  }
  return value;
}

export function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDate(date) {
  return formatLocalDate(date);
}

export function fileMonthLabel(date) {
  const raw = date.toLocaleDateString('it-IT', {
    month: 'long',
    year: 'numeric',
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

export function getDayLabel(date) {
  return date.toLocaleDateString('it-IT', { weekday: 'short' });
}

export function getMarkerMeta(markerCode, markers = DEFAULT_DAY_MARKERS) {
  return (markers || []).find((item) => item.value === markerCode) || null;
}

export function getAttendancePrintMainValue(att, hoursFormat = 'decimal') {
  if (!att) return '';

  if (att.status && att.status !== 'presente' && att.status !== 'assente') {
    const special = [...MAIN_DAY_TYPES, ...LEGACY_DAY_TYPES].find((item) => item.value === att.status);
    return special?.code || att.status;
  }

  if (att.entry_code) {
    return String(att.entry_code);
  }

  const mainHours =
    att.hours_worked !== undefined && att.hours_worked !== null && att.hours_worked !== ''
      ? formatHoursValue(att.hours_worked, hoursFormat)
      : '';
  return mainHours || '';
}

export function getAttendancePrintOvertimeValue(att, hoursFormat = 'decimal') {
  if (!att) return '';
  if (att.status && att.status !== 'presente' && att.status !== 'assente') {
    return '';
  }

  const overtimeHours = Number(att.overtime_hours || 0);
  return overtimeHours > 0 ? formatHoursValue(overtimeHours, hoursFormat) : '';
}

export function getAttendancePrintMarkerValue(att, markers = DEFAULT_DAY_MARKERS) {
  if (!att?.marker_code) return '';
  const markerMeta = getMarkerMeta(att.marker_code, markers);
  return markerMeta || null;
}

export function formatCompactWorkedSummary(totalHours, standardHours, hoursFormat = 'decimal') {
  const full = formatWorkedSummary(totalHours, standardHours, hoursFormat);
  return full
    .replace(/\s*gg/g, 'g')
    .replace(/\s*h/g, 'h')
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getAttendancePrintRowWeight(row) {
  let weight = 1;
  if (row?.employee?.role) weight += 0.22;
  if (row?.teamMember?.manage_by_days) weight += 0.18;
  return weight;
}

export function rebalanceAttendancePrintPages(pages, firstCapacity, otherCapacity) {
  if (pages.length < 2) {
    return pages;
  }

  const next = pages.map((page) => ({ ...page, rows: [...page.rows] }));

  for (let index = next.length - 1; index > 0; index -= 1) {
    const page = next[index];
    const previous = next[index - 1];
    const minimumWeight = index === 0 ? firstCapacity * 0.4 : otherCapacity * 0.4;
    const previousCapacity = index - 1 === 0 ? firstCapacity : otherCapacity;

    while (
      page.weight < minimumWeight &&
      previous.rows.length > 1
    ) {
      const candidate = previous.rows[previous.rows.length - 1];
      const candidateWeight = getAttendancePrintRowWeight(candidate);
      if (previous.weight - candidateWeight < previousCapacity * 0.58) {
        break;
      }

      previous.rows.pop();
      previous.weight -= candidateWeight;
      page.rows.unshift(candidate);
      page.weight += candidateWeight;
    }
  }

  return next;
}

export function paginateAttendancePrintRows(rows) {
  const firstPageCapacity = 12.4;
  const otherPageCapacity = 14.2;
  const pages = [];

  let currentRows = [];
  let currentWeight = 0;
  let currentCapacity = firstPageCapacity;

  rows.forEach((row) => {
    const rowWeight = getAttendancePrintRowWeight(row);
    const wouldOverflow = currentRows.length > 0 && currentWeight + rowWeight > currentCapacity;

    if (wouldOverflow) {
      pages.push({ rows: currentRows, weight: currentWeight });
      currentRows = [];
      currentWeight = 0;
      currentCapacity = otherPageCapacity;
    }

    currentRows.push(row);
    currentWeight += rowWeight;
  });

  if (currentRows.length) {
    pages.push({ rows: currentRows, weight: currentWeight });
  }

  const normalized = pages.length ? pages : [{ rows: [], weight: 0 }];
  return rebalanceAttendancePrintPages(normalized, firstPageCapacity, otherPageCapacity);
}
