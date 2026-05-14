import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calculateAttendanceTotals, formatHoursValue, formatWorkedSummary, getSafeStandardHours } from '../utils/attendanceSummary';
import { getCalendarDayInfo } from '../utils/holidays';
import QuickAttendanceModal from '../components/QuickAttendanceModal';
import { useYearContext } from '../context/YearContext';
import { employeeIsActiveInYear } from '../utils/yearScope';
import AttendancePrintAreaPaginated, { MarkerVisual } from '../components/attendance/AttendancePrintAreaPaginated';
import {
  fileMonthLabel,
  formatDate,
  formatLocalDate,
  getDayLabel,
  getMarkerMeta,
  formatCompactWorkedSummary,
  getAttendancePrintMainValue,
  getAttendancePrintOvertimeValue,
  getAttendancePrintMarkerValue,
  paginateAttendancePrintRows,
  resolveMarkerImageSrc,
  MAIN_DAY_TYPES,
  LEGACY_DAY_TYPES,
  DEFAULT_DAY_MARKERS,
} from '../utils/attendancePrintUtils';
import AttendanceToolbar from '../components/attendance/AttendanceToolbar';
import AttendanceTable from '../components/attendance/AttendanceTable';
import AttendanceEmployeeFilter from '../components/attendance/AttendanceEmployeeFilter';
import {
  parseMainInputValue,
  formatDecimalPreview,
  getMainTypeMeta,
  selectAllInputText,
  getMainInputValue,
} from '../utils/attendanceTableUtils';
import {
  countAttendanceDiag,
  recordAttendanceTiming,
  setAttendanceDiagValue,
} from '../utils/attendanceDiagnostics';

function useStableCallback(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...args) => ref.current(...args), []);
}

const ATTENDANCE_LAYOUT_STORAGE_KEY = 'attendance_layout_mode_v1';
const ATTENDANCE_EMPLOYEE_FILTER_STORAGE_KEY = 'attendance_employee_filter_v1';
const TEAM_ATTENDANCE_MODE_DETAILS = 'details';
const TEAM_ATTENDANCE_MODE_HEADCOUNT = 'headcount';
const TEAM_HEADCOUNT_ROW_ID_OFFSET = 1000000000;

function readStoredEmployeeFilter() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(ATTENDANCE_EMPLOYEE_FILTER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));
  } catch {
    return [];
  }
}
const EMPTY_ROW_ATTENDANCE = Object.freeze({});
const ATTENDANCE_DIAG_MODE = 'off'; // 'off' | 'a' | 'b' | 'c'
const ATTENDANCE_DIAG = {
  disableAutosaveWrite: ATTENDANCE_DIAG_MODE === 'a',
  disableTableRender: ATTENDANCE_DIAG_MODE === 'b',
  logCounters: ATTENDANCE_DIAG_MODE === 'c',
};
let attendanceDiagSeq = 0;

function getPerfNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function diagStart(label) {
  countAttendanceDiag(label);
  const token = {
    label,
    startedAt: getPerfNow(),
    timeLabel: `[attendance-diag] ${label}#${++attendanceDiagSeq}`,
    logCounters: ATTENDANCE_DIAG.logCounters,
  };
  if (token.logCounters) {
    console.count(`[attendance-diag] ${label}`);
    console.time(token.timeLabel);
  }
  return token;
}

function diagEnd(token, details = undefined) {
  if (!token) {
    return;
  }

  const durationMs = getPerfNow() - token.startedAt;
  if (token.logCounters) {
    console.timeEnd(token.timeLabel);
  }
  recordAttendanceTiming(token.label, durationMs, details);
  if (durationMs > 100) {
    console.warn(`[attendance-diag] slow ${token.label}`, {
      ms: Math.round(durationMs * 100) / 100,
      ...(details || {}),
    });
  }
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
  return value === 'standard' ? 'standard' : 'compact';
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

function sanitizeFileName(value) {
  return value.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
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

function normalizeTeamAttendanceMode(value) {
  return value === TEAM_ATTENDANCE_MODE_HEADCOUNT
    ? TEAM_ATTENDANCE_MODE_HEADCOUNT
    : TEAM_ATTENDANCE_MODE_DETAILS;
}

function isTeamHeadcountMode(team) {
  return normalizeTeamAttendanceMode(team?.attendance_mode) === TEAM_ATTENDANCE_MODE_HEADCOUNT;
}

function getTeamHeadcountRowId(teamId) {
  return -(TEAM_HEADCOUNT_ROW_ID_OFFSET + Number(teamId || 0));
}

function isTeamHeadcountRowId(employeeId) {
  const safeId = Number(employeeId);
  return Number.isFinite(safeId) && safeId <= -TEAM_HEADCOUNT_ROW_ID_OFFSET;
}

function getTeamIdFromHeadcountRowId(employeeId) {
  if (!isTeamHeadcountRowId(employeeId)) {
    return null;
  }
  return Math.abs(Number(employeeId)) - TEAM_HEADCOUNT_ROW_ID_OFFSET;
}

function isHeadcountAttendanceEntry(item) {
  return !!item?.is_headcount_mode || isTeamHeadcountRowId(item?.employee_id);
}

function createHeadcountAttendanceEntry({ teamId, date, headcount, notes, teamName }) {
  const normalizedHeadcount =
    headcount === '' || headcount === null || headcount === undefined ? '' : Number(headcount);

  return normalizeAttendanceEntry({
    employee_id: getTeamHeadcountRowId(teamId),
    team_id: Number(teamId),
    team_name: teamName || null,
    date,
    status: 'presente',
    marker_code: null,
    entry_code: null,
    hours_worked: normalizedHeadcount,
    overtime_hours: 0,
    notes: notes || null,
    is_headcount_mode: true,
  });
}

function parseHeadcountInputValue(rawValue) {
  const normalized = String(rawValue ?? '').trim().replace(',', '.');
  if (!normalized) {
    return { kind: 'empty' };
  }

  const headcount = Number(normalized);
  if (!Number.isFinite(headcount) || headcount < 0) {
    return { kind: 'invalid' };
  }

  return { kind: 'headcount', headcount };
}

function formatHeadcountSummary(value) {
  const safeValue = Number(value || 0);
  if (safeValue <= 0) {
    return '0 gg';
  }

  const normalized = Number.isInteger(safeValue)
    ? String(safeValue)
    : safeValue.toFixed(2).replace(/\.?0+$/, '');
  return `${normalized} gg`;
}

function calculateHeadcountTotals(records = [], standardHours) {
  const safeStandardHours = getSafeStandardHours(standardHours);
  const totalHeadcount = records.reduce((sum, item) => sum + Number(item?.hours_worked || 0), 0);
  const totalHours = Number((totalHeadcount * safeStandardHours).toFixed(2));

  return {
    standardHours: safeStandardHours,
    totalRegularHours: totalHours,
    totalOvertimeHours: 0,
    totalHours,
    totalHeadcount,
    isHeadcountMode: true,
    completeDaysRegular: Math.floor(totalHeadcount),
    completeDaysOvertime: 0,
    completeDaysTotal: Math.floor(totalHeadcount),
    remainingRegularHours: 0,
    remainingOvertimeHours: 0,
    remainingTotalHours: 0,
    workedSummary: formatHeadcountSummary(totalHeadcount),
  };
}

function getAttendanceEmployeeDisplayName(employee) {
  if (!employee) return '';
  if (employee.full_name) {
    return String(employee.full_name).trim();
  }
  return `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
}

function countActiveTeamMembers(team, year) {
  return (team?.members || []).filter((member) =>
    member.employee &&
    !member.employee.is_deleted &&
    employeeIsActiveInYear(member.employee, year)
  ).length;
}

function buildHeadcountTeamRow(team) {
  return {
    employee: {
      id: getTeamHeadcountRowId(team.id),
      first_name: `Squadra ${team.name || ''}`.trim(),
      last_name: '',
      full_name: `Squadra ${team.name || ''}`.trim(),
      role: 'Numero presenti',
      status: 'attivo',
      is_deleted: false,
      team_id: Number(team.id),
      is_headcount_team_row: true,
    },
    teamMember: null,
    team,
    headcountMode: true,
    activeMemberCount: countActiveTeamMembers(team, new Date().getFullYear()),
  };
}

function buildTeamRows(team, year) {
  if (!team) return [];
  if (isTeamHeadcountMode(team)) {
    return [{
      ...buildHeadcountTeamRow(team),
      activeMemberCount: countActiveTeamMembers(team, year),
    }];
  }

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
    for (const member of team?.members || []) {
      if (
        member.employee &&
        !member.employee.is_deleted &&
        employeeIsActiveInYear(member.employee, year)
      ) {
        employeeIds.add(Number(member.employee.id));
      }
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
    quickClickValue: String(
      settings?.general?.attendance_quick_click_value || settings?.general?.standard_day_hours || 7
    ).trim() || String(settings?.general?.standard_day_hours || 7),
    quickClickUseSymbolForStandard:
      settings?.general?.attendance_quick_click_use_symbol_for_standard !== false,
    baseHours: getSafeStandardHours(settings?.general?.standard_day_hours),
    autoSymbolizeBaseHours: !!settings?.general?.attendance_auto_symbolize_base_hours,
  };
}

function resolveAttendanceQuickClickValue(attendanceSettings) {
  const configuredValue = String(attendanceSettings?.quickClickValue || '').trim();
  if (!configuredValue) {
    return attendanceSettings?.inputMode === 'hours_and_symbol'
      ? attendanceSettings.quickSymbol
      : String(attendanceSettings?.baseHours || '');
  }

  if (configuredValue.toUpperCase() === String(attendanceSettings?.quickSymbol || '').toUpperCase()) {
    return attendanceSettings.quickSymbol;
  }

  const normalizedNumber = Number(configuredValue.replace(',', '.'));
  if (
    Number.isFinite(normalizedNumber) &&
    attendanceSettings?.quickClickUseSymbolForStandard &&
    attendanceSettings?.inputMode === 'hours_and_symbol' &&
    Math.abs(normalizedNumber - Number(attendanceSettings?.baseHours || 0)) < 0.0001
  ) {
    return attendanceSettings.quickSymbol;
  }

  return configuredValue;
}

function parseOvertimeInputValue(rawValue, attendanceSettings) {
  const parsed = parseMainInputValue(rawValue, attendanceSettings);
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

function hashAttendanceEntry(entry) {
  if (!entry) return null;
  const status = entry.status || 'presente';
  const marker = entry.marker_code || '';
  const code = entry.entry_code || '';
  const hours = entry.hours_worked === '' || entry.hours_worked === null || entry.hours_worked === undefined
    ? ''
    : Number(entry.hours_worked || 0);
  const overtime = Number(entry.overtime_hours || 0);
  const notes = entry.notes || '';
  return `${status}|${marker}|${code}|${hours}|${overtime}|${notes}`;
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
  const [employeeFilterIds, setEmployeeFilterIds] = useState(() => readStoredEmployeeFilter());
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
  const [showQuickActionsMenu, setShowQuickActionsMenu] = useState(false);
  const [savingQuickClickPreference, setSavingQuickClickPreference] = useState(false);
  const [quickClickCustomDraft, setQuickClickCustomDraft] = useState('');
  const [quickEntryDate, setQuickEntryDate] = useState(formatLocalDate(new Date()));
  const [showHoursLegend, setShowHoursLegend] = useState(false);
  const [liveHoursPreview, setLiveHoursPreview] = useState('');
  const [selectedCellKey, setSelectedCellKey] = useState(null);
  const [cellEditorValues, setCellEditorValues] = useState({
    presence: '',
    overtime: '',
    marker: '',
    notes: '',
  });
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
  const mountedRef = useRef(false);
  const flushRetryTimeoutRef = useRef(null);
  const previewScrollTimeoutRef = useRef(null);

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

  useEffect(() => {
    mountedRef.current = true;
    console.info('[route-lifecycle] enter', { page: 'attendance' });
    return () => {
      mountedRef.current = false;
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
      if (bulkFeedbackTimeoutRef.current) {
        clearTimeout(bulkFeedbackTimeoutRef.current);
      }
      if (flushRetryTimeoutRef.current) {
        clearTimeout(flushRetryTimeoutRef.current);
      }
      if (previewScrollTimeoutRef.current) {
        clearTimeout(previewScrollTimeoutRef.current);
      }
      console.info('[route-lifecycle] leave', { page: 'attendance' });
    };
  }, []);

  const loading = directoryLoading || attendanceLoading;
  const loadingMessage = directoryLoading
    ? 'Caricamento anagrafica presenze...'
    : 'Caricamento presenze mese...';

  async function loadDirectoryData() {
    const startedAt = getPerfNow();
    if (mountedRef.current) {
      setDirectoryLoading(true);
    }
    logAttendancePerf('page:directory-load:start', {
      month: currentMonthKey,
      selected_entity: selectedEntity,
    });
    try {
      const employeesStartedAt = getPerfNow();
      const employeeData = await window.api.employees.listBasicForAttendance();
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

      if (!mountedRef.current) {
        console.info('[route-lifecycle] async cancelled', {
          page: 'attendance',
          task: 'loadDirectoryData',
        });
        return;
      }

      setEmployees(employeeData || []);
      setTeams(teamData || []);
      setSettings(settingsData || null);
    } catch (err) {
      console.error(err);
      if (mountedRef.current) {
        alert('Errore caricamento presenze');
      }
    } finally {
      const durationMs = Math.round(getPerfNow() - startedAt);
      logAttendancePerf('page:directory-load:end', {
        duration_ms: durationMs,
      });
      if (mountedRef.current) {
        setDirectoryLoading(false);
      } else {
        console.info('[route-lifecycle] setState skipped after unmount', {
          page: 'attendance',
          task: 'loadDirectoryData',
          state: 'directoryLoading=false',
        });
      }
    }
  }

  async function loadAttendanceMonthData() {
    const diagToken = diagStart('loadAttendanceMonthData');
    const startedAt = getPerfNow();
    const daysCount = dayKeys.length;
    if (mountedRef.current) {
      setAttendanceLoading(true);
    }
    pageLoadStartedAtRef.current = startedAt;
    logAttendancePerf('page:month-load:start', {
      month: currentMonthKey,
      selected_entity: selectedEntity,
      days_count: daysCount,
    });

    try {
      const attendanceStartedAt = getPerfNow();
      const [employeeAttendanceData, teamAttendanceData] = await Promise.all([
        window.api.attendance.listByMonth(
          currentMonth.getFullYear(),
          currentMonth.getMonth() + 1
        ),
        window.api.attendance.listTeamByMonth(
          currentMonth.getFullYear(),
          currentMonth.getMonth() + 1
        ),
      ]);
      const normalizedAttendance = [
        ...((employeeAttendanceData || []).map(normalizeAttendanceEntry)),
        ...((teamAttendanceData || []).map((item) =>
          createHeadcountAttendanceEntry({
            teamId: item.team_id,
            date: item.date,
            headcount: item.headcount,
            notes: item.notes,
            teamName: item.team_name,
          })
        )),
      ];
      logAttendancePerf('page:load-attendance-month:end', {
        month: currentMonthKey,
        records_count: normalizedAttendance.length,
        employee_records_count: Array.isArray(employeeAttendanceData) ? employeeAttendanceData.length : 0,
        team_records_count: Array.isArray(teamAttendanceData) ? teamAttendanceData.length : 0,
        days_count: daysCount,
        duration_ms: Math.round(getPerfNow() - attendanceStartedAt),
      });

      if (!mountedRef.current) {
        console.info('[route-lifecycle] async cancelled', {
          page: 'attendance',
          task: 'loadAttendanceMonthData',
          month: currentMonthKey,
        });
        return;
      }

      setAttendance(normalizedAttendance);
      setPendingChanges({});
      setInputDrafts({});
      setSelectedEmployeeIds([]);
      setBulkApplyFeedback('');
      pendingChangesRef.current = {};
    } catch (err) {
      console.error(err);
      if (mountedRef.current) {
        alert('Errore caricamento presenze');
      }
    } finally {
      diagEnd(diagToken, { month: currentMonthKey, daysCount });
      const durationMs = Math.round(getPerfNow() - startedAt);
      logAttendancePerf('page:month-load:end', {
        month: currentMonthKey,
        duration_ms: durationMs,
      });
      if (mountedRef.current) {
        setAttendanceLoading(false);
      } else {
        console.info('[route-lifecycle] setState skipped after unmount', {
          page: 'attendance',
          task: 'loadAttendanceMonthData',
          state: 'attendanceLoading=false',
        });
      }
    }
  }

  useEffect(() => {
    countAttendanceDiag('effect:loadDirectoryData');
    loadDirectoryData();
  }, []);

  useEffect(() => {
    countAttendanceDiag('effect:loadAttendanceMonthData');
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
    countAttendanceDiag('effect:pendingChangesAutosave');
    if (ATTENDANCE_DIAG.disableAutosaveWrite) {
      console.info('[attendance-perf] autosave-effect:skip', { reason: 'diag-disable' });
      return undefined;
    }

    const pendingCount = Object.keys(pendingChanges).length;
    if (!pendingCount) {
      console.info('[attendance-perf] autosave-effect:skip', { reason: 'no-pending' });
      return undefined;
    }

    console.info('[attendance-perf] autosave-effect:scheduled', { pendingCount });
    const timer = setTimeout(() => {
      console.info('[attendance-perf] autosave-effect:firing', { pendingCount: Object.keys(pendingChangesRef.current).length });
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
    if (flushRetryTimeoutRef.current) {
      clearTimeout(flushRetryTimeoutRef.current);
    }
    if (previewScrollTimeoutRef.current) {
      clearTimeout(previewScrollTimeoutRef.current);
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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    try {
      window.localStorage.setItem(
        ATTENDANCE_EMPLOYEE_FILTER_STORAGE_KEY,
        JSON.stringify(employeeFilterIds)
      );
    } catch {
      // localStorage may be unavailable; ignore.
    }
  }, [employeeFilterIds]);

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
        if (!cancelled && mountedRef.current) {
          setLicenseStatus(status || null);
        } else if (!cancelled && !mountedRef.current) {
          console.info('[route-lifecycle] setState skipped after unmount', {
            page: 'attendance',
            task: 'fetchLicense',
          });
        }
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
    () => employees
      .filter((employee) =>
        employee.status === 'attivo' &&
        !employee.is_deleted &&
        employeeIsActiveInYear(employee, selectedYear)
      ),
    [employees, selectedYear]
  );
  const attendanceSettings = useMemo(() => getAttendanceSettings(settings), [settings]);
  const resolvedQuickClickValue = useMemo(
    () => resolveAttendanceQuickClickValue(attendanceSettings),
    [attendanceSettings]
  );
  const quickClickConfiguredValue = String(
    settings?.general?.attendance_quick_click_value || attendanceSettings.baseHours || 7
  ).trim();
  const quickClickPresetValue = useMemo(() => {
    const normalized = quickClickConfiguredValue.replace(',', '.').toUpperCase();
    if (normalized === 'X') return 'X';
    if (normalized === '7') return '7';
    if (normalized === '6.5') return '6.5';
    if (normalized === '8') return '8';
    return 'custom';
  }, [quickClickConfiguredValue]);
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

  const entityRows = useMemo(() => {
    const diagToken = diagStart('entityRows useMemo');
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
      rows = activeEmployees
        .map((employee, originalIndex) => ({
          employee,
          teamMember: null,
          originalIndex,
        }))
        .sort((a, b) => {
          const compareResult = String(getAttendanceEmployeeDisplayName(a.employee) || '').localeCompare(
            String(getAttendanceEmployeeDisplayName(b.employee) || ''),
            'it',
            { sensitivity: 'base' }
          );
          return compareResult !== 0 ? compareResult : a.originalIndex - b.originalIndex;
        })
        .map(({ originalIndex, ...row }) => row);
    }

    logAttendancePerf('page:build-entityRows:end', {
      selected_entity: selectedEntity,
      selected_type: selectedMeta.type,
      rows_count: rows.length,
      active_employees_count: activeEmployees.length,
      duration_ms: Math.round(getPerfNow() - startedAt),
    });
    setAttendanceDiagValue('entityRows.count', rows.length);
    diagEnd(diagToken, {
      rowsCount: rows.length,
      selectedType: selectedMeta.type,
    });

    return rows;
  }, [activeEmployees, employeesWithoutTeam, selectedEntity, selectedMeta, selectedTeam, selectedYear]);

  const employeeFilterSet = useMemo(
    () => new Set(employeeFilterIds.map((id) => Number(id))),
    [employeeFilterIds]
  );

  const displayRows = useMemo(() => {
    if (employeeFilterSet.size === 0) {
      return entityRows;
    }
    return entityRows.filter(({ employee }) => employeeFilterSet.has(Number(employee.id)));
  }, [entityRows, employeeFilterSet]);

  const filterAvailableEmployees = useMemo(
    () => entityRows.map(({ employee }) => employee),
    [entityRows]
  );

  const visibleEmployeeIds = useMemo(
    () => displayRows.map(({ employee }) => Number(employee.id)).filter(Number.isFinite),
    [displayRows]
  );

  useEffect(() => {
    console.log('[attendance-debug] employee-filter-render', {
      'availableEmployees.length': filterAvailableEmployees.length,
      'selectedIds.length': employeeFilterIds.length,
      'filteredRows.length': displayRows.length,
      'totalRows.length': entityRows.length,
      selectedIds: employeeFilterIds,
      filterSetSize: employeeFilterSet.size,
    });
  }, [filterAvailableEmployees.length, employeeFilterIds.length, displayRows.length, entityRows.length, employeeFilterIds, employeeFilterSet.size]);

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
    countAttendanceDiag('effect:selectedEmployeeIdsSync');
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
    countAttendanceDiag('effect:scrollbarSync');
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

  function buildMainPatchFromParsedValue(parsedMain) {
    if (parsedMain.kind === 'type') {
      return {
        status: parsedMain.status,
        entry_code: null,
        hours_worked: '',
        marker_code: null,
        overtime_hours: 0,
      };
    }

    if (parsedMain.kind === 'symbol') {
      return {
        status: 'presente',
        entry_code: parsedMain.symbol,
        hours_worked: parsedMain.hours,
      };
    }

    if (parsedMain.kind === 'empty') {
      return {
        status: 'presente',
        entry_code: null,
        hours_worked: '',
      };
    }

    return {
      status: parsedMain.hours === 0 ? 'assente' : 'presente',
      entry_code: null,
      hours_worked: parsedMain.hours,
    };
  }

  const handleCellSingleClick = useStableCallback((employeeId, dateStr) => {
    const att = getAtt(employeeId, dateStr);
    const currentMainValue = String(getMainInputValue(att) || '').trim();
    const isHeadcountRow = isTeamHeadcountRowId(employeeId);
    const hasSecondaryDetails = isHeadcountRow
      ? Boolean(att?.notes)
      : Boolean(att?.overtime_hours || att?.marker_code || att?.notes);

    if (!currentMainValue) {
      if (isHeadcountRow) {
        applyEntryPatch(employeeId, dateStr, {
          status: 'presente',
          entry_code: null,
          hours_worked: 1,
          marker_code: null,
          overtime_hours: 0,
        }, {
          field: 'main',
          source: 'single-click-fill-headcount',
        });
        return;
      }

      const parsedMain = parseMainInputValue(resolvedQuickClickValue, attendanceSettings);
      if (parsedMain.kind === 'invalid') {
        return;
      }

      applyEntryPatch(employeeId, dateStr, buildMainPatchFromParsedValue(parsedMain), {
        field: 'main',
        source: 'single-click-fill-standard',
      });
      return;
    }

    if (
      hasSecondaryDetails &&
      !window.confirm(
        isHeadcountRow
          ? 'La cella contiene anche note. Vuoi rimuovere solo il numero presenti?'
          : 'La cella contiene anche straordinario, marker o note. Vuoi rimuovere solo la presenza principale?'
      )
    ) {
      return;
    }

    applyEntryPatch(employeeId, dateStr, {
      status: 'presente',
      entry_code: null,
      hours_worked: '',
      ...(isHeadcountRow ? { overtime_hours: 0, marker_code: null } : {}),
    }, {
      field: 'main',
      source: 'single-click-clear-main',
    });
  });

  const handleCellDoubleClick = useStableCallback((employeeId, dateStr) => {
    const att = getAtt(employeeId, dateStr);
    console.log('[attendance-debug] open-cell-editor', { employeeId, date: dateStr });
    setShowQuickActionsMenu(false);
    setCellEditorValues({
      presence: getMainInputValue(att),
      overtime: att?.overtime_hours ? String(att.overtime_hours).replace('.', ',') : '',
      marker: att?.marker_code || '',
      notes: att?.notes || '',
    });
    setSelectedCellKey(`${employeeId}_${dateStr}`);
  });

  const handleCloseCellEditor = useStableCallback(() => {
    setCellEditorValues({
      presence: '',
      overtime: '',
      marker: '',
      notes: '',
    });
    setSelectedCellKey(null);
  });

  const handleSaveCellEditor = useStableCallback(() => {
    if (!selectedCellData) {
      return;
    }

    if (selectedCellData.isHeadcountMode) {
      const parsedHeadcount = parseHeadcountInputValue(cellEditorValues.presence);
      if (parsedHeadcount.kind === 'invalid') {
        alert('Numero presenti non valido');
        return;
      }

      const patch = {
        status: 'presente',
        entry_code: null,
        hours_worked: parsedHeadcount.kind === 'empty' ? '' : parsedHeadcount.headcount,
        overtime_hours: 0,
        marker_code: null,
        notes: cellEditorValues.notes.trim() ? cellEditorValues.notes.trim() : null,
        is_headcount_mode: true,
      };

      applyEntryPatch(selectedCellData.employeeId, selectedCellData.dateStr, patch, {
        field: 'all',
        source: 'compact-cell-editor-headcount',
      });
      setSelectedCellKey(null);
      return;
    }

    const parsedMain = parseMainInputValue(cellEditorValues.presence, attendanceSettings);
    const parsedOvertime = parseOvertimeInputValue(cellEditorValues.overtime, attendanceSettings);

    if (parsedMain.kind === 'invalid') {
      alert('Valore presenza non valido');
      return;
    }

    if (parsedOvertime.kind === 'invalid') {
      alert('Valore straordinario non valido');
      return;
    }

    const mainPatch = buildMainPatchFromParsedValue(parsedMain);

    const patch = {
      ...mainPatch,
      overtime_hours: parsedOvertime.kind === 'empty' ? 0 : parsedOvertime.hours,
      marker_code: cellEditorValues.marker || null,
      notes: cellEditorValues.notes.trim() ? cellEditorValues.notes.trim() : null,
    };

    if (MAIN_DAY_TYPES.some((item) => item.value === patch.status) && patch.marker_code) {
      alert('I marker non sono disponibili per questo tipo di presenza.');
      return;
    }

    console.log('[attendance-debug] save-cell-editor', {
      employeeId: selectedCellData.employeeId,
      date: selectedCellData.dateStr,
      patch,
    });
    applyEntryPatch(selectedCellData.employeeId, selectedCellData.dateStr, patch, {
      field: 'all',
      source: 'compact-cell-editor',
    });
    setSelectedCellKey(null);
  });

  const selectedCellData = useMemo(() => {
    if (!selectedCellKey) return null;
    const [empIdStr, ...dateArr] = selectedCellKey.split('_');
    const dateStr = dateArr.join('_');
    const employeeId = Number(empIdStr);
    const employee =
      displayRows.find((row) => Number(row.employee.id) === employeeId)?.employee ||
      activeEmployees.find((e) => Number(e.id) === employeeId) ||
      null;
    const attKey = `${employeeId}_${dateStr}`;
    const att = pendingChanges[attKey] || attendanceMap[attKey] || null;
    return {
      employeeId,
      dateStr,
      employee,
      att,
      isHeadcountMode: isTeamHeadcountRowId(employeeId) || !!employee?.is_headcount_team_row,
    };
  }, [selectedCellKey, activeEmployees, attendanceMap, displayRows, pendingChanges]);

  const attendanceRowsData = useMemo(
    () => {
      const diagToken = diagStart('attendanceRowsData useMemo');
      const startedAt = getPerfNow();
      const previousCache = attendanceRowsCacheRef.current;
      const nextCache = new Map();
      let rows = displayRows.map(({ employee, teamMember, headcountMode, team, activeMemberCount }) => {
        const employeeId = Number(employee.id);
        const baseAttendance = attendanceByEmployeeId.get(employeeId) || EMPTY_ROW_ATTENDANCE;
        const pendingAttendance = pendingChangesByEmployeeId.get(employeeId) || EMPTY_ROW_ATTENDANCE;
        const memberRecords = dayKeys.map((dateStr) =>
          pendingAttendance[dateStr] !== undefined ? pendingAttendance[dateStr] : baseAttendance[dateStr]
        );
        const effectiveAttendance = pendingAttendance === EMPTY_ROW_ATTENDANCE
          ? baseAttendance
          : { ...baseAttendance, ...pendingAttendance };
        const totals = headcountMode
          ? calculateHeadcountTotals(memberRecords, attendanceSettings.baseHours)
          : calculateAttendanceTotals(memberRecords, attendanceSettings.baseHours);
        const previousRow = previousCache.get(employeeId);

        if (
          previousRow &&
          previousRow.employee === employee &&
          previousRow.teamMember === teamMember &&
          previousRow.headcountMode === !!headcountMode &&
          previousRow.effectiveAttendance === effectiveAttendance &&
          previousRow.totals?.totalHours === totals.totalHours &&
          previousRow.totals?.standardHours === totals.standardHours &&
          previousRow.totals?.totalHeadcount === totals.totalHeadcount
        ) {
          nextCache.set(employeeId, previousRow);
          return previousRow;
        }

        const nextRow = {
          employee,
          teamMember,
          headcountMode: !!headcountMode,
          team,
          activeMemberCount,
          effectiveAttendance,
          totals,
        };
        nextCache.set(employeeId, nextRow);
        return nextRow;
      });

      if (selectedMeta.type === 'all') {
        rows = rows
          .map((row, originalIndex) => ({
            row,
            originalIndex,
          }))
          .sort((a, b) => {
            const compareResult = String(getAttendanceEmployeeDisplayName(a.row.employee) || '').localeCompare(
              String(getAttendanceEmployeeDisplayName(b.row.employee) || ''),
              'it',
              { sensitivity: 'base' }
            );
            return compareResult !== 0 ? compareResult : a.originalIndex - b.originalIndex;
          })
          .map(({ row }) => row);
      }

      attendanceRowsCacheRef.current = nextCache;
      logAttendancePerf('page:calculate-totals:end', {
        rows_count: rows.length,
        cells_count: rows.length * dayKeys.length,
        days_count: dayKeys.length,
        duration_ms: Math.round(getPerfNow() - startedAt),
      });
      setAttendanceDiagValue('attendanceRowsData.rows', rows.length);
      setAttendanceDiagValue('attendanceRowsData.cells', rows.length * dayKeys.length);
      diagEnd(diagToken, {
        rowsCount: rows.length,
        cellsCount: rows.length * dayKeys.length,
      });

      return rows;
    },
    [attendanceByEmployeeId, attendanceSettings.baseHours, dayKeys, displayRows, pendingChangesByEmployeeId, selectedMeta.type]
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

  const updateLiveHoursPreview = useStableCallback((value) => {
    const diagToken = diagStart('updateLiveHoursPreview');
    const __t0 = getPerfNow();
    setLiveHoursPreview(formatDecimalPreview(value));
    const __dt = getPerfNow() - __t0;
    if (__dt > 1) console.info('[attendance-perf] updateLiveHoursPreview', { ms: Math.round(__dt * 100) / 100 });
    diagEnd(diagToken, { valueLength: String(value || '').length });
  });

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

  function buildBaseEntryForPatch(currentEntry, savedEntry, employeeId, date) {
    const source = currentEntry || savedEntry;
    if (source) {
      return {
        employee_id: source.employee_id ?? employeeId,
        date: source.date ?? date,
        status: source.status || 'presente',
        marker_code: source.marker_code || null,
        entry_code: source.entry_code || null,
        hours_worked: source.hours_worked ?? '',
        overtime_hours: source.overtime_hours || 0,
        notes: source.notes || null,
      };
    }
    return {
      employee_id: employeeId,
      date,
      status: 'presente',
      marker_code: null,
      entry_code: null,
      hours_worked: '',
      overtime_hours: 0,
      notes: null,
    };
  }

  function applyEntryPatch(employeeId, date, patch, debugMeta) {
    const __qt0 = getPerfNow();
    if (isWriteBlockedRef.current) {
      showLicenseBlockedToast();
      return;
    }
    const key = `${employeeId}_${date}`;
    const savedEntry = attendanceMap[key];

    setPendingChanges((current) => {
      const currentEntry = current[key];
      const baseEntry = buildBaseEntryForPatch(currentEntry, savedEntry, employeeId, date);
      const mergedEntry = normalizeAttendanceEntry({ ...baseEntry, ...patch });

      if (debugMeta) {
        console.info('[attendance-debug] cell-update', {
          employee_id: employeeId,
          date_key: date,
          field: debugMeta.field || null,
          source: debugMeta.source || null,
          previous_value: currentEntry || savedEntry || null,
          next_value: mergedEntry,
          changed_fields: Object.keys(patch),
          row_hash_before: currentEntry || savedEntry ? hashAttendanceEntry(currentEntry || savedEntry) : null,
          row_hash_after: hashAttendanceEntry(mergedEntry),
        });
      }

      if (savedEntry && areAttendanceEntriesEquivalent(mergedEntry, savedEntry)) {
        if (currentEntry === undefined) {
          return current;
        }
        const next = { ...current };
        delete next[key];
        pendingChangesRef.current = next;
        return next;
      }

      if (!savedEntry && isEffectivelyEmptyAttendanceEntry(mergedEntry)) {
        if (currentEntry === undefined) {
          return current;
        }
        const next = { ...current };
        delete next[key];
        pendingChangesRef.current = next;
        return next;
      }

      if (currentEntry && areAttendanceEntriesEquivalent(currentEntry, mergedEntry)) {
        return current;
      }

      const next = {
        ...current,
        [key]: mergedEntry,
      };
      pendingChangesRef.current = next;
      return next;
    });

    markDirtyState();
    const __qdt = getPerfNow() - __qt0;
    if (__qdt > 1) console.info('[attendance-perf] applyEntryPatch', { ms: Math.round(__qdt * 100) / 100 });
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

  const handleGridKeyDown = useStableCallback((event) => {
    if (event.key !== 'Enter' && event.key !== 'Tab') {
      return;
    }

    event.preventDefault();
    moveAttendanceFocus(event.currentTarget, event.shiftKey ? -1 : 1);
  });

  const toggleEmployeeSelection = useStableCallback((employeeId, checked) => {
    setSelectedEmployeeIds((current) => {
      if (checked) {
        return current.includes(employeeId) ? current : [...current, employeeId];
      }
      return current.filter((id) => id !== employeeId);
    });
  });

  const toggleSelectAllVisible = useStableCallback((checked) => {
    setSelectedEmployeeIds(checked ? visibleEmployeeIds : []);
  });

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

    const allSelectedHeadcountRows =
      selectedEmployeeIds.length > 0 &&
      selectedEmployeeIds.every((employeeId) => isTeamHeadcountRowId(employeeId));

    if (
      !allSelectedHeadcountRows &&
      (parsedMain?.kind === 'hours' || parsedMain?.kind === 'symbol') &&
      Number(parsedMain.hours || 0) > 24
    ) {
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
        const isHeadcountRow = isTeamHeadcountRowId(employeeId);
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
            if (isHeadcountRow) {
              if (parsedMain.kind === 'type') {
                continue;
              }
              nextEntry = {
                ...nextEntry,
                status: 'presente',
                entry_code: null,
                hours_worked: parsedMain.kind === 'empty' ? '' : parsedMain.hours,
                overtime_hours: 0,
                marker_code: null,
                is_headcount_mode: true,
              };
            } else if (parsedMain.kind === 'type') {
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

        if (normalizedMarker && !isHeadcountRow) {
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

        if (parsedOvertime && !isHeadcountRow) {
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
      if (mountedRef.current) {
        setSaveState('idle');
      } else {
        console.info('[route-lifecycle] setState skipped after unmount', {
          page: 'attendance',
          task: 'scheduleSavedBadge',
        });
      }
    }, 1200);
  }

  async function flushPendingChanges() {
    const diagToken = diagStart('flushPendingChanges');
    const __flushT0 = getPerfNow();
    let __buildPayloadMs = 0;
    let __ipcCallMs = 0;
    let __postSaveSetStateMs = 0;
    const snapshot = pendingChangesRef.current;
    const entries = Object.entries(snapshot);

    if (!entries.length || isSavingRef.current) {
      diagEnd(diagToken, { skipped: true, reason: 'empty-or-saving' });
      return;
    }

    if (isWriteBlockedRef.current) {
      diagEnd(diagToken, { skipped: true, reason: 'write-blocked' });
      return;
    }

    if (ATTENDANCE_DIAG.disableAutosaveWrite) {
      diagEnd(diagToken, { skipped: true, reason: 'diag-disable-autosave' });
      return;
    }

    isSavingRef.current = true;
    if (mountedRef.current) {
      setSaveState('saving');
    }

    const __payloadT0 = getPerfNow();
    const employeePayload = [];
    const teamPayload = [];

    for (const [, item] of entries) {
      const normalized = normalizeAttendanceEntry(item);

      if (isHeadcountAttendanceEntry(normalized)) {
        const teamId = normalized.team_id || getTeamIdFromHeadcountRowId(normalized.employee_id);
        if (!teamId) {
          continue;
        }
        teamPayload.push({
          team_id: Number(teamId),
          date: normalized.date,
          headcount:
            normalized.hours_worked === '' ||
            normalized.hours_worked === null ||
            normalized.hours_worked === undefined
              ? null
              : Number(normalized.hours_worked || 0),
          notes: normalized.notes || null,
        });
        continue;
      }

      employeePayload.push({
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
      });
    }

    __buildPayloadMs = getPerfNow() - __payloadT0;
    console.info('[attendance-perf] flushPendingChanges:payload-built', {
      entries: entries.length,
      employeeEntries: employeePayload.length,
      teamEntries: teamPayload.length,
      ms: Math.round(__buildPayloadMs * 100) / 100,
    });

    try {
      const ipcDiagToken = diagStart('save attendance IPC');
      const __ipcT0 = getPerfNow();
      const [employeeResult, teamResult] = await Promise.all([
        employeePayload.length ? window.api.attendance.bulkUpsert(employeePayload) : Promise.resolve(null),
        teamPayload.length ? window.api.attendance.teamBulkUpsert(teamPayload) : Promise.resolve(null),
      ]);
      __ipcCallMs = getPerfNow() - __ipcT0;
      console.info('[attendance-perf] flushPendingChanges:ipc-bulkUpsert', {
        entries: entries.length,
        employeeEntries: employeePayload.length,
        teamEntries: teamPayload.length,
        ms: Math.round(__ipcCallMs),
        mainPerf: employeeResult?.__perf || null,
        teamPerf: teamResult?.__perf || null,
      });
      diagEnd(ipcDiagToken, { entries: entries.length });

      if (!mountedRef.current) {
        console.info('[route-lifecycle] async cancelled', {
          page: 'attendance',
          task: 'flushPendingChanges',
          entries: entries.length,
        });
        return;
      }

      const __setStateT0 = getPerfNow();
      setAttendance((current) => {
        const nextMap = {};
        for (const item of current) {
          nextMap[`${item.employee_id}_${item.date}`] = item;
        }

        for (const item of employeePayload) {
          nextMap[`${item.employee_id}_${item.date}`] = normalizeAttendanceEntry(item);
        }

        for (const item of teamPayload) {
          const syntheticEntry = createHeadcountAttendanceEntry({
            teamId: item.team_id,
            date: item.date,
            headcount: item.headcount,
            notes: item.notes,
            teamName: teams.find((team) => Number(team.id) === Number(item.team_id))?.name || null,
          });
          const key = `${syntheticEntry.employee_id}_${syntheticEntry.date}`;
          const shouldDelete =
            (syntheticEntry.hours_worked === '' || Number(syntheticEntry.hours_worked || 0) <= 0) &&
            !syntheticEntry.notes;

          if (shouldDelete) {
            delete nextMap[key];
          } else {
            nextMap[key] = syntheticEntry;
          }
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
      __postSaveSetStateMs = getPerfNow() - __setStateT0;
      console.info('[attendance-perf] flushPendingChanges:setState-scheduled', {
        ms: Math.round(__postSaveSetStateMs * 100) / 100,
      });
      const __rafT0 = __setStateT0;
      requestAnimationFrame(() => {
        const __commitMs = getPerfNow() - __rafT0;
        console.info('[attendance-perf] flushPendingChanges:setState-committed', {
          ms: Math.round(__commitMs),
        });
      });
      scheduleSavedBadge();
    } catch (err) {
      const isLicenseBlock =
        err?.code === 'LICENSE_READ_ONLY' ||
        String(err?.message || '').includes('sola lettura');
      if (isLicenseBlock) {
        isWriteBlockedRef.current = true;
        if (mountedRef.current) {
          setPendingChanges({});
          pendingChangesRef.current = {};
          setInputDrafts({});
          setSaveState('idle');
        }
        showLicenseBlockedToast();
      } else {
        console.error(err);
        if (mountedRef.current) {
          setSaveState('error');
          alert('Errore salvataggio automatico presenze');
        }
      }
    } finally {
      diagEnd(diagToken, { entries: entries.length });
      const __totalFlushMs = getPerfNow() - __flushT0;
      console.info('[attendance-perf] flushPendingChanges:total', { entries: entries.length, ms: Math.round(__totalFlushMs) });
      console.info('[attendance-perf] flushPendingChanges:summary', {
        entries: entries.length,
        buildPayloadMs: Math.round(__buildPayloadMs * 100) / 100,
        ipcCallMs: Math.round(__ipcCallMs),
        postSaveSetStateMs: Math.round(__postSaveSetStateMs * 100) / 100,
        totalFlushMs: Math.round(__totalFlushMs),
        unaccountedMs: Math.round(
          (__totalFlushMs - __buildPayloadMs - __ipcCallMs - __postSaveSetStateMs) * 100
        ) / 100,
      });
      isSavingRef.current = false;

      if (!ATTENDANCE_DIAG.disableAutosaveWrite && !isWriteBlockedRef.current && Object.keys(pendingChangesRef.current).length > 0) {
        flushRetryTimeoutRef.current = setTimeout(() => {
          flushPendingChanges();
        }, 100);
      }
    }
  }

  const handleMainValueChange = useStableCallback((employeeId, date, value) => {
    const diagToken = diagStart('handleMainValueChange');
    const __t0 = getPerfNow();
    setInputDraft(employeeId, date, 'main', value);
    updateLiveHoursPreview(value);

    if (isTeamHeadcountRowId(employeeId)) {
      const parsedHeadcount = parseHeadcountInputValue(value);
      if (parsedHeadcount.kind === 'invalid') {
        return;
      }

      applyEntryPatch(employeeId, date, {
        status: 'presente',
        entry_code: null,
        hours_worked: parsedHeadcount.kind === 'empty' ? '' : parsedHeadcount.headcount,
        overtime_hours: 0,
        marker_code: null,
        is_headcount_mode: true,
      }, { field: 'main', source: 'handleMainValueChange:headcount' });
      diagEnd(diagToken, { employeeId, date, value, mode: 'headcount' });
      return;
    }

    const parsed = parseMainInputValue(value, attendanceSettings);

    if (parsed.kind === 'invalid') {
      return;
    }

    let patch;
    if (parsed.kind === 'type') {
      patch = {
        status: parsed.status,
        entry_code: null,
        hours_worked: 0,
        overtime_hours: 0,
      };
    } else if (parsed.kind === 'symbol') {
      patch = {
        status: 'presente',
        entry_code: parsed.symbol,
        hours_worked: parsed.hours,
      };
    } else if (parsed.kind === 'empty') {
      patch = {
        status: 'presente',
        entry_code: null,
        hours_worked: '',
      };
    } else {
      patch = {
        status: parsed.hours === 0 ? 'assente' : 'presente',
        entry_code: null,
        hours_worked: parsed.hours,
      };
    }

    applyEntryPatch(employeeId, date, patch, { field: 'main', source: 'handleMainValueChange' });
    const __dt = getPerfNow() - __t0;
    if (__dt > 1) console.info('[attendance-perf] handleMainValueChange', { ms: Math.round(__dt * 100) / 100 });
    diagEnd(diagToken, { employeeId, date, value });
  });

  const handleMainValueBlur = useStableCallback((employeeId, date) => {
    const diagToken = diagStart('handleMainValueBlur');
    const att = getAtt(employeeId, date);
    const draftValue = inputDrafts[getInputDraftKey(employeeId, date, 'main')];
    if (draftValue === undefined) {
      diagEnd(diagToken, { employeeId, date, skipped: true, reason: 'no-draft' });
      return;
    }

     if (isTeamHeadcountRowId(employeeId)) {
      const parsedHeadcount = parseHeadcountInputValue(draftValue);
      if (parsedHeadcount.kind === 'invalid') {
        setInputDraft(employeeId, date, 'main', '');
        diagEnd(diagToken, { employeeId, date, invalid: true, mode: 'headcount' });
        return;
      }

      setInputDraft(employeeId, date, 'main', getMainInputValue(att));
      updateLiveHoursPreview(getMainInputValue(att));
      diagEnd(diagToken, { employeeId, date, mode: 'headcount' });
      return;
    }

    const parsed = parseMainInputValue(draftValue, attendanceSettings);
    if (parsed.kind === 'invalid') {
      setInputDraft(employeeId, date, 'main', '');
      diagEnd(diagToken, { employeeId, date, invalid: true });
      return;
    }

    setInputDraft(employeeId, date, 'main', getMainInputValue(att));
    updateLiveHoursPreview(getMainInputValue(att));
    diagEnd(diagToken, { employeeId, date });
  });

  const handleOvertimeValueChange = useStableCallback((employeeId, date, value) => {
    if (isTeamHeadcountRowId(employeeId)) {
      return;
    }
    setInputDraft(employeeId, date, 'overtime', value);
    const parsed = parseOvertimeInputValue(value, attendanceSettings);

    if (parsed.kind === 'invalid') {
      return;
    }

    applyEntryPatch(
      employeeId,
      date,
      { overtime_hours: parsed.kind === 'empty' ? 0 : parsed.hours },
      { field: 'overtime', source: 'handleOvertimeValueChange' }
    );
  });

  const handleOvertimeValueBlur = useStableCallback((employeeId, date) => {
    if (isTeamHeadcountRowId(employeeId)) {
      return;
    }
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
  });

  const handleMarkerChange = useStableCallback((employeeId, date, markerCode) => {
    if (isTeamHeadcountRowId(employeeId)) {
      return;
    }
    const existing = getAtt(employeeId, date);
    const isMainType = MAIN_DAY_TYPES.some((item) => item.value === existing?.status);

    if (isMainType && markerCode) {
      return;
    }

    applyEntryPatch(
      employeeId,
      date,
      { marker_code: markerCode || null },
      { field: 'marker', source: 'handleMarkerChange' }
    );
  });

  function applyQuickHours(employeeIds, date, value, minutesValue = '') {
    if (!Array.isArray(employeeIds) || !employeeIds.length) {
      return;
    }

    console.info('[attendance-debug] quick-day-insert', {
      action: 'hours',
      selected_employees: employeeIds,
      day_key: date,
      inserted_value: value,
      affected_rows: employeeIds.length,
    });

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

    const parsed = parseOvertimeInputValue(value, attendanceSettings);
    if (parsed.kind === 'invalid') {
      return;
    }

    const overtimeValue = parsed.kind === 'empty' ? 0 : parsed.hours;
    console.info('[attendance-debug] quick-day-insert', {
      action: 'overtime',
      selected_employees: employeeIds,
      day_key: date,
      inserted_value: overtimeValue,
      affected_rows: employeeIds.length,
    });

    employeeIds.forEach((employeeId) => {
      applyEntryPatch(
        employeeId,
        date,
        { overtime_hours: overtimeValue },
        { field: 'overtime', source: 'applyQuickOvertime' }
      );
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

  const saveQuickClickPreference = useStableCallback(async (patch) => {
    if (!settings) {
      return;
    }

    const previousSettings = settings;
    const nextSettings = {
      ...settings,
      general: {
        ...settings.general,
        ...patch,
      },
    };

    setSettings(nextSettings);
    setSavingQuickClickPreference(true);
    try {
      const saved = await window.api.settings.save(nextSettings);
      setSettings(saved || nextSettings);
    } catch (err) {
      console.error(err);
      setSettings(previousSettings);
      alert('Errore salvataggio preferenza click rapido');
    } finally {
      setSavingQuickClickPreference(false);
    }
  });

  const handleQuickClickPresetChange = useStableCallback(async (nextValue) => {
    if (nextValue === 'custom') {
      setQuickClickCustomDraft((current) => current || String(attendanceSettings.baseHours || 7));
      return;
    }
    setQuickClickCustomDraft(nextValue);
    await saveQuickClickPreference({ attendance_quick_click_value: nextValue });
  });

  const handleQuickClickCustomValueCommit = useStableCallback(async () => {
    const normalized = String(quickClickCustomDraft || '').trim().replace(',', '.');
    if (!normalized) {
      return;
    }
    await saveQuickClickPreference({ attendance_quick_click_value: normalized });
  });

  const handleQuickClickUseSymbolToggle = useStableCallback(async (checked) => {
    await saveQuickClickPreference({ attendance_quick_click_use_symbol_for_standard: !!checked });
  });

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
    previewScrollTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) {
        console.info('[route-lifecycle] setState skipped after unmount', {
          page: 'attendance',
          task: 'handlePreviewPdf-scroll',
        });
        return;
      }
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

  useEffect(() => {
    setQuickClickCustomDraft(quickClickConfiguredValue || String(attendanceSettings.baseHours || 7));
  }, [quickClickConfiguredValue, attendanceSettings.baseHours]);

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
  const selectedTeamUsesHeadcountMode = selectedMeta.type === 'team' && isTeamHeadcountMode(selectedTeam);
  const selectedTeamActiveMemberCount = selectedTeam ? countActiveTeamMembers(selectedTeam, selectedYear) : 0;

  return (
    <div className="attendance-page">
      <div className="page-sticky-stack">
        <section className="page-hero attendance-hero">
          <div>
            <span className="page-kicker">Gestione mensile</span>
            <h1 className="page-title">Foglio Presenze</h1>
            <p className="page-subtitle attendance-hero-subtitle">
              Griglia compatta, dettagli su richiesta e strumenti rapidi per lavorare piu velocemente sul mese.
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
            <div className="attendance-actions-menu">
              <button
                className="button"
                type="button"
                onClick={() => setShowQuickActionsMenu((current) => !current)}
              >
                Azioni rapide
              </button>
              {showQuickActionsMenu ? (
                <div className="attendance-actions-menu__panel">
                  <div className="attendance-actions-menu__section">
                    <div className="attendance-actions-menu__section-title">Click rapido presenza</div>

                    <label className="attendance-actions-menu__field">
                      <span>Valore da inserire al click</span>
                      <select
                        value={quickClickPresetValue}
                        onChange={(event) => handleQuickClickPresetChange(event.target.value)}
                        disabled={savingQuickClickPreference}
                      >
                        <option value="X">X</option>
                        <option value="7">7</option>
                        <option value="6.5">6.5</option>
                        <option value="8">8</option>
                        <option value="custom">Valore personalizzato</option>
                      </select>
                    </label>

                    {quickClickPresetValue === 'custom' ? (
                      <label className="attendance-actions-menu__field">
                        <span>Valore personalizzato</span>
                        <input
                          type="text"
                          value={quickClickCustomDraft}
                          onChange={(event) => setQuickClickCustomDraft(event.target.value)}
                          onBlur={handleQuickClickCustomValueCommit}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              handleQuickClickCustomValueCommit();
                            }
                          }}
                          placeholder={attendanceSettings.inputMode === 'hours_and_symbol' ? attendanceSettings.quickSymbol : String(attendanceSettings.baseHours || 7)}
                          disabled={savingQuickClickPreference}
                        />
                      </label>
                    ) : null}

                    <label className="attendance-actions-menu__check">
                      <input
                        type="checkbox"
                        checked={attendanceSettings.quickClickUseSymbolForStandard}
                        onChange={(event) => handleQuickClickUseSymbolToggle(event.target.checked)}
                        disabled={savingQuickClickPreference}
                      />
                      <span>Usa X se la giornata standard e configurata come X</span>
                    </label>

                    <div className="attendance-actions-menu__hint">
                      Questo valore viene inserito con un click singolo sulle celle vuote.
                    </div>
                  </div>

                  <button
                    type="button"
                    className="attendance-actions-menu__item"
                    onClick={() => {
                      const nextQuickDate = getDefaultQuickDateForMonth(currentMonth);
                      console.info('[attendance-debug] quick-entry-open', {
                        source: 'quick-actions-menu',
                        date: nextQuickDate,
                        visible_rows: quickEntryRows.length,
                      });
                      setQuickEntryDate(nextQuickDate);
                      setShowQuickEntry(true);
                      setShowQuickActionsMenu(false);
                    }}
                  >
                    Inserimento rapido giornaliero
                  </button>
                  <button
                    type="button"
                    className="attendance-actions-menu__item"
                    onClick={() => {
                      handleSavePdf('all');
                      setShowQuickActionsMenu(false);
                    }}
                  >
                    Genera PDF
                  </button>
                  <button
                    type="button"
                    className="attendance-actions-menu__item"
                    onClick={() => {
                      handlePreviewPdf('all');
                      setShowQuickActionsMenu(false);
                    }}
                  >
                    Anteprima PDF
                  </button>
                  <button
                    type="button"
                    className="attendance-actions-menu__item"
                    onClick={() => {
                      handleSavePdf('selected');
                      setShowQuickActionsMenu(false);
                    }}
                    disabled={!hasSelectedPrintRows}
                  >
                    Genera PDF selezionati
                  </button>
                  <button
                    type="button"
                    className="attendance-actions-menu__item"
                    onClick={() => {
                      handlePreviewPdf('selected');
                      setShowQuickActionsMenu(false);
                    }}
                    disabled={!hasSelectedPrintRows}
                  >
                    Anteprima PDF selezionati
                  </button>
                  <button
                    type="button"
                    className="attendance-actions-menu__item"
                    onClick={() => {
                      handlePrint('all');
                      setShowQuickActionsMenu(false);
                    }}
                  >
                    Stampa
                  </button>
                  <button
                    type="button"
                    className="attendance-actions-menu__item"
                    onClick={() => {
                      handlePrint('selected');
                      setShowQuickActionsMenu(false);
                    }}
                    disabled={!hasSelectedPrintRows}
                  >
                    Stampa selezionati
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <AttendanceToolbar
          currentMonth={currentMonth}
          selectedYear={selectedYear}
          setCurrentMonth={setCurrentMonth}
          setSelectedYear={setSelectedYear}
          selectedEntity={selectedEntity}
          setSelectedEntity={setSelectedEntity}
          allEmployeesCount={allEmployeesCount}
          ungroupedEmployeesCount={ungroupedEmployeesCount}
          activeEmployees={activeEmployees}
          visibleTeams={visibleTeams}
          visibleTeamCounts={visibleTeamCounts}
          monthString={monthString}
          parseDateValue={parseDateValue}
          filterSlot={
            filterAvailableEmployees.length > 1 ? (
              <AttendanceEmployeeFilter
                availableEmployees={filterAvailableEmployees}
                selectedIds={employeeFilterIds}
                onChange={setEmployeeFilterIds}
              />
            ) : null
          }
        />
      </div>

      {selectedMeta.type === 'team' && selectedTeam ? (
        <div className="panel panel-section" style={{ padding: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="page-kicker" style={{ marginBottom: 6 }}>Contesto squadra</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{selectedTeam.name}</div>
              <div style={{ color: '#667085', marginTop: 6 }}>
                {selectedTeamUsesHeadcountMode
                  ? 'La squadra usa la modalita numero presenti: nel foglio compare una sola riga rappresentativa con i presenti giornalieri.'
                  : 'Compili le presenze dei membri uno per uno mantenendo la stessa logica del singolo dipendente.'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="soft-chip" style={{ background: 'rgba(37, 99, 235, 0.12)', color: '#1d4ed8' }}>
                {selectedTeamUsesHeadcountMode
                  ? `${selectedTeamActiveMemberCount} membri attivi`
                  : `${displayRows.length} membri visibili`}
              </span>
              <span className="soft-chip" style={{ background: 'rgba(15, 118, 110, 0.1)', color: '#115e59' }}>
                {selectedTeamUsesHeadcountMode ? 'Numero presenti' : 'Selezione squadra'}
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
                Legenda rapida
              </div>
              <button
                type="button"
                className="button-secondary"
                style={{ padding: '6px 12px', minHeight: 0 }}
                onClick={() => setShowHoursLegend((current) => !current)}
              >
                {showHoursLegend ? 'Nascondi esempi ore' : 'Mostra esempi ore'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span className="soft-chip" style={{ background: 'rgba(37, 99, 235, 0.1)', color: '#1d4ed8' }}>
                Layout compatto attivo
              </span>
              <span className="soft-chip" style={{ background: 'rgba(37, 99, 235, 0.1)', color: '#1d4ed8' }}>
                {selectedEmployeeIds.length} selezionati
              </span>
              {liveHoursPreview ? (
                <span className="soft-chip" style={{ background: 'rgba(20, 33, 61, 0.06)', color: '#314762' }}>
                  Anteprima ore: {liveHoursPreview}
                </span>
              ) : null}
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
        ATTENDANCE_DIAG.disableTableRender ? (
          <div>Presenze caricate: {displayRows.length}</div>
        ) : (
          <AttendanceTable
            isCompactLayout={isCompactLayout}
            allVisibleSelected={allVisibleSelected}
            selectedMeta={selectedMeta}
            daysInMonth={daysInMonth}
            dayInfoMap={dayInfoMap}
            todayKey={todayKey}
            attendanceRowsData={attendanceRowsData}
            selectedEmployeeIds={selectedEmployeeIds}
            dayKeys={dayKeys}
            availableMarkers={availableMarkers}
            activeMarkers={activeMarkers}
            openMarkerMenuKey={openMarkerMenuKey}
            compactOvertimeEditorKey={compactOvertimeEditorKey}
            attendanceSettings={attendanceSettings}
            displayRows={displayRows}
            isWriteBlocked={isWriteBlocked}
            horizontalScrollbarRef={horizontalScrollbarRef}
            horizontalScrollbarContentRef={horizontalScrollbarContentRef}
            tableShellRef={tableShellRef}
            thStyleLeftCurrent={thStyleLeftCurrent}
            thStyleCenterCurrent={thStyleCenterCurrent}
            thStyleRightHoursCurrent={thStyleRightHoursCurrent}
            thStyleRightSummaryCurrent={thStyleRightSummaryCurrent}
            tdStyleLeftCurrent={tdStyleLeftCurrent}
            tdStyleCenterCurrent={tdStyleCenterCurrent}
            tdStyleRightHoursCurrent={tdStyleRightHoursCurrent}
            tdStyleRightSummaryCurrent={tdStyleRightSummaryCurrent}
            todayHeaderStyle={todayHeaderStyle}
            todayCellStyle={todayCellStyle}
            toggleSelectAllVisible={toggleSelectAllVisible}
            toggleEmployeeSelection={toggleEmployeeSelection}
            setOpenMarkerMenuKey={setOpenMarkerMenuKey}
            setCompactOvertimeEditorKey={setCompactOvertimeEditorKey}
            handleMainValueChange={handleMainValueChange}
            handleMainValueBlur={handleMainValueBlur}
            handleGridInputFocus={handleGridInputFocus}
            handleGridKeyDown={handleGridKeyDown}
            updateLiveHoursPreview={updateLiveHoursPreview}
            handleAttendanceCellFocus={handleAttendanceCellFocus}
            handleMarkerChange={handleMarkerChange}
            handleOvertimeValueChange={handleOvertimeValueChange}
            handleOvertimeValueBlur={handleOvertimeValueBlur}
            inputDrafts={inputDrafts}
            onCellSingleClick={handleCellSingleClick}
            onCellDoubleClick={handleCellDoubleClick}
          />
        )
      )}

      <QuickAttendanceModal
        open={showQuickEntry}
        quickDate={quickEntryDate}
        onDateChange={handleQuickEntryDateChange}
        onClose={handleCloseQuickEntry}
        rows={quickEntryRows}
        saveState={saveState}
        onApplyHours={applyQuickHours}
        onApplyOvertime={applyQuickOvertime}
        onApplyMarker={applyQuickMarker}
        attendanceSettings={attendanceSettings}
        markers={activeMarkers}
      />

      {selectedCellData ? (
        <div className="modal-overlay" onClick={handleCloseCellEditor}>
          <div className="modal-dialog attendance-cell-editor" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header attendance-cell-editor__header">
              <div>
                <span className="page-kicker">Dettaglio cella</span>
                <h2 style={{ margin: '4px 0 0', fontSize: 20 }}>
                  {getAttendanceEmployeeDisplayName(selectedCellData.employee)}
                </h2>
                <div style={{ color: '#667085', marginTop: 4 }}>
                  {formatIsoDateLabel(selectedCellData.dateStr)}
                </div>
              </div>
              <button type="button" className="modal-close" onClick={handleCloseCellEditor}>x</button>
            </div>

            <div className="attendance-cell-editor__grid">
              <label className="field">
                <span>{selectedCellData.isHeadcountMode ? 'Numero presenti' : 'Presenza'}</span>
                <input
                  type="text"
                  value={cellEditorValues.presence}
                  onChange={(event) => setCellEditorValues((current) => ({ ...current, presence: event.target.value }))}
                  placeholder={selectedCellData.isHeadcountMode
                    ? 'es. 22 o 22,5'
                    : attendanceSettings?.inputMode === 'hours_and_symbol'
                    ? attendanceSettings.quickSymbol
                    : 'Ore'}
                />
              </label>

              {!selectedCellData.isHeadcountMode ? (
                <label className="field">
                  <span>Straordinario</span>
                  <input
                    type="text"
                    value={cellEditorValues.overtime}
                    onChange={(event) => setCellEditorValues((current) => ({ ...current, overtime: event.target.value }))}
                    placeholder="Ore"
                  />
                </label>
              ) : null}

              {!selectedCellData.isHeadcountMode ? (
                <label className="field">
                  <span>Marker</span>
                  <select
                    value={cellEditorValues.marker}
                    onChange={(event) => setCellEditorValues((current) => ({ ...current, marker: event.target.value }))}
                  >
                    <option value="">Nessun marker</option>
                    {activeMarkers.map((marker) => (
                      <option key={marker.value} value={marker.value}>
                        {marker.text}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="field attendance-cell-editor__notes">
                <span>Note</span>
                <textarea
                  rows={4}
                  value={cellEditorValues.notes}
                  onChange={(event) => setCellEditorValues((current) => ({ ...current, notes: event.target.value }))}
                  placeholder="Aggiungi note"
                />
              </label>
            </div>

            <div className="attendance-cell-editor__actions">
              <button type="button" className="button" onClick={handleSaveCellEditor}>
                Salva
              </button>
              <button type="button" className="button-secondary" onClick={handleCloseCellEditor}>
                Annulla
              </button>
            </div>
          </div>
        </div>
      ) : null}

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

