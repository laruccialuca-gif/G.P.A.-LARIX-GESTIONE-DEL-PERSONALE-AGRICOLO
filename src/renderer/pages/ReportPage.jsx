import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import DocumentActions from '../components/DocumentActions';
import { calculateAttendanceTotals, formatHoursValue, formatWorkedSummary, getSafeStandardHours } from '../utils/attendanceSummary';
import { formatCurrency as sharedFormatCurrency, formatSignedCurrency as sharedFormatSignedCurrency } from '../utils/currencyFormat';
import { formatDisplayDate, formatDisplayDateTime } from '../utils/dateFormat';
import { useYearContext } from '../context/YearContext';
import { employeeIsActiveInYear } from '../utils/yearScope';

const MONTH_NAMES = [
  'GENNAIO', 'FEBBRAIO', 'MARZO', 'APRILE', 'MAGGIO', 'GIUGNO',
  'LUGLIO', 'AGOSTO', 'SETTEMBRE', 'OTTOBRE', 'NOVEMBRE', 'DICEMBRE'
];

const MONTH_SELECT_OPTIONS = [
  { value: 0, label: 'Gennaio' },
  { value: 1, label: 'Febbraio' },
  { value: 2, label: 'Marzo' },
  { value: 3, label: 'Aprile' },
  { value: 4, label: 'Maggio' },
  { value: 5, label: 'Giugno' },
  { value: 6, label: 'Luglio' },
  { value: 7, label: 'Agosto' },
  { value: 8, label: 'Settembre' },
  { value: 9, label: 'Ottobre' },
  { value: 10, label: 'Novembre' },
  { value: 11, label: 'Dicembre' },
];

const DAY_ABBR_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateValue(value) {
  const [year, month, day] = String(value || '').split('-');
  if (!year || !month || !day) return null;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function getMonthDays(fromDate, toDate) {
  const days = [];
  const cursor = new Date(fromDate);

  while (cursor <= toDate) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function getCalendarWeeks(days) {
  const weeks = [];
  let currentWeek = [];

  days.forEach((day) => {
    currentWeek.push(day);
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
  });

  if (currentWeek.length) {
    weeks.push(currentWeek);
  }

  return weeks;
}

function monthString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function formatMonthLabelForFile(date) {
  const raw = date.toLocaleDateString('it-IT', {
    month: 'long',
    year: 'numeric',
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatDateLabel(value) {
  return formatDisplayDate(value);
}

function formatPeriodLabel(start, end) {
  if (!start || !end) return 'Periodo non definito';
  return `${formatDateLabel(start)} - ${formatDateLabel(end)}`;
}

function getPreviousMonthKey(monthKey) {
  const parsed = parseDateValue(`${String(monthKey || '')}-01`);
  if (!parsed) return '';
  const previousMonth = new Date(parsed.getFullYear(), parsed.getMonth() - 1, 1);
  return monthString(previousMonth);
}

function sanitizeFileName(value) {
  return value
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSelection(value) {
  if (!value) {
    return { type: null, id: null };
  }

  const [type, id] = String(value).split(':');
  return { type, id: Number(id) };
}

function getReportEmployeeDisplayName(employee) {
  if (!employee) return '';
  if (employee.full_name) {
    return String(employee.full_name).trim();
  }
  if (employee.employee_name) {
    return String(employee.employee_name).trim();
  }
  return `${employee.first_name || ''} ${employee.last_name || ''}`.trim();
}

function getTeamDisplayName(team) {
  if (!team) return '';
  return `Squadra ${team.name || ''}`.trim();
}

function matchesReportEmployeeSearch(employee, normalizedSearch) {
  const haystack = [
    employee?.full_name,
    employee?.employee_name,
    employee?.name,
    employee?.first_name,
    employee?.last_name,
    `${employee?.first_name || ''} ${employee?.last_name || ''}`,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return !normalizedSearch || haystack.includes(normalizedSearch);
}

function getTeamRows(team, year) {
  return (team?.members || []).filter((member) =>
    member.employee &&
    !member.employee.is_deleted &&
    employeeIsActiveInYear(member.employee, year)
  );
}

function getReportCellValue(att, hoursFormat = 'decimal') {
  if (!att) return '';
  if (att.status && att.status !== 'presente' && att.status !== 'assente') {
    return att.status.charAt(0).toUpperCase();
  }
  if (att.entry_code) {
    return att.entry_code;
  }
  return Number(att.hours_worked || 0) + Number(att.overtime_hours || 0) || '';
}

function isDateWithinRange(value, start, end) {
  if (!value || !start || !end) return false;
  return value >= start && value <= end;
}

function getMonthKeysInRange(start, end) {
  const startDate = parseDateValue(start);
  const endDate = parseDateValue(end);
  if (!startDate || !endDate || endDate < startDate) return [];

  const keys = [];
  const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const finish = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (cursor <= finish) {
    keys.push({
      year: cursor.getFullYear(),
      month: cursor.getMonth() + 1,
      key: monthString(cursor),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  return keys;
}

function createLocalDraftKey(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function createEmptyAdvance() {
  return {
    amount: '',
    date: '',
    includeInReport: true,
  };
}

function createEmptyTeamAdvance() {
  return {
    amount: '',
    date: '',
    description: '',
  };
}

function createEmptyDebtInstallment() {
  return {
    client_key: createLocalDraftKey('debt-installment'),
    target_month: '',
    amount: '',
    note: '',
  };
}

function createEmptyDebtPlan() {
  return {
    id: null,
    client_key: createLocalDraftKey('debt-plan'),
    label: '',
    total_amount: '',
    created_from_month: '',
    installments: [createEmptyDebtInstallment()],
  };
}

function normalizeAdvances(advances) {
  const list = Array.isArray(advances) && advances.length ? advances : [createEmptyAdvance()];

  return list.map((advance) => ({
    amount: advance.amount === '' ? '' : String(advance.amount ?? ''),
    date: advance.date || '',
    includeInReport: advance.includeInReport !== undefined ? !!advance.includeInReport : true,
  }));
}

function isAdvanceDraftEmpty(advance) {
  return String(advance?.amount ?? '').trim() === '' && String(advance?.date ?? '').trim() === '';
}

function buildEditorAdvances(savedAdvances, currentAdvances = []) {
  const meaningfulSavedAdvances = normalizeAdvances(savedAdvances).filter((advance) => !isAdvanceDraftEmpty(advance));
  const emptyDraftRows = (currentAdvances || []).filter(isAdvanceDraftEmpty).length;
  const emptyRowsToKeep = meaningfulSavedAdvances.length ? emptyDraftRows : Math.max(1, emptyDraftRows);

  return [
    ...meaningfulSavedAdvances,
    ...Array.from({ length: emptyRowsToKeep }, () => createEmptyAdvance()),
  ];
}

function isDebtInstallmentDraftEmpty(installment) {
  return (
    String(installment?.target_month ?? '').trim() === '' &&
    String(installment?.amount ?? '').trim() === '' &&
    String(installment?.note ?? '').trim() === ''
  );
}

function isDebtPlanDraftEmpty(plan) {
  const installments = Array.isArray(plan?.installments) ? plan.installments : [];
  return (
    String(plan?.label ?? '').trim() === '' &&
    String(plan?.total_amount ?? '').trim() === '' &&
    installments.every(isDebtInstallmentDraftEmpty)
  );
}

function normalizeDebtPlansForEditor(plans = [], fallbackMonth = '') {
  return (plans || []).map((plan) => ({
    id: plan.id,
    client_key: plan.client_key || (plan.id ? `debt-plan-${plan.id}` : createLocalDraftKey('debt-plan')),
    label: plan.label || '',
    total_amount: String(plan.total_amount || ''),
    status: plan.status || 'active',
    created_from_month: plan.created_from_month || fallbackMonth,
    installments: (plan.installments || []).length
      ? plan.installments.map((installment) => ({
          id: installment.id,
          client_key:
            installment.client_key ||
            (installment.id ? `debt-installment-${installment.id}` : createLocalDraftKey('debt-installment')),
          target_month: installment.target_month || '',
          amount: String(installment.amount || ''),
          note: installment.note || '',
        }))
      : [createEmptyDebtInstallment()],
  }));
}

function buildEditorDebtPlans(savedPlans, currentPlans = [], fallbackMonth = '') {
  const meaningfulSavedPlans = normalizeDebtPlansForEditor(savedPlans, fallbackMonth)
    .filter((plan) => !isDebtPlanDraftEmpty(plan));
  const emptyDraftPlans = (currentPlans || []).filter(isDebtPlanDraftEmpty).map((plan) => ({
    ...plan,
    installments: (plan.installments || []).length ? plan.installments : [createEmptyDebtInstallment()],
    created_from_month: plan.created_from_month || fallbackMonth,
  }));

  return [...meaningfulSavedPlans, ...emptyDraftPlans];
}

function normalizeCurrency(value) {
  return Number(value || 0);
}

function formatCurrency(value) {
  return sharedFormatCurrency(value);
}

function getBalanceOutcomeLabel(value) {
  const amount = Number(value || 0);
  if (amount < 0) return 'Debito operaio';
  if (amount > 0) return 'Credito operaio';
  return 'Saldo perfetto';
}

function formatSignedCurrency(value) {
  return sharedFormatSignedCurrency(value);
}

function formatNegativeCurrency(value) {
  return `- ${formatCurrency(Math.abs(Number(value || 0)))}`;
}

function getIpcRecoveryMessage(error, fallbackMessage) {
  const message = String(error?.message || '');
  if (message.includes('No handler registered')) {
    return 'Questa funzione richiede il riavvio completo di Electron per aggiornare il processo principale.';
  }
  return fallbackMessage;
}

function getPayrollAdvancesInRange(records, start, end) {
  return (records || []).flatMap((record) =>
    (record.advances || [])
      .filter((advance) => {
        if (!advance.date) return record.month >= start.slice(0, 7) && record.month <= end.slice(0, 7);
        return isDateWithinRange(advance.date, start, end);
      })
      .map((advance) => ({
        ...advance,
        sourceMonth: record.month,
      }))
  );
}

function buildEconomicSnapshot(fields) {
  return JSON.stringify(fields);
}

function getBenefitsSectionStorageKey(entityKey, monthKey) {
  return `report-benefits-section:${entityKey || 'none'}:${monthKey || 'none'}`;
}

function readBenefitsSectionCollapsed(storageKey) {
  if (!storageKey || typeof window === 'undefined') return false;

  try {
    return window.localStorage.getItem(storageKey) === '1';
  } catch {
    return false;
  }
}

function writeBenefitsSectionCollapsed(storageKey, isCollapsed) {
  if (!storageKey || typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(storageKey, isCollapsed ? '1' : '0');
  } catch {
    // Best effort only.
  }
}

function getPreviousBalanceLabel(amount) {
  const numericAmount = Number(amount || 0);
  if (numericAmount > 0) return 'Credito precedente';
  if (numericAmount < 0) return 'Debito precedente';
  return '';
}

function calculateRecordEffectiveBalance(record) {
  if (!record) return 0;
  const installmentsPaidByRecord = (record.debt_plans || [])
    .flatMap((plan) => plan.installments || [])
    .filter((installment) => String(installment.paid_record_id || '') === String(record.id || ''))
    .reduce((sum, installment) => sum + Number(installment.amount || 0), 0);

  return (
    Number(record.retribuzione_calcolata || 0) +
    Number(record.resto_precedente || 0) +
    Number(record.totale_trasporto || 0) +
    Number(record.regalo_importo || 0) -
    Number(record.acconti || 0) -
    Number(record.importo_busta_paga || 0) -
    installmentsPaidByRecord
  );
}

function buildPreviousBalanceReference(record, currentMonthKey) {
  const snapshotReference = record?.report_snapshot_json?.previous_balance_snapshot || null;
  if (snapshotReference?.source_month) {
    return snapshotReference;
  }

  const importedBalance = Number(record?.resto_precedente || 0);
  if (importedBalance === 0) {
    return null;
  }

  const fallbackMonth = getPreviousMonthKey(currentMonthKey);
  if (!fallbackMonth) {
    return null;
  }

  return {
    source_month: fallbackMonth,
    imported_balance: importedBalance,
    source_resto_paid: false,
    inferred: true,
  };
}

function getEffectiveOvertimeRate(employee, settings) {
  const overtimeEnabled = !!settings?.general?.overtime_enabled;
  if (!overtimeEnabled) return 0;

  if (employee?.overtime_use_general_rate === false) {
    return Number(employee?.overtime_hourly_rate || 0) || 0;
  }

  return Number(settings?.general?.overtime_hourly_rate || 0) || 0;
}

function getOvertimeViewSettings(settings) {
  return {
    enabled: !!settings?.general?.overtime_enabled,
    displayMode: settings?.general?.overtime_display_mode === 'separate' ? 'separate' : 'included',
    showHourlyRate: settings?.general?.overtime_show_hourly_rate !== false,
  };
}

function getHoursFormat(settings) {
  return settings?.general?.attendance_hours_format === 'hours_minutes' ? 'hours_minutes' : 'decimal';
}

const rp2DayIndicatorSlotStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 26,
};

export default function ReportPage() {
  const { selectedYear, setSelectedYear, yearOptions } = useYearContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [currentMonth, setCurrentMonth] = useState(() => new Date(selectedYear, new Date().getMonth(), 1));
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [settings, setSettings] = useState(null);
  const [selectedEntity, setSelectedEntity] = useState('');
  const [reportSearchTerm, setReportSearchTerm] = useState('');
  const [isEmployeeAutocompleteOpen, setIsEmployeeAutocompleteOpen] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [attendanceLoading, setAttendanceLoading] = useState(true);

  const [datore, setDatore] = useState('');
  const [importoBustaPaga, setImportoBustaPaga] = useState('');
  const [giornateBustaPaga, setGiornateBustaPaga] = useState('');
  const [dailyPayInput, setDailyPayInput] = useState('');
  const [savingDailyPay, setSavingDailyPay] = useState(false);
  const [advances, setAdvances] = useState([createEmptyAdvance()]);
  const [restoPrecedente, setRestoPrecedente] = useState('');
  const [trasportoAttivo, setTrasportoAttivo] = useState(false);
  const [nMacchineMese, setNMacchineMese] = useState('');
  const [prezzoPerMacchina, setPrezzoPerMacchina] = useState('');
  const [noteExtra, setNoteExtra] = useState('');
  const [isPagato, setIsPagato] = useState(false);
  const [restoPaid, setRestoPaid] = useState(false);
  const [restoPaidDate, setRestoPaidDate] = useState('');
  const [payrollDocument, setPayrollDocument] = useState(null);
  const [uploadingPayrollDocument, setUploadingPayrollDocument] = useState(false);
  const [currentPayrollRecord, setCurrentPayrollRecord] = useState(null);
  const [giftAmount, setGiftAmount] = useState('');
  const [giftLabel, setGiftLabel] = useState('');
  const [debtPlans, setDebtPlans] = useState([]);
  const [resolvedDebtPlans, setResolvedDebtPlans] = useState([]);
  const [isEditUnlocked, setIsEditUnlocked] = useState(false);
  const [savedEconomicSnapshot, setSavedEconomicSnapshot] = useState(null);
  const [savedEditorState, setSavedEditorState] = useState(null);
  const [saveState, setSaveState] = useState('idle');
  const [overtimeRateOverride, setOvertimeRateOverride] = useState('');
  const [showOvertimePanel, setShowOvertimePanel] = useState(false);
  const [showOvertimeInReport, setShowOvertimeInReport] = useState(true);
  const [showPayslipAmountDetails, setShowPayslipAmountDetails] = useState(false);
  const [payslipCalcDailyAmount, setPayslipCalcDailyAmount] = useState('');
  const [payslipCalcSelectedOption, setPayslipCalcSelectedOption] = useState('');
  const [payslipCustomDays, setPayslipCustomDays] = useState('');
  const [previousBalanceReference, setPreviousBalanceReference] = useState(null);
  const [previousBalanceWarning, setPreviousBalanceWarning] = useState('');
  const [isBenefitsSectionCollapsed, setIsBenefitsSectionCollapsed] = useState(false);
  const [financialImportCounts, setFinancialImportCounts] = useState({ advance: 0, installment: 0 });
  const [financialImportModal, setFinancialImportModal] = useState({
    open: false,
    type: 'advance',
    items: [],
    selectedIds: [],
  });
  const [pendingSavePrompt, setPendingSavePrompt] = useState(null);
  const [importedFinancialMovementIds, setImportedFinancialMovementIds] = useState([]);
  const autosaveTimeoutRef = useRef(null);
  const mountedRef = useRef(false);
  const employeeAutocompleteRef = useRef(null);

  const [teamPeriodStart, setTeamPeriodStart] = useState(formatLocalDate(startOfMonth(currentMonth)));
  const [teamPeriodEnd, setTeamPeriodEnd] = useState(formatLocalDate(endOfMonth(currentMonth)));
  const [teamTransportEnabled, setTeamTransportEnabled] = useState(false);
  const [teamTransportDescription, setTeamTransportDescription] = useState('');
  const [teamTransportAmount, setTeamTransportAmount] = useState('');
  const [teamAdvances, setTeamAdvances] = useState([createEmptyTeamAdvance()]);
  const [teamNotes, setTeamNotes] = useState('');
  const [teamPayrollMap, setTeamPayrollMap] = useState({});
  const [processedEmployeeIdsForMonth, setProcessedEmployeeIdsForMonth] = useState(() => new Set());

  const selectedMeta = parseSelection(selectedEntity);
  const isEmployeeMode = selectedMeta.type === 'employee';
  const isTeamMode = selectedMeta.type === 'team';
  const visibleTeams = useMemo(
    () => teams.filter((team) => getTeamRows(team, selectedYear).length > 0),
    [teams, selectedYear]
  );

  const activeEmployees = useMemo(
    () => employees.filter((item) =>
      item.status !== 'inattivo' &&
      !item.is_deleted &&
      employeeIsActiveInYear(item, selectedYear)
    ),
    [employees, selectedYear]
  );
  const sortedActiveEmployees = useMemo(
    () =>
      activeEmployees
        .map((item, originalIndex) => ({
          item,
          originalIndex,
        }))
        .sort((a, b) => {
          const compareResult = String(getReportEmployeeDisplayName(a.item) || '').localeCompare(
            String(getReportEmployeeDisplayName(b.item) || ''),
            'it',
            { sensitivity: 'base' }
          );
          return compareResult !== 0 ? compareResult : a.originalIndex - b.originalIndex;
        })
        .map(({ item }) => item),
    [activeEmployees]
  );
  const normalizedSearch = useMemo(
    () => reportSearchTerm.trim().toLowerCase(),
    [reportSearchTerm]
  );
  const employee = isEmployeeMode
    ? activeEmployees.find((item) => String(item.id) === String(selectedMeta.id))
    : null;
  const filteredEmployeesForSelect = useMemo(() => {
    if (!normalizedSearch) {
      return sortedActiveEmployees;
    }

    const filtered = sortedActiveEmployees.filter((item) =>
      matchesReportEmployeeSearch(item, normalizedSearch)
    );

    if (
      isEmployeeMode &&
      employee &&
      !filtered.some((item) => String(item.id) === String(employee.id))
    ) {
      return [employee, ...filtered];
    }

    return filtered;
  }, [normalizedSearch, sortedActiveEmployees, isEmployeeMode, employee]);
  const filteredTeamsForSelect = useMemo(() => {
    if (!normalizedSearch) {
      return visibleTeams;
    }

    return visibleTeams.filter((team) =>
      String(team.name || '').toLowerCase().includes(normalizedSearch)
    );
  }, [normalizedSearch, visibleTeams]);
  const hasEmployeeSearchResults = filteredEmployeesForSelect.length > 0;
  const showEmployeeAutocomplete = isEmployeeAutocompleteOpen;
  const selectedTeam = isTeamMode
    ? visibleTeams.find((team) => String(team.id) === String(selectedMeta.id))
    : null;
  const employerOptions = settings?.employer_options || [
    { value: 'LC', short_name: 'LC', name: 'Laruccia Cosimo' },
    { value: 'LG', short_name: 'LG', name: 'Laruccia Giuseppe' },
  ];
  const defaultEmployerValue = employerOptions[0]?.short_name || employerOptions[0]?.value || 'LC';
  const requestedEmployeeId = searchParams.get('employee');
  const requestedMonth = searchParams.get('month');
  const attendanceByEmployeeId = useMemo(() => {
    const map = new Map();
    for (const item of attendance) {
      const employeeId = String(item.employee_id);
      const current = map.get(employeeId);
      if (current) {
        current.push(item);
      } else {
        map.set(employeeId, [item]);
      }
    }
    return map;
  }, [attendance]);

  const queryMonths = useMemo(() => {
    if (isTeamMode) {
      const rangeMonths = getMonthKeysInRange(teamPeriodStart, teamPeriodEnd);
      return rangeMonths.length ? rangeMonths : [{ year: currentMonth.getFullYear(), month: currentMonth.getMonth() + 1, key: monthString(currentMonth) }];
    }

    return [{ year: currentMonth.getFullYear(), month: currentMonth.getMonth() + 1, key: monthString(currentMonth) }];
  }, [isTeamMode, currentMonth, teamPeriodStart, teamPeriodEnd]);

  const queryMonthsKey = queryMonths.map((item) => item.key).join('|');
  const loading = directoryLoading || attendanceLoading;
  const selectedReportMonthKey = monthString(currentMonth);

  const employeeProcessedStatusMap = useMemo(() => {
    const map = new Map();
    sortedActiveEmployees.forEach((item) => {
      map.set(Number(item.id), processedEmployeeIdsForMonth.has(Number(item.id)));
    });
    return map;
  }, [sortedActiveEmployees, processedEmployeeIdsForMonth]);

  function getEmployeeSelectLabel(item) {
    const baseLabel = getReportEmployeeDisplayName(item);
    return employeeProcessedStatusMap.get(Number(item.id))
      ? `${baseLabel} - gia elaborato`
      : baseLabel;
  }

  function handleEmployeeAutocompleteSelect(item) {
    guardUnsavedChanges(() => {
      setSelectedEntity(`employee:${item.id}`);
      setReportSearchTerm(getReportEmployeeDisplayName(item));
      setIsEmployeeAutocompleteOpen(false);
    });
  }

  const employeeAttendanceStatusMap = useMemo(() => {
    const map = new Map();
    sortedActiveEmployees.forEach((item) => {
      map.set(Number(item.id), false);
    });

    for (const item of attendance) {
      if (!String(item?.date || '').startsWith(`${selectedReportMonthKey}-`)) {
        continue;
      }

      const employeeId = Number(item.employee_id);
      if (!Number.isFinite(employeeId)) {
        continue;
      }

      map.set(employeeId, true);
    }

    return map;
  }, [attendance, selectedReportMonthKey, sortedActiveEmployees]);

  function getEmployeeDropdownStatus(item) {
    const employeeId = Number(item.id);
    if (employeeProcessedStatusMap.get(employeeId)) {
      return {
        key: 'processed',
        label: 'gia elaborato',
        style: {
          background: 'rgba(22, 163, 74, 0.14)',
          color: '#14532d',
          borderColor: 'rgba(22, 101, 52, 0.14)',
        },
      };
    }

    if (employeeAttendanceStatusMap.get(employeeId)) {
      return {
        key: 'pending',
        label: 'da elaborare',
        style: {
          background: 'rgba(245, 158, 11, 0.14)',
          color: '#b45309',
          borderColor: 'rgba(245, 158, 11, 0.18)',
        },
      };
    }

    return null;
  }

  function handleTeamAutocompleteSelect(team) {
    guardUnsavedChanges(() => {
      setSelectedEntity(`team:${team.id}`);
      setReportSearchTerm(getTeamDisplayName(team));
      setIsEmployeeAutocompleteOpen(false);
    });
  }

  function logReportPerf(stage, details = {}) {
    console.info('[report-perf]', stage, {
      ...details,
      currentMonth: monthString(currentMonth),
      selectedEntity: selectedEntity || null,
      timestamp: new Date().toISOString(),
    });
  }

  useEffect(() => {
    mountedRef.current = true;
    console.info('[route-lifecycle] enter Report', {
      pathname: window.location.pathname,
      timestamp: new Date().toISOString(),
    });

    return () => {
      mountedRef.current = false;
      console.info('[route-lifecycle] leave Report', {
        pathname: window.location.pathname,
        timestamp: new Date().toISOString(),
      });
    };
  }, []);

  useEffect(() => {
    setTeamPeriodStart(formatLocalDate(startOfMonth(currentMonth)));
    setTeamPeriodEnd(formatLocalDate(endOfMonth(currentMonth)));
  }, [currentMonth]);

  useEffect(() => {
    setCurrentMonth((current) => {
      if (current.getFullYear() === selectedYear) {
        return current;
      }
      return new Date(selectedYear, current.getMonth(), 1);
    });
  }, [selectedYear]);

  useEffect(() => {
    if (!isTeamMode) return;
    setTeamTransportEnabled(false);
    setTeamTransportDescription('');
    setTeamTransportAmount('');
    setTeamAdvances([createEmptyTeamAdvance()]);
    setTeamNotes('');
  }, [selectedTeam?.id, currentMonth, isTeamMode]);

  useEffect(() => {
    setIsEditUnlocked(false);
  }, [selectedEntity, currentMonth]);

  useEffect(() => () => {
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    function handlePointerDown(event) {
      if (!employeeAutocompleteRef.current?.contains(event.target)) {
        setIsEmployeeAutocompleteOpen(false);
      }
    }

    document.addEventListener('mousedown', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
    };
  }, []);

  useEffect(() => {
    if (isEmployeeMode && employee) {
      setReportSearchTerm(getReportEmployeeDisplayName(employee));
      return;
    }

    if (isTeamMode && selectedTeam) {
      setReportSearchTerm(getTeamDisplayName(selectedTeam));
      return;
    }

    if (!selectedEntity) {
      setReportSearchTerm('');
    }
  }, [selectedEntity, isEmployeeMode, isTeamMode, employee, selectedTeam]);

  useEffect(() => {
    if (!employee) {
      setDailyPayInput('');
      return;
    }

    setDailyPayInput(
      employee.daily_pay !== null && employee.daily_pay !== undefined && employee.daily_pay !== ''
        ? String(employee.daily_pay)
        : ''
    );
  }, [employee?.id, employee?.daily_pay]);

  useEffect(() => {
    if (!requestedEmployeeId || !employees.length) {
      return;
    }

    const employeeExists = employees.some((item) => String(item.id) === String(requestedEmployeeId));
    if (!employeeExists) {
      return;
    }

    const nextSelection = `employee:${requestedEmployeeId}`;
    if (selectedEntity !== nextSelection) {
      setSelectedEntity(nextSelection);
    }

    if (requestedMonth) {
      const parsedMonth = parseDateValue(`${requestedMonth}-01`);
      if (parsedMonth && monthString(currentMonth) !== requestedMonth) {
        if (parsedMonth.getFullYear() !== selectedYear) {
          setSelectedYear(parsedMonth.getFullYear());
        }
        setCurrentMonth(new Date(parsedMonth.getFullYear(), parsedMonth.getMonth(), 1));
      }
    }

    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete('employee');
      next.delete('month');
      return next;
    }, { replace: true });
  }, [requestedEmployeeId, requestedMonth, employees, selectedEntity, currentMonth, selectedYear, setSearchParams, setSelectedYear]);

  useEffect(() => {
    if (isEmployeeMode && !employee) {
      setSelectedEntity('');
      return;
    }

    if (isTeamMode && !selectedTeam) {
      setSelectedEntity('');
    }
  }, [isEmployeeMode, isTeamMode, employee, selectedTeam]);

  useEffect(() => {
    let cancelled = false;

    async function loadProcessedReportsForCurrentMonth() {
      if (typeof window.api?.payroll?.listHistory !== 'function') {
        if (!cancelled && mountedRef.current) {
          setProcessedEmployeeIdsForMonth(new Set());
        }
        return;
      }

      try {
        const result = await window.api.payroll.listHistory({
          year: String(currentMonth.getFullYear()),
          month: selectedReportMonthKey,
        });
        if (cancelled || !mountedRef.current) {
          return;
        }

        const items = Array.isArray(result) ? result : result?.items || [];
        const processedIds = new Set(
          items
            .filter((record) => String(record.month || '') === selectedReportMonthKey)
            .map((record) => Number(record.employee_id))
            .filter((id) => Number.isFinite(id))
        );
        setProcessedEmployeeIdsForMonth(processedIds);
      } catch (err) {
        console.error('Errore caricamento stato report elaborati', err);
        if (!cancelled && mountedRef.current) {
          setProcessedEmployeeIdsForMonth(new Set());
        }
      }
    }

    loadProcessedReportsForCurrentMonth();

    return () => {
      cancelled = true;
    };
  }, [currentMonth, selectedReportMonthKey]);

  async function refreshFinancialImportCounts(targetEmployeeId = employee?.id) {
    if (!targetEmployeeId || !window.api.financialMovements) {
      if (mountedRef.current) {
        setFinancialImportCounts({ advance: 0, installment: 0 });
      }
      return;
    }

    try {
      const counts = await window.api.financialMovements.countAvailable(targetEmployeeId);
      if (!mountedRef.current) {
        console.info('[route-lifecycle] setState skipped after unmount', {
          page: 'Report',
          source: 'refreshFinancialImportCounts',
        });
        return;
      }

      setFinancialImportCounts({
        advance: Number(counts?.advance || 0),
        installment: Number(counts?.installment || 0),
      });
    } catch (err) {
      console.error(err);
      if (mountedRef.current) {
        setFinancialImportCounts({ advance: 0, installment: 0 });
      }
    }
  }

  useEffect(() => {
    if (!isEmployeeMode || !employee) {
      setFinancialImportCounts({ advance: 0, installment: 0 });
      return;
    }
    refreshFinancialImportCounts(employee.id);
  }, [isEmployeeMode, employee?.id, currentMonth]);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    logReportPerf('page:directory-load:start');

    async function loadDirectoryData() {
      if (mountedRef.current) {
        setDirectoryLoading(true);
      }

      try {
        const __empT0 = Date.now();
        const employeesPromise = window.api.employees.listBasic({ includePeriods: true });
        const teamsPromise = window.api.teams.list();
        const settingsPromise = window.api.settings.get();
        const employeeData = await employeesPromise;
        console.info('[page-perf] report:employees-load:end', {
          count: Array.isArray(employeeData) ? employeeData.length : 0,
          duration_ms: Date.now() - __empT0,
        });
        const [teamData, settingsData] = await Promise.all([teamsPromise, settingsPromise]);

        if (cancelled || !mountedRef.current) {
          console.info('[route-lifecycle] async cancelled', {
            page: 'Report',
            source: 'loadDirectoryData',
          });
          return;
        }

        setEmployees(employeeData || []);
        setTeams(teamData || []);
        setSettings(settingsData || null);
        const __dirDt = Date.now() - startedAt;
        logReportPerf('page:directory-load:end', {
          duration_ms: __dirDt,
          employees_count: Array.isArray(employeeData) ? employeeData.length : 0,
          teams_count: Array.isArray(teamData) ? teamData.length : 0,
        });
        console.info('[page-perf] report:loadBaseData:end', { duration_ms: __dirDt });
      } catch (err) {
        console.error(err);
        if (!cancelled && mountedRef.current) {
          alert('Errore caricamento report');
        }
      } finally {
        if (!cancelled && mountedRef.current) {
          setDirectoryLoading(false);
        }
      }
    }

    loadDirectoryData();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    logReportPerf('page:attendance-load:start', {
      months_count: queryMonths.length,
      month_keys: queryMonths.map((entry) => entry.key),
    });

    async function loadAttendanceData() {
      if (mountedRef.current) {
        setAttendanceLoading(true);
      }

      try {
        const attendanceChunks = await Promise.all(
          queryMonths.map((entry) => window.api.attendance.listByMonth(entry.year, entry.month))
        );

        if (cancelled || !mountedRef.current) {
          console.info('[route-lifecycle] async cancelled', {
            page: 'Report',
            source: 'loadAttendanceData',
          });
          return;
        }

        const flattenedAttendance = attendanceChunks.flat();
        setAttendance(flattenedAttendance);
        logReportPerf('page:attendance-load:end', {
          duration_ms: Date.now() - startedAt,
          months_count: queryMonths.length,
          attendance_count: flattenedAttendance.length,
        });
      } catch (err) {
        console.error(err);
        if (!cancelled && mountedRef.current) {
          alert('Errore caricamento report');
        }
      } finally {
        if (!cancelled && mountedRef.current) {
          setAttendanceLoading(false);
        }
      }
    }

    loadAttendanceData();

    return () => {
      cancelled = true;
    };
  }, [queryMonthsKey]);

  useEffect(() => {
    let cancelled = false;

    async function loadPayrollContext() {
      function splitDebtPlansByStatus(plans = []) {
        return plans.reduce(
          (acc, plan) => {
            if ((plan.status || 'active') === 'active') {
              acc.active.push(plan);
            } else {
              acc.resolved.push(plan);
            }
            return acc;
          },
          { active: [], resolved: [] }
        );
      }

      function buildSavedStateFromRecord(record) {
        const savedNMacchine = Number(record.n_macchine_mese || 0);
        const savedPrezzo = Number(record.prezzo_per_macchina || 0);
        const savedTrasporto = Number(record.totale_trasporto || 0);
        const normalizedPlans = normalizeDebtPlansForEditor(record.debt_plans || [], currentMonthKey);
        const splitPlans = splitDebtPlansByStatus(normalizedPlans);

        return {
          datore: record.datore || defaultEmployerValue,
          importoBustaPaga: record.importo_busta_paga ? String(record.importo_busta_paga) : '',
          giornateBustaPaga: record.giornate_busta_paga ? String(record.giornate_busta_paga) : '',
          advances: buildEditorAdvances(record.advances),
          restoPrecedente: record.resto_precedente !== null && record.resto_precedente !== undefined ? String(record.resto_precedente) : '',
          trasportoAttivo: savedNMacchine > 0 || savedPrezzo > 0 || savedTrasporto > 0,
          nMacchineMese: savedNMacchine ? String(savedNMacchine) : '',
          prezzoPerMacchina: savedPrezzo ? String(savedPrezzo) : '',
          noteExtra: record.note || '',
          isPagato: !!record.is_pagato,
          restoPaid: !!record.resto_pagato,
          restoPaidDate: record.resto_pagato_data || '',
          payrollDocument: record.payroll_document || null,
          currentPayrollRecord: record || null,
          giftAmount: record.regalo_importo ? String(record.regalo_importo) : '',
          giftLabel: record.regalo_descrizione || '',
          debtPlans: splitPlans.active,
          resolvedDebtPlans: splitPlans.resolved,
          overtimeRateOverride: '',
          showOvertimePanel: false,
          showOvertimeInReport: record?.report_snapshot_json?.showOvertimeInReport !== false,
          payslipCalcDailyAmount: record?.report_snapshot_json?.payslip_simulator?.daily_amount
            ? String(record.report_snapshot_json.payslip_simulator.daily_amount)
            : '',
          payslipCalcSelectedOption: record?.report_snapshot_json?.payslip_simulator?.selected_option || '',
          payslipCustomDays:
            record?.report_snapshot_json?.payslip_simulator?.custom_days !== undefined &&
            record?.report_snapshot_json?.payslip_simulator?.custom_days !== null
              ? String(record.report_snapshot_json.payslip_simulator.custom_days)
              : '',
          previousBalanceReference: buildPreviousBalanceReference(record, currentMonthKey),
        };
      }

      function buildSavedStateFromPreviousBalance(previous) {
        return {
          datore: defaultEmployerValue,
          importoBustaPaga: '',
          giornateBustaPaga: '',
          advances: [createEmptyAdvance()],
          restoPrecedente: previous?.previousBalance !== null && previous?.previousBalance !== undefined ? String(previous.previousBalance) : '',
          trasportoAttivo: false,
          nMacchineMese: '',
          prezzoPerMacchina: '',
          noteExtra: '',
          isPagato: false,
          restoPaid: false,
          restoPaidDate: '',
          payrollDocument: null,
          currentPayrollRecord: null,
          giftAmount: '',
          giftLabel: '',
          debtPlans: [],
          resolvedDebtPlans: [],
          overtimeRateOverride: '',
          showOvertimePanel: false,
          showOvertimeInReport: true,
          payslipCalcDailyAmount: '',
          payslipCalcSelectedOption: '',
          payslipCustomDays: '',
          previousBalanceReference: null,
        };
      }

      function applyEditorState(nextState) {
        setDatore(nextState.datore);
        setImportoBustaPaga(nextState.importoBustaPaga);
        setGiornateBustaPaga(nextState.giornateBustaPaga);
        setAdvances(nextState.advances);
        setRestoPrecedente(nextState.restoPrecedente);
        setTrasportoAttivo(nextState.trasportoAttivo);
        setNMacchineMese(nextState.nMacchineMese);
        setPrezzoPerMacchina(nextState.prezzoPerMacchina);
        setNoteExtra(nextState.noteExtra);
        setIsPagato(nextState.isPagato);
        setRestoPaid(nextState.restoPaid);
        setRestoPaidDate(nextState.restoPaidDate);
        setPayrollDocument(nextState.payrollDocument);
        setGiftAmount(nextState.giftAmount);
        setGiftLabel(nextState.giftLabel);
        setDebtPlans(nextState.debtPlans);
        setResolvedDebtPlans(nextState.resolvedDebtPlans);
        setCurrentPayrollRecord(nextState.currentPayrollRecord);
        setOvertimeRateOverride(nextState.overtimeRateOverride);
        setShowOvertimePanel(nextState.showOvertimePanel);
        setShowOvertimeInReport(nextState.showOvertimeInReport);
        setPayslipCalcDailyAmount(nextState.payslipCalcDailyAmount);
        setPayslipCalcSelectedOption(nextState.payslipCalcSelectedOption);
        setPayslipCustomDays(nextState.payslipCustomDays);
        setPreviousBalanceReference(nextState.previousBalanceReference || null);
      }

      if (!isEmployeeMode || !employee) {
        if (!mountedRef.current || cancelled) return;
        applyEditorState(buildSavedStateFromPreviousBalance(null));
        setSavedEditorState(null);
        setSavedEconomicSnapshot(null);
        setSaveState('idle');
        setPreviousBalanceWarning('');
        return;
      }

      const currentMonthKey = monthString(currentMonth);

      try {
        const existing = await window.api.payroll.getRecord(employee.id, currentMonthKey);
        if (cancelled || !mountedRef.current) {
          console.info('[route-lifecycle] async cancelled', {
            page: 'Report',
            source: 'loadPayrollContext:getRecord',
          });
          return;
        }

        if (existing) {
          const nextSavedState = buildSavedStateFromRecord(existing);
          applyEditorState(nextSavedState);
          setSavedEditorState(nextSavedState);
          setSavedEconomicSnapshot(
            buildEconomicSnapshot({
              datore: nextSavedState.datore,
              importoBustaPaga: nextSavedState.importoBustaPaga,
              giornateBustaPaga: nextSavedState.giornateBustaPaga,
              advances: nextSavedState.advances,
              restoPrecedente: nextSavedState.restoPrecedente,
              trasportoAttivo: nextSavedState.trasportoAttivo,
              nMacchineMese: nextSavedState.nMacchineMese,
              prezzoPerMacchina: nextSavedState.prezzoPerMacchina,
              noteExtra: nextSavedState.noteExtra,
              isPagato: nextSavedState.isPagato,
              restoPaid: nextSavedState.restoPaid,
              restoPaidDate: nextSavedState.restoPaidDate,
              giftAmount: nextSavedState.giftAmount,
              giftLabel: nextSavedState.giftLabel,
              debtPlans: nextSavedState.debtPlans,
              resolvedDebtPlans: nextSavedState.resolvedDebtPlans,
              showOvertimeInReport: nextSavedState.showOvertimeInReport,
              payslipCalcDailyAmount: nextSavedState.payslipCalcDailyAmount,
              payslipCalcSelectedOption: nextSavedState.payslipCalcSelectedOption,
              payslipCustomDays: nextSavedState.payslipCustomDays,
            })
          );
          setSaveState('idle');
          return;
        }

        const previous = await window.api.payroll.getPreviousBalance(employee.id, currentMonthKey);
        if (cancelled || !mountedRef.current) {
          console.info('[route-lifecycle] async cancelled', {
            page: 'Report',
            source: 'loadPayrollContext:getPreviousBalance',
          });
          return;
        }
        const nextSavedState = buildSavedStateFromPreviousBalance(previous);
        applyEditorState(nextSavedState);
        setSavedEditorState(nextSavedState);
        setSavedEconomicSnapshot(
          buildEconomicSnapshot({
            datore: nextSavedState.datore,
            importoBustaPaga: nextSavedState.importoBustaPaga,
            giornateBustaPaga: nextSavedState.giornateBustaPaga,
            advances: nextSavedState.advances,
            restoPrecedente: nextSavedState.restoPrecedente,
            trasportoAttivo: nextSavedState.trasportoAttivo,
            nMacchineMese: nextSavedState.nMacchineMese,
            prezzoPerMacchina: nextSavedState.prezzoPerMacchina,
            noteExtra: nextSavedState.noteExtra,
            isPagato: nextSavedState.isPagato,
            restoPaid: nextSavedState.restoPaid,
            restoPaidDate: nextSavedState.restoPaidDate,
            giftAmount: nextSavedState.giftAmount,
            giftLabel: nextSavedState.giftLabel,
            debtPlans: nextSavedState.debtPlans,
            resolvedDebtPlans: nextSavedState.resolvedDebtPlans,
            showOvertimeInReport: nextSavedState.showOvertimeInReport,
            payslipCalcDailyAmount: nextSavedState.payslipCalcDailyAmount,
            payslipCalcSelectedOption: nextSavedState.payslipCalcSelectedOption,
            payslipCustomDays: nextSavedState.payslipCustomDays,
          })
        );
        setSaveState('idle');
        setPreviousBalanceWarning('');
      } catch (err) {
        console.error(err);
        if (!cancelled && mountedRef.current) {
          alert('Errore caricamento saldo precedente');
        }
      }
    }

    loadPayrollContext();
    return () => {
      cancelled = true;
    };
  }, [isEmployeeMode, employee, currentMonth, defaultEmployerValue, location.key]);

  useEffect(() => {
    const isProcessed = !!currentPayrollRecord?.processed_at;
    const isDisabled = isProcessed && !isEditUnlocked;
    console.log('[report-debug] editability state', {
      employee_id: employee?.id ?? null,
      month: employee ? monthString(currentMonth) : null,
      payroll_record_id: currentPayrollRecord?.id ?? null,
      hasSavedReport: currentPayrollRecord != null,
      isProcessed,
      isEditUnlocked,
      isDisabled,
      disabled_reason: isDisabled ? 'processed_at set and edit not unlocked' : (isProcessed ? 'processed but unlocked' : 'no processed record'),
      record_processed_at: currentPayrollRecord?.processed_at ?? null,
    });
  }, [currentPayrollRecord, isEditUnlocked, employee, currentMonth]);

  useEffect(() => {
    let cancelled = false;

    async function loadTeamPayroll() {
      if (!isTeamMode || !selectedTeam) {
        if (mountedRef.current) {
          setTeamPayrollMap({});
        }
        return;
      }

      const startedAt = Date.now();
      const rows = getTeamRows(selectedTeam, selectedYear);
      logReportPerf('page:team-payroll-load:start', {
        team_id: selectedTeam.id,
        member_count: rows.length,
      });

      try {
        const records = await Promise.all(
          rows.map((row) => window.api.payroll.listByEmployee(row.employee_id))
        );
        if (cancelled || !mountedRef.current) {
          console.info('[route-lifecycle] async cancelled', {
            page: 'Report',
            source: 'loadTeamPayroll',
          });
          return;
        }

        const next = {};
        rows.forEach((row, index) => {
          next[row.employee_id] = records[index] || [];
        });
        setTeamPayrollMap(next);
        logReportPerf('page:team-payroll-load:end', {
          team_id: selectedTeam.id,
          member_count: rows.length,
          duration_ms: Date.now() - startedAt,
        });
      } catch (err) {
        console.error(err);
        if (!cancelled && mountedRef.current) {
          setTeamPayrollMap({});
        }
      }
    }

    loadTeamPayroll();
    return () => {
      cancelled = true;
    };
  }, [isTeamMode, selectedTeam, currentMonth, selectedYear]);

  useEffect(() => {
    let cancelled = false;

    async function checkPreviousBalanceConsistency() {
      if (!isEmployeeMode || !employee || !currentPayrollRecord?.processed_at) {
        setPreviousBalanceWarning('');
        return;
      }

      const snapshot = previousBalanceReference;
      if (!snapshot?.source_month) {
        setPreviousBalanceWarning('');
        return;
      }

      try {
        const sourceRecord = await window.api.payroll.getRecord(employee.id, snapshot.source_month);
        if (cancelled) return;

        const currentSourcePaid = !!sourceRecord?.resto_pagato;
        const currentSourceBalance = sourceRecord ? calculateRecordEffectiveBalance(sourceRecord) : 0;
        const importedBalance = Number(snapshot.imported_balance || 0);
        const importedPaid = !!snapshot.source_resto_paid;
        const amountChanged = Math.abs(currentSourceBalance - importedBalance) > 0.009;
        const paidChanged = currentSourcePaid !== importedPaid;

        if (!sourceRecord || paidChanged || amountChanged) {
          setPreviousBalanceWarning(
            `Attenzione: il resto precedente importato da ${snapshot.source_month} risulta modificato o saldato dopo l'elaborazione di questo report. Controllare e riprocessare il report.`
          );
          return;
        }

        setPreviousBalanceWarning('');
      } catch (err) {
        console.error(err);
        if (!cancelled) {
          setPreviousBalanceWarning('');
        }
      }
    }

    checkPreviousBalanceConsistency();
    return () => {
      cancelled = true;
    };
  }, [isEmployeeMode, employee?.id, currentPayrollRecord?.id, currentPayrollRecord?.processed_at, previousBalanceReference]);

  function importPreviousBalance() {
    if (!employee) return;
    const currentMonthKey = monthString(currentMonth);

    window.api.payroll.getPreviousBalance(employee.id, currentMonthKey)
      .then((previous) => {
        if (previous?.alreadyPaid) {
          setPreviousBalanceWarning(
            `Attenzione: il resto precedente importato da ${previousBalanceReference?.source_month || previous.paidPreviousMonth || getPreviousMonthKey(currentMonthKey)} risulta modificato o saldato dopo l'elaborazione di questo report. Controllare e riprocessare il report.`
          );
          const shouldRemove = window.confirm(
            'Il resto precedente importato risulta saldato. Controllare e aggiornare il report.\n\nVuoi rimuovere il resto precedente importato da questo report?'
          );
          if (shouldRemove) {
            setRestoPrecedente('');
            setPreviousBalanceReference(null);
            setPreviousBalanceWarning('');
          }
          return;
        }

        if (!previous?.previousMonth || Number(previous?.previousBalance || 0) === 0) {
          if (previousBalanceReference || Number(restoPrecedente || 0) !== 0) {
            setPreviousBalanceWarning(
              `Attenzione: il resto precedente importato da ${previousBalanceReference?.source_month || getPreviousMonthKey(currentMonthKey)} risulta modificato o saldato dopo l'elaborazione di questo report. Controllare e riprocessare il report.`
            );
            const shouldRemove = window.confirm(
              'Il resto precedente importato risulta saldato. Controllare e aggiornare il report.\n\nVuoi rimuovere il resto precedente importato da questo report?'
            );
            if (shouldRemove) {
              setRestoPrecedente('');
              setPreviousBalanceReference(null);
              setPreviousBalanceWarning('');
            }
            return;
          }

          alert('Nessun saldo precedente aperto da importare dai mesi precedenti.');
          return;
        }

        setRestoPrecedente(
          previous?.previousBalance !== null && previous?.previousBalance !== undefined
            ? String(previous.previousBalance)
            : ''
        );
        setPreviousBalanceReference({
          source_month: previous.previousMonth,
          imported_balance: Number(previous.previousBalance || 0),
          source_resto_paid: false,
        });
        setPreviousBalanceWarning('');
      })
      .catch((err) => {
        console.error(err);
        alert('Errore importazione saldo precedente');
      });
  }

  async function handleSavePdf() {
    const printArea = document.querySelector('.print-area');
    if (!printArea) {
      alert('Area report non trovata');
      return;
    }

    const suggestedName = isTeamMode && selectedTeam
      ? sanitizeFileName(`${selectedTeam.name} - ${teamPeriodStart}_${teamPeriodEnd}.pdf`)
      : employee
      ? sanitizeFileName(`${employee.first_name || ''} ${employee.last_name || ''} - ${formatMonthLabelForFile(currentMonth)}.pdf`)
      : 'report.pdf';

    try {
      await window.api.reports.savePdf({
        fileName: suggestedName,
        html: printArea.outerHTML,
        debugRenderLabel: '',
      });
    } catch (err) {
      console.error(err);
      alert('Errore apertura PDF');
    }
  }

  async function openFinancialImportModal(type = 'advance') {
    if (!employee) {
      alert('Seleziona un dipendente');
      return;
    }

    try {
      const items = await window.api.financialMovements.listAvailable({
        employee_id: employee.id,
        type,
      });
      setFinancialImportModal({
        open: true,
        type,
        items: items || [],
        selectedIds: (items || []).map((item) => item.id),
      });
    } catch (err) {
      console.error(err);
      alert('Errore caricamento movimenti da importare');
    }
  }

  function closeFinancialImportModal() {
    setFinancialImportModal((current) => ({ ...current, open: false, selectedIds: [] }));
  }

  function toggleFinancialImportSelection(id) {
    setFinancialImportModal((current) => {
      const exists = current.selectedIds.includes(id);
      return {
        ...current,
        selectedIds: exists
          ? current.selectedIds.filter((item) => item !== id)
          : [...current.selectedIds, id],
      };
    });
  }

  async function importSelectedFinancialMovements() {
    if (!employee) return;
    const selectedItems = financialImportModal.items.filter((item) =>
      financialImportModal.selectedIds.includes(item.id)
    );
    if (!selectedItems.length) {
      alert('Seleziona almeno un movimento da importare');
      return;
    }

    const currentMonthKey = monthString(currentMonth);
    if (financialImportModal.type === 'advance') {
      setAdvances((current) => {
        const meaningful = current.filter((advance) => !isAdvanceDraftEmpty(advance));
        return [
          ...meaningful,
          ...selectedItems.map((item) => ({
            amount: String(item.amount || ''),
            date: item.movement_date || '',
            includeInReport: true,
          })),
          createEmptyAdvance(),
        ];
      });
    } else {
      setDebtPlans((current) => [
        ...current,
        ...selectedItems.map((item) => ({
          ...createEmptyDebtPlan(),
          label: item.notes || `Rata ${formatDateLabel(item.movement_date)}`,
          total_amount: String(item.amount || ''),
          created_from_month: currentMonthKey,
          installments: [{
            target_month: currentMonthKey,
            amount: String(item.amount || ''),
            note: item.notes || `Importata da Acconti e Rate ${formatDateLabel(item.movement_date)}`,
          }],
        })),
      ]);
    }

    try {
      await window.api.financialMovements.markInserted(
        selectedItems.map((item) => item.id),
        { month: currentMonthKey }
      );
      setImportedFinancialMovementIds((current) => [
        ...new Set([...current, ...selectedItems.map((item) => item.id)]),
      ]);
      closeFinancialImportModal();
      await refreshFinancialImportCounts(employee.id);
    } catch (err) {
      console.error(err);
      alert('Movimenti importati nel report, ma non e stato possibile aggiornare lo stato storico.');
    }
  }

  async function handleSaveDailyPay() {
    if (!employee) return;

    setSavingDailyPay(true);
    try {
      const normalizedDailyPay = dailyPayInput === '' ? null : Number(dailyPayInput);
      const updated = await window.api.employees.update(employee.id, {
        ...employee,
        daily_pay: Number.isFinite(normalizedDailyPay) ? normalizedDailyPay : null,
      });

      setEmployees((current) =>
        current.map((item) => (String(item.id) === String(employee.id) ? { ...item, ...updated } : item))
      );
      setDailyPayInput(
        updated?.daily_pay !== null && updated?.daily_pay !== undefined && updated?.daily_pay !== ''
          ? String(updated.daily_pay)
          : ''
      );
      alert('Retribuzione dipendente aggiornata.');
    } catch (err) {
      console.error(err);
      alert(err?.message || 'Errore aggiornamento retribuzione');
    } finally {
      setSavingDailyPay(false);
    }
  }

  async function handleSavePayrollRecord(options = {}) {
    if (!employee) {
      alert('Seleziona un dipendente');
      return null;
    }

    if (!options.skipPendingFinancialCheck && !options.silent && !options.autosave) {
      try {
        const pending = await window.api.financialMovements.countPendingForMonth(
          employee.id,
          monthString(currentMonth)
        );
        if (Number(pending?.total || 0) > 0) {
          setPendingSavePrompt({
            options,
            advance: Number(pending?.advance || 0),
            installment: Number(pending?.installment || 0),
          });
          return null;
        }
      } catch (err) {
        console.error(err);
      }
    }

    if (isProcessedRecord && !isEditUnlocked && !options.silent) {
      alert('Questo report è già processato. Usa "Modifica report" per sbloccarlo.');
      return null;
    }

    const currentMonthKey = monthString(currentMonth);
    const workedDays = employeeTotals.completeDaysTotal;
    const normalizedAdvances = advances
      .map((advance, index) => ({
        id: advance.id || `advance-${index}`,
        amount: Number(advance.amount || 0),
        date: advance.date || '',
        includeInReport: !!advance.includeInReport,
      }))
      .filter((advance) => advance.amount > 0);
    const totalAdvances = normalizedAdvances.reduce((sum, advance) => sum + advance.amount, 0);
    const normalizedDebtPlansPayload = [...debtPlans, ...resolvedDebtPlans]
      .map((plan) => ({
        id: plan.id || null,
        label: plan.label || '',
        total_amount: Number(plan.total_amount || 0),
        status: plan.status || 'active',
        created_from_month: plan.created_from_month || currentMonthKey,
        installments: (plan.installments || [])
          .map((installment) => ({
            id: installment.id || null,
            target_month: String(installment.target_month || '').slice(0, 7),
            amount: Number(installment.amount || 0),
            note: installment.note || '',
          }))
          .filter((installment) => installment.target_month && installment.amount > 0),
      }))
      .filter((plan) => plan.status !== 'active' || (plan.total_amount > 0 && plan.installments.length));
    const importoBustaPagaNum = parseFloat(importoBustaPaga) || 0;
    const restoPrecedenteNum = parseFloat(restoPrecedente) || 0;
    const nMacchineMeseNum = trasportoAttivo ? parseFloat(nMacchineMese) || 0 : 0;
    const prezzoPerMacchinaNum = trasportoAttivo ? parseFloat(prezzoPerMacchina) || 0 : 0;
    const totaleTrasporto = nMacchineMeseNum * prezzoPerMacchinaNum;
    const giftAmountNum = parseFloat(giftAmount) || 0;
    const normalizedRestoPaidDate = restoPaid ? restoPaidDate || formatLocalDate(new Date()) : '';
    const currentMonthInstallmentTotal = normalizedDebtPlansPayload
      .flatMap((plan) => plan.installments)
      .filter((installment) => installment.target_month === currentMonthKey)
      .reduce((sum, installment) => sum + installment.amount, 0);
    const differenzaFinale =
      totalCalculatedPay +
      restoPrecedenteNum +
      totaleTrasporto +
      giftAmountNum -
      totalAdvances -
      currentMonthInstallmentTotal -
      importoBustaPagaNum;
    const snapshotHtml = document.querySelector('.print-area')?.outerHTML || null;

    try {
      const saved = await window.api.payroll.saveRecord({
        employee_id: employee.id,
        month: currentMonthKey,
        datore,
        giornate_effettuate: workedDays,
        ore_totali: employeeTotals.totalHours,
        retribuzione_calcolata: totalCalculatedPay,
        giornate_busta_paga: giornateBustaPaga ? Number(giornateBustaPaga) : 0,
        importo_busta_paga: importoBustaPagaNum,
        acconti: totalAdvances,
        advances: normalizedAdvances,
        importedFinancialMovementIds,
        resto_precedente: restoPrecedenteNum,
        differenza_finale: differenzaFinale,
        n_macchine_mese: trasportoAttivo ? nMacchineMeseNum : 0,
        prezzo_per_macchina: trasportoAttivo ? prezzoPerMacchinaNum : 0,
        totale_trasporto: trasportoAttivo ? totaleTrasporto : 0,
        regalo_importo: giftAmountNum,
        regalo_descrizione: giftLabel || null,
        is_pagato: isPagato,
        resto_pagato: restoPaid,
        resto_pagato_data: normalizedRestoPaidDate || null,
        processed_at: new Date().toISOString(),
        report_html_snapshot: snapshotHtml,
        report_snapshot_json: {
          employee_id: employee.id,
          month: currentMonthKey,
          employee_name: `${employee.first_name} ${employee.last_name}`,
          totalCalculatedPay,
          totalRegularPay,
          totalOvertimePay,
          overtimeHourlyRate,
          workedDays,
          totalHours: employeeTotals.totalHours,
          importoBustaPaga: importoBustaPagaNum,
          giornateBustaPaga: giornateBustaPaga ? Number(giornateBustaPaga) : 0,
          advances: normalizedAdvances,
          debt_plans: normalizedDebtPlansPayload,
          current_installments_total: currentMonthInstallmentTotal,
          resto_precedente: restoPrecedenteNum,
          trasporto_totale: totaleTrasporto,
          regalo_importo: giftAmountNum,
          regalo_descrizione: giftLabel || '',
          differenza_finale: differenzaFinale,
          note: noteExtra || '',
          is_pagato: isPagato,
          resto_pagato: restoPaid,
          resto_pagato_data: normalizedRestoPaidDate || null,
          showOvertimeInReport,
          payslip_simulator: {
            compensation_month_amount: compensationMonthAmount,
            daily_amount: payslipCalculatorDailyAmount,
            theoretical_days: payslipTheoreticalDays,
            selected_option: payslipCalcSelectedOption || null,
            custom_days: payslipCustomDays === '' ? null : Number(payslipCustomDays),
          },
          previous_balance_snapshot: previousBalanceReference,
        },
        debt_plans: normalizedDebtPlansPayload,
        note: noteExtra,
      });

      const normalizedSavedPlans = normalizeDebtPlansForEditor(saved?.debt_plans || [], currentMonthKey);
      const savedActiveDebtPlans = normalizedSavedPlans.filter((plan) => (plan.status || 'active') === 'active');
      const nextActiveDebtPlans = buildEditorDebtPlans(savedActiveDebtPlans, debtPlans, currentMonthKey);
      const nextResolvedDebtPlans = normalizedSavedPlans.filter((plan) => (plan.status || 'active') !== 'active');
      const syncedActiveDebtPlans = options.autosave ? debtPlans : nextActiveDebtPlans;
      const syncedResolvedDebtPlans = options.autosave ? resolvedDebtPlans : nextResolvedDebtPlans;

      setCurrentPayrollRecord(saved || null);
      setPayrollDocument(saved?.payroll_document || null);
      setRestoPaidDate(normalizedRestoPaidDate);
      const nextEditorAdvances = buildEditorAdvances(saved?.advances, advances);
      setAdvances(nextEditorAdvances);
      if (!options.autosave) {
        setDebtPlans(nextActiveDebtPlans);
        setResolvedDebtPlans(nextResolvedDebtPlans);
      }
      if (options.autosave) {
        setIsEditUnlocked(true);
      } else {
        setIsEditUnlocked(false);
      }
      const nextSavedState = {
        datore,
        importoBustaPaga,
        giornateBustaPaga,
        advances: nextEditorAdvances,
        restoPrecedente,
        trasportoAttivo,
        nMacchineMese,
        prezzoPerMacchina,
        noteExtra,
        isPagato,
        restoPaid,
        restoPaidDate: normalizedRestoPaidDate,
        payrollDocument: saved?.payroll_document || null,
        currentPayrollRecord: saved || null,
        giftAmount,
        giftLabel,
        debtPlans: syncedActiveDebtPlans,
        resolvedDebtPlans: syncedResolvedDebtPlans,
        overtimeRateOverride,
        showOvertimePanel,
        showOvertimeInReport,
        payslipCalcDailyAmount,
        payslipCalcSelectedOption,
        payslipCustomDays,
        previousBalanceReference,
      };
      setSavedEditorState(nextSavedState);
      setSavedEconomicSnapshot(
        buildEconomicSnapshot({
          datore: nextSavedState.datore,
          importoBustaPaga: nextSavedState.importoBustaPaga,
          giornateBustaPaga: nextSavedState.giornateBustaPaga,
          advances: nextSavedState.advances,
          restoPrecedente: nextSavedState.restoPrecedente,
          trasportoAttivo: nextSavedState.trasportoAttivo,
          nMacchineMese: nextSavedState.nMacchineMese,
          prezzoPerMacchina: nextSavedState.prezzoPerMacchina,
          noteExtra: nextSavedState.noteExtra,
          isPagato: nextSavedState.isPagato,
          restoPaid: nextSavedState.restoPaid,
          restoPaidDate: nextSavedState.restoPaidDate,
          giftAmount: nextSavedState.giftAmount,
          giftLabel: nextSavedState.giftLabel,
          debtPlans: nextSavedState.debtPlans,
          resolvedDebtPlans: nextSavedState.resolvedDebtPlans,
          showOvertimeInReport: nextSavedState.showOvertimeInReport,
          payslipCalcDailyAmount: nextSavedState.payslipCalcDailyAmount,
          payslipCalcSelectedOption: nextSavedState.payslipCalcSelectedOption,
          payslipCustomDays: nextSavedState.payslipCustomDays,
        })
      );
      setSaveState('saved');
      setImportedFinancialMovementIds([]);
      await refreshFinancialImportCounts(employee.id);

      if (!options.silent) {
        alert('Report processato e salvato nello storico');
      }

      return saved;
    } catch (err) {
      console.error(err);
      alert('Errore salvataggio storico');
      return null;
    }
  }

  async function handleUploadPayrollDocument() {
    if (!employee) {
      alert('Seleziona un dipendente');
      return;
    }

    setUploadingPayrollDocument(true);
    try {
      const saved = await handleSavePayrollRecord({ silent: true });
      if (!saved) return;

      const result = await window.api.payroll.uploadDocument(employee.id, monthString(currentMonth));
      if (!result?.canceled) {
        setCurrentPayrollRecord(result.record || currentPayrollRecord);
        setPayrollDocument(result.record?.payroll_document || null);
      }
    } catch (err) {
      console.error(err);
      alert('Errore caricamento busta paga');
    } finally {
      setUploadingPayrollDocument(false);
    }
  }

  async function handleOpenPayrollDocument() {
    if (!employee) {
      alert('Seleziona un dipendente');
      return;
    }

    try {
      const result = await window.api.payroll.openDocument(employee.id, monthString(currentMonth));
      if (result && !result.success && result.message) {
        alert(result.message);
      }
    } catch (err) {
      console.error(err);
      alert('Errore apertura busta paga');
    }
  }

  async function handleDeletePayrollDocument() {
    if (!employee) {
      alert('Seleziona un dipendente');
      return;
    }

    const confirmed = window.confirm("Confermi l'eliminazione della busta paga allegata?");
    if (!confirmed) return;

    try {
      const result = await window.api.payroll.deleteDocument(employee.id, monthString(currentMonth));
      if (result && result.success === false && result.message) {
        alert(result.message);
      }
      setCurrentPayrollRecord(result?.record || currentPayrollRecord);
      setPayrollDocument(result?.record?.payroll_document || null);
    } catch (err) {
      console.error(err);
      alert(getIpcRecoveryMessage(err, 'Errore eliminazione busta paga'));
    }
  }

  function updateAdvance(index, field, value) {
    setAdvances((current) =>
      current.map((advance, currentIndex) =>
        currentIndex === index ? { ...advance, [field]: value } : advance
      )
    );
  }

  function addAdvance() {
    setAdvances((current) => [...current, createEmptyAdvance()]);
  }

  function removeAdvance(index) {
    setAdvances((current) => {
      if (current.length === 1) {
        return [createEmptyAdvance()];
      }
      return current.filter((_, currentIndex) => currentIndex !== index);
    });
  }

  function updateDebtPlan(index, field, value) {
    setDebtPlans((current) =>
      current.map((plan, currentIndex) =>
        currentIndex === index ? { ...plan, [field]: value } : plan
      )
    );
  }

  function updateDebtInstallment(planIndex, installmentIndex, field, value) {
    setDebtPlans((current) =>
      current.map((plan, currentPlanIndex) =>
        currentPlanIndex === planIndex
          ? {
              ...plan,
              installments: plan.installments.map((installment, currentInstallmentIndex) =>
                currentInstallmentIndex === installmentIndex
                  ? { ...installment, [field]: value }
                  : installment
              ),
            }
          : plan
      )
    );
  }

  function addDebtPlan() {
    setDebtPlans((current) => [
      ...current,
      {
        ...createEmptyDebtPlan(),
        created_from_month: monthString(currentMonth),
      },
    ]);
  }

  function removeDebtPlan(index) {
    const confirmed = window.confirm('Il debito e stato saldato?');
    if (!confirmed) return;

    setDebtPlans((current) => {
      const targetPlan = current[index];
      if (!targetPlan) return current;

      if (targetPlan.id) {
        setResolvedDebtPlans((resolvedCurrent) => [
          ...resolvedCurrent,
          {
            ...targetPlan,
            status: 'paid',
          },
        ]);
      }

      return current.filter((_, currentIndex) => currentIndex !== index);
    });
  }

  function addDebtInstallment(planIndex) {
    setDebtPlans((current) =>
      current.map((plan, currentIndex) =>
        currentIndex === planIndex
          ? { ...plan, installments: [...plan.installments, createEmptyDebtInstallment()] }
          : plan
      )
    );
  }

  function removeDebtInstallment(planIndex, installmentIndex) {
    const confirmed = window.confirm('Il debito e stato saldato?');
    if (!confirmed) return;
    setDebtPlans((current) => {
      const targetPlan = current[planIndex];
      if (!targetPlan) return current;
      const nextInstallments = targetPlan.installments.filter((_, currentInstallmentIndex) => currentInstallmentIndex !== installmentIndex);
      return current.map((plan, currentIndex) =>
        currentIndex === planIndex
          ? {
              ...plan,
              installments: nextInstallments.length ? nextInstallments : [createEmptyDebtInstallment()],
            }
          : plan
      );
    });
  }

  function generateDebtInstallments(planIndex, countValue, startMonthValue) {
    const count = Math.max(1, Number(countValue || 0));
    const startMonth = String(startMonthValue || '').slice(0, 7) || monthString(currentMonth);

    setDebtPlans((current) =>
      current.map((plan, currentIndex) => {
        if (currentIndex !== planIndex) return plan;
        const total = Number(plan.total_amount || 0);
        if (total <= 0) return plan;

        const baseAmount = Math.floor((total / count) * 100) / 100;
        const installments = Array.from({ length: count }, (_, index) => {
          const [year, month] = startMonth.split('-').map(Number);
          const currentDate = new Date(year, (month || 1) - 1 + index, 1);
          const amount = index === count - 1
            ? Number((total - baseAmount * (count - 1)).toFixed(2))
            : Number(baseAmount.toFixed(2));
          return {
            client_key: createLocalDraftKey('debt-installment'),
            target_month: monthString(currentDate),
            amount: String(amount),
            note: '',
          };
        });

        return {
          ...plan,
          created_from_month: startMonth,
          installments,
        };
      })
    );
  }

  function updateTeamAdvance(index, field, value) {
    setTeamAdvances((current) =>
      current.map((advance, currentIndex) =>
        currentIndex === index ? { ...advance, [field]: value } : advance
      )
    );
  }

  function addTeamAdvance() {
    setTeamAdvances((current) => [...current, createEmptyTeamAdvance()]);
  }

  function removeTeamAdvance(index) {
    setTeamAdvances((current) => {
      if (current.length === 1) {
        return [createEmptyTeamAdvance()];
      }
      return current.filter((_, currentIndex) => currentIndex !== index);
    });
  }

  const attendanceBaseHours = useMemo(
    () => getSafeStandardHours(settings?.general?.standard_day_hours),
    [settings?.general?.standard_day_hours]
  );
  const hoursFormat = useMemo(() => getHoursFormat(settings), [settings]);
  const employeeAttendance = useMemo(
    () => (employee ? attendanceByEmployeeId.get(String(employee.id)) || [] : []),
    [attendanceByEmployeeId, employee]
  );
  const attendanceMap = useMemo(
    () => Object.fromEntries(employeeAttendance.map((item) => [item.date, item])),
    [employeeAttendance]
  );
  const employeeTotals = useMemo(
    () => calculateAttendanceTotals(employeeAttendance, attendanceBaseHours),
    [attendanceBaseHours, employeeAttendance]
  );
  const dailyPay = Number(dailyPayInput || 0);
  const standardHours = getSafeStandardHours(employee?.standard_hours);
  const regularHourlyRate = standardHours > 0 ? dailyPay / standardHours : 0;
  const overtimeHourlyRate = overtimeRateOverride !== '' ? (Number(overtimeRateOverride) || 0) : getEffectiveOvertimeRate(employee, settings);
  const overtimeView = getOvertimeViewSettings(settings);
  const workedDays = employeeTotals.completeDaysTotal;
  const totalRegularPay = employeeTotals.totalRegularHours * regularHourlyRate;
  const totalOvertimePay = employeeTotals.totalOvertimeHours * overtimeHourlyRate;
  const totalCalculatedPay = totalRegularPay + totalOvertimePay;
  const totalCalculatedPayForReport = showOvertimeInReport ? totalCalculatedPay : totalRegularPay;
  const normalizedAdvances = advances
    .map((advance, index) => ({
      id: advance.id || `advance-${index}`,
      amount: Number(advance.amount || 0),
      date: advance.date || '',
      includeInReport: !!advance.includeInReport,
    }))
    .filter((advance) => advance.amount > 0);
  const visibleAdvances = normalizedAdvances.filter((advance) => advance.includeInReport);
  const importoBustaPagaNum = parseFloat(importoBustaPaga) || 0;
  const totalAdvances = normalizedAdvances.reduce((sum, advance) => sum + advance.amount, 0);
  const normalizedDebtPlans = debtPlans
    .map((plan) => ({
      ...plan,
      status: plan.status || 'active',
      total_amount: Number(plan.total_amount || 0),
      installments: (plan.installments || [])
        .map((installment) => ({
          ...installment,
          amount: Number(installment.amount || 0),
          target_month: String(installment.target_month || '').slice(0, 7),
        }))
        .filter((installment) => installment.target_month && installment.amount > 0),
    }))
    .filter((plan) => plan.total_amount > 0 || plan.installments.length > 0);
  const currentInstallments = normalizedDebtPlans.flatMap((plan) =>
    plan.installments
      .map((installment, index) => ({
        ...installment,
        planLabel: plan.label || 'Rateizzazione debito',
        planTotal: Number(plan.total_amount || 0),
        installmentNumber: index + 1,
        residualAfterCurrent: Math.max(
          Number(plan.total_amount || 0) -
            plan.installments
              .filter((item) => item.target_month <= installment.target_month)
              .reduce((sum, item) => sum + Number(item.amount || 0), 0),
          0
        ),
      }))
      .filter((installment) => installment.target_month === monthString(currentMonth))
  );
  const currentInstallmentTotal = currentInstallments.reduce((sum, installment) => sum + installment.amount, 0);
  const currentMonthKey = monthString(currentMonth);
  const totalDebtResidual = normalizedDebtPlans.reduce((sum, plan) => {
    const paidInstallments = plan.installments
      .filter((installment) => installment.target_month < currentMonthKey)
      .reduce((acc, installment) => acc + installment.amount, 0);
    return sum + Math.max(plan.total_amount - paidInstallments - currentInstallmentTotal, 0);
  }, 0);
  const restoPrecedenteNum = parseFloat(restoPrecedente) || 0;
  const previousBalanceBadgeLabel = getPreviousBalanceLabel(restoPrecedenteNum);
  const nMacchineMeseNum = trasportoAttivo ? parseFloat(nMacchineMese) || 0 : 0;
  const prezzoPerMacchinaNum = trasportoAttivo ? parseFloat(prezzoPerMacchina) || 0 : 0;
  const totaleTrasporto = nMacchineMeseNum * prezzoPerMacchinaNum;
  const giftAmountNum = parseFloat(giftAmount) || 0;
  const isProcessedRecord = !!currentPayrollRecord?.processed_at;
  const isEmployeeEditingDisabled = isProcessedRecord && !isEditUnlocked;
  const compensationMonthAmount =
    totalCalculatedPayForReport +
    giftAmountNum +
    Math.max(restoPrecedenteNum, 0) +
    totaleTrasporto -
    currentInstallmentTotal -
    Math.abs(Math.min(restoPrecedenteNum, 0)) -
    totalAdvances;
  const payslipCalculatorDailyAmount = Number(payslipCalcDailyAmount || 0);
  const payslipTheoreticalDays =
    payslipCalculatorDailyAmount > 0
      ? compensationMonthAmount / payslipCalculatorDailyAmount
      : 0;
  const payslipFloorDays =
    payslipCalculatorDailyAmount > 0
      ? Math.max(0, Math.floor(payslipTheoreticalDays))
      : 0;
  const payslipCeilDays =
    payslipCalculatorDailyAmount > 0
      ? Math.max(0, Math.ceil(payslipTheoreticalDays))
      : 0;
  const payslipFloorTotal = payslipFloorDays * payslipCalculatorDailyAmount;
  const payslipCeilTotal = payslipCeilDays * payslipCalculatorDailyAmount;
  const payslipFloorDifference = compensationMonthAmount - payslipFloorTotal;
  const payslipCeilDifference = payslipCeilTotal - compensationMonthAmount;
  const payslipCustomDaysNum = Math.max(0, Number(payslipCustomDays || 0));
  const payslipCustomTotal = payslipCustomDaysNum * payslipCalculatorDailyAmount;
  const payslipCustomDifference = compensationMonthAmount - payslipCustomTotal;
  const payslipPreferredOption =
    payslipCalculatorDailyAmount > 0 && payslipFloorDifference <= payslipCeilDifference ? 'floor' : 'ceil';
  const meaningfulAdvanceCount = advances.filter((advance) => Number(advance.amount || 0) > 0).length;
  const benefitsSectionSummaryParts = [
    meaningfulAdvanceCount > 0 ? `Acconti: ${meaningfulAdvanceCount}` : '',
    totaleTrasporto > 0 ? `Trasporto: ${formatCurrency(totaleTrasporto)}` : '',
    giftAmountNum > 0 ? `Extra: ${formatCurrency(giftAmountNum)}` : '',
  ].filter(Boolean);
  const benefitsSectionSummary = benefitsSectionSummaryParts.length
    ? benefitsSectionSummaryParts.join(' - ')
    : 'Nessun acconto, trasporto o extra';
  const benefitsSectionStorageKey = getBenefitsSectionStorageKey(selectedEntity, currentMonthKey);
  const currentEconomicSnapshot = buildEconomicSnapshot({
    datore,
    importoBustaPaga,
    giornateBustaPaga,
    advances,
    restoPrecedente,
    trasportoAttivo,
    nMacchineMese,
    prezzoPerMacchina,
    noteExtra,
    isPagato,
    restoPaid,
    restoPaidDate,
    giftAmount,
    giftLabel,
    debtPlans,
    resolvedDebtPlans,
    showOvertimeInReport,
    payslipCalcDailyAmount,
    payslipCalcSelectedOption,
    payslipCustomDays,
  });
  const hasUnsavedChanges =
    isEmployeeMode &&
    !!employee &&
    savedEconomicSnapshot !== null &&
    currentEconomicSnapshot !== savedEconomicSnapshot;

  useEffect(() => {
    setPayslipCalcDailyAmount('');
    setPayslipCalcSelectedOption('');
    setPayslipCustomDays('');
    setShowOvertimeInReport(true);
    setShowPayslipAmountDetails(false);
  }, [employee?.id, currentMonth]);

  useEffect(() => {
    setIsBenefitsSectionCollapsed(readBenefitsSectionCollapsed(benefitsSectionStorageKey));
  }, [benefitsSectionStorageKey]);

  useEffect(() => {
    writeBenefitsSectionCollapsed(benefitsSectionStorageKey, isBenefitsSectionCollapsed);
  }, [benefitsSectionStorageKey, isBenefitsSectionCollapsed]);

  function handleSelectPayslipOption(optionKey, optionDays, optionTotal) {
    setPayslipCalcSelectedOption(optionKey);
    setGiornateBustaPaga(String(optionDays));
    setImportoBustaPaga(optionTotal > 0 ? optionTotal.toFixed(2) : '');
  }

  useEffect(() => {
    if (payslipCalcSelectedOption !== 'C') {
      return;
    }

    setGiornateBustaPaga(payslipCustomDays === '' ? '' : String(payslipCustomDaysNum));
    setImportoBustaPaga(payslipCustomTotal > 0 ? payslipCustomTotal.toFixed(2) : '');
  }, [payslipCalcSelectedOption, payslipCustomDays, payslipCustomDaysNum, payslipCustomTotal]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    if (!isEmployeeMode || !employee || !hasUnsavedChanges) {
      if (!hasUnsavedChanges && saveState === 'dirty') {
        setSaveState('idle');
      }
      return undefined;
    }

    setSaveState((current) => (current === 'saving' ? current : 'dirty'));

    autosaveTimeoutRef.current = setTimeout(async () => {
      setSaveState('saving');
      const saved = await handleSavePayrollRecord({ silent: true, autosave: true });
      if (!saved) {
        setSaveState('dirty');
      }
    }, 700);

    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [hasUnsavedChanges, currentEconomicSnapshot, isEmployeeMode, employee?.id]);

  function handleUnlockEdit() {
    setIsEditUnlocked(true);
  }

  function handleCancelReportChanges() {
    if (!savedEditorState) {
      return;
    }

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }

    setDatore(savedEditorState.datore);
    setImportoBustaPaga(savedEditorState.importoBustaPaga);
    setGiornateBustaPaga(savedEditorState.giornateBustaPaga);
    setAdvances(savedEditorState.advances);
    setRestoPrecedente(savedEditorState.restoPrecedente);
    setTrasportoAttivo(savedEditorState.trasportoAttivo);
    setNMacchineMese(savedEditorState.nMacchineMese);
    setPrezzoPerMacchina(savedEditorState.prezzoPerMacchina);
    setNoteExtra(savedEditorState.noteExtra);
    setIsPagato(savedEditorState.isPagato);
    setRestoPaid(savedEditorState.restoPaid);
    setRestoPaidDate(savedEditorState.restoPaidDate);
    setPayrollDocument(savedEditorState.payrollDocument);
    setGiftAmount(savedEditorState.giftAmount);
    setGiftLabel(savedEditorState.giftLabel);
    setDebtPlans(savedEditorState.debtPlans);
    setResolvedDebtPlans(savedEditorState.resolvedDebtPlans);
    setCurrentPayrollRecord(savedEditorState.currentPayrollRecord);
    setOvertimeRateOverride(savedEditorState.overtimeRateOverride);
    setShowOvertimePanel(savedEditorState.showOvertimePanel);
    setShowOvertimeInReport(savedEditorState.showOvertimeInReport);
    setPayslipCalcDailyAmount(savedEditorState.payslipCalcDailyAmount);
    setPayslipCalcSelectedOption(savedEditorState.payslipCalcSelectedOption);
    setPayslipCustomDays(savedEditorState.payslipCustomDays);
    setPreviousBalanceReference(savedEditorState.previousBalanceReference || null);
    setSaveState('idle');
  }

  function guardUnsavedChanges(callback) {
    if (hasUnsavedChanges) {
      alert('Salva prima di uscire');
      return;
    }
    callback();
  }

  function updateReportMonth(year, monthIndex) {
    guardUnsavedChanges(() => {
      if (selectedYear !== year) {
        setSelectedYear(year);
      }
      setCurrentMonth(new Date(year, monthIndex, 1));
    });
  }

  const reportYearOptions = useMemo(() => yearOptions, [yearOptions]);

  const differenzaFinale =
    totalCalculatedPay +
    restoPrecedenteNum +
    totaleTrasporto +
    giftAmountNum -
    totalAdvances -
    currentInstallmentTotal -
    importoBustaPagaNum;

  const teamStartDate = parseDateValue(teamPeriodStart);
  const teamEndDate = parseDateValue(teamPeriodEnd);
  const safeTeamStart = teamStartDate && teamEndDate && teamEndDate >= teamStartDate ? teamPeriodStart : formatLocalDate(startOfMonth(currentMonth));
  const safeTeamEnd = teamStartDate && teamEndDate && teamEndDate >= teamStartDate ? teamPeriodEnd : formatLocalDate(endOfMonth(currentMonth));
  const teamPeriodDays = useMemo(
    () => getMonthDays(parseDateValue(safeTeamStart), parseDateValue(safeTeamEnd)),
    [safeTeamEnd, safeTeamStart]
  );
  const teamPeriodLabel = formatPeriodLabel(safeTeamStart, safeTeamEnd);
  const monthName = MONTH_NAMES[currentMonth.getMonth()];
  const yearStr = String(currentMonth.getFullYear());

  const filteredTeamAdvances = teamAdvances
    .map((advance, index) => ({
      id: `team-advance-${index}`,
      amount: Number(advance.amount || 0),
      date: advance.date || '',
      description: advance.description || '',
    }))
    .filter((advance) => advance.amount > 0);

  const teamRows = useMemo(
    () =>
      getTeamRows(selectedTeam, selectedYear).map((member) => {
        const allMemberAttendance = attendanceByEmployeeId.get(String(member.employee_id)) || [];
        const memberAttendance = allMemberAttendance.filter((item) =>
          isDateWithinRange(item.date, safeTeamStart, safeTeamEnd)
        );
        const totals = calculateAttendanceTotals(memberAttendance, attendanceBaseHours);
        const compensationRate = Number(
          member.compensation !== null && member.compensation !== undefined
            ? member.compensation
            : member.employee?.daily_pay || 0
        );
        const workedDaysCount = totals.completeDaysTotal;
        const estimatedCompensation = totals.completeDaysTotal * compensationRate;
        const personalAdvances = getPayrollAdvancesInRange(teamPayrollMap[member.employee_id], safeTeamStart, safeTeamEnd);
        const personalAdvancesTotal = personalAdvances.reduce((sum, advance) => sum + Number(advance.amount || 0), 0);

        return {
          member,
          records: memberAttendance,
          totals,
          workedDays: workedDaysCount,
          compensationRate,
          estimatedCompensation,
          personalAdvances,
          personalAdvancesTotal,
          individualNet: estimatedCompensation - personalAdvancesTotal,
        };
      }),
    [attendanceBaseHours, attendanceByEmployeeId, safeTeamEnd, safeTeamStart, selectedTeam, selectedYear, teamPayrollMap]
  );

  const teamTransportTotal = teamTransportEnabled ? normalizeCurrency(teamTransportAmount) : 0;
  const teamAdvancesTotal = filteredTeamAdvances.reduce((sum, advance) => sum + advance.amount, 0);
  const teamTotals = useMemo(
    () =>
      teamRows.reduce(
        (acc, row) => ({
          totalHours: acc.totalHours + row.totals.totalHours,
          totalWorkedDays: acc.totalWorkedDays + row.workedDays,
          totalCompensation: acc.totalCompensation + row.estimatedCompensation,
          totalResidualHours: acc.totalResidualHours + row.totals.remainingTotalHours,
          totalPersonalAdvances: acc.totalPersonalAdvances + row.personalAdvancesTotal,
        }),
        {
          totalHours: 0,
          totalWorkedDays: 0,
          totalCompensation: 0,
          totalResidualHours: 0,
          totalPersonalAdvances: 0,
        }
      ),
    [teamRows]
  );

  const teamFinalBalance = teamTotals.totalCompensation + teamTransportTotal - teamAdvancesTotal;

  return (
    <div className="page report-page">
      <div className="page-sticky-stack no-print">
        <section className="page-hero">
          <div>
            <span className="page-kicker">Riepilogo economico</span>
            <h1 className="page-title">Report</h1>
            <p className="page-subtitle">
              Seleziona un dipendente per il report classico oppure una squadra per il riepilogo del responsabile.
            </p>
          </div>

          {selectedEntity ? (
            <div className="page-actions">
              <button className="button" onClick={handleSavePdf}>Genera PDF</button>
              <button className="button-secondary" onClick={() => window.print()}>Stampa</button>
            </div>
          ) : null}
        </section>

        <div className="toolbar report-toolbar">
          <div className="toolbar-group" style={{ gap: 10 }}>
            <button
              className="report-month-nav"
              onClick={() => updateReportMonth(currentMonth.getFullYear(), currentMonth.getMonth() - 1)}
            >
              {'<'}
            </button>

            <strong className="report-month-label">
              {currentMonth.toLocaleDateString('it-IT', {
                month: 'long',
                year: 'numeric',
              })}
            </strong>

            <div className="report-period-picker">
              <select
                className="report-period-select"
                value={currentMonth.getMonth()}
                onChange={(event) => updateReportMonth(currentMonth.getFullYear(), Number(event.target.value))}
              >
                {MONTH_SELECT_OPTIONS.map((monthOption) => (
                  <option key={monthOption.value} value={monthOption.value}>
                    {monthOption.label}
                  </option>
                ))}
              </select>

              <select
                className="report-period-select report-period-year"
                value={currentMonth.getFullYear()}
                onChange={(event) => updateReportMonth(Number(event.target.value), currentMonth.getMonth())}
              >
                {reportYearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <button
              className="report-month-nav"
              onClick={() => updateReportMonth(currentMonth.getFullYear(), currentMonth.getMonth() + 1)}
            >
              {'>'}
            </button>
          </div>

          <div
            ref={employeeAutocompleteRef}
            style={{
              position: 'relative',
              width: 'min(340px, 100%)',
              minWidth: 260,
              flex: '0 1 340px',
            }}
          >
            <input
              type="search"
              className="report-entity-select"
              value={reportSearchTerm}
              onFocus={() => {
                setIsEmployeeAutocompleteOpen(true);
              }}
              onChange={(event) => {
                const nextValue = event.target.value;
                setReportSearchTerm(nextValue);
                setIsEmployeeAutocompleteOpen(true);
              }}
              placeholder="Cerca dipendente o seleziona squadra..."
              aria-label="Cerca dipendente o seleziona squadra..."
              style={{ width: '100%' }}
            />

            {showEmployeeAutocomplete ? (
              <div className="report-entity-dropdown">
                {selectedEntity ? (
                  <button
                    type="button"
                    className="report-entity-dropdown__clear"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      guardUnsavedChanges(() => {
                        setSelectedEntity('');
                        setReportSearchTerm('');
                        setIsEmployeeAutocompleteOpen(false);
                      });
                    }}
                  >
                    Nessuna selezione
                  </button>
                ) : null}

                {filteredEmployeesForSelect.length ? (
                  <div className="report-entity-dropdown__group">
                    <div className="report-entity-dropdown__label">Dipendenti</div>
                    {filteredEmployeesForSelect.map((item) => {
                      const employeeStatus = getEmployeeDropdownStatus(item);
                      const isSelected = selectedEntity === `employee:${item.id}`;
                      return (
                        <button
                          key={`employee-autocomplete-${item.id}`}
                          type="button"
                          className={`report-entity-option ${isSelected ? 'report-entity-option--selected' : ''}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleEmployeeAutocompleteSelect(item)}
                        >
                          <span className="report-entity-option__name">
                            {getReportEmployeeDisplayName(item)}
                          </span>
                          {employeeStatus ? (
                            <span className="soft-chip report-entity-option__badge" style={employeeStatus.style}>
                              {employeeStatus.label}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {filteredTeamsForSelect.length ? (
                  <div className="report-entity-dropdown__group">
                    <div className="report-entity-dropdown__label">Squadre</div>
                    {filteredTeamsForSelect.map((team) => {
                      const isSelected = selectedEntity === `team:${team.id}`;
                      return (
                        <button
                          key={`team-autocomplete-${team.id}`}
                          type="button"
                          className={`report-entity-option ${isSelected ? 'report-entity-option--selected' : ''}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleTeamAutocompleteSelect(team)}
                        >
                          <span className="report-entity-option__name">
                            {getTeamDisplayName(team)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}

                {!filteredEmployeesForSelect.length && !filteredTeamsForSelect.length ? (
                  <div className="report-entity-dropdown__empty">
                    Nessun dipendente o squadra trovato
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {normalizedSearch && !showEmployeeAutocomplete && !hasEmployeeSearchResults ? (
            <div style={{ fontSize: 13, color: '#6b7280' }}>Nessun dipendente trovato</div>
          ) : null}
        </div>
      </div>

      {isEmployeeMode && employee ? (
        <div className="report-workspace">
          <div className="report-editor-column no-print">
            <div className="report-editor-panel">
          {isProcessedRecord ? (
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="soft-chip" style={{ background: 'rgba(22, 163, 74, 0.14)', color: '#14532d', borderColor: 'rgba(22, 101, 52, 0.14)' }}>
                Report processato il {formatDisplayDateTime(currentPayrollRecord?.processed_at)}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {isEditUnlocked ? (
                  <div className="soft-chip" style={{ background: 'rgba(212, 160, 23, 0.16)', color: '#a16207', borderColor: 'rgba(212, 160, 23, 0.18)' }}>
                    Modalita modifica attiva
                  </div>
                ) : null}
                <button
                  type="button"
                  className="button-secondary"
                  onClick={handleUnlockEdit}
                  disabled={isEditUnlocked}
                >
                  Modifica
                </button>
              </div>
            </div>
          ) : null}

          {previousBalanceWarning ? (
            <div style={reportWarningStyle}>
              {previousBalanceWarning}
            </div>
          ) : null}

          <fieldset
            disabled={isEmployeeEditingDisabled}
            style={{ gridColumn: '1 / -1', display: 'contents', border: 'none', padding: 0, margin: 0 }}
          >
            <div style={editorBlockStyle}>
              <div style={{ ...sectionToolbarStyle, marginBottom: 0 }}>
                <div>
                  <div style={editorBlockTitleStyle}>1. Busta paga</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 800 }}>
                      {employee.first_name} {employee.last_name}
                    </span>
                    <a
                      className="button-secondary"
                      href={`#/dipendenti?employee=${employee.id}`}
                      title="Apri scheda dipendente"
                      style={{ minHeight: 30, width: 34, padding: 0, borderRadius: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                      {'->'}
                    </a>
                  </div>
                </div>
                <label style={{ ...checkboxLabelStyle, padding: '8px 10px', borderRadius: 12, background: '#fff', border: '1px solid rgba(31, 41, 55, 0.08)' }}>
                  <input
                    type="checkbox"
                    checked={showOvertimeInReport}
                    onChange={(e) => setShowOvertimeInReport(e.target.checked)}
                    style={{ width: 16, height: 16 }}
                  />
                  Mostra straordinario
                </label>
              </div>
              <div style={editorBlockGridStyle}>
                <div>
                  <div style={fieldLabelStyle}>Datore di lavoro</div>
                  <select value={datore} onChange={(e) => setDatore(e.target.value)} style={fieldStyle}>
                    {employerOptions.map((option) => (
                      <option key={option.short_name || option.value} value={option.short_name || option.value}>
                        {(option.short_name || option.value)}{option.name ? ` - ${option.name}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div style={fieldLabelStyle}>Retribuzione giornaliera (EUR)</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={dailyPayInput}
                      onChange={(e) => setDailyPayInput(e.target.value)}
                      placeholder="es. 55.00"
                      style={fieldStyle}
                    />
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={handleSaveDailyPay}
                      disabled={savingDailyPay}
                    >
                      {savingDailyPay ? 'Salvataggio...' : 'Salva'}
                    </button>
                  </div>
                </div>

                <div>
                  <div style={fieldLabelStyle}>Importo busta paga (EUR)</div>
                  <input type="number" step="0.01" min="0" value={importoBustaPaga} onChange={(e) => setImportoBustaPaga(e.target.value)} placeholder="es. 800.00" style={fieldStyle} />
                </div>

                <div>
                  <div style={fieldLabelStyle}>Giornate in busta paga</div>
                  <input type="number" min="0" value={giornateBustaPaga} onChange={(e) => setGiornateBustaPaga(e.target.value)} placeholder="es. 11" style={fieldStyle} />
                </div>

                {overtimeView.enabled && showOvertimeInReport ? (
                  <>
                    <div>
                      <div style={fieldLabelStyle}>Straordinario</div>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => setShowOvertimePanel(!showOvertimePanel)}
                        style={{ fontSize: 12, padding: '6px 12px' }}
                      >
                        {showOvertimePanel ? 'Nascondi dettaglio -' : 'Mostra dettaglio +'}
                      </button>
                    </div>
                    {showOvertimePanel && (
                      <div style={{ gridColumn: '1 / -1', background: '#f8fbf7', border: '1px solid rgba(31, 41, 55, 0.08)', borderRadius: 8, padding: '10px 14px', display: 'grid', gap: 6 }}>
                        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12, color: '#374151' }}>
                          <span>
                            <span style={{ color: '#6b7280', fontWeight: 600 }}>Tariffa:</span>{' '}
                            <strong>{overtimeHourlyRate > 0 ? formatCurrency(overtimeHourlyRate) + ' / ora' : '-'}</strong>
                          </span>
                          <span>
                            <span style={{ color: '#6b7280', fontWeight: 600 }}>Origine:</span>{' '}
                            <span style={{
                              fontSize: 11,
                              padding: '1px 7px',
                              borderRadius: 10,
                              background: '#f0fdf4',
                              color: '#166534',
                              border: '1px solid #bbf7d0',
                            }}>
                              {employee?.overtime_use_general_rate === false ? 'Personalizzata dipendente' : 'Generale'}
                            </span>
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12, color: '#374151' }}>
                          <span>
                            <span style={{ color: '#6b7280', fontWeight: 600 }}>Ore straordinario:</span>{' '}
                            <strong>{employeeTotals.totalOvertimeHours > 0 ? `${employeeTotals.totalOvertimeHours} h` : '-'}</strong>
                          </span>
                          <span>
                            <span style={{ color: '#6b7280', fontWeight: 600 }}>Totale straordinario:</span>{' '}
                            <strong style={{ color: totalOvertimePay > 0 ? '#1F2937' : '#374151' }}>
                              {totalOvertimePay > 0 ? formatCurrency(totalOvertimePay) : '-'}
                            </strong>
                          </span>
                        </div>
                      </div>
                    )}
                  </>
                ) : null}

                <div style={{ gridColumn: '1 / -1', ...payslipSupportBoxStyle }}>
                  <div style={payslipSupportHeaderStyle}>
                    <div>
                      <div style={fieldLabelStyle}>Compenso del mese</div>
                      <div style={payslipSupportValueStyle}>{formatCurrency(compensationMonthAmount)}</div>
                    </div>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => setShowPayslipAmountDetails((current) => !current)}
                      title="Mostra dettaglio calcolo"
                      style={{ minHeight: 34, width: 34, padding: 0, borderRadius: 999 }}
                    >
                      ?
                    </button>
                  </div>

                  {showPayslipAmountDetails ? (
                    <div style={payslipTooltipStyle}>
                      <SummaryLine label="Giornate lavorate convertite" value={formatCurrency(totalCalculatedPayForReport)} />
                      <SummaryLine label="Regali" value={formatCurrency(giftAmountNum)} />
                      <SummaryLine label="Crediti precedenti" value={formatCurrency(Math.max(restoPrecedenteNum, 0))} />
                      <SummaryLine label="Trasporto" value={formatCurrency(totaleTrasporto)} />
                      <SummaryLine label="Rate" value={`- ${formatCurrency(currentInstallmentTotal)}`} />
                      <SummaryLine label="Debiti precedenti" value={`- ${formatCurrency(Math.abs(Math.min(restoPrecedenteNum, 0)))}`} />
                      <SummaryLine label="Acconti" value={`- ${formatCurrency(totalAdvances)}`} />
                    </div>
                  ) : null}

                  <div style={payslipCalculatorGridStyle}>
                    <div>
                      <div style={fieldLabelStyle}>Importo giornaliero busta</div>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={payslipCalcDailyAmount}
                        onChange={(e) => setPayslipCalcDailyAmount(e.target.value)}
                        placeholder="es. 69.22"
                        style={fieldStyle}
                      />
                    </div>
                  </div>

                  <div style={fieldSubtleStyle}>
                    Giornate teoriche: <strong>{payslipCalculatorDailyAmount > 0 ? payslipTheoreticalDays.toFixed(2) : '-'}</strong>
                  </div>

                  <div style={payslipDecisionGridStyle}>
                    <button
                      type="button"
                      onClick={() => handleSelectPayslipOption('floor', payslipFloorDays, payslipFloorTotal)}
                      style={getPayslipOptionCardStyle(
                        payslipCalcSelectedOption === 'floor',
                        payslipPreferredOption === 'floor'
                      )}
                      disabled={payslipCalculatorDailyAmount <= 0}
                    >
                      <div style={payslipDecisionTopRowStyle}>
                        <div style={payslipDecisionTitleStyle}>Opzione A - arrotonda per difetto</div>
                        <div style={payslipDecisionDaysStyle}>{payslipFloorDays} giornate</div>
                      </div>
                      <div style={payslipDecisionMetricsRowStyle}>
                        <div style={payslipDecisionMetricStyle}>
                          <span style={payslipDecisionMetricLabelStyle}>Totale busta</span>
                          <span style={payslipDecisionMetricValueStyle}>{formatCurrency(payslipFloorTotal)}</span>
                        </div>
                        <div style={payslipDecisionMetricStyle}>
                          <span style={payslipDecisionMetricLabelStyle}>Differenza</span>
                          <span style={payslipDecisionMetricValueStyle}>{formatCurrency(payslipFloorDifference)}</span>
                        </div>
                      </div>
                      <div
                        style={{
                          ...payslipDecisionHintStyle,
                          background: getPayslipDecisionTone(
                            payslipFloorDifference > 0 ? 'give' : 'neutral'
                          ).background,
                        }}
                      >
                        <span
                          style={{
                            color: getPayslipDecisionTone(
                              payslipFloorDifference > 0 ? 'give' : 'neutral'
                            ).color,
                          }}
                        >
                          {payslipFloorDifference > 0
                            ? "Devi dare all'operaio"
                            : 'Saldo perfetto'}
                        </span>
                        <span
                          style={{
                            ...payslipDecisionHintAmountStyle,
                            color: getPayslipDecisionTone(
                              payslipFloorDifference > 0 ? 'give' : 'neutral'
                            ).amountColor,
                          }}
                        >
                          {formatCurrency(payslipFloorDifference)}
                        </span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSelectPayslipOption('ceil', payslipCeilDays, payslipCeilTotal)}
                      style={getPayslipOptionCardStyle(
                        payslipCalcSelectedOption === 'ceil',
                        payslipPreferredOption === 'ceil'
                      )}
                      disabled={payslipCalculatorDailyAmount <= 0}
                    >
                      <div style={payslipDecisionTopRowStyle}>
                        <div style={payslipDecisionTitleStyle}>Opzione B - arrotonda per eccesso</div>
                        <div style={payslipDecisionDaysStyle}>{payslipCeilDays} giornate</div>
                      </div>
                      <div style={payslipDecisionMetricsRowStyle}>
                        <div style={payslipDecisionMetricStyle}>
                          <span style={payslipDecisionMetricLabelStyle}>Totale busta</span>
                          <span style={payslipDecisionMetricValueStyle}>{formatCurrency(payslipCeilTotal)}</span>
                        </div>
                        <div style={payslipDecisionMetricStyle}>
                          <span style={payslipDecisionMetricLabelStyle}>Differenza</span>
                          <span style={payslipDecisionMetricValueStyle}>{formatCurrency(payslipCeilDifference)}</span>
                        </div>
                      </div>
                      <div
                        style={{
                          ...payslipDecisionHintStyle,
                          background: getPayslipDecisionTone(
                            payslipCeilDifference > 0 ? 'receive' : 'neutral'
                          ).background,
                        }}
                      >
                        <span
                          style={{
                            color: getPayslipDecisionTone(
                              payslipCeilDifference > 0 ? 'receive' : 'neutral'
                            ).color,
                          }}
                        >
                          {payslipCeilDifference > 0
                            ? "Devi ricevere dall'operaio"
                            : 'Saldo perfetto'}
                        </span>
                        <span
                          style={{
                            ...payslipDecisionHintAmountStyle,
                            color: getPayslipDecisionTone(
                              payslipCeilDifference > 0 ? 'receive' : 'neutral'
                            ).amountColor,
                          }}
                        >
                          {formatCurrency(payslipCeilDifference)}
                        </span>
                      </div>
                    </button>

                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSelectPayslipOption('C', payslipCustomDaysNum, payslipCustomTotal)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleSelectPayslipOption('C', payslipCustomDaysNum, payslipCustomTotal);
                        }
                      }}
                      style={getPayslipOptionCardStyle(
                        payslipCalcSelectedOption === 'C',
                        false
                      )}
                    >
                      <div style={payslipDecisionTopRowStyle}>
                        <div style={payslipDecisionTitleStyle}>Opzione C - Personalizzata</div>
                        <div style={payslipDecisionDaysStyle}>
                          {payslipCustomDays === '' ? '-' : `${payslipCustomDaysNum} giornate`}
                        </div>
                      </div>
                      <div style={payslipDecisionInputRowStyle}>
                        <div style={payslipDecisionInlineLabelStyle}>Giornate busta</div>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={payslipCustomDays}
                          onClick={(event) => event.stopPropagation()}
                          onFocus={() => setPayslipCalcSelectedOption('C')}
                          onChange={(event) => {
                            setPayslipCustomDays(event.target.value);
                            setPayslipCalcSelectedOption('C');
                          }}
                          placeholder="es. 5"
                          style={payslipCompactInputStyle}
                        />
                      </div>
                      <div style={payslipDecisionMetricsRowStyle}>
                        <div style={payslipDecisionMetricStyle}>
                          <span style={payslipDecisionMetricLabelStyle}>Totale busta</span>
                          <span style={payslipDecisionMetricValueStyle}>{formatCurrency(payslipCustomTotal)}</span>
                        </div>
                        <div style={payslipDecisionMetricStyle}>
                          <span style={payslipDecisionMetricLabelStyle}>Differenza</span>
                          <span style={payslipDecisionMetricValueStyle}>{formatCurrency(Math.abs(payslipCustomDifference))}</span>
                        </div>
                      </div>
                      <div
                        style={{
                          ...payslipDecisionHintStyle,
                          background: getPayslipDecisionTone(
                            payslipCustomDifference > 0
                              ? 'give'
                              : payslipCustomDifference < 0
                              ? 'receive'
                              : 'neutral'
                          ).background,
                        }}
                      >
                        <span
                          style={{
                            color: getPayslipDecisionTone(
                              payslipCustomDifference > 0
                                ? 'give'
                                : payslipCustomDifference < 0
                                ? 'receive'
                                : 'neutral'
                            ).color,
                          }}
                        >
                          {payslipCustomDifference > 0
                            ? "Devi dare all'operaio"
                            : payslipCustomDifference < 0
                            ? "Devi ricevere dall'operaio"
                            : 'Saldo perfetto'}
                        </span>
                        <span
                          style={{
                            ...payslipDecisionHintAmountStyle,
                            color: getPayslipDecisionTone(
                              payslipCustomDifference > 0
                                ? 'give'
                                : payslipCustomDifference < 0
                                ? 'receive'
                                : 'neutral'
                            ).amountColor,
                          }}
                        >
                          {formatCurrency(Math.abs(payslipCustomDifference))}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <div style={fieldLabelStyle}>Stato pagamento</div>
                  <button
                    type="button"
                    onClick={() => setIsPagato(!isPagato)}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      border: '1px solid transparent',
                      color: 'white',
                      background: isPagato ? '#10b981' : '#ef4444',
                      fontWeight: 700,
                    }}
                  >
                    {isPagato ? 'PAGATO' : 'NON PAGATO'}
                  </button>
                </div>
              </div>
            </div>

            <div style={editorBlockStyle}>
              <div
                style={{
                  ...sectionToolbarStyle,
                  alignItems: isBenefitsSectionCollapsed ? 'center' : 'flex-start',
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                    }}
                  >
                    <div style={editorBlockTitleStyle}>2. Acconti, trasporto e regalo</div>
                    <button
                      type="button"
                      onClick={() => setIsBenefitsSectionCollapsed((current) => !current)}
                      aria-expanded={!isBenefitsSectionCollapsed}
                      aria-label={isBenefitsSectionCollapsed ? 'Apri sezione acconti, trasporto e regalo' : 'Chiudi sezione acconti, trasporto e regalo'}
                      style={{
                        minWidth: 40,
                        height: 36,
                        borderRadius: 10,
                        border: '1px solid rgba(31, 41, 55, 0.12)',
                        background: 'white',
                        color: '#1f2937',
                        fontSize: 16,
                        fontWeight: 800,
                        cursor: 'pointer',
                        flexShrink: 0,
                      }}
                    >
                      {isBenefitsSectionCollapsed ? '>' : 'v'}
                    </button>
                  </div>
                  <div style={{ ...fieldSubtleStyle, marginTop: 4 }}>
                    {isBenefitsSectionCollapsed
                      ? benefitsSectionSummary
                      : 'Gestisci acconti del mese, trasporto e voce extra da mostrare in stampa.'}
                  </div>
                </div>
                {!isBenefitsSectionCollapsed ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button type="button" className="button-secondary" onClick={() => openFinancialImportModal('advance')}>
                      Importa{financialImportCounts.advance ? ` (${financialImportCounts.advance})` : ''}
                    </button>
                    <button type="button" className="button-secondary" onClick={addAdvance}>
                      Aggiungi acconto
                    </button>
                  </div>
                ) : null}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateRows: isBenefitsSectionCollapsed ? '0fr' : '1fr',
                  transition: 'grid-template-rows 220ms ease, opacity 220ms ease, margin-top 220ms ease',
                  opacity: isBenefitsSectionCollapsed ? 0 : 1,
                  marginTop: isBenefitsSectionCollapsed ? 0 : 10,
                }}
              >
                <div style={{ overflow: 'hidden', minHeight: 0 }}>
              <div style={{ display: 'grid', gap: 10 }}>
                {advances.map((advance, index) => (
                  <div key={`advance-row-${index}`} style={advanceRowStyle}>
                    <input type="number" step="0.01" min="0" value={advance.amount} onChange={(e) => updateAdvance(index, 'amount', e.target.value)} placeholder="Importo acconto (€)" />
                    <input type="date" value={advance.date} onChange={(e) => updateAdvance(index, 'date', e.target.value)} />
                    <label style={checkboxLabelStyle}>
                      <input type="checkbox" checked={advance.includeInReport} onChange={(e) => updateAdvance(index, 'includeInReport', e.target.checked)} />
                      Mostra nel report stampato/PDF
                    </label>
                    <button type="button" className="button-danger" onClick={() => removeAdvance(index)} style={{ minWidth: 90 }}>
                      Elimina
                    </button>
                  </div>
                ))}
              </div>

              {meaningfulAdvanceCount > 1 ? (
                <div style={{ marginTop: 8, fontSize: 12, color: '#6b7280' }}>
                  Totale acconti: <strong>{formatCurrency(totalAdvances)}</strong>
                </div>
              ) : null}

              <div style={{ ...editorBlockGridStyle, marginTop: 14 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label
                    style={{
                      ...checkboxLabelStyle,
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: 12,
                      background: 'rgba(244, 248, 243, 0.92)',
                      border: '1px solid rgba(31, 41, 55, 0.08)',
                    }}
                  >
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                      <input
                        type="checkbox"
                        checked={trasportoAttivo}
                        onChange={(e) => setTrasportoAttivo(e.target.checked)}
                      />
                      <span style={{ fontWeight: 700, color: '#1F2937' }}>Trasporto nel mese</span>
                    </span>
                    <span style={{ fontSize: 12, color: '#667085' }}>
                      {trasportoAttivo ? 'Attivo' : 'Disattivato'}
                    </span>
                  </label>
                </div>

                {trasportoAttivo ? (
                  <>
                    <div>
                      <div style={fieldLabelStyle}>N. macchine nel mese</div>
                      <input type="number" step="1" min="0" value={nMacchineMese} onChange={(e) => setNMacchineMese(e.target.value)} placeholder="es. 5" style={fieldStyle} />
                    </div>

                    <div>
                      <div style={fieldLabelStyle}>Prezzo per macchina (EUR)</div>
                      <input type="number" step="0.01" min="0" value={prezzoPerMacchina} onChange={(e) => setPrezzoPerMacchina(e.target.value)} placeholder="es. 15.00" style={fieldStyle} />
                    </div>

                    <div>
                      <div style={fieldLabelStyle}>Totale trasporto (EUR)</div>
                      <div style={readonlyBoxStyle}>{formatCurrency(totaleTrasporto)}</div>
                    </div>
                  </>
                ) : null}

                <div>
                  <div style={fieldLabelStyle}>Regalo (EUR)</div>
                  <input type="number" step="0.01" min="0" value={giftAmount} onChange={(e) => setGiftAmount(e.target.value)} placeholder="Importo regalo" style={fieldStyle} />
                </div>

                <div>
                  <div style={fieldLabelStyle}>Etichetta in stampa</div>
                  <input value={giftLabel} onChange={(e) => setGiftLabel(e.target.value)} placeholder="Es. Premio Pasqua" style={fieldStyle} />
                </div>
              </div>
                </div>
              </div>
            </div>

            <div style={editorBlockStyle}>
              <div style={editorBlockTitleStyle}>3. Resto precedente</div>
              <div style={fieldSubtleStyle}>Importa il credito o debito non ancora chiuso dal mese precedente.</div>
              <div style={{ ...editorBlockGridStyle, marginTop: 10 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={fieldLabelStyle}>Resto precedente (EUR)</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="number" step="0.01" value={restoPrecedente} onChange={(e) => setRestoPrecedente(e.target.value)} placeholder="automatico dal mese precedente" style={fieldStyle} />
                    <button type="button" onClick={importPreviousBalance}>Importa</button>
                  </div>
                  {previousBalanceBadgeLabel ? (
                    <div style={{ marginTop: 10 }}>
                      <span style={previousBalanceBadgeStyle(restoPrecedenteNum)}>
                        {previousBalanceBadgeLabel}
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div style={editorBlockStyle}>
              <div style={sectionToolbarStyle}>
                <div>
                  <div style={editorBlockTitleStyle}>4. Rateizzazione debito</div>
                  <div style={fieldSubtleStyle}>Programma le trattenute future e tieni traccia delle rate mensili.</div>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="button-secondary" onClick={() => openFinancialImportModal('installment')}>
                    Importa{financialImportCounts.installment ? ` (${financialImportCounts.installment})` : ''}
                  </button>
                  <button type="button" className="button-secondary" onClick={addDebtPlan}>
                    Nuova rateizzazione
                  </button>
                </div>
              </div>

              {!debtPlans.length ? (
                <div style={{ color: '#667085', fontSize: 13 }}>Nessuna rateizzazione attiva.</div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {debtPlans.map((plan, planIndex) => (
                    <div key={plan.client_key || `debt-plan-${plan.id || planIndex}`} style={{ display: 'grid', gap: 10, padding: 12, borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff' }}>
                      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'minmax(0, 1.2fr) 140px 140px auto', alignItems: 'end' }}>
                        <input value={plan.label} onChange={(e) => updateDebtPlan(planIndex, 'label', e.target.value)} placeholder="Nome debito / causale" />
                        <input type="number" step="0.01" min="0" value={plan.total_amount} onChange={(e) => updateDebtPlan(planIndex, 'total_amount', e.target.value)} placeholder="Totale debito" />
                        <input type="month" value={plan.created_from_month || monthString(currentMonth)} onChange={(e) => updateDebtPlan(planIndex, 'created_from_month', e.target.value)} />
                        <button type="button" className="button-danger" onClick={() => removeDebtPlan(planIndex)}>Elimina</button>
                      </div>

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button type="button" className="button-secondary" onClick={() => generateDebtInstallments(planIndex, 2, plan.created_from_month || monthString(currentMonth))}>Genera 2 rate</button>
                        <button type="button" className="button-secondary" onClick={() => generateDebtInstallments(planIndex, 3, plan.created_from_month || monthString(currentMonth))}>Genera 3 rate</button>
                        <button type="button" className="button-secondary" onClick={() => generateDebtInstallments(planIndex, 4, plan.created_from_month || monthString(currentMonth))}>Genera 4 rate</button>
                        <button type="button" className="button-secondary" onClick={() => addDebtInstallment(planIndex)}>Aggiungi rata</button>
                      </div>

                      <div style={{ display: 'grid', gap: 8 }}>
                        {plan.installments.map((installment, installmentIndex) => (
                          <div key={installment.client_key || `debt-installment-${planIndex}-${installmentIndex}`} style={{ display: 'grid', gap: 10, gridTemplateColumns: '140px 140px minmax(0, 1fr) auto', alignItems: 'center' }}>
                            <input type="month" value={installment.target_month} onChange={(e) => updateDebtInstallment(planIndex, installmentIndex, 'target_month', e.target.value)} />
                            <input type="number" step="0.01" min="0" value={installment.amount} onChange={(e) => updateDebtInstallment(planIndex, installmentIndex, 'amount', e.target.value)} placeholder="Importo rata" />
                            <input value={installment.note} onChange={(e) => updateDebtInstallment(planIndex, installmentIndex, 'note', e.target.value)} placeholder="Nota rata (facoltativa)" />
                            <button type="button" className="button-danger" onClick={() => removeDebtInstallment(planIndex, installmentIndex)}>X</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={editorBlockStyle}>
              <div style={editorBlockTitleStyle}>5. Resto / saldo finale</div>
              {(() => {
                const _showControls = restoPrecedenteNum !== 0 || differenzaFinale !== 0;
                const _reason = !_showControls
                  ? 'differenzaFinale === 0 and restoPrecedenteNum === 0'
                  : differenzaFinale > 0
                  ? 'differenzaFinale > 0 (resto da dare)'
                  : differenzaFinale < 0
                  ? 'differenzaFinale < 0 (da ricevere)'
                  : 'restoPrecedenteNum !== 0';
                console.log('[report-debug] payment status visibility', {
                  employee_id: employee?.id ?? null,
                  month: monthString(currentMonth),
                  finalBalance: differenzaFinale,
                  payroll_record_id: currentPayrollRecord?.id ?? null,
                  isProcessedRecord: !!currentPayrollRecord?.processed_at,
                  restoPaid,
                  showPaymentStatusControls: _showControls,
                  reasonHidden: _showControls ? null : 'differenzaFinale === 0 and restoPrecedenteNum === 0',
                  condition: _reason,
                });
                return null;
              })()}
              <div style={{ ...editorBlockGridStyle, alignItems: 'end' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={getBalanceBoxStyle(differenzaFinale)}>
                    {differenzaFinale > 0
                      ? `Resto da dare all'operaio ${formatCurrency(differenzaFinale)}`
                      : differenzaFinale < 0
                      ? `Da ricevere ${formatSignedCurrency(differenzaFinale)}`
                      : 'Pareggio'}
                  </div>
                </div>

                {restoPrecedenteNum !== 0 || differenzaFinale !== 0 ? (
                  <>
                    <div>
                      <div style={fieldLabelStyle}>Stato saldo</div>
                      <button
                        type="button"
                        className="button"
                        onClick={() => {
                          setRestoPaid((current) => {
                            const next = !current;
                            if (next && !restoPaidDate) {
                              setRestoPaidDate(formatLocalDate(new Date()));
                            }
                            if (!next) {
                              setRestoPaidDate('');
                            }
                            return next;
                          });
                        }}
                        style={{
                          width: '100%',
                          background: restoPaid ? '#10b981' : '#ef4444',
                          borderColor: 'transparent',
                        }}
                      >
                        {restoPaid ? 'PAGATO' : 'NON PAGATO'}
                      </button>
                    </div>

                    <div>
                      <div style={fieldLabelStyle}>Data chiusura saldo</div>
                      <input
                        type="date"
                        value={restoPaidDate}
                        onChange={(e) => setRestoPaidDate(e.target.value)}
                        disabled={!restoPaid}
                        style={fieldStyle}
                      />
                    </div>
                  </>
                ) : null}

                <div>
                  <div style={fieldLabelStyle}>Note aggiuntive</div>
                  <input value={noteExtra} onChange={(e) => setNoteExtra(e.target.value)} placeholder="Note..." style={fieldStyle} />
                </div>
              </div>
            </div>

            <div style={editorBlockStyle}>
              <div style={editorBlockTitleStyle}>6. Allegato report</div>
              <DocumentActions
                document={payrollDocument}
                onUpload={handleUploadPayrollDocument}
                onOpen={handleOpenPayrollDocument}
                onDelete={handleDeletePayrollDocument}
                uploadLabel={uploadingPayrollDocument ? 'Caricamento...' : 'Carica file'}
                openLabel="Apri file"
                emptyLabel="Nessuna busta paga allegata"
              />
            </div>

          </fieldset>

          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center', paddingTop: 6 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {hasUnsavedChanges ? (
                <span className="soft-chip" style={{ background: 'rgba(245, 158, 11, 0.14)', color: '#b45309', borderColor: 'rgba(245, 158, 11, 0.18)' }}>
                  {saveState === 'saving' ? 'Salvataggio...' : 'Modifiche in corso'}
                </span>
              ) : saveState === 'saved' ? (
                <span className="soft-chip" style={{ background: 'rgba(22, 163, 74, 0.14)', color: '#14532d', borderColor: 'rgba(22, 101, 52, 0.14)' }}>
                  Salvato
                </span>
              ) : (
                <span className="soft-chip" style={{ background: 'rgba(22, 163, 74, 0.14)', color: '#14532d', borderColor: 'rgba(22, 101, 52, 0.14)' }}>
                  Dati sincronizzati
                </span>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {isProcessedRecord ? (
                <button
                  type="button"
                  className="button-secondary"
                  onClick={handleUnlockEdit}
                  disabled={isEditUnlocked}
                >
                  Modifica
                </button>
              ) : null}
              <button
                type="button"
                className="button-secondary"
                onClick={handleCancelReportChanges}
                disabled={!hasUnsavedChanges}
              >
                Annulla
              </button>
              <button type="button" className="button" onClick={() => handleSavePayrollRecord()}>
                Salva nel registro
              </button>
            </div>
          </div>
            </div>
          </div>

          <div className="report-preview-column">
            <div className="report-preview-sticky">
              {loading ? (
                <div style={emptyBoxStyle}>Caricamento...</div>
              ) : (
                <EmployeePrintArea
                  employee={employee}
                  currentMonth={currentMonth}
                  datore={datore}
                  employerOptions={employerOptions}
                  attendanceBaseHours={attendanceBaseHours}
                  hoursFormat={hoursFormat}
                  attendanceMap={attendanceMap}
                  dayMarkers={settings?.general?.attendance_markers || []}
                  employeeTotals={employeeTotals}
                  dailyPay={dailyPay}
                  overtimeHourlyRate={overtimeHourlyRate}
                  overtimeView={overtimeView}
                  showOvertimeInReport={showOvertimeInReport}
                  workedDays={workedDays}
                  totalRegularPay={totalRegularPay}
                  totalOvertimePay={totalOvertimePay}
                  totalCalculatedPay={totalCalculatedPayForReport}
                  importoBustaPagaNum={importoBustaPagaNum}
                  giornateBustaPaga={giornateBustaPaga}
                  totalAdvances={totalAdvances}
                  visibleAdvances={visibleAdvances}
                  currentInstallments={currentInstallments}
                  currentInstallmentTotal={currentInstallmentTotal}
                  giftAmountNum={giftAmountNum}
                  giftLabel={giftLabel}
                  restoPrecedenteNum={restoPrecedenteNum}
                  trasportoAttivo={trasportoAttivo}
                  nMacchineMeseNum={nMacchineMeseNum}
                  prezzoPerMacchinaNum={prezzoPerMacchinaNum}
                  totaleTrasporto={totaleTrasporto}
                  differenzaFinale={differenzaFinale}
                  noteExtra={noteExtra}
                  isPagato={isPagato}
                  restoPaid={restoPaid}
                  restoPaidDate={restoPaidDate}
                />
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isTeamMode && selectedTeam ? (
        <div className="no-print" style={teamEditorStyle}>
          <div style={teamEditorHeaderStyle}>
            <div>
              <div className="page-kicker" style={{ marginBottom: 6 }}>Report squadra</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{selectedTeam.name}</div>
              <div style={{ color: '#667085', marginTop: 6 }}>
                Definisci il periodo reale di pagamento e completa trasporto, acconti squadra e note per la stampa.
              </div>
            </div>

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', minWidth: 'min(100%, 520px)' }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Dal giorno</div>
                <input type="date" value={teamPeriodStart} onChange={(e) => setTeamPeriodStart(e.target.value)} style={fieldStyle} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Al giorno</div>
                <input type="date" value={teamPeriodEnd} onChange={(e) => setTeamPeriodEnd(e.target.value)} style={fieldStyle} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Periodo selezionato</div>
                <div style={readonlyBoxStyle}>{teamPeriodLabel}</div>
              </div>
            </div>
          </div>

          <div style={teamEditorGridStyle}>
            <div style={teamEditorCardStyle}>
              <div style={editorSectionTitleStyle}>Trasporto squadra</div>
              <label style={checkboxLabelStyle}>
                <input type="checkbox" checked={teamTransportEnabled} onChange={(e) => setTeamTransportEnabled(e.target.checked)} />
                Includi trasporto nel report squadra
              </label>
              <input value={teamTransportDescription} onChange={(e) => setTeamTransportDescription(e.target.value)} placeholder="Descrizione trasporto (es. mezzi settimana 1)" style={fieldStyle} />
              <input type="number" step="0.01" min="0" value={teamTransportAmount} onChange={(e) => setTeamTransportAmount(e.target.value)} placeholder="Totale trasporto squadra (€)" style={fieldStyle} />
            </div>

            <div style={teamEditorCardStyle}>
              <div style={sectionToolbarStyle}>
                <div style={editorSectionTitleStyle}>Acconti squadra</div>
                <button type="button" className="button-secondary" onClick={addTeamAdvance}>
                  Aggiungi acconto
                </button>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                {teamAdvances.map((advance, index) => (
                  <div key={`team-advance-${index}`} style={teamAdvanceRowStyle}>
                    <input type="number" step="0.01" min="0" value={advance.amount} onChange={(e) => updateTeamAdvance(index, 'amount', e.target.value)} placeholder="Importo (€)" />
                    <input type="date" value={advance.date} onChange={(e) => updateTeamAdvance(index, 'date', e.target.value)} />
                    <input value={advance.description} onChange={(e) => updateTeamAdvance(index, 'description', e.target.value)} placeholder="Descrizione / nota" />
                    <button type="button" className="button-danger" onClick={() => removeTeamAdvance(index)}>
                      Elimina
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={teamEditorCardStyle}>
            <div style={editorSectionTitleStyle}>Note del report squadra</div>
            <textarea rows={3} value={teamNotes} onChange={(e) => setTeamNotes(e.target.value)} placeholder="Note per il titolare o dettagli del pagamento..." />
          </div>
        </div>
      ) : null}

      {!selectedEntity ? (
        <div style={emptyBoxStyle}>
          Seleziona un dipendente o una squadra per generare il report
        </div>
      ) : loading && !isEmployeeMode ? (
        <div>Caricamento...</div>
      ) : isTeamMode && selectedTeam ? (
        <TeamPrintArea
          selectedTeam={selectedTeam}
          teamPeriodLabel={teamPeriodLabel}
          teamPeriodDays={teamPeriodDays}
          teamRows={teamRows}
          teamTotals={teamTotals}
          hoursFormat={hoursFormat}
          teamTransportEnabled={teamTransportEnabled}
          teamTransportDescription={teamTransportDescription}
          teamTransportTotal={teamTransportTotal}
          filteredTeamAdvances={filteredTeamAdvances}
          teamAdvancesTotal={teamAdvancesTotal}
          teamFinalBalance={teamFinalBalance}
          teamNotes={teamNotes}
        />
      ) : (
        <div style={emptyBoxStyle}>Selezione non disponibile.</div>
      )}

      {financialImportModal.open ? (
        <div className="no-print" style={modalBackdropStyle}>
          <div style={modalCardStyle}>
            <div style={sectionToolbarStyle}>
              <div>
                <div style={editorBlockTitleStyle}>
                  Importa {financialImportModal.type === 'installment' ? 'rate' : 'acconti'}
                </div>
                <div style={fieldSubtleStyle}>
                  Movimenti non inseriti disponibili per {employee?.first_name} {employee?.last_name}.
                </div>
              </div>
              <button type="button" className="button-secondary" onClick={closeFinancialImportModal}>
                Chiudi
              </button>
            </div>

            <div style={{ display: 'grid', gap: 8, marginTop: 14, maxHeight: 320, overflow: 'auto' }}>
              {financialImportModal.items.map((item) => (
                <label key={item.id} style={importMovementRowStyle}>
                  <input
                    type="checkbox"
                    checked={financialImportModal.selectedIds.includes(item.id)}
                    onChange={() => toggleFinancialImportSelection(item.id)}
                  />
                  <span style={{ minWidth: 0 }}>
                    <strong>{formatDateLabel(item.movement_date)} - {formatCurrency(item.amount)}</strong>
                    <span style={{ display: 'block', color: '#4b5563', fontSize: 12 }}>
                      {item.employer_key || datore || 'Datore'}{item.notes ? ` - ${item.notes}` : ''}
                    </span>
                  </span>
                </label>
              ))}
              {!financialImportModal.items.length ? (
                <div style={emptyBoxStyle}>Nessun movimento disponibile da importare.</div>
              ) : null}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
              <button type="button" className="button-secondary" onClick={closeFinancialImportModal}>
                Annulla
              </button>
              <button type="button" className="button" onClick={importSelectedFinancialMovements}>
                Importa nel report
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingSavePrompt ? (
        <div className="no-print" style={modalBackdropStyle}>
          <div style={modalCardStyle}>
            <div style={editorBlockTitleStyle}>Movimenti non inseriti</div>
            <div style={{ ...fieldSubtleStyle, marginTop: 8 }}>
              Attenzione: ci sono acconti o rate non ancora inseriti nel report. Vuoi controllarli prima di salvare?
            </div>
            <div style={{ ...fieldSubtleStyle, marginTop: 8 }}>
              Acconti: {pendingSavePrompt.advance} - Rate: {pendingSavePrompt.installment}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
              <button
                type="button"
                className="button-secondary"
                onClick={async () => {
                  const nextOptions = pendingSavePrompt.options || {};
                  setPendingSavePrompt(null);
                  await handleSavePayrollRecord({ ...nextOptions, skipPendingFinancialCheck: true });
                }}
              >
                Salva comunque
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  const type = pendingSavePrompt.advance > 0 ? 'advance' : 'installment';
                  setPendingSavePrompt(null);
                  openFinancialImportModal(type);
                }}
              >
                Controlla ora
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function groupDaysByWeek(days) {
  const weeks = [];
  let currentWeek = Array(7).fill(null);
  let hasContent = false;
  for (const day of days) {
    const dow = (day.getDay() + 6) % 7;
    if (dow === 0 && hasContent) {
      weeks.push(currentWeek);
      currentWeek = Array(7).fill(null);
      hasContent = false;
    }
    currentWeek[dow] = day;
    hasContent = true;
  }
  if (hasContent) weeks.push(currentWeek);
  return weeks;
}

function getMarkerMeta(markerCode, markers) {
  if (!markerCode || !Array.isArray(markers)) return null;
  return markers.find((m) => m.value === markerCode) || null;
}

function resolveReportMarkerImageSrc(imagePath) {
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

function ReportMarkerVisual({ marker, size = 10 }) {
  const imageSrc = resolveReportMarkerImageSrc(marker?.image);

  if (imageSrc) {
    return (
      <img
        src={imageSrc}
        alt={marker?.text || marker?.value || 'marker'}
        style={{ width: size, height: size, objectFit: 'contain', display: 'inline-block' }}
      />
    );
  }

  return <span style={{ display: 'inline-block', lineHeight: 1 }}>{marker?.symbol || marker?.text || marker?.value || ''}</span>;
}

function formatCompactOvertimeValue(hours, hoursFormat) {
  return formatHoursValue(hours, hoursFormat).replace(/\s*h(?:\s*)$/i, '').replace(/\s*min/i, 'm');
}

function WeekGrid({ week, attendanceMap, hoursFormat, dayMarkers, showOvertimeInReport = true }) {
  return (
    <div style={rp2WeekGridStyle}>
      {week.map((day, colIndex) => {
        const isSunday = colIndex === 6;
        if (!day) {
          return (
            <div key={colIndex} style={{ ...rp2DayCellStyle(isSunday), opacity: 0 }}>
              <div style={rp2DayHeaderTopStyle}>
                <span style={rp2DayHeaderLabelStyle}>-</span>
                <span style={rp2DayHeaderNumberStyle}>-</span>
              </div>
              <div style={rp2DayIndicatorSlotStyle}>
                <div style={rp2DayIndicatorStyle('neutral')}><span style={rp2IndicatorDotStyle('neutral')} /></div>
              </div>
              <div style={rp2DayMetaAccentStyle}> </div>
              <div style={rp2DayMetaMutedStyle}> </div>
              <div style={rp2DayDetailStyle(false)}> </div>
            </div>
          );
        }
        const dateStr = formatLocalDate(day);
        const att = attendanceMap[dateStr];

        let entryCode = null;
        let specialCode = null;
        let normalHours = 0;
        let overtimeHours = 0;

        if (att) {
          if (att.entry_code) {
            entryCode = String(att.entry_code || '').trim();
          }
          if (att.status && att.status !== 'presente' && att.status !== 'assente' && !att.entry_code) {
            specialCode = att.status.charAt(0).toUpperCase();
          }
          normalHours = Number(att.hours_worked || 0);
          overtimeHours = showOvertimeInReport ? Number(att.overtime_hours || 0) : 0;
        }

        const markerMeta = getMarkerMeta(att?.marker_code, dayMarkers);
        const isPresenceEntry = !!entryCode && (/^x$/i.test(entryCode) || Number(entryCode) > 0);
        const hasHours = normalHours > 0 || overtimeHours > 0;
        const hasContent = isPresenceEntry || specialCode !== null || hasHours || !!markerMeta;
        const isWorkedDay = hasHours || isPresenceEntry;
        const isEmptyDay = !hasContent;
        const indicatorTone = isWorkedDay
          ? 'worked'
          : specialCode
          ? 'special'
          : isSunday || isEmptyDay
          ? 'neutral'
          : 'empty';
        const indicatorLabel = isWorkedDay ? (entryCode || 'X') : specialCode || '';
        const rawHelperLabel = markerMeta?.symbol || markerMeta?.text || markerMeta?.value || '';
        const hasRealPresence = isWorkedDay || overtimeHours > 0;
        const showMarker = !!markerMeta && (isWorkedDay || !!specialCode || overtimeHours > 0) && rawHelperLabel && rawHelperLabel !== indicatorLabel;
        const detailLabel = !isWorkedDay && !specialCode ? (isSunday ? 'Riposo' : 'Assenza') : '';
        const overtimeLabel = overtimeHours > 0 ? `+${formatCompactOvertimeValue(overtimeHours, hoursFormat)}` : '';

        return (
          <div key={dateStr} style={rp2DayCellStyle(isSunday, hasRealPresence)}>
            <div style={rp2DayHeaderTopStyle}>
              <span style={rp2DayHeaderLabelStyle}>{DAY_ABBR_SHORT[colIndex]}</span>
              <span style={rp2DayHeaderNumberStyle}>{day.getDate()}</span>
            </div>
            <div style={rp2DayIndicatorSlotStyle}>
              <div style={rp2DayIndicatorStyle(indicatorTone, showMarker ? markerMeta?.color : null)}>
                {indicatorLabel || <span style={rp2IndicatorDotStyle(indicatorTone)} />}
              </div>
            </div>
            <div style={rp2DayMetaAccentStyle}>
              {overtimeLabel || ' '}
            </div>
            <div style={showMarker ? rp2DayMetaStyle(markerMeta?.color) : rp2DayMetaMutedStyle}>
              {showMarker ? <ReportMarkerVisual marker={markerMeta} size={11} /> : ' '}
            </div>
            <div style={rp2DayDetailStyle(!isWorkedDay && !isEmptyDay)}>
              {detailLabel || ' '}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmployeePrintArea({
  employee,
  currentMonth,
  datore,
  employerOptions,
  attendanceBaseHours,
  hoursFormat,
  attendanceMap,
  dayMarkers,
  employeeTotals,
  dailyPay,
  overtimeHourlyRate,
  overtimeView,
  showOvertimeInReport,
  workedDays,
  totalRegularPay,
  totalOvertimePay,
  totalCalculatedPay,
  importoBustaPagaNum,
  giornateBustaPaga,
  totalAdvances,
  visibleAdvances,
  currentInstallments,
  currentInstallmentTotal,
  giftAmountNum,
  giftLabel,
  restoPrecedenteNum,
  trasportoAttivo,
  nMacchineMeseNum,
  prezzoPerMacchinaNum,
  totaleTrasporto,
  differenzaFinale,
  noteExtra,
  isPagato,
  restoPaid,
  restoPaidDate,
}) {
  const daysInMonth = useMemo(
    () => getMonthDays(startOfMonth(currentMonth), endOfMonth(currentMonth)),
    [currentMonth]
  );
  const weekGroups = useMemo(() => groupDaysByWeek(daysInMonth), [daysInMonth]);
  const monthName = MONTH_NAMES[currentMonth.getMonth()];
  const yearStr = String(currentMonth.getFullYear());
  const mainBalanceLabel =
    differenzaFinale > 0
      ? "Resto da dare all'operaio"
      : differenzaFinale < 0
      ? "Resto da ricevere dall'operaio"
      : 'Saldo perfetto';
  const payslipDaysNum = Number(giornateBustaPaga || 0);
  const hasMultipleEmployers = Array.isArray(employerOptions) && employerOptions.length > 1;
  const selectedEmployer = hasMultipleEmployers
    ? employerOptions.find((option) => (option.short_name || option.value) === datore)
    : null;
  const selectedEmployerLabel = selectedEmployer?.short_name || selectedEmployer?.value || datore || '';
  const payrollDifference = totalCalculatedPay - importoBustaPagaNum;
  const totalTrattenute = totalAdvances + currentInstallmentTotal;
  const displayTotalHours = showOvertimeInReport
    ? employeeTotals.totalHours
    : employeeTotals.totalRegularHours;
  const compensationMonthAmount =
    totalCalculatedPay +
    giftAmountNum +
    Math.max(restoPrecedenteNum, 0) +
    totaleTrasporto -
    currentInstallmentTotal -
    Math.abs(Math.min(restoPrecedenteNum, 0)) -
    totalAdvances;
  const creditRows = [
    {
      label: 'Retribuzione calcolata',
      detail: formatWorkedSummary(displayTotalHours, attendanceBaseHours, hoursFormat),
      value: formatCurrency(totalCalculatedPay),
      tone: 'base',
      order: 1,
    },
    {
      label: 'Trasporto',
      detail: trasportoAttivo && totaleTrasporto !== 0
        ? `${nMacchineMeseNum} macchine x ${formatCurrency(prezzoPerMacchinaNum)}`
        : 'Non incluso',
      value: totaleTrasporto !== 0 ? formatCurrency(totaleTrasporto) : '-',
      tone: 'positive',
      order: 2,
      hidden: !trasportoAttivo || totaleTrasporto === 0,
    },
    {
      label: giftLabel || 'Regalo / Extra',
      detail: giftAmountNum !== 0 ? 'Voce aggiuntiva del mese' : 'Nessun extra',
      value: giftAmountNum !== 0 ? formatCurrency(giftAmountNum) : '-',
      tone: 'positive',
      order: 4,
      hidden: giftAmountNum === 0,
    },
    {
      label: 'Credito precedente',
      detail: restoPrecedenteNum !== 0 ? 'Saldo importato dal mese precedente' : 'Nessun saldo precedente',
      value: restoPrecedenteNum > 0 ? formatCurrency(restoPrecedenteNum) : '-',
      tone: 'positive',
      order: 3,
      hidden: restoPrecedenteNum <= 0,
    },
  ].filter((row) => !row.hidden).sort((a, b) => a.order - b.order);
  const debitRows = [
    {
      label: 'Busta paga',
      detail: payslipDaysNum
        ? `${payslipDaysNum} giornate${hasMultipleEmployers && selectedEmployerLabel ? ` - ${selectedEmployerLabel}` : ''}`
        : 'Non inserita',
      value: importoBustaPagaNum > 0 ? formatCurrency(importoBustaPagaNum) : '-',
      tone: 'negative',
      order: 1,
      hidden: importoBustaPagaNum <= 0,
    },
    ...visibleAdvances.map((advance, index) => ({
      label: `Acconto${visibleAdvances.length > 1 ? ` ${index + 1}` : ''}`,
      detail: advance.date ? `Data: ${formatDateLabel(advance.date)}` : 'Senza data',
      value: formatCurrency(advance.amount),
      tone: 'negative',
      order: 2 + index,
    })),
    ...currentInstallments.map((installment, index) => ({
      label: `Rata ${installment.installmentNumber || index + 1}`,
      detail: `${installment.planLabel} - Residuo ${formatCurrency(installment.residualAfterCurrent)}`,
      value: formatCurrency(installment.amount),
      tone: 'negative',
      order: 100 + index,
    })),
    {
      label: 'Debito precedente',
      detail: restoPrecedenteNum !== 0 ? 'Saldo importato dal mese precedente' : 'Nessun saldo precedente',
      value: restoPrecedenteNum < 0 ? formatCurrency(Math.abs(restoPrecedenteNum)) : '-',
      tone: 'negative',
      order: 200,
      hidden: restoPrecedenteNum >= 0,
    },
  ].filter((row) => !row.hidden).sort((a, b) => a.order - b.order);
  const totalCredits = totalCalculatedPay + totaleTrasporto + giftAmountNum + Math.max(restoPrecedenteNum, 0);
  const totalDebits = importoBustaPagaNum + totalAdvances + currentInstallmentTotal + Math.abs(Math.min(restoPrecedenteNum, 0));
  const balanceFormulaLabel = (() => {
    const positiveTerms = ['Crediti operaio'];
    const negativeTerms = [];

    if (totaleTrasporto !== 0) {
      positiveTerms.push('trasporto');
    }
    if (giftAmountNum !== 0) {
      positiveTerms.push('extra');
    }
    if (restoPrecedenteNum > 0) {
      positiveTerms.push('credito precedente');
    }

    if (importoBustaPagaNum > 0) {
      negativeTerms.push('busta paga');
    }
    if (totalAdvances > 0) {
      negativeTerms.push('acconti');
    }
    if (currentInstallmentTotal > 0) {
      negativeTerms.push('rate');
    }
    if (restoPrecedenteNum < 0) {
      negativeTerms.push('debito precedente');
    }

    return [
      ...positiveTerms.map((term, index) => (index === 0 ? term : `+ ${term}`)),
      ...negativeTerms.map((term) => `- ${term}`),
    ].join(' ');
  })();

  return (
    <div className="print-area employee-print-area">
      <div className="print-sheet employee-print-sheet" style={employeePrintSheetStyle}>
        <div style={rp2HeaderStyle}>
          <div>
            <div style={rp2NameStyle}>{employee.first_name} {employee.last_name}</div>
            <div style={rp2SubtitleStyle}>{employee.role || 'Nessuna mansione'} - {monthName} {yearStr}</div>
          </div>
          <div style={rp2BadgeStyle(isPagato)}>{isPagato ? 'PAGATO' : 'NON PAGATO'}</div>
        </div>

        <div style={rp2SummaryRowStyle}>
          <div style={rp2SummaryCardStyle}>
            <div style={rp2CardLabelStyle}>Giorni lavorati</div>
            <div style={rp2CardValueStyle}>{workedDays}</div>
            <div style={rp2CardSubStyle}>Giornate registrate</div>
          </div>
          <div style={rp2SummaryCardStyle}>
            <div style={rp2CardLabelStyle}>Ore totali</div>
            <div style={rp2CardValueStyle}>{formatHoursValue(displayTotalHours, hoursFormat)}</div>
            <div style={rp2CardSubStyle}>{formatWorkedSummary(displayTotalHours, attendanceBaseHours, hoursFormat)}</div>
          </div>
          <div style={rp2SummaryCardStyle}>
            <div style={rp2CardLabelStyle}>Compenso mese</div>
            <div style={rp2CardValueStyle}>{formatCurrency(compensationMonthAmount)}</div>
            <div style={rp2CardSubStyle}>Saldo teorico del mese</div>
          </div>
        </div>

        <div style={rp2TariffRowStyle}>
          <div style={rp2TariffPillStyle}>
            <span style={rp2TariffLabelStyle}>Tariffa giornaliera</span>
            <strong>{formatCurrency(dailyPay)}</strong>
          </div>
          {showOvertimeInReport ? (
            <div style={rp2TariffPillStyle}>
              <span style={rp2TariffLabelStyle}>Straordinario</span>
              <strong>
                {overtimeView?.showHourlyRate
                  ? overtimeHourlyRate > 0 ? `${formatCurrency(overtimeHourlyRate)} / h` : '-'
                  : '-'}
              </strong>
            </div>
          ) : null}
        </div>

        <div className="print-block employee-print-section" style={rp2SectionBoxStyle}>
          <div style={rp2SectionLabelStyle}>Presenze del mese</div>
          {weekGroups.map((week, i) => (
            <div key={`week-group-${i}`} style={rp2WeekBlockStyle}>
              <div style={rp2WeekLabelStyle}>Settimana {i + 1}</div>
              <WeekGrid
                week={week}
                attendanceMap={attendanceMap}
                hoursFormat={hoursFormat}
                dayMarkers={dayMarkers}
                showOvertimeInReport={showOvertimeInReport}
              />
            </div>
          ))}
          <div style={rp2AttendanceLegendStyle}>
            <span style={rp2LegendItemStyle}><span style={rp2LegendDotStyle('worked')} /> Presenza</span>
            <span style={rp2LegendItemStyle}><span style={rp2LegendDotStyle('neutral')} /> Domenica / riposo</span>
            <span style={rp2LegendItemStyle}><span style={rp2LegendDotStyle('empty')} /> Assenza</span>
          </div>
        </div>

        <div className="print-block employee-print-section" style={rp2SectionBoxStyle}>
          <div style={rp2SectionLabelStyle}>Crediti dell'operaio</div>
          <div style={rp2EconomicTableStyle}>
            {creditRows.map((row) => (
              <div key={row.label} style={rp2EconRowStyle(row.strong)}>
                <div style={{ minWidth: 0 }}>
                  <div style={rp2EconLabelStyle(row.strong)}>{row.label}</div>
                  <div style={rp2EconSubStyle}>{row.detail}</div>
                </div>
                <div style={rp2EconAmountStyle(row.tone, row.strong)}>
                  {row.tone === 'negative' && !String(row.value).trim().startsWith('-') ? `- ${row.value}` : row.value}
                </div>
              </div>
            ))}
            {creditRows.length > 1 ? <div style={rp2DeductionBoxStyle}>
              <span>Totale crediti operaio</span>
              <span>{formatCurrency(totalCredits)}</span>
            </div> : null}
          </div>
        </div>

        {debitRows.length ? (
          <div className="print-block employee-print-section" style={rp2SectionBoxStyle}>
            <div style={rp2SectionLabelStyle}>Debiti / Trattenute dell'operaio</div>
            {debitRows.map((row) => (
              <div key={row.label + row.detail} style={rp2EconRowStyle()}>
                <div>
                  <div style={rp2EconLabelStyle()}>{row.label}</div>
                  <div style={rp2EconSubStyle}>{row.detail}</div>
                </div>
                <div style={rp2EconAmountStyle('negative')}>
                  - {row.value}
                </div>
              </div>
            ))}
            {debitRows.length > 1 ? <div style={rp2DeductionBoxStyle}>
              <span>Totale debiti / trattenute</span>
              <span>- {formatCurrency(totalDebits)}</span>
            </div> : null}
          </div>
        ) : null}

        <div className="print-block employee-print-section" style={rp2ResultCardStyle(differenzaFinale)}>
          <div>
            <div style={rp2ResultLabelStyle}>{mainBalanceLabel}</div>
            <div style={rp2ResultFormulaStyle}>
              {differenzaFinale > 0 && restoPaid && restoPaidDate
                ? `Pagato il ${formatDateLabel(restoPaidDate)}`
                : balanceFormulaLabel}
            </div>
          </div>
          <div style={rp2ResultValueStyle(differenzaFinale)}>
            {differenzaFinale !== 0 ? formatSignedCurrency(differenzaFinale) : '\u20ac 0,00'}
          </div>
        </div>

        {noteExtra ? <div style={rp2NoteStyle}>{noteExtra}</div> : null}

        <div style={rp2FooterStyle}>
          <span>GPA 1.0.2</span>
        </div>
      </div>
    </div>
  );
}

function CompactAttendanceRow({ days, attendanceMap, hoursFormat }) {
  return (
    <>
      <tr>
        <td style={compactLegendCellStyle}>Giorno</td>
        {days.map((day) => {
          const isSunday = day.getDay() === 0;
          return (
            <td
              key={`day-number-${formatLocalDate(day)}`}
              style={{
                ...compactHeaderCellStyle,
                background: isSunday ? '#fef3c7' : '#f8fafc',
              }}
            >
              {day.getDate()}
            </td>
          );
        })}
      </tr>
      <tr>
        <td style={compactLegendCellStyle}>Presenza</td>
        {days.map((day) => {
          const dateStr = formatLocalDate(day);
          const att = attendanceMap[dateStr];
          const value = getReportCellValue(att, hoursFormat);
          const isSunday = day.getDay() === 0;

          return (
            <td
              key={`day-value-${dateStr}`}
              style={{
                ...compactValueCellStyle,
                background: isSunday ? '#fffbeb' : '#fff',
              }}
            >
              {value || '-'}
            </td>
          );
        })}
      </tr>
    </>
  );
}

function MiniMetricCard({ label, detail, value, strong }) {
  return (
    <div style={employeeMiniMetricCardStyle}>
      <div style={{ ...smallMutedStyle, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: strong ? 16 : 14, fontWeight: strong ? 800 : 700 }}>{value}</div>
      {detail ? (
        <div style={{ ...smallMutedStyle, marginTop: 4 }}>{detail}</div>
      ) : null}
    </div>
  );
}

function SummaryLineCompact({ label, detail, value, strong, color, subtle }) {
  return (
    <div
      style={{
        ...summaryRow,
        alignItems: detail ? 'start' : 'center',
        color: color || (subtle ? '#6b7280' : '#111827'),
        fontStyle: subtle ? 'italic' : 'normal',
        gap: 8,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: strong ? 800 : 700 }}>{label}</div>
        {detail ? (
          <div style={{ fontSize: 9, color: subtle ? '#6b7280' : '#667085', marginTop: 1 }}>{detail}</div>
        ) : null}
      </div>
      <div style={{ marginLeft: 'auto', fontWeight: strong ? 800 : 700, whiteSpace: 'nowrap' }}>{value || '-'}</div>
    </div>
  );
}

function SummaryGroupTitle({ children }) {
  return <div style={summaryGroupTitleStyle}>{children}</div>;
}

function TeamPrintArea({
  selectedTeam,
  teamPeriodLabel,
  teamPeriodDays,
  teamRows,
  teamTotals,
  hoursFormat,
  teamTransportEnabled,
  teamTransportDescription,
  teamTransportTotal,
  filteredTeamAdvances,
  teamAdvancesTotal,
  teamFinalBalance,
  teamNotes,
}) {
  return (
    <div className="print-area">
      <div style={{ display: 'block' }}>
        <div style={{ ...printCardStyle, marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div className="page-kicker" style={{ marginBottom: 6 }}>Riepilogo squadra</div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{selectedTeam.name}</div>
              <div style={{ color: '#667085', marginTop: 6 }}>Periodo selezionato: {teamPeriodLabel}</div>
            </div>

            <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(3, minmax(120px, 1fr))' }}>
              <SummaryMiniCard label="Componenti" value={String(teamRows.length)} />
              <SummaryMiniCard label="Ore squadra" value={formatHoursValue(teamTotals.totalHours, hoursFormat)} />
              <SummaryMiniCard label="Compenso stimato" value={formatCurrency(teamTotals.totalCompensation)} />
            </div>
          </div>

          {selectedTeam.notes ? <div className="muted-box" style={{ marginTop: 12 }}>{selectedTeam.notes}</div> : null}
          {teamNotes ? <div className="muted-box" style={{ marginTop: 12 }}>{teamNotes}</div> : null}
        </div>

        <div style={{ ...printCardStyle, marginBottom: 14 }}>
          <div style={printSectionTitleStyle}>Riepilogo generale squadra</div>
          <div style={statsGridStyle}>
            <MetricCard label="Totale ore periodo" value={formatHoursValue(teamTotals.totalHours, hoursFormat)} />
            <MetricCard label="Giornate registrate" value={String(teamTotals.totalWorkedDays)} />
            <MetricCard label="Compenso stimato" value={formatCurrency(teamTotals.totalCompensation)} />
            <MetricCard label="Acconti squadra" value={formatCurrency(teamAdvancesTotal)} />
            <MetricCard label="Trasporto squadra" value={teamTransportEnabled ? formatCurrency(teamTransportTotal) : '—'} />
            <MetricCard label="Saldo finale squadra" value={formatCurrency(teamFinalBalance)} strong />
          </div>
        </div>

        <div style={{ ...printCardStyle, marginBottom: 14 }}>
          <div style={printSectionTitleStyle}>Dettaglio economico squadra</div>
          <table style={printTableStyle}>
            <tbody>
              <tr>
                <td style={tdLabel}>Compenso stimato squadra</td>
                <td style={tdCenter}>{formatCurrency(teamTotals.totalCompensation)}</td>
              </tr>
              <tr>
                <td style={tdLabel}>Trasporto squadra</td>
                <td style={tdCenter}>
                  {teamTransportEnabled ? `${formatCurrency(teamTransportTotal)}${teamTransportDescription ? ` • ${teamTransportDescription}` : ''}` : '—'}
                </td>
              </tr>
              <tr>
                <td style={tdLabel}>Acconti squadra</td>
                <td style={tdCenter}>{filteredTeamAdvances.length ? formatCurrency(teamAdvancesTotal) : '-'}</td>
              </tr>
              <tr>
                <td style={{ ...tdLabel, fontWeight: 800 }}>Saldo finale</td>
                <td style={{ ...tdCenter, fontWeight: 800 }}>{formatCurrency(teamFinalBalance)}</td>
              </tr>
            </tbody>
          </table>

          {filteredTeamAdvances.length ? (
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
              {filteredTeamAdvances.map((advance) => (
                <div key={advance.id} style={summaryRow}>
                  <span style={{ width: 220, fontWeight: 700 }}>
                    Acconto squadra{advance.date ? ` del ${advance.date}` : ''}
                  </span>
                  <span style={{ flex: 1, color: '#667085' }}>{advance.description || 'Nessuna descrizione'}</span>
                  <span style={{ fontWeight: 800 }}>{formatCurrency(advance.amount)}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div style={{ ...printCardStyle, marginBottom: 14 }}>
          <div style={printSectionTitleStyle}>Presenze componenti nel periodo</div>
          <table style={{ ...printTableStyle, fontSize: 9 }}>
            <thead>
              <tr>
                <th style={thLeft}>Componente</th>
                {teamPeriodDays.map((day) => (
                  <th key={formatLocalDate(day)} style={thCenter}>{day.getDate()}</th>
                ))}
                <th style={thCenter}>Ore</th>
                <th style={thCenter}>Riepilogo</th>
                <th style={thCenter}>Compenso stimato</th>
              </tr>
            </thead>
            <tbody>
              {teamRows.map((row) => {
                const attendanceMap = Object.fromEntries(row.records.map((record) => [record.date, record]));
                return (
                  <tr key={row.member.employee_id}>
                    <td style={tdLeftCompact}>
                      <div style={{ fontWeight: 700 }}>
                        {row.member.employee.first_name} {row.member.employee.last_name}
                      </div>
                      <div style={{ color: '#6b7280' }}>
                        {row.member.employee.role || '-'}
                        {row.member.manage_by_days ? ' - gestione a giornate' : ''}
                      </div>
                    </td>
                    {teamPeriodDays.map((day) => (
                      <td key={formatLocalDate(day)} style={tdCenter}>
                        {getReportCellValue(attendanceMap[formatLocalDate(day)], hoursFormat)}
                      </td>
                    ))}
                    <td style={tdCenter}>{formatHoursValue(row.totals.totalHours, hoursFormat)}</td>
                    <td style={tdCenter}>{formatWorkedSummary(row.totals.totalHours, row.member.employee.standard_hours, hoursFormat)}</td>
                    <td style={tdCenter}>{formatCurrency(row.estimatedCompensation)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={printCardStyle}>
          <div style={printSectionTitleStyle}>Dettaglio componenti e busta paga individuale</div>
          <div style={{ display: 'block' }}>
            {teamRows.map((row) => (
              <div key={`component-sheet-${row.member.employee_id}`} style={{ ...memberSheetStyle, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>
                      {row.member.employee.first_name} {row.member.employee.last_name}
                    </div>
                    <div style={{ color: '#667085', marginTop: 4 }}>
                      {row.member.employee.role || 'Nessuna mansione'} - Periodo {teamPeriodLabel}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gap: 6, minWidth: 240 }}>
                    <SummaryLine label="Ore totali" value={formatHoursValue(row.totals.totalHours, hoursFormat)} />
                    <SummaryLine label="Giornate / residui" value={formatWorkedSummary(row.totals.totalHours, row.member.employee.standard_hours, hoursFormat)} />
                    <SummaryLine label="Compenso stimato" value={formatCurrency(row.estimatedCompensation)} />
                    <SummaryLine label="Acconti personali" value={row.personalAdvancesTotal ? formatCurrency(row.personalAdvancesTotal) : '—'} />
                    <SummaryLine label="Saldo individuale" value={formatCurrency(row.individualNet)} strong />
                  </div>
                </div>

                <table style={{ ...printTableStyle, marginTop: 12 }}>
                  <tbody>
                    <tr>
                      <td style={tdLabel}>Presenze del periodo</td>
                      <td style={tdCenter}>{row.workedDays}</td>
                    </tr>
                    <tr>
                      <td style={tdLabel}>Ore lavorate</td>
                      <td style={tdCenter}>{formatHoursValue(row.totals.totalHours, hoursFormat)}</td>
                    </tr>
                    <tr>
                      <td style={tdLabel}>Giornate calcolate</td>
                      <td style={tdCenter}>{row.totals.completeDaysTotal}</td>
                    </tr>
                    <tr>
                      <td style={tdLabel}>Ore residue</td>
                      <td style={tdCenter}>{formatHoursValue(row.totals.remainingTotalHours, hoursFormat)}</td>
                    </tr>
                    <tr>
                      <td style={tdLabel}>Compenso / giornata</td>
                      <td style={tdCenter}>{formatCurrency(row.compensationRate)}</td>
                    </tr>
                  </tbody>
                </table>

                {row.personalAdvances.length ? (
                  <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 800 }}>Acconti personali registrati nel periodo</div>
                    {row.personalAdvances.map((advance, index) => (
                      <div key={`personal-advance-${row.member.employee_id}-${index}`} style={summaryRow}>
                        <span style={{ width: 220, fontWeight: 700 }}>
                          {advance.date ? `Acconto del ${advance.date}` : `Acconto mese ${advance.sourceMonth}`}
                        </span>
                        <span style={{ flex: 1, color: '#667085' }}>Registrato nello storico personale</span>
                        <span style={{ fontWeight: 800 }}>{formatCurrency(advance.amount)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ marginTop: 12, color: '#667085' }}>
                    Nessun acconto personale registrato nel periodo selezionato.
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, strong }) {
  return (
    <div style={metricCardStyle}>
      <div style={{ fontSize: 11, color: '#667085', textTransform: 'uppercase', fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: strong ? 26 : 22, fontWeight: 800, marginTop: 6 }}>{value}</div>
    </div>
  );
}

function SummaryMiniCard({ label, value }) {
  return (
    <div style={summaryMiniCardStyle}>
      <div style={{ fontSize: 11, color: '#667085', textTransform: 'uppercase', fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 800, marginTop: 4 }}>{value}</div>
    </div>
  );
}

function SummaryLine({ label, detail, value, strong, color, subtle }) {
  return (
    <div style={{ ...summaryRow, color: color || (subtle ? '#6b7280' : '#111827'), fontStyle: subtle ? 'italic' : 'normal' }}>
      <span style={{ width: 220, fontWeight: strong ? 800 : 700 }}>{label}</span>
      <span style={{ flex: detail ? 1 : 0 }}>{detail || ''}</span>
      <span style={{ marginLeft: 'auto', fontWeight: strong ? 800 : 700 }}>{value}</span>
    </div>
  );
}

const payslipSupportBoxStyle = {
  display: 'grid',
  gap: 12,
  padding: 14,
  borderRadius: 12,
  border: '1px solid rgba(22, 101, 52, 0.16)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,253,244,0.72))',
};

const payslipSupportHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'center',
};

const payslipSupportValueStyle = {
  fontSize: 24,
  fontWeight: 800,
  color: '#14532d',
};

const payslipTooltipStyle = {
  display: 'grid',
  gap: 6,
  padding: 12,
  borderRadius: 10,
  border: '1px solid rgba(31, 41, 55, 0.08)',
  background: '#fff',
};

const payslipCalculatorGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
  gap: 12,
};

const payslipOutputGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 10,
};

const payslipDecisionGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10,
};

function getPayslipOptionCardStyle(isSelected, isPreferred) {
  return {
    display: 'grid',
    gap: 7,
    textAlign: 'left',
    padding: 11,
    borderRadius: 12,
    border: isSelected
      ? '2px solid #111827'
      : isPreferred
      ? '1px solid rgba(22, 101, 52, 0.22)'
      : '1px solid rgba(31, 41, 55, 0.08)',
    background: isSelected
      ? 'linear-gradient(180deg, rgba(243, 244, 246, 0.98), rgba(229, 231, 235, 0.95))'
      : isPreferred
      ? 'linear-gradient(180deg, rgba(255,255,255,0.98), rgba(240,253,244,0.65))'
      : '#fff',
    boxShadow: isSelected ? '0 8px 18px rgba(17, 24, 39, 0.1)' : 'none',
    alignContent: 'start',
    minWidth: 0,
  };
}

function getPayslipDecisionTone(type) {
  if (type === 'give') {
    return {
      color: '#b91c1c',
      amountColor: '#991b1b',
      background: 'rgba(239, 68, 68, 0.08)',
    };
  }

  if (type === 'receive') {
    return {
      color: '#166534',
      amountColor: '#14532d',
      background: 'rgba(34, 197, 94, 0.08)',
    };
  }

  return {
    color: '#4b5563',
    amountColor: '#374151',
    background: 'rgba(107, 114, 128, 0.08)',
  };
}

const payslipDecisionTitleStyle = {
  fontSize: 11,
  fontWeight: 800,
  color: '#475467',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const payslipDecisionTopRowStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 10,
  flexWrap: 'wrap',
};

const payslipDecisionDaysStyle = {
  fontSize: 20,
  fontWeight: 800,
  color: '#111827',
  lineHeight: 1.1,
};

const payslipDecisionMetricsRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 8,
};

const payslipDecisionMetricStyle = {
  display: 'grid',
  gap: 2,
  padding: '7px 8px',
  borderRadius: 10,
  background: 'rgba(248, 250, 252, 0.95)',
  border: '1px solid rgba(31, 41, 55, 0.06)',
  minWidth: 0,
};

const payslipDecisionMetricLabelStyle = {
  fontSize: 11,
  color: '#667085',
  fontWeight: 700,
};

const payslipDecisionMetricValueStyle = {
  fontSize: 13,
  color: '#111827',
  fontWeight: 800,
};

const payslipDecisionInputRowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
};

const payslipDecisionInlineLabelStyle = {
  fontSize: 12,
  fontWeight: 700,
  color: '#374151',
};

const payslipDecisionHintStyle = {
  fontSize: 12,
  fontWeight: 800,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
  padding: '8px 10px',
  borderRadius: 10,
};

const payslipDecisionHintAmountStyle = {
  fontSize: 14,
  fontWeight: 900,
  whiteSpace: 'nowrap',
};

const fieldStyle = {
  width: '100%',
  padding: 10,
  border: '1px solid rgba(31, 41, 55, 0.12)',
  borderRadius: 8,
  background: 'rgba(255, 255, 255, 0.92)',
  color: '#000',
};

const payslipCompactInputStyle = {
  ...fieldStyle,
  width: 92,
  minWidth: 92,
  padding: '8px 10px',
  textAlign: 'right',
};

const readonlyBoxStyle = {
  width: '100%',
  padding: 10,
  border: '1px solid rgba(31, 41, 55, 0.12)',
  borderRadius: 8,
  background: 'rgba(244, 248, 243, 0.92)',
  fontWeight: 700,
  color: '#000',
};

const editorBlockStyle = {
  gridColumn: '1 / -1',
  display: 'grid',
  gap: 12,
  padding: 14,
  borderRadius: 14,
  border: '1px solid rgba(31, 41, 55, 0.08)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(244, 248, 243, 0.94) 100%)',
  boxShadow: '0 8px 24px rgba(31, 41, 55, 0.05)',
};

const editorBlockTitleStyle = {
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: '0.02em',
  textTransform: 'uppercase',
  color: '#1f2937',
};

const editorBlockGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 14,
  alignItems: 'start',
};

const fieldLabelStyle = {
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
  color: '#000',
};

const fieldSubtleStyle = {
  fontSize: 12,
  color: '#64748b',
};

const reportWarningStyle = {
  gridColumn: '1 / -1',
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid rgba(217, 119, 6, 0.28)',
  background: 'rgba(245, 158, 11, 0.12)',
  color: '#000',
  fontWeight: 700,
};

function previousBalanceBadgeStyle(amount) {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '5px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    border: '1px solid rgba(31, 41, 55, 0.12)',
    background: Number(amount || 0) > 0 ? 'rgba(22, 163, 74, 0.12)' : 'rgba(239, 68, 68, 0.12)',
    color: '#000',
  };
}

function getBalanceBoxStyle(value) {
  return {
    padding: 10,
    borderRadius: 8,
    fontWeight: 700,
    border: '1px solid rgba(31, 41, 55, 0.12)',
    background: value > 0 ? 'rgba(239, 68, 68, 0.1)' : value < 0 ? 'rgba(22, 163, 74, 0.12)' : 'rgba(244, 248, 243, 0.92)',
    color: '#000',
  };
}

const emptyBoxStyle = {
  border: '1px solid rgba(31, 41, 55, 0.08)',
  borderRadius: 12,
  padding: 30,
  textAlign: 'center',
  background: 'rgba(255, 255, 255, 0.96)',
  color: '#64748b',
};

const sectionToolbarStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'flex-start',
  marginBottom: 8,
  flexWrap: 'wrap',
};

const advanceRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(160px, 180px) minmax(220px, 1.2fr) auto',
  gap: 12,
  alignItems: 'end',
  padding: 12,
  border: '1px solid rgba(31, 41, 55, 0.08)',
  borderRadius: 10,
  background: 'rgba(255, 255, 255, 0.96)',
};

const teamAdvanceRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(150px, 170px) minmax(220px, 1.2fr) auto',
  gap: 12,
  alignItems: 'end',
  padding: 12,
  border: '1px solid rgba(31, 41, 55, 0.08)',
  borderRadius: 10,
  background: 'rgba(255, 255, 255, 0.96)',
};

const checkboxLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 12,
  fontWeight: 700,
};

const teamEditorStyle = {
  display: 'grid',
  gap: 14,
};

const teamEditorHeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
  padding: 18,
  borderRadius: 12,
  border: '1px solid rgba(31, 41, 55, 0.08)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(244, 248, 243, 0.94))',
};

const teamEditorGridStyle = {
  display: 'grid',
  gap: 14,
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
};

const modalBackdropStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  background: 'rgba(15, 23, 42, 0.42)',
};

const modalCardStyle = {
  width: 'min(720px, 96vw)',
  maxHeight: '90vh',
  overflow: 'auto',
  padding: 18,
  borderRadius: 12,
  background: '#fff',
  boxShadow: '0 24px 60px rgba(15, 23, 42, 0.22)',
};

const importMovementRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr)',
  gap: 10,
  alignItems: 'center',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(31, 41, 55, 0.1)',
  background: '#f8fafc',
  cursor: 'pointer',
};

const teamEditorCardStyle = {
  display: 'grid',
  gap: 12,
  padding: 18,
  borderRadius: 12,
  border: '1px solid rgba(31, 41, 55, 0.08)',
  background: 'rgba(255, 255, 255, 0.96)',
};

const editorSectionTitleStyle = {
  fontSize: 14,
  fontWeight: 800,
};

const printCardStyle = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  padding: 16,
  background: '#fff',
  position: 'relative',
  width: '100%',
  maxWidth: '200mm',
  margin: '0 auto',
  overflow: 'hidden',
  breakInside: 'avoid',
  pageBreakInside: 'avoid',
};

const printSectionTitleStyle = {
  fontSize: 16,
  fontWeight: 800,
  marginBottom: 12,
};

const printSideStampStyle = (isPaid) => ({
  position: 'absolute',
  right: 10,
  top: 10,
  transform: 'none',
  writingMode: 'horizontal-tb',
  fontSize: 8,
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: isPaid ? '#065f46' : '#991b1b',
  border: `1px solid ${isPaid ? 'rgba(5, 150, 105, 0.3)' : 'rgba(220, 38, 38, 0.3)'}`,
  background: isPaid ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
  padding: '4px 8px',
  borderRadius: 999,
});

const printIdentityRowStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  marginBottom: 6,
};

const printIdentityValueStyle = {
  fontSize: 14,
  fontWeight: 700,
  borderBottom: '1px solid #111827',
  paddingBottom: 2,
  minWidth: 160,
};

const printGridHeadStyle = {
  display: 'grid',
  gridTemplateColumns: '90px 90px',
  gap: 12,
};

const smallMutedStyle = {
  fontSize: 10,
  color: '#6b7280',
};

const bigValueStyle = {
  fontSize: 22,
  fontWeight: 800,
};

const printTableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  marginBottom: 4,
  fontSize: 10,
};

const printSummaryGridStyle = {
  display: 'grid',
  gap: 4,
  fontSize: 10,
  borderTop: '1px solid #d1d5db',
  paddingTop: 6,
};

const statsGridStyle = {
  display: 'grid',
  gap: 12,
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
};

const metricCardStyle = {
  padding: 14,
  borderRadius: 14,
  border: '1px solid rgba(31, 41, 55, 0.08)',
  background: 'rgba(244, 248, 243, 0.92)',
};

const summaryMiniCardStyle = {
  padding: 12,
  borderRadius: 14,
  border: '1px solid rgba(31, 41, 55, 0.08)',
  background: 'rgba(244, 248, 243, 0.86)',
};

const memberSheetStyle = {
  display: 'grid',
  gap: 12,
  padding: 16,
  borderRadius: 14,
  border: '1px solid rgba(31, 41, 55, 0.08)',
  background: 'rgba(252, 253, 252, 0.98)',
  breakInside: 'avoid',
  pageBreakInside: 'avoid',
};

const thLeft = {
  border: '1px solid #9ca3af',
  padding: 4,
  textAlign: 'left',
  width: 110,
};

const thCenter = {
  border: '1px solid #9ca3af',
  padding: 4,
  textAlign: 'center',
};

const tdRight = {
  border: '1px solid #9ca3af',
  padding: 3,
  textAlign: 'right',
  fontWeight: 600,
};

const tdCenter = {
  border: '1px solid #9ca3af',
  padding: 3,
  textAlign: 'center',
};

const tdLabel = {
  border: '1px solid #9ca3af',
  padding: 4,
  fontWeight: 600,
  width: 150,
};

const tdLeftCompact = {
  border: '1px solid #9ca3af',
  padding: 4,
  textAlign: 'left',
  minWidth: 180,
};

const summaryRow = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 10,
};

const summaryGroupTitleStyle = {
  marginTop: 4,
  paddingTop: 8,
  borderTop: '1px solid #d1d5db',
  fontSize: 9,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#667085',
};

const employeePrintHeaderStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)',
  gap: 12,
  alignItems: 'start',
  marginBottom: 10,
};

const employeePrintNameStyle = {
  fontSize: 18,
  fontWeight: 800,
  color: '#111827',
  lineHeight: 1.25,
};

const employeePrintIdentityGridStyle = {
  display: 'grid',
  gap: 8,
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
};

const employeeMiniMetricCardStyle = {
  padding: 10,
  borderRadius: 12,
  border: '1px solid rgba(31, 41, 55, 0.08)',
  background: 'rgba(244, 248, 243, 0.9)',
};

const employeePrintSheetStyle = {
  ...printCardStyle,
  width: '100%',
  maxWidth: '206mm',
  padding: '20px 18px 14px',
  borderRadius: 0,
  border: 'none',
  background: '#ffffff',
  boxShadow: 'none',
  overflow: 'visible',
};

const employeePrintBodyGridStyle = {
  display: 'grid',
  gap: 10,
  gridTemplateColumns: '1fr',
};

const employeePrintSectionCardStyle = {
  border: '1px solid rgba(31, 41, 55, 0.08)',
  borderRadius: 12,
  padding: 10,
  background: 'rgba(255, 255, 255, 0.98)',
  breakInside: 'avoid',
  pageBreakInside: 'avoid',
};

const employeePrintSectionTitleStyle = {
  fontSize: 12,
  fontWeight: 800,
  marginBottom: 8,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#475467',
};

const employeePrintSummaryGridStyle = {
  display: 'grid',
  gap: 6,
  fontSize: 9.5,
};

const attendanceWeeksStackStyle = {
  display: 'grid',
  gap: 6,
  marginBottom: 6,
};

const attendanceWeekCardStyle = {
  display: 'grid',
  gap: 4,
};

const attendanceWeekTitleStyle = {
  fontSize: 8.5,
  fontWeight: 800,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  color: '#667085',
};

const compactLegendCellStyle = {
  border: '1px solid #9ca3af',
  padding: 4,
  fontWeight: 700,
  textAlign: 'left',
  width: 56,
  background: '#f8fafc',
};

const compactHeaderCellStyle = {
  border: '1px solid #9ca3af',
  padding: 3,
  textAlign: 'center',
  fontWeight: 700,
};

const compactValueCellStyle = {
  border: '1px solid #9ca3af',
  padding: 3,
  textAlign: 'center',
  fontWeight: 600,
};

const tdLabelCompact = {
  border: '1px solid #9ca3af',
  padding: 4,
  fontWeight: 600,
  width: 110,
  background: '#f8fafc',
};

const tdCenterCompact = {
  border: '1px solid #9ca3af',
  padding: 4,
  textAlign: 'center',
};

const rp2SectionBoxStyle = {
  border: '1.25px solid #1f2937',
  borderRadius: 12,
  padding: 16,
  background: '#fff',
  marginTop: 14,
};
const rp2SectionLabelStyle = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#111827',
  marginBottom: 12,
};
const rp2HeaderStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  marginBottom: 18,
};
const rp2NameStyle = { fontSize: 28, fontWeight: 800, color: '#111827', lineHeight: 1.05 };
const rp2SubtitleStyle = { fontSize: 13.5, color: '#111827', marginTop: 6, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em' };
const rp2BadgeStyle = (isPaid) => ({
  fontSize: 11,
  fontWeight: 800,
  padding: '8px 14px',
  borderRadius: 999,
  background: isPaid ? '#ffffff' : '#f8fafc',
  color: isPaid ? '#14532d' : '#7f1d1d',
  border: `1.5px solid ${isPaid ? '#14532d' : '#7f1d1d'}`,
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
});
const rp2SummaryRowStyle = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 14 };
const rp2SummaryCardStyle = {
  border: '1.25px solid #1f2937',
  borderRadius: 10,
  padding: '14px 16px',
  background: '#ffffff',
};
const rp2CardLabelStyle = { fontSize: 11, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
const rp2CardValueStyle = { fontSize: 24, fontWeight: 800, color: '#111827', lineHeight: 1.1 };
const rp2CardSubStyle = { fontSize: 11, color: '#111827', marginTop: 6 };
const rp2TariffRowStyle = { display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 4 };
const rp2TariffPillStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderRadius: 999,
  border: '1.25px solid #1f2937',
  background: '#ffffff',
  fontSize: 12,
};
const rp2TariffLabelStyle = { color: '#111827' };
const rp2WeekBlockStyle = { display: 'grid', gap: 2, marginTop: 4 };
const rp2WeekLabelStyle = { fontSize: 10, fontWeight: 800, color: '#111827', textTransform: 'uppercase', letterSpacing: '0.08em' };
const rp2WeekGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 3 };
const rp2DayCellStyle = (isSunday, hasRealPresence = false) => ({
  border: hasRealPresence ? '1.75px solid #000' : '1px solid #9ca3af',
  borderRadius: 6,
  padding: '3px 3px',
  textAlign: 'center',
  background: hasRealPresence ? '#fff' : isSunday ? '#fafafa' : '#fff',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'stretch',
  gap: 1,
});
const rp2DayHeaderTopStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 0,
  minHeight: 24,
};
const rp2DayHeaderLabelStyle = { fontSize: 9, lineHeight: 1.1, color: '#111827', fontWeight: 700, textTransform: 'uppercase', whiteSpace: 'nowrap' };
const rp2DayHeaderNumberStyle = { fontSize: 12.5, lineHeight: 1.1, color: '#111827', fontWeight: 800 };
const rp2DayIndicatorStyle = (tone, markerColor) => {
  const palette =
    tone === 'worked'
      ? { background: '#ffffff', color: '#000000', border: '#000000', borderWidth: 2.25 }
      : tone === 'special'
      ? { background: '#ffffff', color: '#111827', border: '#374151', borderWidth: 1.25 }
      : tone === 'neutral'
      ? { background: '#fff', color: '#9ca3af', border: '#d1d5db', borderWidth: 1 }
      : { background: '#fff', color: '#9ca3af', border: '#d1d5db', borderWidth: 1 };
  return {
    width: 24,
    height: 24,
    borderRadius: 999,
    display: 'grid',
    placeItems: 'center',
    fontSize: 11.5,
    fontWeight: 800,
    background: palette.background,
    color: palette.color,
    border: `${palette.borderWidth}px solid ${palette.border}`,
  };
};
const rp2IndicatorDotStyle = (tone) => ({
  width: tone === 'empty' ? 3 : 4,
  height: tone === 'empty' ? 3 : 4,
  borderRadius: 999,
  background: tone === 'empty' ? '#d1d5db' : '#9ca3af',
  display: 'block',
});
const rp2DayDetailStyle = (active) => ({
  fontSize: 8,
  color: active ? '#1f2937' : '#9ca3af',
  fontWeight: active ? 700 : 600,
  lineHeight: 1.1,
  minHeight: 10,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  textAlign: 'center',
});
const rp2DayMetaAccentStyle = { fontSize: 9.5, color: '#000', fontWeight: 900, lineHeight: 1.1, minHeight: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', textAlign: 'center' };
const rp2DayMetaStyle = (markerColor) => ({ fontSize: 10, color: markerColor || '#111827', fontWeight: 800, lineHeight: 1.1, minHeight: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', textAlign: 'center' });
const rp2DayMetaMutedStyle = { fontSize: 8, color: '#9ca3af', lineHeight: 1.1, minHeight: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', textAlign: 'center' };
const rp2AttendanceLegendStyle = { display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 12, fontSize: 11.5, color: '#111827' };
const rp2LegendItemStyle = { display: 'inline-flex', alignItems: 'center', gap: 6 };
const rp2LegendDotStyle = (tone) => ({
  width: 10,
  height: 10,
  borderRadius: 999,
  background: tone === 'worked' ? '#111827' : tone === 'neutral' ? '#6b7280' : '#374151',
});
const rp2EconomicTableStyle = { display: 'grid', gap: 0 };
const rp2EconRowStyle = (strong = false) => ({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 14,
  padding: strong ? '12px 0 0' : '12px 0',
  borderTop: strong ? '1px solid rgba(31, 41, 55, 0.14)' : 'none',
  borderBottom: strong ? 'none' : '1px solid rgba(203, 213, 225, 0.92)',
});
const rp2EconLabelStyle = (strong = false) => ({ fontSize: strong ? 13 : 12, fontWeight: strong ? 800 : 700, color: '#111827' });
const rp2EconSubStyle = { fontSize: 11.5, color: '#1f2937', marginTop: 4, lineHeight: 1.35 };
const rp2EconAmountStyle = (tone = 'base', strong = false) => ({
  fontSize: strong ? 15 : 13,
  fontWeight: 800,
  color: '#111827',
  whiteSpace: 'nowrap',
  marginLeft: 'auto',
  flexShrink: 0,
});
const rp2CreditBoxStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  background: '#ffffff',
  border: '1.25px solid #14532d',
  borderRadius: 10,
  padding: '8px 11px',
  marginTop: 8,
  fontSize: 12,
  fontWeight: 800,
  color: '#14532d',
};
const rp2DeductionBoxStyle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  background: '#ffffff',
  border: '1.25px solid #7c2d12',
  borderRadius: 10,
  padding: '8px 11px',
  marginTop: 8,
  fontSize: 12,
  fontWeight: 800,
  color: '#9a3412',
};
const rp2ResultCardStyle = (value) => ({
  border: `1.5px solid ${value > 0 ? '#14532d' : value < 0 ? '#7c2d12' : '#1f2937'}`,
  borderRadius: 10,
  padding: '14px 16px',
  background: '#ffffff',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 14,
  marginTop: 12,
});
const rp2ResultLabelStyle = { fontSize: 14, fontWeight: 800, color: '#111827', marginBottom: 4 };
const rp2ResultFormulaStyle = { fontSize: 11.5, color: '#1f2937', lineHeight: 1.35 };
const rp2ResultValueStyle = (value) => ({
  fontSize: 28,
  fontWeight: 900,
  color: value > 0 ? '#166534' : value < 0 ? '#9a3412' : '#111827',
  lineHeight: 1,
  whiteSpace: 'nowrap',
  flexShrink: 0,
});
const rp2NoteStyle = {
  marginTop: 10,
  padding: '9px 11px',
  borderRadius: 10,
  background: '#ffffff',
  border: '1px solid #374151',
  fontSize: 11.5,
  color: '#1f2937',
  lineHeight: 1.5,
};
const rp2FooterStyle = {
  marginTop: 10,
  paddingTop: 8,
  borderTop: '1px solid rgba(31, 41, 55, 0.16)',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  fontSize: 11,
  color: '#111827',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  fontWeight: 700,
};
