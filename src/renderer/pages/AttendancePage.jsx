import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calculateAttendanceTotals, formatHoursValue, formatWorkedSummary, getSafeStandardHours } from '../utils/attendanceSummary';
import { getCalendarDayInfo } from '../utils/holidays';
import QuickAttendanceModal from '../components/QuickAttendanceModal';
import { useYearContext } from '../context/YearContext';
import { employeeIsActiveInYear } from '../utils/yearScope';

const MAIN_DAY_TYPES = [
  { value: 'ferie', code: 'F', text: 'Ferie' },
  { value: 'permesso', code: 'P', text: 'Permesso' },
  { value: 'malattia', code: 'M', text: 'Malattia' },
];

const LEGACY_DAY_TYPES = [
  { value: 'infortunio', code: 'I', text: 'Infortunio' },
  { value: 'riposo', code: 'R', text: 'Riposo/Festivo' },
];

const DEFAULT_DAY_MARKERS = [
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

const ATTENDANCE_LAYOUT_STORAGE_KEY = 'attendance_layout_mode_v1';
const EMPTY_ROW_ATTENDANCE = Object.freeze({});

function getPerfNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function logAttendancePerf(event, details = {}) {
  if (typeof console === 'undefined' || typeof console.info !== 'function') {
    return;
  }

  console.info('[attendance-perf]', {
    event,
    ...details,
  });
}

function normalizeAttendanceLayoutMode(value) {
  return value === 'compact' ? 'compact' : 'standard';
}

function getConfiguredDayMarkers(settings) {
  const configured = settings?.general?.attendance_markers;
  if (!Array.isArray(configured) || !configured.length) {
    return DEFAULT_DAY_MARKERS.map((marker) => ({ ...marker, active: true }));
  }

  return configured.map((marker, index) => ({
    value: String(marker?.value || `MARKER_${index + 1}`).toUpperCase(),
    text: String(marker?.text || `Marker ${index + 1}`),
    symbol: String(marker?.symbol || '•'),
    image: String(marker?.image || ''),
    color: String(marker?.color || '#27445f'),
    background: String(marker?.background || 'rgba(20, 33, 61, 0.08)'),
    active: marker?.active !== false,
  }));
}

function resolveMarkerImageSrc(imagePath) {
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

function getMonthDays(currentMonth) {
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const days = [];

  for (let day = 1; day <= lastDay; day++) {
    days.push(new Date(year, month, day));
  }

  return days;
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDate(date) {
  return formatLocalDate(date);
}

function monthString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function isSameMonth(date, monthDate) {
  return (
    date.getFullYear() === monthDate.getFullYear() &&
    date.getMonth() === monthDate.getMonth()
  );
}

function fileMonthLabel(date) {
  const raw = date.toLocaleDateString('it-IT', {
    month: 'long',
    year: 'numeric',
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function sanitizeFileName(value) {
  return value.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
}

function getDayLabel(date) {
  return date.toLocaleDateString('it-IT', { weekday: 'short' });
}

function getAttendancePrintMainValue(att, hoursFormat = 'decimal') {
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

function getAttendancePrintOvertimeValue(att, hoursFormat = 'decimal') {
  if (!att) return '';
  if (att.status && att.status !== 'presente' && att.status !== 'assente') {
    return '';
  }

  const overtimeHours = Number(att.overtime_hours || 0);
  return overtimeHours > 0 ? formatHoursValue(overtimeHours, hoursFormat) : '';
}

function getAttendancePrintMarkerValue(att, markers = DEFAULT_DAY_MARKERS) {
  if (!att?.marker_code) return '';
  const markerMeta = getMarkerMeta(att.marker_code, markers);
  return markerMeta || null;
}

function getSpecialTypeText(status) {
  return [...MAIN_DAY_TYPES, ...LEGACY_DAY_TYPES].find((item) => item.value === status)?.text || status;
}

function normalizeAttendanceEntry(item) {
  const rawHours = item.hours_worked;
  const markerCode = item.marker_code ? String(item.marker_code).trim().toUpperCase() : null;
  const computedStatus =
    item.status ||
    (rawHours === '' || rawHours === null || rawHours === undefined
      ? 'presente'
      : Number(rawHours || 0) === 0
      ? 'assente'
      : 'presente');
  const hoursWorked =
    rawHours === '' ||
    rawHours === null ||
    rawHours === undefined ||
    (Number(rawHours || 0) === 0 && computedStatus === 'presente' && markerCode)
      ? ''
      : Number(rawHours || 0);

  return {
    ...item,
    status: computedStatus,
    marker_code: markerCode,
    entry_code: item.entry_code ? String(item.entry_code).trim().toUpperCase() : null,
    hours_worked: hoursWorked,
    overtime_hours: Number(item.overtime_hours || 0),
    notes: item.notes || null,
  };
}

function parseSelection(value) {
  if (!value || value === 'all') {
    return { type: 'all', id: null };
  }

  if (value === 'no_team') {
    return { type: 'no_team', id: null };
  }

  const [type, id] = String(value).split(':');
  return { type, id: Number(id) };
}

function buildTeamRows(team, year) {
  return (team?.members || [])
    .filter((member) =>
      member.employee &&
      !member.employee.is_deleted &&
      employeeIsActiveInYear(member.employee, year)
    )
    .map((member) => ({
      employee: member.employee,
      teamMember: member,
    }));
}

function buildTeamMemberEmployeeIdsSet(teams = [], year) {
  const employeeIds = new Set();
  for (const team of teams || []) {
    for (const row of buildTeamRows(team, year)) {
      employeeIds.add(Number(row.employee.id));
    }
  }
  return employeeIds;
}

function sameNumberArray(left = [], right = []) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => Number(value) === Number(right[index]));
}

function parseDateValue(value) {
  const [year, month, day] = String(value || '').split('-');
  if (!year || !month) return null;
  return new Date(Number(year), Number(month) - 1, Number(day || 1));
}

function shiftLocalDateString(value, dayOffset) {
  const parsed = parseDateValue(value);
  if (!parsed) return '';
  parsed.setDate(parsed.getDate() + dayOffset);
  return formatLocalDate(parsed);
}

function formatIsoDateLabel(value) {
  const parsed = parseDateValue(value);
  return parsed ? parsed.toLocaleDateString('it-IT') : '—';
}

function formatBulkFieldSummary({ hours, markerLabel, overtime }) {
  const parts = [];
  if (hours) {
    parts.push(`${hours} ore`);
  }
  if (markerLabel) {
    parts.push(`marker ${markerLabel}`);
  }
  if (overtime) {
    parts.push(`${overtime} straordinario`);
  }
  return parts.join(', ');
}

function getMarkerMeta(markerCode, markers = DEFAULT_DAY_MARKERS) {
  return (markers || []).find((item) => item.value === markerCode) || null;
}

function getMainTypeMeta(status) {
  return [...MAIN_DAY_TYPES, ...LEGACY_DAY_TYPES].find((item) => item.value === status) || null;
}

function selectAllInputText(event) {
  const input = event.currentTarget;
  if (!input?.value) return;
  input.select();
}

function normalizeDecimalString(value) {
  return String(value || '').replace(',', '.').trim();
}

function formatDecimalPreview(value) {
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

function getAttendanceHoursTone(inputValue, attendanceSettings) {
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

function splitHoursToParts(hoursValue) {
  if (hoursValue === '' || hoursValue === null || hoursValue === undefined || Number(hoursValue) === 0) {
    return { hours: '', minutes: '' };
  }

  const totalMinutes = Math.round(Number(hoursValue) * 60);
  const normalizedHours = Math.floor(totalMinutes / 60);
  const normalizedMinutes = totalMinutes % 60;

  return {
    hours: String(normalizedHours),
    minutes: normalizedMinutes ? String(normalizedMinutes) : '',
  };
}

function getMainInputValue(att) {
  if (!att) return '';

  if (att.status && att.status !== 'presente' && att.status !== 'assente') {
    return getMainTypeMeta(att.status)?.code || '';
  }

  if (att.hours_worked === '' || att.hours_worked === null || att.hours_worked === undefined) {
    return '';
  }

  return att.entry_code ? String(att.entry_code) : String(att.hours_worked);
}

function getHoursMinutesInputValue(att) {
  if (!att) return { hours: '', minutes: '' };

  if (att.status && att.status !== 'presente' && att.status !== 'assente') {
    return {
      hours: getMainTypeMeta(att.status)?.code || '',
      minutes: '',
    };
  }

  if (att.entry_code) {
    return { hours: String(att.entry_code), minutes: '' };
  }

  return splitHoursToParts(att.hours_worked);
}

function getAttendanceSettings(settings) {
  return {
    inputMode: settings?.general?.attendance_entry_mode === 'hours_only' ? 'hours_only' : 'hours_and_symbol',
    hoursFormat: 'decimal',
    quickSymbol: String(settings?.general?.attendance_quick_symbol || 'X').trim().toUpperCase().slice(0, 3) || 'X',
    baseHours: getSafeStandardHours(settings?.general?.standard_day_hours),
    autoSymbolizeBaseHours: !!settings?.general?.attendance_auto_symbolize_base_hours,
  };
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

function parseMainInputValue(rawValue, attendanceSettings) {
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

function parseOvertimeInputValue(rawValue, attendanceSettings) {
  const parsed = parseMainInputValue(rawValue, attendanceSettings);
  if (parsed.kind === 'type') {
    return { kind: 'invalid' };
  }
  return parsed;
}

function formatCompactWorkedSummary(totalHours, standardHours, hoursFormat = 'decimal') {
  const full = formatWorkedSummary(totalHours, standardHours, hoursFormat);
  return full
    .replace(/\s*gg/g, 'g')
    .replace(/\s*h/g, 'h')
    .replace(/\s*\+\s*/g, '+')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAttendancePrintRowWeight(row) {
  let weight = 1;
  if (row?.employee?.role) weight += 0.22;
  if (row?.teamMember?.manage_by_days) weight += 0.18;
  return weight;
}

function rebalanceAttendancePrintPages(pages, firstCapacity, otherCapacity) {
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

function paginateAttendancePrintRows(rows) {
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

function isEffectivelyEmptyAttendanceEntry(item) {
  const normalized = normalizeAttendanceEntry(item || {});
  return (
    normalized.status === 'presente' &&
    !normalized.marker_code &&
    !normalized.entry_code &&
    (normalized.hours_worked === '' || normalized.hours_worked === null || normalized.hours_worked === undefined) &&
    Number(normalized.overtime_hours || 0) === 0 &&
    !normalized.notes
  );
}

function areAttendanceEntriesEquivalent(a, b) {
  const left = normalizeAttendanceEntry(a || {});
  const right = normalizeAttendanceEntry(b || {});
  return (
    left.employee_id === right.employee_id &&
    left.date === right.date &&
    left.status === right.status &&
    (left.marker_code || null) === (right.marker_code || null) &&
    (left.entry_code || null) === (right.entry_code || null) &&
    (left.hours_worked === '' ? '' : Number(left.hours_worked || 0)) === (right.hours_worked === '' ? '' : Number(right.hours_worked || 0)) &&
    Number(left.overtime_hours || 0) === Number(right.overtime_hours || 0) &&
    (left.notes || null) === (right.notes || null)
  );
}

export default function AttendancePage() {
  const { selectedYear, setSelectedYear } = useYearContext();
  const [currentMonth, setCurrentMonth] = useState(() => new Date(selectedYear, new Date().getMonth(), 1));
  const [layoutMode, setLayoutMode] = useState(() => {
    if (typeof window === 'undefined') {
      return 'standard';
    }
    return normalizeAttendanceLayoutMode(window.localStorage.getItem(ATTENDANCE_LAYOUT_STORAGE_KEY));
  });
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [settings, setSettings] = useState(null);
  const [selectedEntity, setSelectedEntity] = useState('all');
  const [pendingChanges, setPendingChanges] = useState({});
  const [inputDrafts, setInputDrafts] = useState({});
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([]);
  const [bulkHoursValue, setBulkHoursValue] = useState('');
  const [bulkMarkerValue, setBulkMarkerValue] = useState('');
  const [bulkOvertimeValue, setBulkOvertimeValue] = useState('');
  const [bulkOverwrite, setBulkOverwrite] = useState(false);
  const [bulkTargetDate, setBulkTargetDate] = useState(formatLocalDate(new Date()));
  const [bulkApplyFeedback, setBulkApplyFeedback] = useState('');
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [attendanceLoading, setAttendanceLoading] = useState(true);
  const [saveState, setSaveState] = useState('idle');
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [quickEntryDate, setQuickEntryDate] = useState(formatLocalDate(new Date()));
  const [showHoursLegend, setShowHoursLegend] = useState(false);
  const [liveHoursPreview, setLiveHoursPreview] = useState('');
  const [openMarkerMenuKey, setOpenMarkerMenuKey] = useState(null);
  const [compactOvertimeEditorKey, setCompactOvertimeEditorKey] = useState(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const [printSelectionMode, setPrintSelectionMode] = useState('all');
  const printAreaRef = useRef(null);
  const tableShellRef = useRef(null);
  const horizontalScrollbarRef = useRef(null);
  const horizontalScrollbarContentRef = useRef(null);
  const horizontalScrollSyncRef = useRef(false);
  const attendanceRowsCacheRef = useRef(new Map());
  const pageLoadStartedAtRef = useRef(getPerfNow());

  const daysInMonth = useMemo(() => getMonthDays(currentMonth), [currentMonth]);
  const dayKeys = useMemo(() => daysInMonth.map((day) => formatDate(day)), [daysInMonth]);
  const dayInfoMap = useMemo(
    () => Object.fromEntries(daysInMonth.map((day, index) => [dayKeys[index], getCalendarDayInfo(day)])),
    [dayKeys, daysInMonth]
  );
  const currentMonthKey = monthString(currentMonth);
  const pendingChangesRef = useRef({});
  const isSavingRef = useRef(false);
  const statusTimeoutRef = useRef(null);
  const bulkFeedbackTimeoutRef = useRef(null);
  const [licenseStatus, setLicenseStatus] = useState(null);
  const isWriteBlockedRef = useRef(false);
  const lastLicenseErrorRef = useRef(0);

  const loading = directoryLoading || attendanceLoading;
  const loadingMessage = directoryLoading
    ? 'Caricamento anagrafica presenze...'
    : 'Caricamento presenze mese...';

  async function loadDirectoryData() {
    const startedAt = getPerfNow();
    setDirectoryLoading(true);
    logAttendancePerf('page:directory-load:start', {
      month: currentMonthKey,
      selected_entity: selectedEntity,
    });
    try {
      const employeesStartedAt = getPerfNow();
      const employeeData = await window.api.employees.list();
      logAttendancePerf('page:load-employees:end', {
        count: Array.isArray(employeeData) ? employeeData.length : 0,
        duration_ms: Math.round(getPerfNow() - employeesStartedAt),
      });

      const teamsStartedAt = getPerfNow();
      const teamData = await window.api.teams.list();
      logAttendancePerf('page:load-teams:end', {
        count: Array.isArray(teamData) ? teamData.length : 0,
        duration_ms: Math.round(getPerfNow() - teamsStartedAt),
      });

      const settingsStartedAt = getPerfNow();
      const settingsData = await window.api.settings.get();
      logAttendancePerf('page:load-settings:end', {
        duration_ms: Math.round(getPerfNow() - settingsStartedAt),
      });

      setEmployees(employeeData || []);
      setTeams(teamData || []);
      setSettings(settingsData || null);
    } catch (err) {
      console.error(err);
      alert('Errore caricamento presenze');
    } finally {
      const durationMs = Math.round(getPerfNow() - startedAt);
      logAttendancePerf('page:directory-load:end', {
        duration_ms: durationMs,
      });
      setDirectoryLoading(false);
    }
  }

  async function loadAttendanceMonthData() {
    const startedAt = getPerfNow();
    const daysCount = dayKeys.length;
    setAttendanceLoading(true);
    pageLoadStartedAtRef.current = startedAt;
    logAttendancePerf('page:month-load:start', {
      month: currentMonthKey,
      selected_entity: selectedEntity,
      days_count: daysCount,
    });

    try {
      const attendanceStartedAt = getPerfNow();
      const data = await window.api.attendance.listByMonth(
        currentMonth.getFullYear(),
        currentMonth.getMonth() + 1
      );
      const normalizedAttendance = (data || []).map(normalizeAttendanceEntry);
      logAttendancePerf('page:load-attendance-month:end', {
        month: currentMonthKey,
        records_count: normalizedAttendance.length,
        days_count: daysCount,
        duration_ms: Math.round(getPerfNow() - attendanceStartedAt),
      });

      setAttendance(normalizedAttendance);
      setPendingChanges({});
      setInputDrafts({});
      setSelectedEmployeeIds([]);
      setBulkApplyFeedback('');
      pendingChangesRef.current = {};
    } catch (err) {
      console.error(err);
      alert('Errore caricamento presenze');
    } finally {
      const durationMs = Math.round(getPerfNow() - startedAt);
      logAttendancePerf('page:month-load:end', {
        month: currentMonthKey,
        duration_ms: durationMs,
      });
      setAttendanceLoading(false);
    }
  }

  useEffect(() => {
    loadDirectoryData();
  }, []);

  useEffect(() => {
    loadAttendanceMonthData();
  }, [currentMonthKey]);

  useEffect(() => {
    setCurrentMonth((current) => {
      if (current.getFullYear() === selectedYear) {
        return current;
      }
      return new Date(selectedYear, current.getMonth(), 1);
    });
  }, [selectedYear]);

  useEffect(() => {
    pendingChangesRef.current = pendingChanges;
  }, [pendingChanges]);

  useEffect(() => {
    if (!Object.keys(pendingChanges).length && saveState === 'dirty' && !isSavingRef.current) {
      setSaveState('idle');
    }
  }, [pendingChanges, saveState]);

  useEffect(() => {
    // Debounce unico per il buffer locale: finche l'utente digita, aggiorniamo lo stato
    // ma salviamo sul backend solo dopo una breve pausa.
    if (!Object.keys(pendingChanges).length) {
      return undefined;
    }

    const timer = setTimeout(() => {
      flushPendingChanges();
    }, 500);

    return () => clearTimeout(timer);
  }, [pendingChanges]);

  useEffect(() => () => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    if (bulkFeedbackTimeoutRef.current) {
      clearTimeout(bulkFeedbackTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    setOpenMarkerMenuKey(null);
  }, [selectedEntity, currentMonthKey, layoutMode]);

  useEffect(() => {
    setCompactOvertimeEditorKey(null);
  }, [selectedEntity, currentMonthKey, layoutMode]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(ATTENDANCE_LAYOUT_STORAGE_KEY, layoutMode);
  }, [layoutMode]);

  const isWriteBlocked = Boolean(licenseStatus?.is_write_blocked);

  useEffect(() => {
    isWriteBlockedRef.current = isWriteBlocked;
  }, [isWriteBlocked]);

  useEffect(() => {
    if (!isWriteBlocked) return;
    setPendingChanges({});
    pendingChangesRef.current = {};
    setInputDrafts({});
    setSaveState('idle');
  }, [isWriteBlocked]);

  useEffect(() => {
    let cancelled = false;
    async function fetchLicense() {
      try {
        const status = await window.api.license.getStatus();
        if (!cancelled) setLicenseStatus(status || null);
      } catch {
        // non-critical
      }
    }
    fetchLicense();
    const interval = setInterval(fetchLicense, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const activeEmployees = useMemo(
    () => employees.filter((employee) =>
      employee.status === 'attivo' &&
      !employee.is_deleted &&
      employeeIsActiveInYear(employee, selectedYear)
    ),
    [employees, selectedYear]
  );
  const attendanceSettings = useMemo(() => getAttendanceSettings(settings), [settings]);
  const availableMarkers = useMemo(() => getConfiguredDayMarkers(settings), [settings]);
  const activeMarkers = useMemo(
    () => availableMarkers.filter((marker) => marker.active !== false),
    [availableMarkers]
  );

  const selectedMeta = useMemo(() => parseSelection(selectedEntity), [selectedEntity]);
  const visibleTeams = useMemo(
    () => teams.filter((team) => buildTeamRows(team, selectedYear).length > 0),
    [teams, selectedYear]
  );
  const groupedEmployeeIds = useMemo(
    () => buildTeamMemberEmployeeIdsSet(visibleTeams, selectedYear),
    [visibleTeams, selectedYear]
  );
  const employeesWithoutTeam = useMemo(
    () => activeEmployees.filter((employee) => !groupedEmployeeIds.has(Number(employee.id))),
    [activeEmployees, groupedEmployeeIds]
  );
  const visibleTeamCounts = useMemo(
    () => new Map(visibleTeams.map((team) => [Number(team.id), buildTeamRows(team, selectedYear).length])),
    [visibleTeams, selectedYear]
  );
  const selectedTeam = useMemo(
    () => selectedMeta.type === 'team'
      ? visibleTeams.find((team) => Number(team.id) === selectedMeta.id) || null
      : null,
    [selectedMeta.type, selectedMeta.id, visibleTeams]
  );

  const displayRows = useMemo(() => {
    const startedAt = getPerfNow();
    let rows;

    if (selectedMeta.type === 'employee') {
      const employee = activeEmployees.find((item) => Number(item.id) === selectedMeta.id);
      rows = employee ? [{ employee, teamMember: null }] : [];
    } else if (selectedMeta.type === 'team') {
      rows = buildTeamRows(selectedTeam, selectedYear);
    } else if (selectedMeta.type === 'no_team') {
      rows = employeesWithoutTeam.map((employee) => ({
        employee,
        teamMember: null,
      }));
    } else {
      rows = activeEmployees.map((employee) => ({
        employee,
        teamMember: null,
      }));
    }

    logAttendancePerf('page:build-displayRows:end', {
      selected_entity: selectedEntity,
      selected_type: selectedMeta.type,
      rows_count: rows.length,
      active_employees_count: activeEmployees.length,
      duration_ms: Math.round(getPerfNow() - startedAt),
    });

    return rows;
  }, [activeEmployees, employeesWithoutTeam, selectedEntity, selectedMeta, selectedTeam, selectedYear]);

  const visibleEmployeeIds = useMemo(
    () => displayRows.map(({ employee }) => Number(employee.id)).filter(Number.isFinite),
    [displayRows]
  );

  useEffect(() => {
    if (selectedMeta.type === 'employee' && !activeEmployees.some((employee) => Number(employee.id) === selectedMeta.id)) {
      setSelectedEntity('all');
      return;
    }

    if (selectedMeta.type === 'team' && !visibleTeams.some((team) => Number(team.id) === selectedMeta.id)) {
      setSelectedEntity('all');
      return;
    }

    if (selectedMeta.type === 'no_team' && employeesWithoutTeam.length === 0) {
      setSelectedEntity('all');
    }
  }, [selectedMeta.type, selectedMeta.id, activeEmployees, employeesWithoutTeam.length, visibleTeams]);

  useEffect(() => {
    setSelectedEmployeeIds((current) => {
      const next = current.filter((employeeId) => visibleEmployeeIds.includes(Number(employeeId)));
      return sameNumberArray(current, next) ? current : next;
    });
  }, [visibleEmployeeIds]);

  useEffect(() => {
    const normalizedTargetDate = getDefaultQuickDateForMonth(currentMonth);
    const isDateInCurrentMonth = daysInMonth.some((day) => formatDate(day) === bulkTargetDate);
    if (!isDateInCurrentMonth) {
      setBulkTargetDate(normalizedTargetDate);
    }
  }, [bulkTargetDate, currentMonth, daysInMonth]);

  useEffect(() => {
    const tableShell = tableShellRef.current;
    const horizontalScrollbar = horizontalScrollbarRef.current;
    const horizontalScrollbarContent = horizontalScrollbarContentRef.current;
    const startedAt = getPerfNow();

    if (!tableShell || !horizontalScrollbar || !horizontalScrollbarContent) {
      return undefined;
    }

    const syncSizes = () => {
      const needsHorizontalScroll = tableShell.scrollWidth > tableShell.clientWidth + 1;
      horizontalScrollbarContent.style.width = `${tableShell.scrollWidth}px`;
      horizontalScrollbar.style.display = needsHorizontalScroll ? 'block' : 'none';

      if (Math.abs(horizontalScrollbar.scrollLeft - tableShell.scrollLeft) > 1) {
        horizontalScrollbar.scrollLeft = tableShell.scrollLeft;
      }
    };

    const handleTableShellScroll = () => {
      if (horizontalScrollSyncRef.current) {
        return;
      }

      horizontalScrollSyncRef.current = true;
      horizontalScrollbar.scrollLeft = tableShell.scrollLeft;
      horizontalScrollSyncRef.current = false;
    };

    const handleHorizontalScrollbarScroll = () => {
      if (horizontalScrollSyncRef.current) {
        return;
      }

      horizontalScrollSyncRef.current = true;
      tableShell.scrollLeft = horizontalScrollbar.scrollLeft;
      horizontalScrollSyncRef.current = false;
    };

    syncSizes();
    logAttendancePerf('page:scrollbar-sync:init', {
      month: currentMonthKey,
      rows_count: displayRows.length,
      duration_ms: Math.round(getPerfNow() - startedAt),
      table_scroll_width: tableShell.scrollWidth,
      table_client_width: tableShell.clientWidth,
    });

    tableShell.addEventListener('scroll', handleTableShellScroll, { passive: true });
    horizontalScrollbar.addEventListener('scroll', handleHorizontalScrollbarScroll, { passive: true });

    const resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            syncSizes();
          })
        : null;

    resizeObserver?.observe(tableShell);

    const tableElement = tableShell.querySelector('table');
    if (tableElement) {
      resizeObserver?.observe(tableElement);
    }

    window.addEventListener('resize', syncSizes);

    return () => {
      tableShell.removeEventListener('scroll', handleTableShellScroll);
      horizontalScrollbar.removeEventListener('scroll', handleHorizontalScrollbarScroll);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', syncSizes);
    };
  }, [currentMonthKey, displayRows, loading, layoutMode]);

  const attendanceMap = useMemo(() => {
    const startedAt = getPerfNow();
    const map = {};
    for (const item of attendance) {
      map[`${item.employee_id}_${item.date}`] = item;
    }
    logAttendancePerf('page:build-attendanceMap:end', {
      records_count: attendance.length,
      duration_ms: Math.round(getPerfNow() - startedAt),
    });
    return map;
  }, [attendance]);

  const attendanceByEmployeeId = useMemo(() => {
    const map = new Map();
    for (const item of attendance) {
      const employeeId = Number(item.employee_id);
      const current = map.get(employeeId);
      if (current) {
        current[item.date] = item;
      } else {
        map.set(employeeId, { [item.date]: item });
      }
    }
    return map;
  }, [attendance]);

  const pendingChangesByEmployeeId = useMemo(() => {
    const map = new Map();
    for (const value of Object.values(pendingChanges)) {
      const employeeId = Number(value.employee_id);
      const current = map.get(employeeId);
      if (current) {
        current[value.date] = value;
      } else {
        map.set(employeeId, { [value.date]: value });
      }
    }
    return map;
  }, [pendingChanges]);

  const getAtt = (employeeId, date) => {
    const key = `${employeeId}_${date}`;
    return pendingChanges[key] !== undefined ? pendingChanges[key] : attendanceMap[key];
  };

  const attendanceRowsData = useMemo(
    () => {
      const startedAt = getPerfNow();
      const previousCache = attendanceRowsCacheRef.current;
      const nextCache = new Map();
      const rows = displayRows.map(({ employee, teamMember }) => {
        const employeeId = Number(employee.id);
        const baseAttendance = attendanceByEmployeeId.get(employeeId) || EMPTY_ROW_ATTENDANCE;
        const pendingAttendance = pendingChangesByEmployeeId.get(employeeId) || EMPTY_ROW_ATTENDANCE;
        const memberRecords = dayKeys.map((dateStr) =>
          pendingAttendance[dateStr] !== undefined ? pendingAttendance[dateStr] : baseAttendance[dateStr]
        );
        const effectiveAttendance = pendingAttendance === EMPTY_ROW_ATTENDANCE
          ? baseAttendance
          : { ...baseAttendance, ...pendingAttendance };
        const totals = calculateAttendanceTotals(memberRecords, attendanceSettings.baseHours);
        const previousRow = previousCache.get(employeeId);

        if (
          previousRow &&
          previousRow.employee === employee &&
          previousRow.teamMember === teamMember &&
          previousRow.effectiveAttendance === effectiveAttendance &&
          previousRow.totals?.totalHours === totals.totalHours &&
          previousRow.totals?.standardHours === totals.standardHours
        ) {
          nextCache.set(employeeId, previousRow);
          return previousRow;
        }

        const nextRow = {
          employee,
          teamMember,
          effectiveAttendance,
          totals,
        };
        nextCache.set(employeeId, nextRow);
        return nextRow;
      });

      attendanceRowsCacheRef.current = nextCache;
      logAttendancePerf('page:calculate-totals:end', {
        rows_count: rows.length,
        cells_count: rows.length * dayKeys.length,
        days_count: dayKeys.length,
        duration_ms: Math.round(getPerfNow() - startedAt),
      });

      return rows;
    },
    [attendanceByEmployeeId, attendanceSettings.baseHours, dayKeys, displayRows, pendingChangesByEmployeeId]
  );

  function getInputDraftKey(employeeId, date, field = 'main') {
    return `${employeeId}_${date}_${field}`;
  }

  function setInputDraft(employeeId, date, field, value) {
    const draftKey = getInputDraftKey(employeeId, date, field);
    setInputDrafts((current) => {
      if (!value) {
        if (!(draftKey in current)) return current;
        const next = { ...current };
        delete next[draftKey];
        return next;
      }
      return {
        ...current,
        [draftKey]: value,
      };
    });
  }

  function getDisplayedInputValue(employeeId, date, field, fallbackValue) {
    const draftKey = getInputDraftKey(employeeId, date, field);
    return inputDrafts[draftKey] ?? fallbackValue;
  }

  function updateLiveHoursPreview(value) {
    setLiveHoursPreview(formatDecimalPreview(value));
  }

  function markDirtyState() {
    if (!isSavingRef.current) {
      setSaveState('dirty');
    }
  }

  function showLicenseBlockedToast() {
    const now = Date.now();
    if (now - lastLicenseErrorRef.current < 10_000) return;
    lastLicenseErrorRef.current = now;
    window.dispatchEvent(new CustomEvent('app:toast', {
      detail: { message: 'Licenza non attiva: le modifiche sono bloccate.', tone: 'error' },
    }));
  }

  function queuePendingEntry(employeeId, date, nextEntry) {
    if (isWriteBlockedRef.current) {
      showLicenseBlockedToast();
      return;
    }
    const key = `${employeeId}_${date}`;
    const normalizedEntry = normalizeAttendanceEntry(nextEntry);
    const savedEntry = attendanceMap[key];

    setPendingChanges((current) => {
      const currentEntry = current[key];

      if (savedEntry && areAttendanceEntriesEquivalent(normalizedEntry, savedEntry)) {
        if (currentEntry === undefined) {
          return current;
        }
        const next = { ...current };
        delete next[key];
        pendingChangesRef.current = next;
        return next;
      }

      if (!savedEntry && isEffectivelyEmptyAttendanceEntry(normalizedEntry)) {
        if (currentEntry === undefined) {
          return current;
        }
        const next = { ...current };
        delete next[key];
        pendingChangesRef.current = next;
        return next;
      }

      if (currentEntry && areAttendanceEntriesEquivalent(currentEntry, normalizedEntry)) {
        return current;
      }

      const next = {
        ...current,
        [key]: normalizedEntry,
      };
      pendingChangesRef.current = next;
      return next;
    });

    markDirtyState();
  }

  function clearPendingChange(employeeId, date) {
    const key = `${employeeId}_${date}`;
    setPendingChanges((current) => {
      if (current[key] === undefined) return current;
      const next = { ...current };
      delete next[key];
      pendingChangesRef.current = next;
      return next;
    });
  }

  function handleCancelChanges() {
    if (isSavingRef.current) {
      return;
    }

    setPendingChanges({});
    pendingChangesRef.current = {};
    setInputDrafts({});
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    setSaveState('idle');
  }

  function moveAttendanceFocus(currentTarget, direction = 1) {
    const focusableNodes = [...(tableShellRef.current?.querySelectorAll('[data-attendance-focus="true"]') || [])]
      .filter((node) => !node.disabled);

    const currentIndex = focusableNodes.indexOf(currentTarget);
    if (currentIndex === -1) {
      return;
    }

    const nextIndex = currentIndex + direction;
    const nextTarget = focusableNodes[nextIndex];
    if (!nextTarget) {
      return;
    }

    nextTarget.focus();
    if (typeof nextTarget.select === 'function') {
      nextTarget.select();
    }
  }

  function handleGridKeyDown(event) {
    if (event.key !== 'Enter' && event.key !== 'Tab') {
      return;
    }

    event.preventDefault();
    moveAttendanceFocus(event.currentTarget, event.shiftKey ? -1 : 1);
  }

  function toggleEmployeeSelection(employeeId, checked) {
    setSelectedEmployeeIds((current) => {
      if (checked) {
        return current.includes(employeeId) ? current : [...current, employeeId];
      }
      return current.filter((id) => id !== employeeId);
    });
  }

  function toggleSelectAllVisible(checked) {
    setSelectedEmployeeIds(checked ? visibleEmployeeIds : []);
  }

  function getAttendanceForSnapshot(snapshot, employeeId, date) {
    const key = `${employeeId}_${date}`;
    return snapshot[key] !== undefined ? snapshot[key] : attendanceMap[key];
  }

  function hasMainValue(attendanceEntry) {
    return getMainInputValue(attendanceEntry) !== '';
  }

  function hasMarkerValue(attendanceEntry) {
    return !!attendanceEntry?.marker_code;
  }

  function hasOvertimeValue(attendanceEntry) {
    return Number(attendanceEntry?.overtime_hours || 0) > 0;
  }

  function isAttendanceCellEmpty(attendanceEntry) {
    return !attendanceEntry || isEffectivelyEmptyAttendanceEntry(attendanceEntry);
  }

  useEffect(() => {
    if (directoryLoading || attendanceLoading) {
      return;
    }

    logAttendancePerf('page:render-table:ready', {
      month: currentMonthKey,
      employees_count: activeEmployees.length,
      rows_count: displayRows.length,
      days_count: dayKeys.length,
      cells_count: displayRows.length * dayKeys.length,
      duration_ms: Math.round(getPerfNow() - pageLoadStartedAtRef.current),
    });
  }, [activeEmployees.length, attendanceLoading, currentMonthKey, dayKeys.length, directoryLoading, displayRows.length]);

  const handleAttendanceCellFocus = useCallback((date) => {
    setBulkTargetDate(date);
  }, []);

  const handleGridInputFocus = useCallback((date, event) => {
    handleAttendanceCellFocus(date);
    selectAllInputText(event);
  }, [handleAttendanceCellFocus]);

  function showBulkApplyFeedback(message) {
    if (bulkFeedbackTimeoutRef.current) {
      clearTimeout(bulkFeedbackTimeoutRef.current);
    }
    setBulkApplyFeedback(message);
    bulkFeedbackTimeoutRef.current = setTimeout(() => {
      setBulkApplyFeedback('');
    }, 1800);
  }

  function handleBulkApply() {
    const normalizedHours = String(bulkHoursValue || '').trim();
    const normalizedMarker = String(bulkMarkerValue || '').trim();
    const normalizedOvertime = String(bulkOvertimeValue || '').trim();

    if (!normalizedHours && !normalizedMarker && !normalizedOvertime) {
      return;
    }

    const parsedMain = normalizedHours ? parseMainInputValue(normalizedHours, attendanceSettings) : null;
    const parsedOvertime = normalizedOvertime ? parseOvertimeInputValue(normalizedOvertime, attendanceSettings) : null;

    if (parsedMain?.kind === 'invalid') {
      alert('Valore ore ordinarie non valido');
      return;
    }

    if (parsedOvertime?.kind === 'invalid') {
      alert('Valore straordinario non valido');
      return;
    }

    if ((parsedMain?.kind === 'hours' || parsedMain?.kind === 'symbol') && Number(parsedMain.hours || 0) > 24) {
      alert('Le ore ordinarie devono essere comprese tra 0 e 24.');
      return;
    }

    if (parsedOvertime?.kind === 'hours' && Number(parsedOvertime.hours || 0) > 24) {
      alert('Lo straordinario deve essere compreso tra 0 e 24.');
      return;
    }

    const selectedCount = selectedEmployeeIds.length;
    const markerLabel = normalizedMarker
      ? activeMarkers.find((marker) => marker.value === normalizedMarker)?.text || normalizedMarker
      : '';
    const confirmationNeeded = selectedCount > 10 || bulkOverwrite;

    if (confirmationNeeded) {
      const summary = formatBulkFieldSummary({
        hours: normalizedHours,
        markerLabel,
        overtime: normalizedOvertime,
      });
      const confirmMessage = bulkOverwrite
        ? `Stai per sovrascrivere valori esistenti per ${selectedCount} dipendenti.\n\nApplicare: ${summary || 'modifiche batch'}?`
        : `Stai per applicare ${summary || 'modifiche batch'} a ${selectedCount} dipendenti.\n\nConfermi?`;

      if (!window.confirm(confirmMessage)) {
        return;
      }
    }

    let appliedCount = 0;
    const mainDraftKeysToClear = new Set();
    const overtimeDraftKeysToClear = new Set();

    // Update atomico: costruiamo tutti i cambi batch in un solo passaggio sullo
    // snapshot corrente, cosi il batch non viene piu sovrascritto da setState ravvicinati.
    setPendingChanges((current) => {
      const next = { ...current };

      for (const employeeId of selectedEmployeeIds) {
        const key = `${employeeId}_${bulkTargetDate}`;
        const existing = getAttendanceForSnapshot(current, employeeId, bulkTargetDate);
        const baseEntry = normalizeAttendanceEntry({
          employee_id: employeeId,
          date: bulkTargetDate,
          status: existing?.status || 'presente',
          marker_code: existing?.marker_code || null,
          entry_code: existing?.entry_code || null,
          hours_worked: existing?.hours_worked ?? '',
          overtime_hours: existing?.overtime_hours || 0,
          notes: existing?.notes || null,
        });

        let nextEntry = { ...baseEntry };
        let entryChanged = false;

        if (parsedMain) {
          const canApplyMain = bulkOverwrite || !hasMainValue(baseEntry);
          if (canApplyMain) {
            if (parsedMain.kind === 'type') {
              nextEntry = {
                ...nextEntry,
                status: parsedMain.status,
                entry_code: null,
                hours_worked: 0,
                overtime_hours: 0,
              };
            } else if (parsedMain.kind === 'symbol') {
              nextEntry = {
                ...nextEntry,
                status: 'presente',
                entry_code: parsedMain.symbol,
                hours_worked: parsedMain.hours,
              };
            } else if (parsedMain.kind === 'hours') {
              nextEntry = {
                ...nextEntry,
                status: parsedMain.hours === 0 ? 'assente' : 'presente',
                entry_code: null,
                hours_worked: parsedMain.hours,
              };
            }
            entryChanged = true;
            mainDraftKeysToClear.add(getInputDraftKey(employeeId, bulkTargetDate, 'main'));
          }
        }

        if (normalizedMarker) {
          const markerTargetEntry = entryChanged ? nextEntry : baseEntry;
          const canApplyMarker =
            (bulkOverwrite || !hasMarkerValue(baseEntry)) &&
            !MAIN_DAY_TYPES.some((item) => item.value === markerTargetEntry.status);
          if (canApplyMarker) {
            nextEntry = {
              ...nextEntry,
              marker_code: normalizedMarker,
            };
            entryChanged = true;
          }
        }

        if (parsedOvertime) {
          const overtimeTargetEntry = entryChanged ? nextEntry : baseEntry;
          const canApplyOvertime = bulkOverwrite || !hasOvertimeValue(baseEntry);
          if (canApplyOvertime) {
            nextEntry = {
              ...overtimeTargetEntry,
              overtime_hours: parsedOvertime.kind === 'empty' ? 0 : parsedOvertime.hours,
            };
            entryChanged = true;
            overtimeDraftKeysToClear.add(getInputDraftKey(employeeId, bulkTargetDate, 'overtime'));
          }
        }

        if (!entryChanged) {
          continue;
        }

        const savedEntry = attendanceMap[key];
        const normalizedNextEntry = normalizeAttendanceEntry(nextEntry);
        appliedCount += 1;

        if (savedEntry && areAttendanceEntriesEquivalent(normalizedNextEntry, savedEntry)) {
          delete next[key];
          continue;
        }

        if (!savedEntry && isEffectivelyEmptyAttendanceEntry(normalizedNextEntry)) {
          delete next[key];
          continue;
        }

        next[key] = normalizedNextEntry;
      }

      pendingChangesRef.current = next;
      return next;
    });

    if (!appliedCount) {
      showBulkApplyFeedback('Nessuna cella disponibile da aggiornare');
      return;
    }

    setInputDrafts((current) => {
      if (!Object.keys(current).length) {
        return current;
      }

      const next = { ...current };
      mainDraftKeysToClear.forEach((draftKey) => {
        delete next[draftKey];
      });
      overtimeDraftKeysToClear.forEach((draftKey) => {
        delete next[draftKey];
      });
      return next;
    });

    markDirtyState();

    setBulkHoursValue('');
    setBulkMarkerValue('');
    setBulkOvertimeValue('');
    setBulkOverwrite(false);

    const summary = formatBulkFieldSummary({
      hours: normalizedHours,
      markerLabel,
      overtime: normalizedOvertime,
    });
    showBulkApplyFeedback(
      summary
        ? `${summary} applicate a ${appliedCount} dipendenti`
        : `Applicato a ${appliedCount} dipendenti`
    );
  }

  function scheduleSavedBadge() {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    statusTimeoutRef.current = setTimeout(() => {
      setSaveState('idle');
    }, 1200);
  }

  async function flushPendingChanges() {
    const snapshot = pendingChangesRef.current;
    const entries = Object.entries(snapshot);

    if (!entries.length || isSavingRef.current) {
      return;
    }

    if (isWriteBlockedRef.current) {
      return;
    }

    isSavingRef.current = true;
    setSaveState('saving');

    const payload = entries.map(([, item]) => {
      const normalized = normalizeAttendanceEntry(item);
      return {
        employee_id: normalized.employee_id,
        date: normalized.date,
        status: normalized.status,
        marker_code: normalized.marker_code || null,
        entry_code: normalized.entry_code || null,
        hours_worked:
          normalized.hours_worked === '' ||
          normalized.hours_worked === null ||
          normalized.hours_worked === undefined
            ? null
            : Number(normalized.hours_worked || 0),
        overtime_hours: Number(normalized.overtime_hours || 0),
        notes: normalized.notes || null,
      };
    });

    try {
      await window.api.attendance.bulkUpsert(payload);

      setAttendance((current) => {
        const nextMap = {};
        for (const item of current) {
          nextMap[`${item.employee_id}_${item.date}`] = item;
        }
        for (const item of payload) {
          nextMap[`${item.employee_id}_${item.date}`] = normalizeAttendanceEntry(item);
        }
        return Object.values(nextMap);
      });

      setPendingChanges((current) => {
        const next = { ...current };
        for (const [key, value] of entries) {
          const currentValue = current[key];
          if (currentValue && JSON.stringify(currentValue) === JSON.stringify(value)) {
            delete next[key];
          }
        }
        pendingChangesRef.current = next;
        return next;
      });

      setInputDrafts((current) => {
        if (!Object.keys(current).length) {
          return current;
        }
        const next = { ...current };
        for (const [, value] of entries) {
          delete next[getInputDraftKey(value.employee_id, value.date, 'main')];
          delete next[getInputDraftKey(value.employee_id, value.date, 'overtime')];
        }
        return next;
      });

      setSaveState('saved');
      scheduleSavedBadge();
    } catch (err) {
      const isLicenseBlock =
        err?.code === 'LICENSE_READ_ONLY' ||
        String(err?.message || '').includes('sola lettura');
      if (isLicenseBlock) {
        isWriteBlockedRef.current = true;
        setPendingChanges({});
        pendingChangesRef.current = {};
        setInputDrafts({});
        setSaveState('idle');
        showLicenseBlockedToast();
      } else {
        console.error(err);
        setSaveState('error');
        alert('Errore salvataggio automatico presenze');
      }
    } finally {
      isSavingRef.current = false;

      if (!isWriteBlockedRef.current && Object.keys(pendingChangesRef.current).length > 0) {
        setTimeout(() => {
          flushPendingChanges();
        }, 100);
      }
    }
  }

  function handleMainValueChange(employeeId, date, value) {
    const existing = getAtt(employeeId, date);
    setInputDraft(employeeId, date, 'main', value);
    updateLiveHoursPreview(value);
    const parsed = parseMainInputValue(value, attendanceSettings);

    if (parsed.kind === 'invalid') {
      return;
    }

    const nextEntry =
      parsed.kind === 'type'
        ? {
            employee_id: employeeId,
            date,
            status: parsed.status,
            marker_code: existing?.marker_code || null,
            entry_code: null,
            hours_worked: 0,
            overtime_hours: 0,
            notes: existing?.notes || null,
          }
        : parsed.kind === 'symbol'
        ? {
            employee_id: employeeId,
            date,
            status: 'presente',
            marker_code: existing?.marker_code || null,
            entry_code: parsed.symbol,
            hours_worked: parsed.hours,
            overtime_hours: existing?.overtime_hours || 0,
            notes: existing?.notes || null,
          }
        : {
            employee_id: employeeId,
            date,
            status:
              parsed.kind === 'empty'
                ? 'presente'
                : parsed.hours === 0
                ? 'assente'
                : 'presente',
            marker_code: existing?.marker_code || null,
            entry_code: null,
            hours_worked:
              parsed.kind === 'empty'
                ? ''
                : parsed.hours,
            overtime_hours: existing?.overtime_hours || 0,
            notes: existing?.notes || null,
          };

    queuePendingEntry(employeeId, date, nextEntry);
  }

  function handleMainValueBlur(employeeId, date) {
    const att = getAtt(employeeId, date);
    const draftValue = inputDrafts[getInputDraftKey(employeeId, date, 'main')];
    if (draftValue === undefined) {
      return;
    }

    const parsed = parseMainInputValue(draftValue, attendanceSettings);
    if (parsed.kind === 'invalid') {
      setInputDraft(employeeId, date, 'main', '');
      return;
    }

    setInputDraft(employeeId, date, 'main', getMainInputValue(att));
    updateLiveHoursPreview(getMainInputValue(att));
  }

  function handleOvertimeValueChange(employeeId, date, value) {
    setInputDraft(employeeId, date, 'overtime', value);
    const parsed = parseOvertimeInputValue(value, attendanceSettings);

    if (parsed.kind === 'invalid') {
      return;
    }

    const existing = getAtt(employeeId, date);
    queuePendingEntry(employeeId, date, {
        employee_id: employeeId,
        date,
        status: existing?.status || 'presente',
        marker_code: existing?.marker_code || null,
        entry_code: existing?.entry_code || null,
        hours_worked: existing?.hours_worked ?? '',
        overtime_hours:
          parsed.kind === 'empty'
            ? 0
            : parsed.hours,
        notes: existing?.notes || null,
    });
  }

  function handleOvertimeValueBlur(employeeId, date) {
    const att = getAtt(employeeId, date);
    const draftValue = inputDrafts[getInputDraftKey(employeeId, date, 'overtime')];
    if (draftValue === undefined) {
      return;
    }

    const parsed = parseOvertimeInputValue(draftValue, attendanceSettings);
    if (parsed.kind === 'invalid') {
      setInputDraft(employeeId, date, 'overtime', '');
      return;
    }

    const normalizedValue = att?.overtime_hours ? String(att.overtime_hours).replace('.', ',') : '';
    setInputDraft(employeeId, date, 'overtime', normalizedValue);
  }

  function handleMarkerChange(employeeId, date, markerCode) {
    const existing = getAtt(employeeId, date);
    const isMainType = MAIN_DAY_TYPES.some((item) => item.value === existing?.status);

    if (isMainType && markerCode) {
      return;
    }

    queuePendingEntry(employeeId, date, {
        employee_id: employeeId,
        date,
        status: existing?.status || 'presente',
        marker_code: markerCode || null,
        entry_code: existing?.entry_code || null,
        hours_worked: existing?.hours_worked ?? '',
        overtime_hours: existing?.overtime_hours || 0,
        notes: existing?.notes || null,
    });
  }

  function applyQuickHours(employeeIds, date, value, minutesValue = '') {
    if (!Array.isArray(employeeIds) || !employeeIds.length) {
      return;
    }

    if (value === '' && minutesValue === '') {
      employeeIds.forEach((employeeId) => {
        clearPendingChange(employeeId, date);
      });
      return;
    }

    employeeIds.forEach((employeeId) => {
      handleMainValueChange(employeeId, date, value);
    });
  }

  function applyQuickOvertime(employeeIds, date, value, minutesValue = '') {
    if (!Array.isArray(employeeIds) || !employeeIds.length) {
      return;
    }

    employeeIds.forEach((employeeId) => {
      const parsed = parseOvertimeInputValue(value, attendanceSettings);

      if (parsed.kind === 'invalid') {
        return;
      }

      const existing = getAtt(employeeId, date);
      queuePendingEntry(employeeId, date, {
          employee_id: employeeId,
          date,
          status: existing?.status || 'presente',
          marker_code: existing?.marker_code || null,
          entry_code: existing?.entry_code || null,
          hours_worked: existing?.hours_worked ?? '',
          overtime_hours: parsed.kind === 'empty' ? 0 : parsed.hours,
          notes: existing?.notes || null,
      });
    });
  }

  function applyQuickMarker(employeeIds, date, markerCode) {
    if (!Array.isArray(employeeIds) || !employeeIds.length) {
      return;
    }

    employeeIds.forEach((employeeId) => {
      handleMarkerChange(employeeId, date, markerCode || null);
    });
  }

  function applyCopyPreviousDay(employeeIds) {
    if (!Array.isArray(employeeIds) || !employeeIds.length) {
      return { copiedCount: 0, previousDate: shiftLocalDateString(quickEntryDate, -1) };
    }

    const previousDate = shiftLocalDateString(quickEntryDate, -1);
    const copiedEntries = [];

    for (const employeeId of employeeIds) {
      const previousAtt = getAtt(employeeId, previousDate);
      if (!previousAtt) {
        continue;
      }

      const currentAtt = getAtt(employeeId, quickEntryDate);
      copiedEntries.push({
        key: `${employeeId}_${quickEntryDate}`,
        employeeId,
        value: normalizeAttendanceEntry({
          employee_id: employeeId,
          date: quickEntryDate,
          status: previousAtt.status || 'presente',
          marker_code: previousAtt.marker_code || null,
          entry_code: previousAtt.entry_code || null,
          hours_worked: previousAtt.hours_worked ?? '',
          overtime_hours: previousAtt.overtime_hours || 0,
          notes: currentAtt?.notes || null,
        }),
      });
    }

    if (!copiedEntries.length) {
      return { copiedCount: 0, previousDate };
    }

    setPendingChanges((current) => {
      const next = { ...current };
      for (const entry of copiedEntries) {
        next[entry.key] = entry.value;
      }
      pendingChangesRef.current = next;
      return next;
    });
    markDirtyState();

    setInputDrafts((current) => {
      if (!copiedEntries.length || !Object.keys(current).length) {
        return current;
      }

      const next = { ...current };
      for (const entry of copiedEntries) {
        delete next[getInputDraftKey(entry.employeeId, quickEntryDate, 'main')];
        delete next[getInputDraftKey(entry.employeeId, quickEntryDate, 'overtime')];
      }
      return next;
    });

    return { copiedCount: copiedEntries.length, previousDate };
  }

  async function handleCloseQuickEntry() {
    await flushPendingChanges();
    setShowQuickEntry(false);
  }

  function handleQuickEntryDateChange(value) {
    setQuickEntryDate(value);
    const parsed = parseDateValue(value);
    if (parsed) {
      if (parsed.getFullYear() !== selectedYear) {
        setSelectedYear(parsed.getFullYear());
      }
      setCurrentMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
    }
  }

  function getDefaultQuickDateForMonth(monthDate) {
    const today = new Date();
    return isSameMonth(today, monthDate)
      ? formatLocalDate(today)
      : formatLocalDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), 1));
  }

  function getQuickEntryRows() {
    const previousDate = shiftLocalDateString(quickEntryDate, -1);

    return displayRows.map(({ employee, teamMember }) => {
      const att = getAtt(employee.id, quickEntryDate);
      const previousAtt = getAtt(employee.id, previousDate);
      const isSpecial = att?.status && att.status !== 'presente' && att.status !== 'assente';
      const markerMeta = getMarkerMeta(att?.marker_code, availableMarkers);
      return {
        employee,
        teamName: selectedMeta.type === 'team' ? selectedTeam?.name || null : null,
        hasExistingHours: !!att && !isSpecial && String(att?.hours_worked ?? '') !== '',
        initialHours:
          !isSpecial && att?.hours_worked !== undefined && att?.hours_worked !== null
            ? String(att.entry_code || att.hours_worked)
            : '',
        initialParts: getHoursMinutesInputValue(att),
        existingSpecialLabel: isSpecial ? getSpecialTypeText(att.status) : null,
        markerLabel: markerMeta ? markerMeta.symbol : null,
        previousDayHasData: !!previousAtt,
        manageByDays: !!teamMember?.manage_by_days,
      };
    });
  }

  const quickEntryRows = useMemo(
    () => getQuickEntryRows(),
    [displayRows, quickEntryDate, pendingChanges, attendance]
  );

  const selectedEmployeeIdsSet = useMemo(
    () => new Set(selectedEmployeeIds.map((employeeId) => Number(employeeId))),
    [selectedEmployeeIds]
  );

  function getAttendancePrintRows(mode = 'all') {
    if (mode === 'selected' && selectedEmployeeIdsSet.size > 0) {
      return displayRows.filter(({ employee }) => selectedEmployeeIdsSet.has(Number(employee.id)));
    }
    return displayRows;
  }

  function getAttendancePrintModeLabel(mode = 'all') {
    return mode === 'selected' && selectedEmployeeIds.length > 0 ? 'Selezionati' : 'Tutti';
  }

  function buildAttendancePdfFileName(mode = 'all') {
    const monthLabel = fileMonthLabel(currentMonth);
    const monthKey = sanitizeFileName(monthLabel);
    const scopeLabel =
      selectedMeta.type === 'team' && selectedTeam
        ? selectedTeam.name
        : selectedMeta.type === 'no_team'
        ? 'Senza squadra'
        : selectedMeta.type === 'employee' && displayRows[0]?.employee
        ? `${displayRows[0].employee.first_name} ${displayRows[0].employee.last_name}`
        : 'mensili';
    const selectionSuffix = mode === 'selected' && selectedEmployeeIds.length > 0 ? 'selezionati' : 'tutti';
    return sanitizeFileName(`Presenze - ${scopeLabel} - ${monthKey} - ${selectionSuffix}.pdf`);
  }

  async function ensurePrintPreviewVisible(mode = 'all') {
    await flushPendingChanges();
    setPrintSelectionMode(mode === 'selected' && selectedEmployeeIds.length > 0 ? 'selected' : 'all');
    setShowPrintPreview(true);
    await new Promise((resolve) => {
      if (typeof window === 'undefined') {
        resolve();
        return;
      }
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });
  }

  async function handlePreviewPdf(mode = 'all') {
    await ensurePrintPreviewVisible(mode);
    setTimeout(() => {
      printAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  async function handlePrint(mode = 'all') {
    await ensurePrintPreviewVisible(mode);

    const printArea = printAreaRef.current;
    if (!printArea) {
      alert('Anteprima PDF non disponibile');
      return;
    }

    try {
      const fileName = buildAttendancePdfFileName(mode);

      const result = await window.api.reports.printHtml({
        html: printArea.outerHTML,
        landscape: true,
        fileName,
      });

      if (result?.canceled) {
        return;
      }
    } catch (err) {
      console.error(err);
      alert('Errore stampa presenze');
    }
  }

  async function handleSavePdf(mode = 'all') {
    await ensurePrintPreviewVisible(mode);
    const printArea = printAreaRef.current;
    if (!printArea) {
      alert('Anteprima PDF non disponibile');
      return;
    }

    try {
      const fileName = buildAttendancePdfFileName(mode);

      await window.api.reports.savePdf({
        fileName,
        html: printArea.outerHTML,
        landscape: true,
      });
    } catch (err) {
      console.error(err);
      alert('Errore apertura PDF presenze');
    }
  }

  const saveStatusLabel =
    saveState === 'saving'
      ? 'Salvataggio automatico...'
      : saveState === 'dirty'
      ? 'Modifiche in corso'
      : saveState === 'saved'
      ? 'Salvato'
      : saveState === 'error'
      ? 'Errore salvataggio'
      : 'Autosave attivo';

  const hasPendingChanges = Object.keys(pendingChanges).length > 0;
  const allVisibleSelected = visibleEmployeeIds.length > 0 && visibleEmployeeIds.every((employeeId) => selectedEmployeeIdsSet.has(Number(employeeId)));
  const selectedPrintRows = useMemo(() => getAttendancePrintRows('selected'), [displayRows, selectedEmployeeIdsSet]);
  const activePrintRows = useMemo(() => getAttendancePrintRows(printSelectionMode), [displayRows, printSelectionMode, selectedEmployeeIdsSet]);
  const hasSelectedPrintRows = selectedPrintRows.length > 0;

  useEffect(() => {
    if (!showPrintPreview) {
      return;
    }

    logAttendancePerf('page:print-preview:mount', {
      month: currentMonthKey,
      rows_count: activePrintRows.length,
      mode: printSelectionMode,
    });
  }, [activePrintRows.length, currentMonthKey, printSelectionMode, showPrintPreview]);

  const todayKey = formatLocalDate(new Date());
  const isCompactLayout = layoutMode === 'compact';
  const thStyleLeftCurrent = isCompactLayout ? thStyleLeftCompact : thStyleLeft;
  const thStyleCenterCurrent = isCompactLayout ? thStyleCenterCompact : thStyleCenter;
  const tdStyleLeftCurrent = isCompactLayout ? tdStyleLeftCompact : tdStyleLeft;
  const tdStyleCenterCurrent = isCompactLayout ? tdStyleCenterCompact : tdStyleCenter;
  const thStyleRightHoursCurrent = isCompactLayout ? thStyleRightHoursCompact : thStyleRightHours;
  const thStyleRightSummaryCurrent = isCompactLayout ? thStyleRightSummaryCompact : thStyleRightSummary;
  const tdStyleRightHoursCurrent = isCompactLayout ? tdStyleRightHoursCompact : tdStyleRightHours;
  const tdStyleRightSummaryCurrent = isCompactLayout ? tdStyleRightSummaryCompact : tdStyleRightSummary;
  const isBulkApplyDisabled =
    !String(bulkHoursValue || '').trim() &&
    !String(bulkMarkerValue || '').trim() &&
    !String(bulkOvertimeValue || '').trim();
  const allEmployeesCount = activeEmployees.length;
  const ungroupedEmployeesCount = employeesWithoutTeam.length;

  return (
    <div className="attendance-page">
      <div className="page-sticky-stack">
        <section className="page-hero attendance-hero">
          <div>
            <span className="page-kicker">Gestione mensile</span>
            <h1 className="page-title">Foglio Presenze</h1>
            <p className="page-subtitle attendance-hero-subtitle">
              Seleziona un dipendente o una squadra: la registrazione resta sempre sui singoli componenti.
            </p>
          </div>

          <div className="attendance-action-row">
            {isWriteBlocked ? (
              <span
                className="soft-chip"
                style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#b91c1c', borderColor: 'rgba(239, 68, 68, 0.25)' }}
              >
                Licenza non attiva — sola lettura
              </span>
            ) : null}
            <span
              className="soft-chip"
              style={saveState === 'error'
                ? { background: 'rgba(239, 68, 68, 0.12)', color: '#b91c1c', borderColor: 'rgba(20, 33, 61, 0.08)' }
                : saveState === 'saved'
                ? { background: 'rgba(16, 185, 129, 0.14)', color: '#047857', borderColor: 'rgba(20, 33, 61, 0.08)' }
                : saveState === 'dirty'
                ? { background: 'rgba(245, 158, 11, 0.14)', color: '#b45309', borderColor: 'rgba(20, 33, 61, 0.08)' }
                : { background: 'rgba(20, 33, 61, 0.06)', color: '#314762', borderColor: 'rgba(20, 33, 61, 0.08)' }}
            >
              {saveStatusLabel}
            </span>
            <button
              className="button-secondary"
              onClick={handleCancelChanges}
              disabled={!hasPendingChanges || saveState === 'saving'}
            >
              Annulla
            </button>
            <button
              className="button-secondary"
              onClick={() => {
                setQuickEntryDate(getDefaultQuickDateForMonth(currentMonth));
                setShowQuickEntry(true);
              }}
            >
              Inserimento rapido giornaliero
            </button>
            <button className="button-secondary" onClick={() => handlePreviewPdf('all')}>Anteprima PDF</button>
            <button className="button" onClick={() => handleSavePdf('all')}>Genera PDF</button>
            <button className="button-secondary" onClick={() => handlePrint('all')}>Stampa</button>
            {hasSelectedPrintRows ? (
              <>
                <button className="button-secondary" onClick={() => handlePreviewPdf('selected')}>
                  Anteprima selezionati ({selectedPrintRows.length})
                </button>
                <button className="button" onClick={() => handleSavePdf('selected')}>
                  Genera PDF selezionati ({selectedPrintRows.length})
                </button>
                <button className="button-secondary" onClick={() => handlePrint('selected')}>
                  Stampa selezionati
                </button>
              </>
            ) : null}
          </div>
        </section>

        <div className="toolbar attendance-toolbar">
          <div className="toolbar-group attendance-toolbar-group">
            <button
              className="attendance-month-nav"
              onClick={() => {
                const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
                if (nextMonth.getFullYear() !== selectedYear) {
                  setSelectedYear(nextMonth.getFullYear());
                }
                setCurrentMonth(nextMonth);
              }}
            >
              {'<'}
            </button>

            <strong className="attendance-month-label">
              {currentMonth.toLocaleDateString('it-IT', {
                month: 'long',
                year: 'numeric',
              })}
            </strong>

            <button
              className="attendance-month-nav"
              onClick={() => {
                const nextMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
                if (nextMonth.getFullYear() !== selectedYear) {
                  setSelectedYear(nextMonth.getFullYear());
                }
                setCurrentMonth(nextMonth);
              }}
            >
              {'>'}
            </button>
          </div>

          <input
            className="attendance-month-input"
            type="month"
            value={monthString(currentMonth)}
            onChange={(event) => {
              const parsed = parseDateValue(`${event.target.value}-01`);
              if (parsed) {
                if (parsed.getFullYear() !== selectedYear) {
                  setSelectedYear(parsed.getFullYear());
                }
                setCurrentMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
              }
            }}
          />

          <select
            className="attendance-entity-select"
            value={selectedEntity}
            onChange={(event) => setSelectedEntity(event.target.value)}
          >
            <option value="all">Tutti ({allEmployeesCount})</option>
            <option value="no_team">Senza squadra ({ungroupedEmployeesCount})</option>
            <optgroup label="Dipendenti">
              {activeEmployees.map((employee) => (
                <option key={`employee-${employee.id}`} value={`employee:${employee.id}`}>
                  {employee.first_name} {employee.last_name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Squadre">
              {visibleTeams.map((team) => (
                <option key={`team-${team.id}`} value={`team:${team.id}`}>
                  Squadra • {team.name} ({visibleTeamCounts.get(Number(team.id)) || 0})
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      {selectedMeta.type === 'team' && selectedTeam ? (
        <div className="panel panel-section" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="page-kicker" style={{ marginBottom: 6 }}>Contesto squadra</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{selectedTeam.name}</div>
              <div style={{ color: '#667085', marginTop: 6 }}>
                Compili le presenze dei membri uno per uno mantenendo la stessa logica del singolo dipendente.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="soft-chip" style={{ background: 'rgba(37, 99, 235, 0.12)', color: '#1d4ed8' }}>
                {displayRows.length} membri visibili
              </span>
              <span className="soft-chip" style={{ background: 'rgba(15, 118, 110, 0.1)', color: '#115e59' }}>
                Selezione squadra
              </span>
            </div>
          </div>

          {selectedTeam.notes ? (
            <div className="muted-box" style={{ marginTop: 12 }}>
              {selectedTeam.notes}
            </div>
          ) : null}
        </div>
      ) : selectedMeta.type === 'no_team' ? (
        <div className="panel panel-section" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="page-kicker" style={{ marginBottom: 6 }}>Contesto filtro</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>Dipendenti senza squadra</div>
              <div style={{ color: '#667085', marginTop: 6 }}>
                Visualizzi solo i dipendenti attivi che non risultano assegnati ad alcuna squadra.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="soft-chip" style={{ background: 'rgba(37, 99, 235, 0.12)', color: '#1d4ed8' }}>
                {displayRows.length} dipendenti visibili
              </span>
              <span className="soft-chip" style={{ background: 'rgba(20, 33, 61, 0.06)', color: '#314762' }}>
                Filtro senza squadra
              </span>
            </div>
          </div>
        </div>
      ) : null}

      {selectedEmployeeIds.length > 0 ? (
        <div className="panel panel-section attendance-bulk-bar">
          <div className="attendance-bulk-bar-head">
            <div>
              <div className="page-kicker" style={{ marginBottom: 6 }}>Inserimento multiplo</div>
              <div className="attendance-bulk-bar-title">
                {selectedEmployeeIds.length} dipendenti selezionati
              </div>
              <div className="attendance-bulk-bar-subtitle">
                Giorno attivo: {formatIsoDateLabel(bulkTargetDate)}
              </div>
            </div>
            {bulkApplyFeedback ? (
              <span className="soft-chip" style={{ background: 'rgba(16, 185, 129, 0.14)', color: '#047857' }}>
                {bulkApplyFeedback}
              </span>
            ) : null}
          </div>

          <div className="attendance-bulk-controls">
            <label className="attendance-bulk-field">
              <span className="communication-field-label">Ore</span>
              <input
                type="text"
                value={bulkHoursValue}
                onChange={(event) => {
                  setBulkHoursValue(event.target.value);
                  updateLiveHoursPreview(event.target.value);
                }}
                placeholder={attendanceSettings.inputMode === 'hours_and_symbol' ? attendanceSettings.quickSymbol : 'Ore'}
              />
              {formatDecimalPreview(bulkHoursValue) ? (
                <span className="attendance-hours-preview">{formatDecimalPreview(bulkHoursValue)}</span>
              ) : null}
            </label>

            <label className="attendance-bulk-field">
              <span className="communication-field-label">Marker</span>
              <select
                value={bulkMarkerValue}
                onChange={(event) => setBulkMarkerValue(event.target.value)}
              >
                <option value="">Lascia invariato</option>
                {activeMarkers.map((marker) => (
                  <option key={marker.value} value={marker.value}>
                    {marker.text}
                  </option>
                ))}
              </select>
            </label>

            <label className="attendance-bulk-field">
              <span className="communication-field-label">Straordinario</span>
              <input
                type="text"
                value={bulkOvertimeValue}
                onChange={(event) => setBulkOvertimeValue(event.target.value)}
                placeholder="STR"
              />
            </label>

            <label className="communication-checkbox attendance-bulk-checkbox">
              <input
                type="checkbox"
                checked={bulkOverwrite}
                onChange={(event) => setBulkOverwrite(event.target.checked)}
              />
              Sovrascrivi celle gia compilate
            </label>

            <button
              className="button"
              type="button"
              onClick={handleBulkApply}
              disabled={isBulkApplyDisabled || isWriteBlocked}
            >
              Applica
            </button>
          </div>
        </div>
      ) : null}

      <div className="panel panel-section" style={{ padding: 18 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#115e59' }}>
                Legenda principale
              </div>
              <button
                type="button"
                className="button-secondary"
                style={{ padding: '6px 12px', minHeight: 0 }}
                onClick={() => setShowHoursLegend((current) => !current)}
              >
                {showHoursLegend ? 'Nascondi legenda ore' : 'Legenda ore ?'}
              </button>
              {liveHoursPreview ? (
                <span className="soft-chip" style={{ background: 'rgba(37, 99, 235, 0.12)', color: '#1d4ed8' }}>
                  Anteprima ore: {liveHoursPreview}
                </span>
              ) : null}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="attendance-layout-mode">
                <span className="attendance-layout-mode__label">Layout</span>
                <select
                  value={layoutMode}
                  onChange={(event) => setLayoutMode(normalizeAttendanceLayoutMode(event.target.value))}
                  className="attendance-layout-mode__select"
                >
                  <option value="standard">Standard</option>
                  <option value="compact">Compatta</option>
                </select>
              </label>
              <span className="soft-chip" style={{ background: 'rgba(37, 99, 235, 0.1)', color: '#1d4ed8' }}>
                {selectedEmployeeIds.length} selezionati
              </span>
              <span className="soft-chip" style={{ background: 'rgba(20, 33, 61, 0.06)', color: '#314762' }}>
                Selezione multipla pronta per azioni batch
              </span>
            </div>
          </div>
          {showHoursLegend ? (
            <div className="muted-box" style={{ display: 'grid', gap: 4 }}>
              <strong>Esempi inserimento ore:</strong>
              <span>1 = 1 ora</span>
              <span>1.5 = 1 ora e 30 minuti</span>
              <span>0.5 = 30 minuti</span>
              <span>0.25 = 15 minuti</span>
              <span>0.75 = 45 minuti</span>
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {MAIN_DAY_TYPES.map((item) => (
              <span
                key={item.value}
                className="soft-chip"
                style={{ background: 'rgba(20, 33, 61, 0.06)', color: '#314762', borderColor: 'rgba(20, 33, 61, 0.08)' }}
              >
                {item.code} = {item.text}
              </span>
            ))}
          </div>

          <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#115e59' }}>
            Marcatori grafici aggiuntivi
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {activeMarkers.map((marker) => (
              <span
                key={marker.value}
                className="soft-chip"
                style={{
                  background: marker.background,
                  color: marker.color,
                  borderColor: 'rgba(20, 33, 61, 0.08)',
                }}
              >
                <MarkerVisual marker={marker} size={16} /> {marker.text}
              </span>
            ))}
            <span className="soft-chip" style={{ background: 'rgba(220, 38, 38, 0.12)', color: '#b91c1c' }}>
              Domeniche in rosso
            </span>
            <span className="soft-chip" style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#991b1b' }}>
              Festivita italiane in rosso pieno
            </span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="panel panel-section" style={{ padding: 18 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <strong>{loadingMessage}</strong>
            <span style={{ color: '#667085' }}>
              {directoryLoading
                ? 'Sto caricando dipendenti, squadre e impostazioni del foglio presenze.'
                : 'Sto caricando le presenze del mese selezionato.'}
            </span>
          </div>
        </div>
      ) : (
        <div className={`attendance-table-region ${isCompactLayout ? 'attendance-table-region--compact' : ''}`}>
          <div
            className="attendance-horizontal-scrollbar"
            ref={horizontalScrollbarRef}
            aria-label="Scorrimento orizzontale giorni del foglio presenze"
          >
            <div
              className="attendance-horizontal-scrollbar-content"
              ref={horizontalScrollbarContentRef}
            />
          </div>
          <div className="attendance-table-shell" ref={tableShellRef}>
            <table className={`attendance-table ${isCompactLayout ? 'attendance-table--compact' : ''}`}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={thStyleLeftCurrent}>
                  <div className="attendance-left-head">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(event) => toggleSelectAllVisible(event.target.checked)}
                      aria-label="Seleziona tutti i dipendenti visibili"
                    />
                    <span>{selectedMeta.type === 'team' ? 'Componente squadra' : 'Dipendente'}</span>
                  </div>
                </th>
                {daysInMonth.map((day) => (
                  <th
                    key={formatDate(day)}
                    style={{
                      ...thStyleCenterCurrent,
                      ...getCalendarHeaderStyle(dayInfoMap[formatDate(day)]),
                      ...(formatDate(day) === todayKey ? todayHeaderStyle : {}),
                    }}
                    title={dayInfoMap[formatDate(day)]?.holidayLabel || undefined}
                  >
                    {day.getDate()}
                    <br />
                    <span
                      style={{
                        fontSize: isCompactLayout ? 9 : 10,
                        color: dayInfoMap[formatDate(day)]?.isSpecialDay ? '#991b1b' : '#6b7280',
                        fontWeight: dayInfoMap[formatDate(day)]?.isSpecialDay ? 800 : 500,
                      }}
                    >
                      {getDayLabel(day)}
                    </span>
                  </th>
                ))}
                <th style={thStyleRightHoursCurrent}>{isCompactLayout ? 'Tot.' : 'Ore tot.'}</th>
                <th style={thStyleRightSummaryCurrent}>{isCompactLayout ? 'Riep.' : 'Riepilogo'}</th>
              </tr>
            </thead>
            <tbody>
              {attendanceRowsData.map(({ employee, teamMember, effectiveAttendance, totals }) => {
                return (
                  <tr key={employee.id}>
                    <td style={tdStyleLeftCurrent}>
                      <div className="attendance-left-cell">
                        <input
                          type="checkbox"
                          checked={selectedEmployeeIds.includes(employee.id)}
                          onChange={(event) => toggleEmployeeSelection(employee.id, event.target.checked)}
                          aria-label={`Seleziona ${employee.first_name} ${employee.last_name}`}
                        />
                        <div>
                          <div className="attendance-employee-name">{employee.first_name} {employee.last_name}</div>
                          <div style={{ fontSize: isCompactLayout ? 9 : 10, color: '#6b7280' }}>
                            {employee.role || ''}
                            {teamMember?.manage_by_days ? ' · gestione a giornate' : ''}
                          </div>
                        </div>
                      </div>
                    </td>

                    {daysInMonth.map((day, index) => {
                      const dateStr = dayKeys[index];
                      const att = effectiveAttendance[dateStr];
                      const isSpecial = att?.status && att.status !== 'presente' && att.status !== 'assente';
                      const specialOpt = getMainTypeMeta(att?.status);
                      const markerMeta = getMarkerMeta(att?.marker_code, availableMarkers);
                      const dayInfo = dayInfoMap[dateStr];
                      const markerMenuKey = `${employee.id}_${dateStr}`;
                      const overtimeEditorKey = `${employee.id}_${dateStr}_overtime`;
                      const isMainType = MAIN_DAY_TYPES.some((item) => item.value === att?.status);
                      const isEditingMarker = openMarkerMenuKey === markerMenuKey || !markerMeta;
                      const isEditingCompactOvertime = compactOvertimeEditorKey === overtimeEditorKey;
                      const mainInputValue = getDisplayedInputValue(employee.id, dateStr, 'main', getMainInputValue(att));
                      const overtimeInputValue = getDisplayedInputValue(
                        employee.id,
                        dateStr,
                        'overtime',
                        att?.overtime_hours ? String(att.overtime_hours).replace('.', ',') : ''
                      );
                      const mainInputTone = getAttendanceHoursTone(mainInputValue, attendanceSettings);
                      const overtimeHasValue = String(overtimeInputValue || '').trim() !== '';

                      return (
                        <td
                          key={dateStr}
                          style={{
                            ...tdStyleCenterCurrent,
                            ...getCalendarCellStyle(dayInfo),
                            ...(dateStr === todayKey ? todayCellStyle : {}),
                          }}
                          title={dayInfo?.holidayLabel || undefined}
                        >
                          <div className={`attendance-cell-stack ${isCompactLayout ? 'attendance-cell-stack--compact' : ''}`}>
                            <div className={`attendance-day-cell ${isCompactLayout ? 'attendance-day-cell--compact' : ''}`}>
                              <input
                                className={`attendance-hours-input ${isCompactLayout ? 'attendance-hours-input--compact' : ''} ${mainInputTone ? `attendance-hours-input--${mainInputTone}` : ''}`}
                                type="text"
                                inputMode="decimal"
                                value={mainInputValue}
                                onChange={(event) => handleMainValueChange(employee.id, dateStr, event.target.value)}
                                onBlur={() => handleMainValueBlur(employee.id, dateStr)}
                                onFocus={(event) => {
                                  handleGridInputFocus(dateStr, event);
                                  updateLiveHoursPreview(event.currentTarget.value);
                                }}
                                onClick={selectAllInputText}
                                onKeyDown={handleGridKeyDown}
                                data-attendance-focus="true"
                                placeholder=""
                                disabled={isWriteBlocked}
                                title={isSpecial ? specialOpt?.text : 'Inserisci ore decimali oppure F / P / M'}
                              />

                              {isCompactLayout ? (
                                <>
                                  {!isMainType ? (
                                    markerMeta && !isEditingMarker ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          handleAttendanceCellFocus(dateStr);
                                          setOpenMarkerMenuKey(markerMenuKey);
                                        }}
                                        title={`Marcatore ${markerMeta.text}. Clicca per modificare.`}
                                        className="attendance-compact-marker-badge"
                                        style={{ background: markerMeta.background, color: markerMeta.color }}
                                        disabled={isWriteBlocked}
                                      >
                                        <MarkerVisual marker={markerMeta} size={11} />
                                      </button>
                                    ) : (
                                      <select
                                        className="attendance-compact-marker-select"
                                        value={att?.marker_code || ''}
                                        onChange={(event) => {
                                          const nextValue = event.target.value || null;
                                          handleMarkerChange(employee.id, dateStr, nextValue);
                                          setOpenMarkerMenuKey(nextValue ? null : markerMenuKey);
                                        }}
                                        onFocus={() => handleAttendanceCellFocus(dateStr)}
                                        onBlur={() => {
                                          if (att?.marker_code) {
                                            setOpenMarkerMenuKey(null);
                                          }
                                        }}
                                        title="Seleziona un marcatore grafico"
                                        disabled={isWriteBlocked}
                                      >
                                        <option value="">+</option>
                                        {activeMarkers.map((item) => (
                                          <option key={item.value} value={item.value}>
                                            {item.image ? item.text : item.symbol}
                                          </option>
                                        ))}
                                      </select>
                                    )
                                  ) : null}

                                  {!isSpecial ? (
                                    isEditingCompactOvertime ? (
                                      <input
                                        className={`attendance-compact-overtime-input ${overtimeHasValue ? 'attendance-hours-input--overtime-filled' : ''}`}
                                        type="text"
                                        inputMode="decimal"
                                        value={overtimeInputValue}
                                        onChange={(event) => handleOvertimeValueChange(employee.id, dateStr, event.target.value)}
                                        onBlur={() => {
                                          handleOvertimeValueBlur(employee.id, dateStr);
                                          setCompactOvertimeEditorKey(null);
                                        }}
                                        onFocus={(event) => handleGridInputFocus(dateStr, event)}
                                        onClick={selectAllInputText}
                                        onKeyDown={handleGridKeyDown}
                                        data-attendance-focus="true"
                                        placeholder="str"
                                        autoFocus
                                        disabled={isWriteBlocked}
                                        title="Straordinario decimale separato dalle ore normali"
                                      />
                                    ) : (
                                      <button
                                        type="button"
                                        className={`attendance-compact-overtime-badge ${overtimeHasValue ? 'attendance-compact-overtime-badge--filled' : ''}`}
                                        onClick={() => {
                                          handleAttendanceCellFocus(dateStr);
                                          setCompactOvertimeEditorKey(overtimeEditorKey);
                                        }}
                                        disabled={isWriteBlocked}
                                        title={overtimeHasValue ? `Straordinario ${overtimeInputValue} h. Clicca per modificare.` : 'Aggiungi straordinario'}
                                      >
                                        {overtimeHasValue ? `+${overtimeInputValue}` : '+STR'}
                                      </button>
                                    )
                                  ) : null}
                                </>
                              ) : (
                                <>
                                  <input
                                    className={`attendance-hours-input attendance-hours-input--overtime ${overtimeHasValue ? 'attendance-hours-input--overtime-filled' : ''}`}
                                    type="text"
                                    inputMode="decimal"
                                    value={overtimeInputValue}
                                    onChange={(event) => handleOvertimeValueChange(employee.id, dateStr, event.target.value)}
                                    onBlur={() => handleOvertimeValueBlur(employee.id, dateStr)}
                                    onFocus={(event) => handleGridInputFocus(dateStr, event)}
                                    onClick={selectAllInputText}
                                    onKeyDown={handleGridKeyDown}
                                    data-attendance-focus="true"
                                    placeholder="str"
                                    disabled={isWriteBlocked || isSpecial}
                                    title="Straordinario decimale separato dalle ore normali"
                                  />

                                  {isMainType ? (
                                    <span className="attendance-marker-placeholder" />
                                  ) : markerMeta && !isEditingMarker ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        handleAttendanceCellFocus(dateStr);
                                        setOpenMarkerMenuKey(markerMenuKey);
                                      }}
                                      title={`Marcatore ${markerMeta.text}. Clicca per modificare.`}
                                      className="attendance-marker-button"
                                      style={{ background: markerMeta.background, color: markerMeta.color }}
                                      disabled={isWriteBlocked}
                                    >
                                      <MarkerVisual marker={markerMeta} size={16} />
                                    </button>
                                  ) : (
                                    <select
                                      className="attendance-marker-select"
                                      value={att?.marker_code || ''}
                                      onChange={(event) => {
                                        const nextValue = event.target.value || null;
                                        handleMarkerChange(employee.id, dateStr, nextValue);
                                        setOpenMarkerMenuKey(nextValue ? null : markerMenuKey);
                                      }}
                                      onFocus={() => handleAttendanceCellFocus(dateStr)}
                                      onKeyDown={handleGridKeyDown}
                                      data-attendance-focus="true"
                                      onBlur={() => {
                                        if (att?.marker_code) {
                                          setOpenMarkerMenuKey(null);
                                        }
                                      }}
                                      title="Seleziona un marcatore grafico"
                                      disabled={isWriteBlocked}
                                    >
                                      <option value="">+</option>
                                      {activeMarkers.map((item) => (
                                        <option key={item.value} value={item.value}>
                                          {item.image ? item.text : item.symbol}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                      );
                    })}

                    <td style={tdStyleRightHoursCurrent}>{formatHoursValue(totals.totalHours, attendanceSettings.hoursFormat)}</td>
                    <td style={tdStyleRightSummaryCurrent}>
                      {isCompactLayout
                        ? formatCompactWorkedSummary(totals.totalHours, attendanceSettings.baseHours, attendanceSettings.hoursFormat)
                        : formatWorkedSummary(totals.totalHours, attendanceSettings.baseHours, attendanceSettings.hoursFormat)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!displayRows.length ? (
            <div className="empty-state">Nessun dipendente disponibile per la selezione corrente.</div>
          ) : null}
          </div>
        </div>
      )}

      <QuickAttendanceModal
        open={showQuickEntry}
        quickDate={quickEntryDate}
        previousDate={shiftLocalDateString(quickEntryDate, -1)}
        onDateChange={handleQuickEntryDateChange}
        onClose={handleCloseQuickEntry}
        rows={quickEntryRows}
        saveState={saveState}
        scopeType={selectedMeta.type}
        scopeLabel={
          selectedMeta.type === 'team'
            ? selectedTeam?.name || 'Squadra'
            : selectedMeta.type === 'no_team'
            ? 'Dipendenti senza squadra'
            : selectedMeta.type === 'employee'
            ? displayRows[0]?.employee
              ? `${displayRows[0].employee.first_name} ${displayRows[0].employee.last_name}`
              : 'Dipendente'
            : 'Tutti i dipendenti attivi'
        }
        onApplyHours={applyQuickHours}
        onApplyOvertime={applyQuickOvertime}
        onApplyMarker={applyQuickMarker}
        onCopyPreviousDay={applyCopyPreviousDay}
        onClearHours={clearPendingChange}
        onUseToday={() => handleQuickEntryDateChange(getDefaultQuickDateForMonth(currentMonth))}
        onMovePreviousDay={() => handleQuickEntryDateChange(shiftLocalDateString(quickEntryDate, -1))}
        onMoveNextDay={() => handleQuickEntryDateChange(shiftLocalDateString(quickEntryDate, 1))}
        attendanceSettings={attendanceSettings}
        markers={activeMarkers}
      />

      {showPrintPreview ? (
        <div
          className="panel panel-section"
          style={{
            padding: 18,
            display: 'grid',
            gap: 14,
          }}
        >
          <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div className="page-kicker" style={{ marginBottom: 6 }}>Anteprima PDF</div>
              <div style={{ color: '#667085' }}>
                Questa area riproduce il layout usato per PDF e stampa del foglio presenze.
              </div>
            </div>
            <button className="button-secondary" onClick={() => setShowPrintPreview(false)}>
              Chiudi anteprima
            </button>
          </div>

          <AttendancePrintAreaPaginated
            ref={printAreaRef}
            currentMonth={currentMonth}
            baseHours={attendanceSettings.baseHours}
            hoursFormat={attendanceSettings.hoursFormat}
            markers={availableMarkers}
            selectedMeta={selectedMeta}
            selectedTeam={selectedTeam}
            displayRows={activePrintRows}
            modeLabel={getAttendancePrintModeLabel(printSelectionMode)}
            daysInMonth={daysInMonth}
            dayInfoMap={dayInfoMap}
            getAtt={getAtt}
          />
        </div>
      ) : null}
    </div>
  );
}

const AttendancePrintArea = React.forwardRef(function AttendancePrintArea(
  { currentMonth, baseHours, hoursFormat, markers, selectedMeta, selectedTeam, displayRows, daysInMonth, dayInfoMap, getAtt },
  ref
) {
  const monthLabel = fileMonthLabel(currentMonth);
  const title =
    selectedMeta.type === 'team' && selectedTeam
      ? `Presenze squadra - ${selectedTeam.name}`
      : selectedMeta.type === 'employee'
      ? 'Presenze dipendente'
      : 'Presenze mensili';

  const subtitle =
    selectedMeta.type === 'team' && selectedTeam
      ? `${monthLabel} · ${displayRows.length} componenti`
      : monthLabel;
  const quickSymbolLabel = `X = ${formatHoursValue(baseHours, hoursFormat)}`;

  return (
    <div ref={ref} className="print-area">
      <div style={attendancePrintCardStyle}>
        <div style={attendancePrintHeaderStyle}>
          <div>
            <h2 style={{ margin: 0, fontSize: 22, color: '#14213d' }}>{title}</h2>
            <div style={{ marginTop: 6, color: '#667085' }}>{subtitle}</div>
          </div>
          <div style={attendancePrintQuickSymbolBadgeStyle}>{quickSymbolLabel}</div>
        </div>

        <table style={attendancePrintTableStyle}>
          <thead>
            <tr>
              <th style={{ ...attendancePrintHeadCellStyle, ...attendancePrintNameCellStyle }}>Dipendente</th>
              {daysInMonth.map((day) => {
                const dateStr = formatDate(day);
                const dayInfo = dayInfoMap[dateStr];
                return (
                  <th
                    key={`print-head-${dateStr}`}
                    style={{
                      ...attendancePrintHeadCellStyle,
                      ...getPrintDayCellInlineStyle(dayInfo),
                    }}
                  >
                    {day.getDate()}
                    <br />
                    <span style={{ fontSize: 9, fontWeight: 600 }}>{getDayLabel(day)}</span>
                  </th>
                );
              })}
              <th style={attendancePrintHeadCellStyle}>Ore</th>
              <th style={attendancePrintHeadCellStyle}>Riepilogo</th>
            </tr>
          </thead>
          <tbody>
            {displayRows.map(({ employee, teamMember }) => {
              let totalHours = 0;

              return (
                <tr key={`print-row-${employee.id}`}>
                  <td style={{ ...attendancePrintBodyCellStyle, ...attendancePrintNameCellStyle, textAlign: 'left' }}>
                    <strong>{employee.last_name} {employee.first_name}</strong>
                    {employee.role ? (
                      <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>{employee.role}</div>
                    ) : null}
                    {teamMember?.manage_by_days ? (
                      <div style={{ fontSize: 9, color: '#6b7280', marginTop: 2 }}>Gestione a giornate</div>
                    ) : null}
                  </td>
                  {daysInMonth.map((day) => {
                    const dateStr = formatDate(day);
                    const att = getAtt(employee.id, dateStr);
                    const dayInfo = dayInfoMap[dateStr];
                    const hours = Number(att?.hours_worked || 0) + Number(att?.overtime_hours || 0);
                    if (hours > 0) {
                      totalHours += hours;
                    }

                    return (
                      <td
                        key={`print-cell-${employee.id}-${dateStr}`}
                        style={{
                          ...attendancePrintBodyCellStyle,
                          ...getPrintDayCellInlineStyle(dayInfo),
                        }}
                      >
                        <AttendancePrintCell
                          mainValue={getAttendancePrintMainValue(att, hoursFormat)}
                          overtimeValue={getAttendancePrintOvertimeValue(att, hoursFormat)}
                          markerValue={getAttendancePrintMarkerValue(att, markers)}
                        />
                      </td>
                    );
                  })}
                  <td style={attendancePrintBodyCellStyle}>
                    <strong>{formatHoursValue(totalHours, hoursFormat)}</strong>
                  </td>
                  <td style={attendancePrintBodyCellStyle}>
                    <strong>{formatWorkedSummary(totalHours, baseHours, hoursFormat)}</strong>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});

const AttendancePrintAreaPaginated = React.forwardRef(function AttendancePrintAreaPaginated(
  { currentMonth, baseHours, hoursFormat, markers, selectedMeta, selectedTeam, displayRows, modeLabel, daysInMonth, dayInfoMap, getAtt },
  ref
) {
  const monthLabel = fileMonthLabel(currentMonth);
  const title =
    selectedMeta.type === 'team' && selectedTeam
      ? `Presenze squadra - ${selectedTeam.name}`
      : selectedMeta.type === 'employee'
      ? 'Presenze dipendente'
      : 'Presenze mensili';

  const subtitle =
    selectedMeta.type === 'team' && selectedTeam
      ? `${monthLabel} · ${displayRows.length} componenti`
      : `${monthLabel} · ${modeLabel}`;
  const quickSymbolLabel = `X = ${formatHoursValue(baseHours, hoursFormat)}`;
  const printPages = useMemo(() => paginateAttendancePrintRows(displayRows), [displayRows]);

  return (
    <div ref={ref} className="print-area attendance-print-area">
      <style>{`
        @page {
          size: A4 landscape;
          margin: 8mm;
        }
      `}</style>
      {printPages.map((page, pageIndex) => (
        <section
          key={`attendance-print-page-${pageIndex}`}
          className="attendance-print-page"
          style={attendancePrintPageStyle}
        >
          <div style={attendancePrintCardStyle}>
            <div style={attendancePrintHeaderStyle}>
              <div>
                <h2 style={attendancePrintTitleStyle}>{title}</h2>
                <div style={attendancePrintSubtitleStyle}>
                  {subtitle} · Pagina {pageIndex + 1} / {printPages.length}
                </div>
              </div>
              <div style={attendancePrintHeaderMetaStyle}>
                <div style={attendancePrintQuickSymbolBadgeStyle}>{quickSymbolLabel}</div>
                <div style={attendancePrintModeBadgeStyle}>{modeLabel}</div>
              </div>
            </div>

            <table style={attendancePrintTableStyle}>
              <colgroup>
                <col style={attendancePrintNameColumnStyle} />
                {daysInMonth.map((day) => (
                  <col key={`print-col-${pageIndex}-${formatDate(day)}`} style={attendancePrintDayColumnStyle} />
                ))}
                <col style={attendancePrintHoursColumnStyle} />
                <col style={attendancePrintSummaryColumnStyle} />
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...attendancePrintHeadCellStyle, ...attendancePrintNameHeadCellStyle }}>Dipendente</th>
                  {daysInMonth.map((day) => {
                    const dateStr = formatDate(day);
                    const dayInfo = dayInfoMap[dateStr];
                    return (
                      <th
                        key={`print-head-${pageIndex}-${dateStr}`}
                        style={{
                          ...attendancePrintHeadCellStyle,
                          ...getPrintDayCellInlineStyle(dayInfo),
                        }}
                      >
                        {day.getDate()}
                        <br />
                        <span style={attendancePrintDayLabelStyle}>{getDayLabel(day)}</span>
                      </th>
                    );
                  })}
                  <th style={attendancePrintHeadCellStyle}>Ore</th>
                  <th style={attendancePrintHeadCellStyle}>Riep.</th>
                </tr>
              </thead>
              <tbody>
                {page.rows.map(({ employee, teamMember }) => {
                  let totalHours = 0;

                  return (
                    <tr key={`print-row-${pageIndex}-${employee.id}`}>
                      <td style={{ ...attendancePrintBodyCellStyle, ...attendancePrintNameCellStyle, textAlign: 'left' }}>
                        <strong>{employee.last_name} {employee.first_name}</strong>
                        {employee.role ? <div style={attendancePrintEmployeeMetaStyle}>{employee.role}</div> : null}
                        {teamMember?.manage_by_days ? (
                          <div style={attendancePrintEmployeeMetaStyle}>Gestione a giornate</div>
                        ) : null}
                      </td>
                      {daysInMonth.map((day) => {
                        const dateStr = formatDate(day);
                        const att = getAtt(employee.id, dateStr);
                        const dayInfo = dayInfoMap[dateStr];
                        const hours = Number(att?.hours_worked || 0) + Number(att?.overtime_hours || 0);
                        if (hours > 0) {
                          totalHours += hours;
                        }

                        return (
                          <td
                            key={`print-cell-${pageIndex}-${employee.id}-${dateStr}`}
                            style={{
                              ...attendancePrintBodyCellStyle,
                              ...getPrintDayCellInlineStyle(dayInfo),
                            }}
                          >
                            <AttendancePrintCell
                              mainValue={getAttendancePrintMainValue(att, hoursFormat)}
                              overtimeValue={getAttendancePrintOvertimeValue(att, hoursFormat)}
                              markerValue={getAttendancePrintMarkerValue(att, markers)}
                            />
                          </td>
                        );
                      })}
                      <td style={attendancePrintBodyCellStyle}>
                        <strong>{formatHoursValue(totalHours, hoursFormat)}</strong>
                      </td>
                      <td style={attendancePrintBodyCellStyle}>
                        <strong>{formatCompactWorkedSummary(totalHours, baseHours, hoursFormat)}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
});

function AttendancePrintCell({ mainValue, overtimeValue, markerValue }) {
  const hasMain = !!mainValue;
  const lowerRows = [overtimeValue, markerValue].filter(Boolean);

  if (!hasMain && !lowerRows.length) {
    return <div style={attendancePrintCellSingleStyle}>—</div>;
  }

  if (hasMain && !lowerRows.length) {
    return <div style={attendancePrintCellSingleStyle}>{mainValue}</div>;
  }

  return (
    <div style={attendancePrintCellStackStyle}>
      {hasMain ? (
        <div style={attendancePrintCellSingleUpperStyle}>{mainValue}</div>
      ) : null}

      <div
        style={{
          ...attendancePrintCellLowerGroupStyle,
          ...(hasMain ? attendancePrintCellLowerGroupDividerStyle : null),
          gridTemplateRows: `repeat(${lowerRows.length}, minmax(0, 1fr))`,
        }}
      >
        {lowerRows.map((rowValue, index) => (
          <div
            key={`${rowValue}-${index}`}
            style={attendancePrintCellRowStyle}
          >
            {typeof rowValue === 'string' ? rowValue : <MarkerVisual marker={rowValue} size={14} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function MarkerVisual({ marker, size = 14 }) {
  const imageSrc = resolveMarkerImageSrc(marker?.image);

  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={marker?.text || marker?.value || 'marker'}
        style={{ width: size, height: size, objectFit: 'contain', display: 'inline-block' }}
      />
    );
  }

  return <>{marker?.symbol || '•'}</>;
}

function getPrintDayCellInlineStyle(dayInfo) {
  if (!dayInfo?.isSpecialDay) {
    return {};
  }

  return {
    background: dayInfo.isHoliday ? '#fee2e2' : '#fff5f5',
    color: '#991b1b',
  };
}

function getCalendarHeaderStyle(dayInfo) {
  if (!dayInfo?.isSpecialDay) {
    return {};
  }

  return {
    background: dayInfo.isHoliday ? '#fee2e2' : '#fef2f2',
    color: '#991b1b',
    borderBottomColor: '#fecaca',
  };
}

function getCalendarCellStyle(dayInfo) {
  if (!dayInfo?.isSpecialDay) {
    return {};
  }

  return {
    background: dayInfo.isHoliday ? '#fef2f2' : '#fff5f5',
  };
}

const thStyleLeft = {
  padding: 10,
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
  position: 'sticky',
  left: 0,
  top: 0,
  background: '#f9fafb',
  zIndex: 6,
  minWidth: 180,
};

const thStyleCenter = {
  padding: '5px 3px',
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'center',
  minWidth: 42,
  fontSize: 11,
  lineHeight: 1.2,
  position: 'sticky',
  top: 0,
  background: '#f9fafb',
  zIndex: 4,
};

const tdStyleLeft = {
  padding: 10,
  borderBottom: '1px solid #f1f5f9',
  textAlign: 'left',
  position: 'sticky',
  left: 0,
  background: '#fff',
  minWidth: 180,
};

const tdStyleCenter = {
  padding: '4px 2px',
  borderBottom: '1px solid #f1f5f9',
  textAlign: 'center',
  verticalAlign: 'top',
};

const thStyleLeftCompact = {
  ...thStyleLeft,
  padding: 8,
  minWidth: 160,
};

const thStyleCenterCompact = {
  ...thStyleCenter,
  padding: '4px 2px',
  minWidth: 36,
  fontSize: 10,
  lineHeight: 1.1,
};

const tdStyleLeftCompact = {
  ...tdStyleLeft,
  padding: 8,
  minWidth: 160,
};

const tdStyleCenterCompact = {
  ...tdStyleCenter,
  padding: '3px 1px',
};

const ATTENDANCE_TOTALS_HOURS_WIDTH = 68;
const ATTENDANCE_TOTALS_SUMMARY_WIDTH = 96;
const ATTENDANCE_TOTALS_HOURS_WIDTH_COMPACT = 56;
const ATTENDANCE_TOTALS_SUMMARY_WIDTH_COMPACT = 78;

const thStyleRightHours = {
  ...thStyleCenter,
  position: 'sticky',
  top: 0,
  right: ATTENDANCE_TOTALS_SUMMARY_WIDTH,
  background: '#f9fafb',
  zIndex: 5,
  width: ATTENDANCE_TOTALS_HOURS_WIDTH,
  minWidth: ATTENDANCE_TOTALS_HOURS_WIDTH,
  borderLeft: '1px solid #e5e7eb',
  boxShadow: 'inset 1px 0 0 rgba(15, 23, 42, 0.06)',
};

const thStyleRightSummary = {
  ...thStyleCenter,
  position: 'sticky',
  top: 0,
  right: 0,
  background: '#f9fafb',
  zIndex: 5,
  width: ATTENDANCE_TOTALS_SUMMARY_WIDTH,
  minWidth: ATTENDANCE_TOTALS_SUMMARY_WIDTH,
};

const tdStyleRightHours = {
  ...tdStyleCenter,
  position: 'sticky',
  right: ATTENDANCE_TOTALS_SUMMARY_WIDTH,
  background: '#fff',
  zIndex: 2,
  width: ATTENDANCE_TOTALS_HOURS_WIDTH,
  minWidth: ATTENDANCE_TOTALS_HOURS_WIDTH,
  borderLeft: '1px solid #e5e7eb',
  boxShadow: 'inset 1px 0 0 rgba(15, 23, 42, 0.04)',
  fontWeight: 700,
};

const tdStyleRightSummary = {
  ...tdStyleCenter,
  position: 'sticky',
  right: 0,
  background: '#fff',
  zIndex: 2,
  width: ATTENDANCE_TOTALS_SUMMARY_WIDTH,
  minWidth: ATTENDANCE_TOTALS_SUMMARY_WIDTH,
  fontWeight: 700,
};

const thStyleRightHoursCompact = {
  ...thStyleCenterCompact,
  position: 'sticky',
  top: 0,
  right: ATTENDANCE_TOTALS_SUMMARY_WIDTH_COMPACT,
  background: '#f9fafb',
  zIndex: 5,
  width: ATTENDANCE_TOTALS_HOURS_WIDTH_COMPACT,
  minWidth: ATTENDANCE_TOTALS_HOURS_WIDTH_COMPACT,
  borderLeft: '1px solid #e5e7eb',
  boxShadow: 'inset 1px 0 0 rgba(15, 23, 42, 0.06)',
};

const thStyleRightSummaryCompact = {
  ...thStyleCenterCompact,
  position: 'sticky',
  top: 0,
  right: 0,
  background: '#f9fafb',
  zIndex: 5,
  width: ATTENDANCE_TOTALS_SUMMARY_WIDTH_COMPACT,
  minWidth: ATTENDANCE_TOTALS_SUMMARY_WIDTH_COMPACT,
};

const tdStyleRightHoursCompact = {
  ...tdStyleCenterCompact,
  position: 'sticky',
  right: ATTENDANCE_TOTALS_SUMMARY_WIDTH_COMPACT,
  background: '#fff',
  zIndex: 2,
  width: ATTENDANCE_TOTALS_HOURS_WIDTH_COMPACT,
  minWidth: ATTENDANCE_TOTALS_HOURS_WIDTH_COMPACT,
  borderLeft: '1px solid #e5e7eb',
  boxShadow: 'inset 1px 0 0 rgba(15, 23, 42, 0.04)',
  fontWeight: 700,
  fontSize: 10,
};

const tdStyleRightSummaryCompact = {
  ...tdStyleCenterCompact,
  position: 'sticky',
  right: 0,
  background: '#fff',
  zIndex: 2,
  width: ATTENDANCE_TOTALS_SUMMARY_WIDTH_COMPACT,
  minWidth: ATTENDANCE_TOTALS_SUMMARY_WIDTH_COMPACT,
  fontWeight: 700,
  fontSize: 10,
};

const todayHeaderStyle = {
  background: 'linear-gradient(180deg, rgba(219, 234, 254, 0.9), rgba(239, 246, 255, 0.95))',
  boxShadow: 'inset 0 -2px 0 rgba(37, 99, 235, 0.25)',
};

const todayCellStyle = {
  background: 'rgba(239, 246, 255, 0.86)',
  boxShadow: 'inset 1px 0 0 rgba(37, 99, 235, 0.12), inset -1px 0 0 rgba(37, 99, 235, 0.12)',
};

const attendancePrintCardStyle = {
  background: '#fff',
  border: '1px solid #dbe4f0',
  borderRadius: 12,
  padding: 8,
  boxShadow: '0 10px 24px rgba(15, 23, 42, 0.05)',
};

const attendancePrintPageStyle = {
  width: '100%',
  display: 'grid',
  gap: 0,
};

const attendancePrintHeaderStyle = {
  marginBottom: 6,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'nowrap',
};

const attendancePrintTitleStyle = {
  margin: 0,
  fontSize: 16,
  lineHeight: 1.05,
  color: '#14213d',
  fontWeight: 800,
};

const attendancePrintSubtitleStyle = {
  marginTop: 2,
  color: '#667085',
  fontSize: 9,
  lineHeight: 1.2,
};

const attendancePrintHeaderMetaStyle = {
  display: 'grid',
  justifyItems: 'end',
  gap: 4,
};

const attendancePrintQuickSymbolBadgeStyle = {
  padding: '4px 8px',
  borderRadius: 999,
  border: '1px solid rgba(20, 33, 61, 0.12)',
  background: 'rgba(20, 33, 61, 0.05)',
  color: '#27445f',
  fontSize: 9,
  fontWeight: 800,
  whiteSpace: 'nowrap',
};

const attendancePrintModeBadgeStyle = {
  padding: '3px 7px',
  borderRadius: 999,
  border: '1px solid rgba(20, 33, 61, 0.1)',
  background: 'rgba(22, 163, 74, 0.08)',
  color: '#166534',
  fontSize: 8,
  fontWeight: 800,
  whiteSpace: 'nowrap',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const attendancePrintTableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 8.6,
};

const attendancePrintHeadCellStyle = {
  border: '1px solid #9ca3af',
  padding: '3px 2px',
  textAlign: 'center',
  fontWeight: 800,
  background: '#f8fafc',
  minWidth: 0,
  lineHeight: 1.05,
};

const attendancePrintBodyCellStyle = {
  border: '1px solid #9ca3af',
  padding: '3px 2px',
  textAlign: 'center',
  verticalAlign: 'middle',
  overflow: 'hidden',
  minWidth: 0,
};

const attendancePrintNameCellStyle = {
  minWidth: 124,
  maxWidth: 124,
};

const attendancePrintNameHeadCellStyle = {
  minWidth: 124,
};

const attendancePrintNameColumnStyle = {
  width: '124px',
};

const attendancePrintDayColumnStyle = {
  width: '21px',
};

const attendancePrintHoursColumnStyle = {
  width: '48px',
};

const attendancePrintSummaryColumnStyle = {
  width: '66px',
};

const attendancePrintDayLabelStyle = {
  fontSize: 7.2,
  fontWeight: 700,
  lineHeight: 1,
};

const attendancePrintEmployeeMetaStyle = {
  fontSize: 7.4,
  color: '#6b7280',
  marginTop: 1,
  lineHeight: 1.1,
};

const attendancePrintCellStackStyle = {
  minHeight: 18,
  display: 'grid',
  width: '100%',
  overflow: 'hidden',
  borderRadius: 2,
  background: '#ffffff',
};

const attendancePrintCellSingleStyle = {
  minHeight: 18,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  fontSize: 7.1,
  fontWeight: 800,
  lineHeight: 1.05,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const attendancePrintCellSingleUpperStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  minHeight: 0,
  fontSize: 7.1,
  fontWeight: 800,
  lineHeight: 1.05,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const attendancePrintCellLowerGroupStyle = {
  display: 'grid',
  width: 'calc(100% + 10px)',
  marginLeft: -5,
  marginRight: -5,
};

const attendancePrintCellLowerGroupDividerStyle = {
  borderTop: '1px solid rgba(156, 163, 175, 0.7)',
};

const attendancePrintCellRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  minHeight: 0,
  fontSize: 6.8,
  fontWeight: 800,
  lineHeight: 1.05,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
