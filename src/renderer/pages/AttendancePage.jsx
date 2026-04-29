import React, { useEffect, useMemo, useRef, useState } from 'react';
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

function getAttendanceCellText(att, hoursFormat = 'decimal', markers = DEFAULT_DAY_MARKERS) {
  if (!att) return '';
  const markerSymbol = getMarkerMeta(att.marker_code, markers)?.symbol || att.marker_code || '';

  if (att.status && att.status !== 'presente' && att.status !== 'assente') {
    const special = [...MAIN_DAY_TYPES, ...LEGACY_DAY_TYPES].find((item) => item.value === att.status);
    const marker = markerSymbol ? ` ${markerSymbol}` : '';
    return `${special?.code || att.status}${marker}`;
  }

  if (att.entry_code) {
    return att.entry_code;
  }

  const hoursText =
    att.hours_worked !== undefined && att.hours_worked !== null && att.hours_worked !== ''
      ? att.entry_code
        ? String(att.entry_code)
        : formatHoursValue(att.hours_worked, hoursFormat)
      : '';
  const overtimeHours = Number(att.overtime_hours || 0);
  const overtimeText = overtimeHours > 0 ? `STR ${formatHoursValue(overtimeHours, hoursFormat)}` : '';

  if (hoursText && overtimeText && markerSymbol) {
    return `${hoursText} + ${overtimeText} ${markerSymbol}`;
  }

  if (hoursText && overtimeText) {
    return `${hoursText} + ${overtimeText}`;
  }

  if (hoursText && markerSymbol) {
    return `${hoursText} ${markerSymbol}`;
  }

  if (overtimeText && markerSymbol) {
    return `${overtimeText} ${markerSymbol}`;
  }

  return hoursText || overtimeText || markerSymbol || '';
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

function getOvertimeInputValue(att) {
  return splitHoursToParts(att?.overtime_hours);
}

function getAttendanceSettings(settings) {
  return {
    inputMode: settings?.general?.attendance_entry_mode === 'hours_only' ? 'hours_only' : 'hours_and_symbol',
    hoursFormat: settings?.general?.attendance_hours_format === 'hours_minutes' ? 'hours_minutes' : 'decimal',
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

function parseHoursMinutesValue(hoursRaw, minutesRaw, attendanceSettings) {
  const hoursValue = String(hoursRaw || '').trim().toUpperCase();
  const minutesValue = String(minutesRaw || '').trim();

  if (!hoursValue && !minutesValue) {
    return { kind: 'empty' };
  }

  const mainType = MAIN_DAY_TYPES.find((item) => item.code === hoursValue);
  if (mainType) {
    return { kind: 'type', status: mainType.value };
  }

  if (
    attendanceSettings?.inputMode === 'hours_and_symbol' &&
    hoursValue === attendanceSettings.quickSymbol
  ) {
    return {
      kind: 'symbol',
      symbol: attendanceSettings.quickSymbol,
      hours: attendanceSettings.baseHours,
    };
  }

  const normalizedHours = hoursValue === '' ? 0 : Number(hoursValue);
  const normalizedMinutes = minutesValue === '' ? 0 : Number(minutesValue);

  if (
    !Number.isInteger(normalizedHours) ||
    normalizedHours < 0 ||
    !Number.isInteger(normalizedMinutes) ||
    normalizedMinutes < 0 ||
    normalizedMinutes > 59
  ) {
    return { kind: 'invalid' };
  }

  const totalHours = normalizedHours + normalizedMinutes / 60;
  if (totalHours <= 0) {
    return { kind: 'empty' };
  }

  return { kind: 'hours', hours: totalHours };
}

function parseOvertimeInputValue(rawValue, attendanceSettings) {
  const parsed = parseMainInputValue(rawValue, attendanceSettings);
  if (parsed.kind === 'type') {
    return { kind: 'invalid' };
  }
  return parsed;
}

function parseOvertimeHoursMinutesValue(hoursRaw, minutesRaw, attendanceSettings) {
  const parsed = parseHoursMinutesValue(hoursRaw, minutesRaw, attendanceSettings);
  if (parsed.kind === 'type') {
    return { kind: 'invalid' };
  }
  return parsed;
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
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [settings, setSettings] = useState(null);
  const [selectedEntity, setSelectedEntity] = useState('all');
  const [pendingChanges, setPendingChanges] = useState({});
  const [inputDrafts, setInputDrafts] = useState({});
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState('idle');
  const [showQuickEntry, setShowQuickEntry] = useState(false);
  const [quickEntryDate, setQuickEntryDate] = useState(formatLocalDate(new Date()));
  const [openMarkerMenuKey, setOpenMarkerMenuKey] = useState(null);
  const [showPrintPreview, setShowPrintPreview] = useState(false);
  const printAreaRef = useRef(null);
  const tableShellRef = useRef(null);

  const daysInMonth = useMemo(() => getMonthDays(currentMonth), [currentMonth]);
  const dayInfoMap = useMemo(
    () => Object.fromEntries(daysInMonth.map((day) => [formatDate(day), getCalendarDayInfo(day)])),
    [daysInMonth]
  );
  const currentMonthKey = monthString(currentMonth);
  const pendingChangesRef = useRef({});
  const isSavingRef = useRef(false);
  const statusTimeoutRef = useRef(null);

  async function loadData() {
    setLoading(true);
    try {
      const [employeeData, teamData, data, settingsData] = await Promise.all([
        window.api.employees.list(),
        window.api.teams.list(),
        window.api.attendance.listByMonth(
          currentMonth.getFullYear(),
          currentMonth.getMonth() + 1
        ),
        window.api.settings.get(),
      ]);

      setEmployees(employeeData || []);
      setTeams(teamData || []);
      setAttendance((data || []).map(normalizeAttendanceEntry));
      setSettings(settingsData || null);
      setPendingChanges({});
      setInputDrafts({});
      setSelectedEmployeeIds([]);
      pendingChangesRef.current = {};
    } catch (err) {
      console.error(err);
      alert('Errore caricamento presenze');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
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
  }, []);

  useEffect(() => {
    setOpenMarkerMenuKey(null);
  }, [selectedEntity, currentMonthKey]);

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

  const selectedMeta = parseSelection(selectedEntity);
  const visibleTeams = useMemo(
    () => teams.filter((team) => buildTeamRows(team, selectedYear).length > 0),
    [teams, selectedYear]
  );
  const selectedTeam = selectedMeta.type === 'team'
    ? visibleTeams.find((team) => Number(team.id) === selectedMeta.id) || null
    : null;

  const displayRows = useMemo(() => {
    if (selectedMeta.type === 'employee') {
      const employee = activeEmployees.find((item) => Number(item.id) === selectedMeta.id);
      return employee ? [{ employee, teamMember: null }] : [];
    }

    if (selectedMeta.type === 'team') {
      return buildTeamRows(selectedTeam, selectedYear);
    }

    return activeEmployees.map((employee) => ({
      employee,
      teamMember: null,
    }));
  }, [activeEmployees, selectedMeta, selectedTeam, selectedYear]);

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
    }
  }, [selectedMeta.type, selectedMeta.id, activeEmployees, visibleTeams]);

  useEffect(() => {
    setSelectedEmployeeIds((current) =>
      current.filter((employeeId) => visibleEmployeeIds.includes(Number(employeeId)))
    );
  }, [visibleEmployeeIds]);

  const attendanceMap = useMemo(() => {
    const map = {};
    for (const item of attendance) {
      map[`${item.employee_id}_${item.date}`] = item;
    }
    return map;
  }, [attendance]);

  const getAtt = (employeeId, date) => {
    const key = `${employeeId}_${date}`;
    return pendingChanges[key] !== undefined ? pendingChanges[key] : attendanceMap[key];
  };

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

  function markDirtyState() {
    if (!isSavingRef.current) {
      setSaveState('dirty');
    }
  }

  function queuePendingEntry(employeeId, date, nextEntry) {
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
      console.error(err);
      setSaveState('error');
      alert('Errore salvataggio automatico presenze');
    } finally {
      isSavingRef.current = false;

      if (Object.keys(pendingChangesRef.current).length > 0) {
        setTimeout(() => {
          flushPendingChanges();
        }, 100);
      }
    }
  }

  function handleMainValueChange(employeeId, date, value) {
    const existing = getAtt(employeeId, date);
    setInputDraft(employeeId, date, 'main', value);
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
  }

  function handleHoursMinutesValueChange(employeeId, date, field, value) {
    const existing = getAtt(employeeId, date);
    const currentParts = getHoursMinutesInputValue(existing);
    const nextHours = field === 'hours' ? value : currentParts.hours;
    const nextMinutes = field === 'minutes' ? value : currentParts.minutes;
    const parsed = parseHoursMinutesValue(nextHours, nextMinutes, attendanceSettings);

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
            status: parsed.kind === 'empty' ? 'presente' : 'presente',
            marker_code: existing?.marker_code || null,
            entry_code: null,
            hours_worked: parsed.kind === 'empty' ? '' : parsed.hours,
            overtime_hours: existing?.overtime_hours || 0,
            notes: existing?.notes || null,
          };

    queuePendingEntry(employeeId, date, nextEntry);
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

  function handleOvertimeHoursMinutesChange(employeeId, date, field, value) {
    const existing = getAtt(employeeId, date);
    const currentParts = getOvertimeInputValue(existing);
    const nextHours = field === 'hours' ? value : currentParts.hours;
    const nextMinutes = field === 'minutes' ? value : currentParts.minutes;
    const parsed = parseOvertimeHoursMinutesValue(nextHours, nextMinutes, attendanceSettings);

    if (parsed.kind === 'invalid') {
      return;
    }

    const mergedExisting = getAtt(employeeId, date);
    queuePendingEntry(employeeId, date, {
        employee_id: employeeId,
        date,
        status: mergedExisting?.status || 'presente',
        marker_code: mergedExisting?.marker_code || null,
        entry_code: mergedExisting?.entry_code || null,
        hours_worked: mergedExisting?.hours_worked ?? '',
        overtime_hours:
          parsed.kind === 'empty'
            ? 0
            : parsed.hours,
        notes: mergedExisting?.notes || null,
    });
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
      if (attendanceSettings.hoursFormat === 'hours_minutes') {
        const existing = getAtt(employeeId, date);
        const parsed = parseHoursMinutesValue(value, minutesValue, attendanceSettings);

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
                status: 'presente',
                marker_code: existing?.marker_code || null,
                entry_code: null,
                hours_worked: parsed.kind === 'empty' ? '' : parsed.hours,
                overtime_hours: existing?.overtime_hours || 0,
                notes: existing?.notes || null,
              };

        queuePendingEntry(employeeId, date, nextEntry);
      } else {
        handleMainValueChange(employeeId, date, value);
      }
    });
  }

  function applyQuickOvertime(employeeIds, date, value, minutesValue = '') {
    if (!Array.isArray(employeeIds) || !employeeIds.length) {
      return;
    }

    employeeIds.forEach((employeeId) => {
      const parsed =
        attendanceSettings.hoursFormat === 'hours_minutes'
          ? parseOvertimeHoursMinutesValue(value, minutesValue, attendanceSettings)
          : parseOvertimeInputValue(value, attendanceSettings);

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

  async function ensurePrintPreviewVisible() {
    await flushPendingChanges();
    setShowPrintPreview(true);
  }

  async function handlePreviewPdf() {
    await ensurePrintPreviewVisible();
    setTimeout(() => {
      printAreaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
  }

  async function handlePrint() {
    await ensurePrintPreviewVisible();

    const printArea = printAreaRef.current;
    if (!printArea) {
      alert('Anteprima PDF non disponibile');
      return;
    }

    try {
      const monthLabel = fileMonthLabel(currentMonth);
      const monthKey = sanitizeFileName(monthLabel);
      const fileName =
        selectedMeta.type === 'team' && selectedTeam
          ? sanitizeFileName(`Presenze - ${selectedTeam.name} - ${monthKey}.pdf`)
          : 'Presenze-mensili.pdf';

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

  async function handleSavePdf() {
    const printArea = printAreaRef.current;
    if (!printArea) {
      alert('Anteprima PDF non disponibile');
      return;
    }

    try {
      await ensurePrintPreviewVisible();

      const monthLabel = fileMonthLabel(currentMonth);
      const monthKey = sanitizeFileName(monthLabel);
      const fileName =
        selectedMeta.type === 'team' && selectedTeam
          ? sanitizeFileName(`Presenze - ${selectedTeam.name} - ${monthKey}.pdf`)
          : 'Presenze-mensili.pdf';

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
  const allVisibleSelected = visibleEmployeeIds.length > 0 && visibleEmployeeIds.every((employeeId) => selectedEmployeeIds.includes(employeeId));
  const todayKey = formatLocalDate(new Date());

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
            <button className="button-secondary" onClick={handlePreviewPdf}>Anteprima PDF</button>
            <button className="button" onClick={handleSavePdf}>Genera PDF</button>
            <button className="button-secondary" onClick={handlePrint}>Stampa</button>
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
            <option value="all">Tutti i dipendenti</option>
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
                  Squadra • {team.name}
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
      ) : null}

      <div className="panel panel-section" style={{ padding: 18 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#115e59' }}>
              Legenda principale
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="soft-chip" style={{ background: 'rgba(37, 99, 235, 0.1)', color: '#1d4ed8' }}>
                {selectedEmployeeIds.length} selezionati
              </span>
              <span className="soft-chip" style={{ background: 'rgba(20, 33, 61, 0.06)', color: '#314762' }}>
                Selezione multipla pronta per azioni batch
              </span>
            </div>
          </div>
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
        <div>Caricamento...</div>
      ) : (
        <div className="attendance-table-shell" ref={tableShellRef}>
          <table className="attendance-table">
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={thStyleLeft}>
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
                      ...thStyleCenter,
                      ...getCalendarHeaderStyle(dayInfoMap[formatDate(day)]),
                      ...(formatDate(day) === todayKey ? todayHeaderStyle : {}),
                    }}
                    title={dayInfoMap[formatDate(day)]?.holidayLabel || undefined}
                  >
                    {day.getDate()}
                    <br />
                    <span
                      style={{
                        fontSize: 10,
                        color: dayInfoMap[formatDate(day)]?.isSpecialDay ? '#991b1b' : '#6b7280',
                        fontWeight: dayInfoMap[formatDate(day)]?.isSpecialDay ? 800 : 500,
                      }}
                    >
                      {getDayLabel(day)}
                    </span>
                  </th>
                ))}
                <th style={thStyleCenter}>Ore tot.</th>
                <th style={thStyleCenter}>Riepilogo</th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map(({ employee, teamMember }) => {
                const memberRecords = daysInMonth.map((day) => getAtt(employee.id, formatDate(day)));
                const totals = calculateAttendanceTotals(memberRecords, attendanceSettings.baseHours);

                return (
                  <tr key={employee.id}>
                    <td style={tdStyleLeft}>
                      <div className="attendance-left-cell">
                        <input
                          type="checkbox"
                          checked={selectedEmployeeIds.includes(employee.id)}
                          onChange={(event) => toggleEmployeeSelection(employee.id, event.target.checked)}
                          aria-label={`Seleziona ${employee.first_name} ${employee.last_name}`}
                        />
                        <div>
                          <div className="attendance-employee-name">{employee.first_name} {employee.last_name}</div>
                          <div style={{ fontSize: 10, color: '#6b7280' }}>
                            {employee.role || ''}
                            {teamMember?.manage_by_days ? ' · gestione a giornate' : ''}
                          </div>
                        </div>
                      </div>
                    </td>

                    {daysInMonth.map((day) => {
                      const dateStr = formatDate(day);
                      const att = getAtt(employee.id, dateStr);
                      const isSpecial = att?.status && att.status !== 'presente' && att.status !== 'assente';
                      const specialOpt = getMainTypeMeta(att?.status);
                      const markerMeta = getMarkerMeta(att?.marker_code, availableMarkers);
                      const dayInfo = dayInfoMap[dateStr];
                      const markerMenuKey = `${employee.id}_${dateStr}`;
                      const isMainType = MAIN_DAY_TYPES.some((item) => item.value === att?.status);
                      const isEditingMarker = openMarkerMenuKey === markerMenuKey || !markerMeta;
                      const hmValue = getHoursMinutesInputValue(att);
                      const overtimeHmValue = getOvertimeInputValue(att);

                      return (
                        <td
                          key={dateStr}
                          style={{
                            ...tdStyleCenter,
                            ...getCalendarCellStyle(dayInfo),
                            ...(dateStr === todayKey ? todayCellStyle : {}),
                          }}
                          title={dayInfo?.holidayLabel || undefined}
                        >
                          <div className="attendance-cell-stack">
                            {attendanceSettings.hoursFormat === 'hours_minutes' ? (
                              <div style={{ display: 'grid', gap: 3, justifyItems: 'center' }}>
                                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                  <input
                                    className="attendance-hours-input"
                                    type="text"
                                    inputMode="numeric"
                                    value={hmValue.hours}
                                    onChange={(event) => handleHoursMinutesValueChange(employee.id, dateStr, 'hours', event.target.value)}
                                    onFocus={selectAllInputText}
                                    onClick={selectAllInputText}
                                    onKeyDown={handleGridKeyDown}
                                    data-attendance-focus="true"
                                    placeholder={attendanceSettings.inputMode === 'hours_and_symbol' ? attendanceSettings.quickSymbol : 'h'}
                                    style={{
                                      width: 34,
                                      ...(isSpecial
                                        ? { border: '1px solid #f59e0b', background: 'rgba(245, 158, 11, 0.08)', fontWeight: 800 }
                                        : { border: '1px solid #d1d5db', background: '#fff', fontWeight: 600 }),
                                    }}
                                    title={isSpecial ? specialOpt?.text : 'Ore intere oppure simbolo rapido / F / P / M'}
                                  />
                                  <input
                                    className="attendance-hours-input"
                                    type="text"
                                    inputMode="numeric"
                                    value={hmValue.minutes}
                                    onChange={(event) => handleHoursMinutesValueChange(employee.id, dateStr, 'minutes', event.target.value)}
                                    onFocus={selectAllInputText}
                                    onClick={selectAllInputText}
                                    onKeyDown={handleGridKeyDown}
                                    data-attendance-focus="true"
                                    placeholder="m"
                                    disabled={!!att?.entry_code || isSpecial}
                                    style={{
                                      width: 30,
                                      border: '1px solid #d1d5db',
                                      background: !!att?.entry_code || isSpecial ? '#f3f4f6' : '#fff',
                                      fontWeight: 600,
                                    }}
                                    title="Minuti 0-59"
                                  />
                                </div>
                                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                  <input
                                    className="attendance-hours-input"
                                    type="text"
                                    inputMode="numeric"
                                    value={overtimeHmValue.hours}
                                    onChange={(event) => handleOvertimeHoursMinutesChange(employee.id, dateStr, 'hours', event.target.value)}
                                    onFocus={selectAllInputText}
                                    onClick={selectAllInputText}
                                    onKeyDown={handleGridKeyDown}
                                    data-attendance-focus="true"
                                    placeholder={attendanceSettings.inputMode === 'hours_and_symbol' ? attendanceSettings.quickSymbol : 'str'}
                                    disabled={isSpecial}
                                    style={{
                                      width: 34,
                                      border: '1px solid #c7d2fe',
                                      background: isSpecial ? '#f3f4f6' : '#eef2ff',
                                      fontWeight: 600,
                                    }}
                                    title="Straordinario: ore intere oppure simbolo rapido"
                                  />
                                  <input
                                    className="attendance-hours-input"
                                    type="text"
                                    inputMode="numeric"
                                    value={overtimeHmValue.minutes}
                                    onChange={(event) => handleOvertimeHoursMinutesChange(employee.id, dateStr, 'minutes', event.target.value)}
                                    onFocus={selectAllInputText}
                                    onClick={selectAllInputText}
                                    onKeyDown={handleGridKeyDown}
                                    data-attendance-focus="true"
                                    placeholder="str"
                                    disabled={isSpecial}
                                    style={{
                                      width: 30,
                                      border: '1px solid #c7d2fe',
                                      background: isSpecial ? '#f3f4f6' : '#eef2ff',
                                      fontWeight: 600,
                                    }}
                                    title="Straordinario: minuti 0-59"
                                  />
                                </div>
                              </div>
                            ) : (
                              <>
                                <input
                                  className="attendance-hours-input"
                                  type="text"
                                  inputMode="decimal"
                                  value={getDisplayedInputValue(employee.id, dateStr, 'main', getMainInputValue(att))}
                                  onChange={(event) => handleMainValueChange(employee.id, dateStr, event.target.value)}
                                  onBlur={() => handleMainValueBlur(employee.id, dateStr)}
                                  onFocus={selectAllInputText}
                                  onClick={selectAllInputText}
                                  onKeyDown={handleGridKeyDown}
                                  data-attendance-focus="true"
                                  placeholder=""
                                  style={isSpecial
                                    ? { border: '1px solid #f59e0b', background: 'rgba(245, 158, 11, 0.08)', fontWeight: 800 }
                                    : { border: '1px solid #d1d5db', background: '#fff', fontWeight: 600 }}
                                  title={isSpecial ? specialOpt?.text : 'Inserisci ore oppure F / P / M'}
                                />
                                <input
                                  className="attendance-hours-input"
                                  type="text"
                                  inputMode="decimal"
                                  value={getDisplayedInputValue(
                                    employee.id,
                                    dateStr,
                                    'overtime',
                                    att?.overtime_hours ? String(att.overtime_hours).replace('.', ',') : ''
                                  )}
                                  onChange={(event) => handleOvertimeValueChange(employee.id, dateStr, event.target.value)}
                                  onBlur={() => handleOvertimeValueBlur(employee.id, dateStr)}
                                  onFocus={selectAllInputText}
                                  onClick={selectAllInputText}
                                  onKeyDown={handleGridKeyDown}
                                  data-attendance-focus="true"
                                  placeholder="str"
                                  disabled={isSpecial}
                                  style={{
                                    border: '1px solid #c7d2fe',
                                    background: isSpecial ? '#f3f4f6' : '#eef2ff',
                                    fontWeight: 600,
                                  }}
                                  title="Straordinario separato dalle ore normali"
                                />
                              </>
                            )}

                            {isMainType ? (
                              <span className="attendance-marker-placeholder" />
                            ) : markerMeta && !isEditingMarker ? (
                              <button
                                type="button"
                                onClick={() => setOpenMarkerMenuKey(markerMenuKey)}
                                title={`Marcatore ${markerMeta.text}. Clicca per modificare.`}
                                className="attendance-marker-button"
                                style={{ background: markerMeta.background, color: markerMeta.color }}
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
                                onKeyDown={handleGridKeyDown}
                                data-attendance-focus="true"
                                onBlur={() => {
                                  if (att?.marker_code) {
                                    setOpenMarkerMenuKey(null);
                                  }
                                }}
                                title="Seleziona un marcatore grafico"
                              >
                                <option value="">+</option>
                                {activeMarkers.map((item) => (
                                  <option key={item.value} value={item.value}>
                                    {item.image ? item.text : item.symbol}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        </td>
                      );
                    })}

                    <td style={tdStyleCenter}>{formatHoursValue(totals.totalHours, attendanceSettings.hoursFormat)}</td>
                    <td style={tdStyleCenter}>{formatWorkedSummary(totals.totalHours, attendanceSettings.baseHours, attendanceSettings.hoursFormat)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!displayRows.length ? (
            <div className="empty-state">Nessun dipendente disponibile per la selezione corrente.</div>
          ) : null}
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

      <div
        className="panel panel-section"
        style={{
          padding: 18,
          display: showPrintPreview ? 'grid' : 'none',
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

        <AttendancePrintArea
          ref={printAreaRef}
          currentMonth={currentMonth}
          baseHours={attendanceSettings.baseHours}
          hoursFormat={attendanceSettings.hoursFormat}
          markers={availableMarkers}
          selectedMeta={selectedMeta}
          selectedTeam={selectedTeam}
          displayRows={displayRows}
          daysInMonth={daysInMonth}
          dayInfoMap={dayInfoMap}
          getAtt={getAtt}
        />
      </div>
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

function getPdfDayCellStyle(dayInfo) {
  if (!dayInfo?.isSpecialDay) {
    return '';
  }

  const background = dayInfo.isHoliday ? '#fee2e2' : '#fff5f5';
  return `background:${background};color:#991b1b;`;
}

const thStyleLeft = {
  padding: 10,
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'left',
  position: 'sticky',
  left: 0,
  background: '#f9fafb',
  zIndex: 1,
  minWidth: 180,
};

const thStyleCenter = {
  padding: 10,
  borderBottom: '1px solid #e5e7eb',
  textAlign: 'center',
  minWidth: 74,
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
  padding: 8,
  borderBottom: '1px solid #f1f5f9',
  textAlign: 'center',
  verticalAlign: 'top',
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
  borderRadius: 18,
  padding: 18,
  boxShadow: '0 20px 50px rgba(15, 23, 42, 0.08)',
};

const attendancePrintHeaderStyle = {
  marginBottom: 10,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
  flexWrap: 'wrap',
};

const attendancePrintQuickSymbolBadgeStyle = {
  padding: '6px 10px',
  borderRadius: 999,
  border: '1px solid rgba(20, 33, 61, 0.12)',
  background: 'rgba(20, 33, 61, 0.05)',
  color: '#27445f',
  fontSize: 11,
  fontWeight: 800,
  whiteSpace: 'nowrap',
};

const attendancePrintTableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 10,
};

const attendancePrintHeadCellStyle = {
  border: '1px solid #9ca3af',
  padding: 5,
  textAlign: 'center',
  fontWeight: 800,
  background: '#f8fafc',
  minWidth: 34,
};

const attendancePrintBodyCellStyle = {
  border: '1px solid #9ca3af',
  padding: 5,
  textAlign: 'center',
  verticalAlign: 'middle',
  overflow: 'hidden',
  minWidth: 34,
};

const attendancePrintNameCellStyle = {
  minWidth: 180,
  whiteSpace: 'nowrap',
};

const attendancePrintCellStackStyle = {
  minHeight: 28,
  display: 'grid',
  width: '100%',
  overflow: 'hidden',
  borderRadius: 2,
  background: '#ffffff',
};

const attendancePrintCellSingleStyle = {
  minHeight: 28,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  fontSize: 8,
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
  fontSize: 8,
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
  fontSize: 7.5,
  fontWeight: 800,
  lineHeight: 1.05,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};
