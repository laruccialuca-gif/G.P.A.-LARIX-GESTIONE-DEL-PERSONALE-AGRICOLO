import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import DocumentActions from '../components/DocumentActions';
import { calculateAttendanceTotals, formatHoursValue, formatWorkedSummary, getSafeStandardHours } from '../utils/attendanceSummary';
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
    target_month: '',
    amount: '',
    note: '',
  };
}

function createEmptyDebtPlan() {
  return {
    id: null,
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

function normalizeCurrency(value) {
  return Number(value || 0);
}

function formatCurrency(value) {
  return `€ ${Number(value || 0).toFixed(2)}`;
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

export default function ReportPage() {
  const { selectedYear, setSelectedYear, yearOptions } = useYearContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentMonth, setCurrentMonth] = useState(() => new Date(selectedYear, new Date().getMonth(), 1));
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [settings, setSettings] = useState(null);
  const [selectedEntity, setSelectedEntity] = useState('');
  const [loading, setLoading] = useState(true);

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
  const [isEditUnlocked, setIsEditUnlocked] = useState(false);
  const [savedEconomicSnapshot, setSavedEconomicSnapshot] = useState(null);
  const [overtimeRateOverride, setOvertimeRateOverride] = useState('');
  const [showOvertimePanel, setShowOvertimePanel] = useState(false);

  const [teamPeriodStart, setTeamPeriodStart] = useState(formatLocalDate(startOfMonth(currentMonth)));
  const [teamPeriodEnd, setTeamPeriodEnd] = useState(formatLocalDate(endOfMonth(currentMonth)));
  const [teamTransportEnabled, setTeamTransportEnabled] = useState(false);
  const [teamTransportDescription, setTeamTransportDescription] = useState('');
  const [teamTransportAmount, setTeamTransportAmount] = useState('');
  const [teamAdvances, setTeamAdvances] = useState([createEmptyTeamAdvance()]);
  const [teamNotes, setTeamNotes] = useState('');
  const [teamPayrollMap, setTeamPayrollMap] = useState({});

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
  const employee = isEmployeeMode
    ? activeEmployees.find((item) => String(item.id) === String(selectedMeta.id))
    : null;
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

  const queryMonths = useMemo(() => {
    if (isTeamMode) {
      const rangeMonths = getMonthKeysInRange(teamPeriodStart, teamPeriodEnd);
      return rangeMonths.length ? rangeMonths : [{ year: currentMonth.getFullYear(), month: currentMonth.getMonth() + 1, key: monthString(currentMonth) }];
    }

    return [{ year: currentMonth.getFullYear(), month: currentMonth.getMonth() + 1, key: monthString(currentMonth) }];
  }, [isTeamMode, currentMonth, teamPeriodStart, teamPeriodEnd]);

  const queryMonthsKey = queryMonths.map((item) => item.key).join('|');

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

  async function loadData() {
    setLoading(true);
    try {
      const attendanceChunks = await Promise.all(
        queryMonths.map((entry) => window.api.attendance.listByMonth(entry.year, entry.month))
      );

      const [employeeData, teamData, settingsData] = await Promise.all([
        window.api.employees.list(),
        window.api.teams.list(),
        window.api.settings.get(),
      ]);

      setEmployees(employeeData || []);
      setTeams(teamData || []);
      setSettings(settingsData || null);
      setAttendance(attendanceChunks.flat());
    } catch (err) {
      console.error(err);
      alert('Errore caricamento report');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [queryMonthsKey]);

  useEffect(() => {
    async function loadPayrollContext() {
      if (!isEmployeeMode || !employee) {
        setDatore(defaultEmployerValue);
        setImportoBustaPaga('');
        setGiornateBustaPaga('');
        setAdvances([createEmptyAdvance()]);
        setRestoPrecedente('');
        setTrasportoAttivo(false);
        setNMacchineMese('');
        setPrezzoPerMacchina('');
        setNoteExtra('');
        setIsPagato(false);
        setRestoPaid(false);
        setRestoPaidDate('');
        setPayrollDocument(null);
        setGiftAmount('');
        setGiftLabel('');
        setDebtPlans([]);
        setCurrentPayrollRecord(null);
        setSavedEconomicSnapshot(null);
        setOvertimeRateOverride('');
        setShowOvertimePanel(false);
        return;
      }

      const currentMonthKey = monthString(currentMonth);

      try {
        const existing = await window.api.payroll.getRecord(employee.id, currentMonthKey);

        if (existing) {
          setCurrentPayrollRecord(existing);
          setDatore(existing.datore || defaultEmployerValue);
          setImportoBustaPaga(existing.importo_busta_paga ? String(existing.importo_busta_paga) : '');
          setGiornateBustaPaga(existing.giornate_busta_paga ? String(existing.giornate_busta_paga) : '');
          setAdvances(normalizeAdvances(existing.advances));
          setRestoPrecedente(existing.resto_precedente !== null && existing.resto_precedente !== undefined ? String(existing.resto_precedente) : '');
          const savedNMacchine = Number(existing.n_macchine_mese || 0);
          const savedPrezzo = Number(existing.prezzo_per_macchina || 0);
          const savedTrasporto = Number(existing.totale_trasporto || 0);
          setTrasportoAttivo(savedNMacchine > 0 || savedPrezzo > 0 || savedTrasporto > 0);
          setNMacchineMese(savedNMacchine ? String(savedNMacchine) : '');
          setPrezzoPerMacchina(savedPrezzo ? String(savedPrezzo) : '');
          setNoteExtra(existing.note || '');
          setIsPagato(!!existing.is_pagato);
          setRestoPaid(!!existing.resto_pagato);
          setRestoPaidDate(existing.resto_pagato_data || '');
          setPayrollDocument(existing.payroll_document || null);
          setGiftAmount(existing.regalo_importo ? String(existing.regalo_importo) : '');
          setGiftLabel(existing.regalo_descrizione || '');
          setDebtPlans(
            (existing.debt_plans || []).map((plan) => ({
              id: plan.id,
              label: plan.label || '',
              total_amount: String(plan.total_amount || ''),
              created_from_month: plan.created_from_month || currentMonthKey,
              installments: (plan.installments || []).length
                ? plan.installments.map((installment) => ({
                    id: installment.id,
                    target_month: installment.target_month || '',
                    amount: String(installment.amount || ''),
                    note: installment.note || '',
                  }))
                : [createEmptyDebtInstallment()],
            }))
          );
          setOvertimeRateOverride('');
          setSavedEconomicSnapshot(
            buildEconomicSnapshot({
              datore: existing.datore || defaultEmployerValue,
              importoBustaPaga: existing.importo_busta_paga ? String(existing.importo_busta_paga) : '',
              giornateBustaPaga: existing.giornate_busta_paga ? String(existing.giornate_busta_paga) : '',
              advances: normalizeAdvances(existing.advances),
              restoPrecedente: existing.resto_precedente !== null && existing.resto_precedente !== undefined ? String(existing.resto_precedente) : '',
              trasportoAttivo: savedNMacchine > 0 || savedPrezzo > 0 || savedTrasporto > 0,
              nMacchineMese: savedNMacchine ? String(savedNMacchine) : '',
              prezzoPerMacchina: savedPrezzo ? String(savedPrezzo) : '',
              noteExtra: existing.note || '',
              isPagato: !!existing.is_pagato,
              restoPaid: !!existing.resto_pagato,
              restoPaidDate: existing.resto_pagato_data || '',
              giftAmount: existing.regalo_importo ? String(existing.regalo_importo) : '',
              giftLabel: existing.regalo_descrizione || '',
              debtPlans: (existing.debt_plans || []).map((plan) => ({
                id: plan.id,
                label: plan.label || '',
                total_amount: String(plan.total_amount || ''),
                created_from_month: plan.created_from_month || currentMonthKey,
                installments: (plan.installments || []).map((installment) => ({
                  id: installment.id,
                  target_month: installment.target_month || '',
                  amount: String(installment.amount || ''),
                  note: installment.note || '',
                })),
              })),
            })
          );
          return;
        }

        const previous = await window.api.payroll.getPreviousBalance(employee.id, currentMonthKey);
        setDatore(defaultEmployerValue);
        setImportoBustaPaga('');
        setGiornateBustaPaga('');
        setAdvances([createEmptyAdvance()]);
        setRestoPrecedente(previous?.previousBalance !== null && previous?.previousBalance !== undefined ? String(previous.previousBalance) : '');
        setTrasportoAttivo(false);
        setNMacchineMese('');
        setPrezzoPerMacchina('');
        setNoteExtra('');
        setIsPagato(false);
        setRestoPaid(false);
        setRestoPaidDate('');
        setPayrollDocument(null);
        setGiftAmount('');
        setGiftLabel('');
        setDebtPlans([]);
        setCurrentPayrollRecord(null);
        setOvertimeRateOverride('');
        setSavedEconomicSnapshot(
          buildEconomicSnapshot({
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
            giftAmount: '',
            giftLabel: '',
            debtPlans: [],
          })
        );
      } catch (err) {
        console.error(err);
        alert('Errore caricamento saldo precedente');
      }
    }

    loadPayrollContext();
  }, [isEmployeeMode, employee, currentMonth, defaultEmployerValue]);

  useEffect(() => {
    async function loadTeamPayroll() {
      if (!isTeamMode || !selectedTeam) {
        setTeamPayrollMap({});
        return;
      }

      try {
        const rows = getTeamRows(selectedTeam, selectedYear);
        const records = await Promise.all(
          rows.map((row) => window.api.payroll.listByEmployee(row.employee_id))
        );

        const next = {};
        rows.forEach((row, index) => {
          next[row.employee_id] = records[index] || [];
        });
        setTeamPayrollMap(next);
      } catch (err) {
        console.error(err);
        setTeamPayrollMap({});
      }
    }

    loadTeamPayroll();
  }, [isTeamMode, selectedTeam, currentMonth, selectedYear]);

  function importPreviousBalance() {
    if (!employee) return;
    const currentMonthKey = monthString(currentMonth);

    window.api.payroll.getPreviousBalance(employee.id, currentMonthKey)
      .then((previous) => {
        if (!previous?.previousMonth || Number(previous?.previousBalance || 0) <= 0) {
          alert('Nessun resto da dare all’operaio da importare dai mesi precedenti.');
          return;
        }

        setRestoPrecedente(
          previous?.previousBalance !== null && previous?.previousBalance !== undefined
            ? String(previous.previousBalance)
            : ''
        );
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
      });
    } catch (err) {
      console.error(err);
      alert('Errore apertura PDF');
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

    if (isProcessedRecord && !isEditUnlocked && !options.silent) {
      alert('Questo report è già processato. Usa "Modifica report" per sbloccarlo.');
      return null;
    }

    const currentMonthKey = monthString(currentMonth);
    const employeeAttendance = attendance.filter((item) => String(item.employee_id) === String(employee.id));
    const employeeTotals = calculateAttendanceTotals(employeeAttendance, employee?.standard_hours);
    const workedDays = employeeTotals.completeDaysTotal;
    const dailyPay = Number(dailyPayInput || 0);
    const standardHours = getSafeStandardHours(employee?.standard_hours);
    const regularHourlyRate = standardHours > 0 ? dailyPay / standardHours : 0;
    const overtimeHourlyRate = overtimeRateOverride !== '' ? (Number(overtimeRateOverride) || 0) : getEffectiveOvertimeRate(employee, settings);
    const totalRegularPay = employeeTotals.totalRegularHours * regularHourlyRate;
    const totalOvertimePay = employeeTotals.totalOvertimeHours * overtimeHourlyRate;
    const totalCalculatedPay = totalRegularPay + totalOvertimePay;
    const normalizedAdvances = advances
      .map((advance, index) => ({
        id: advance.id || `advance-${index}`,
        amount: Number(advance.amount || 0),
        date: advance.date || '',
        includeInReport: !!advance.includeInReport,
      }))
      .filter((advance) => advance.amount > 0);
    const totalAdvances = normalizedAdvances.reduce((sum, advance) => sum + advance.amount, 0);
    const normalizedDebtPlansPayload = debtPlans
      .map((plan) => ({
        id: plan.id || null,
        label: plan.label || '',
        total_amount: Number(plan.total_amount || 0),
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
      .filter((plan) => plan.total_amount > 0 && plan.installments.length);
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
        },
        debt_plans: normalizedDebtPlansPayload,
        note: noteExtra,
      });

      setCurrentPayrollRecord(saved || null);
      setPayrollDocument(saved?.payroll_document || null);
      setRestoPaidDate(normalizedRestoPaidDate);
      setAdvances(normalizeAdvances(saved?.advances));
      setDebtPlans(
        (saved?.debt_plans || []).map((plan) => ({
          id: plan.id,
          label: plan.label || '',
          total_amount: String(plan.total_amount || ''),
          created_from_month: plan.created_from_month || currentMonthKey,
          installments: (plan.installments || []).length
            ? plan.installments.map((installment) => ({
                id: installment.id,
                target_month: installment.target_month || '',
                amount: String(installment.amount || ''),
                note: installment.note || '',
              }))
            : [createEmptyDebtInstallment()],
        }))
      );
      setIsEditUnlocked(false);
      setSavedEconomicSnapshot(
        buildEconomicSnapshot({
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
          restoPaidDate: normalizedRestoPaidDate,
          giftAmount,
          giftLabel,
          debtPlans,
        })
      );

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

    const confirmed = window.confirm('Confermi l’eliminazione della busta paga allegata?');
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
    setDebtPlans((current) => current.filter((_, currentIndex) => currentIndex !== index));
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
    setDebtPlans((current) =>
      current.map((plan, currentIndex) => {
        if (currentIndex !== planIndex) return plan;
        const nextInstallments = plan.installments.filter((_, currentInstallmentIndex) => currentInstallmentIndex !== installmentIndex);
        return {
          ...plan,
          installments: nextInstallments.length ? nextInstallments : [createEmptyDebtInstallment()],
        };
      })
    );
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

  const employeeAttendance = employee
    ? attendance.filter((item) => String(item.employee_id) === String(employee.id))
    : [];
  const attendanceBaseHours = getSafeStandardHours(settings?.general?.standard_day_hours);

  const attendanceMap = Object.fromEntries(employeeAttendance.map((item) => [item.date, item]));
  const employeeTotals = calculateAttendanceTotals(employeeAttendance, attendanceBaseHours);
  const hoursFormat = getHoursFormat(settings);
  const dailyPay = Number(dailyPayInput || 0);
  const standardHours = getSafeStandardHours(employee?.standard_hours);
  const regularHourlyRate = standardHours > 0 ? dailyPay / standardHours : 0;
  const overtimeHourlyRate = overtimeRateOverride !== '' ? (Number(overtimeRateOverride) || 0) : getEffectiveOvertimeRate(employee, settings);
  const overtimeView = getOvertimeViewSettings(settings);
  const workedDays = employeeTotals.completeDaysTotal;
  const totalRegularPay = employeeTotals.totalRegularHours * regularHourlyRate;
  const totalOvertimePay = employeeTotals.totalOvertimeHours * overtimeHourlyRate;
  const totalCalculatedPay = totalRegularPay + totalOvertimePay;
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
  const totalDebtResidual = normalizedDebtPlans.reduce((sum, plan) => {
    const paidInstallments = plan.installments
      .filter((installment) => installment.target_month < monthString(currentMonth))
      .reduce((acc, installment) => acc + installment.amount, 0);
    return sum + Math.max(plan.total_amount - paidInstallments - currentInstallmentTotal, 0);
  }, 0);
  const restoPrecedenteNum = parseFloat(restoPrecedente) || 0;
  const nMacchineMeseNum = trasportoAttivo ? parseFloat(nMacchineMese) || 0 : 0;
  const prezzoPerMacchinaNum = trasportoAttivo ? parseFloat(prezzoPerMacchina) || 0 : 0;
  const totaleTrasporto = nMacchineMeseNum * prezzoPerMacchinaNum;
  const giftAmountNum = parseFloat(giftAmount) || 0;
  const isProcessedRecord = !!currentPayrollRecord?.processed_at;
  const isEmployeeEditingDisabled = isProcessedRecord && !isEditUnlocked;
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
  });
  const hasUnsavedChanges =
    isEmployeeMode &&
    !!employee &&
    savedEconomicSnapshot !== null &&
    currentEconomicSnapshot !== savedEconomicSnapshot;

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

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
  const teamPeriodDays = getMonthDays(parseDateValue(safeTeamStart), parseDateValue(safeTeamEnd));
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

  const teamRows = getTeamRows(selectedTeam, selectedYear).map((member) => {
    const memberAttendance = attendance.filter(
      (item) =>
        String(item.employee_id) === String(member.employee_id) &&
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
  });

  const teamTransportTotal = teamTransportEnabled ? normalizeCurrency(teamTransportAmount) : 0;
  const teamAdvancesTotal = filteredTeamAdvances.reduce((sum, advance) => sum + advance.amount, 0);
  const teamTotals = teamRows.reduce(
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

          <select
            className="report-entity-select"
            value={selectedEntity}
            onChange={(event) => guardUnsavedChanges(() => setSelectedEntity(event.target.value))}
          >
            <option value="">Seleziona dipendente o squadra...</option>
            <optgroup label="Dipendenti">
              {activeEmployees.map((item) => (
                <option key={`employee-${item.id}`} value={`employee:${item.id}`}>
                  {item.first_name} {item.last_name}
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

      {isEmployeeMode && employee ? (
        <div className="no-print report-editor-panel">
          {isProcessedRecord ? (
            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="soft-chip" style={{ background: 'rgba(22, 163, 74, 0.14)', color: '#14532d', borderColor: 'rgba(22, 101, 52, 0.14)' }}>
                Report processato il {formatDisplayDateTime(currentPayrollRecord?.processed_at)}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {isEditUnlocked ? (
                  <div className="soft-chip" style={{ background: 'rgba(212, 160, 23, 0.16)', color: '#a16207', borderColor: 'rgba(212, 160, 23, 0.18)' }}>
                    Modalità modifica attiva
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <fieldset
            disabled={isEmployeeEditingDisabled}
            style={{ gridColumn: '1 / -1', display: 'contents', border: 'none', padding: 0, margin: 0 }}
          >
            <div style={editorBlockStyle}>
              <div style={editorBlockTitleStyle}>1. Busta paga</div>
              <div style={editorBlockGridStyle}>
                <div>
                  <div style={fieldLabelStyle}>Datore di lavoro</div>
                  <select value={datore} onChange={(e) => setDatore(e.target.value)} style={fieldStyle}>
                    {employerOptions.map((option) => (
                      <option key={option.short_name || option.value} value={option.short_name || option.value}>
                        {(option.short_name || option.value)}{option.name ? ` · ${option.name}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <div style={fieldLabelStyle}>Retribuzione giornaliera (€)</div>
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
                  <div style={fieldLabelStyle}>Importo busta paga (€)</div>
                  <input type="number" step="0.01" min="0" value={importoBustaPaga} onChange={(e) => setImportoBustaPaga(e.target.value)} placeholder="es. 800.00" style={fieldStyle} />
                </div>

                <div>
                  <div style={fieldLabelStyle}>Giornate in busta paga</div>
                  <input type="number" min="0" value={giornateBustaPaga} onChange={(e) => setGiornateBustaPaga(e.target.value)} placeholder="es. 11" style={fieldStyle} />
                </div>

                {overtimeView.enabled ? (
                  <>
                    <div>
                      <div style={fieldLabelStyle}>Straordinario</div>
                      <button
                        type="button"
                        className="button-secondary"
                        onClick={() => setShowOvertimePanel(!showOvertimePanel)}
                        style={{ fontSize: 12, padding: '6px 12px' }}
                      >
                        {showOvertimePanel ? 'Nascondi dettaglio ▲' : 'Mostra dettaglio ▼'}
                      </button>
                    </div>
                    {showOvertimePanel && (
                      <div style={{ gridColumn: '1 / -1', background: '#f8fbf7', border: '1px solid rgba(31, 41, 55, 0.08)', borderRadius: 8, padding: '10px 14px', display: 'grid', gap: 6 }}>
                        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12, color: '#374151' }}>
                          <span>
                            <span style={{ color: '#6b7280', fontWeight: 600 }}>Tariffa:</span>{' '}
                            <strong>{overtimeHourlyRate > 0 ? formatCurrency(overtimeHourlyRate) + ' / ora' : '—'}</strong>
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
                            <strong>{employeeTotals.totalOvertimeHours > 0 ? `${employeeTotals.totalOvertimeHours} h` : '—'}</strong>
                          </span>
                          <span>
                            <span style={{ color: '#6b7280', fontWeight: 600 }}>Totale straordinario:</span>{' '}
                            <strong style={{ color: totalOvertimePay > 0 ? '#1F2937' : '#374151' }}>
                              {totalOvertimePay > 0 ? formatCurrency(totalOvertimePay) : '—'}
                            </strong>
                          </span>
                        </div>
                      </div>
                    )}
                  </>
                ) : null}

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
              <div style={editorBlockTitleStyle}>2. Acconti, trasporto e regalo</div>
              <div style={sectionToolbarStyle}>
                <div style={fieldSubtleStyle}>Gestisci acconti del mese, trasporto e voce extra da mostrare in stampa.</div>
                <button type="button" className="button-secondary" onClick={addAdvance}>
                  Aggiungi acconto
                </button>
              </div>

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

              {advances.filter((advance) => Number(advance.amount || 0) > 0).length > 1 ? (
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
                      <div style={fieldLabelStyle}>Prezzo per macchina (€)</div>
                      <input type="number" step="0.01" min="0" value={prezzoPerMacchina} onChange={(e) => setPrezzoPerMacchina(e.target.value)} placeholder="es. 15.00" style={fieldStyle} />
                    </div>

                    <div>
                      <div style={fieldLabelStyle}>Totale trasporto (€)</div>
                      <div style={readonlyBoxStyle}>{formatCurrency(totaleTrasporto)}</div>
                    </div>
                  </>
                ) : null}

                <div>
                  <div style={fieldLabelStyle}>Regalo (€)</div>
                  <input type="number" step="0.01" min="0" value={giftAmount} onChange={(e) => setGiftAmount(e.target.value)} placeholder="Importo regalo" style={fieldStyle} />
                </div>

                <div>
                  <div style={fieldLabelStyle}>Etichetta in stampa</div>
                  <input value={giftLabel} onChange={(e) => setGiftLabel(e.target.value)} placeholder="Es. Premio Pasqua" style={fieldStyle} />
                </div>
              </div>
            </div>

            <div style={editorBlockStyle}>
              <div style={editorBlockTitleStyle}>3. Resto precedente</div>
              <div style={fieldSubtleStyle}>Importa il credito o debito non ancora chiuso dal mese precedente.</div>
              <div style={{ ...editorBlockGridStyle, marginTop: 10 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={fieldLabelStyle}>Resto precedente (€)</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input type="number" step="0.01" value={restoPrecedente} onChange={(e) => setRestoPrecedente(e.target.value)} placeholder="automatico dal mese precedente" style={fieldStyle} />
                    <button type="button" onClick={importPreviousBalance}>Importa</button>
                  </div>
                </div>
              </div>
            </div>

            <div style={editorBlockStyle}>
              <div style={sectionToolbarStyle}>
                <div>
                  <div style={editorBlockTitleStyle}>4. Rateizzazione debito</div>
                  <div style={fieldSubtleStyle}>Programma le trattenute future e tieni traccia delle rate mensili.</div>
                </div>
                <button type="button" className="button-secondary" onClick={addDebtPlan}>
                  Nuova rateizzazione
                </button>
              </div>

              {!debtPlans.length ? (
                <div style={{ color: '#667085', fontSize: 13 }}>Nessuna rateizzazione attiva.</div>
              ) : (
                <div style={{ display: 'grid', gap: 12 }}>
                  {debtPlans.map((plan, planIndex) => (
                    <div key={`debt-plan-${plan.id || planIndex}`} style={{ display: 'grid', gap: 10, padding: 12, borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff' }}>
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
                          <div key={`debt-installment-${planIndex}-${installmentIndex}`} style={{ display: 'grid', gap: 10, gridTemplateColumns: '140px 140px minmax(0, 1fr) auto', alignItems: 'center' }}>
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
              <div style={{ ...editorBlockGridStyle, alignItems: 'end' }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={getBalanceBoxStyle(differenzaFinale)}>
                    {differenzaFinale > 0
                      ? `Resto da dare all'operaio ${formatCurrency(differenzaFinale)}`
                      : differenzaFinale < 0
                      ? `Da restituire ${formatCurrency(Math.abs(differenzaFinale))}`
                      : 'Pareggio'}
                  </div>
                </div>

                {differenzaFinale > 0 ? (
                  <>
                    <div>
                      <div style={fieldLabelStyle}>Stato resto</div>
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
                      <div style={fieldLabelStyle}>Data pagamento resto</div>
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
                <span className="soft-chip" style={{ background: 'rgba(239, 68, 68, 0.12)', color: '#b91c1c', borderColor: 'rgba(185, 28, 28, 0.14)' }}>
                  Modifiche non salvate
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
                  onClick={() => setIsEditUnlocked(true)}
                  disabled={isEditUnlocked}
                >
                  Modifica
                </button>
              ) : null}
              <button type="button" className="button" onClick={() => handleSavePayrollRecord()}>
                Salva nel registro
              </button>
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
      ) : loading ? (
        <div>Caricamento...</div>
      ) : isEmployeeMode && employee ? (
        <EmployeePrintArea
          employee={employee}
          currentMonth={currentMonth}
          attendanceBaseHours={attendanceBaseHours}
          hoursFormat={hoursFormat}
          attendanceMap={attendanceMap}
          dayMarkers={settings?.general?.attendance_markers || []}
          employeeTotals={employeeTotals}
          dailyPay={dailyPay}
          overtimeHourlyRate={overtimeHourlyRate}
          overtimeView={overtimeView}
          workedDays={workedDays}
          totalRegularPay={totalRegularPay}
          totalOvertimePay={totalOvertimePay}
          totalCalculatedPay={totalCalculatedPay}
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

function WeekGrid({ week, attendanceMap, hoursFormat, dayMarkers }) {
  return (
    <div style={rp2WeekGridStyle}>
      {week.map((day, colIndex) => {
        const isSunday = colIndex === 6;
        if (!day) {
          return (
            <div key={colIndex} style={{ ...rp2DayCellStyle(isSunday), opacity: 0 }}>
              <div style={rp2DayHeaderStyle}>—</div>
              <div style={rp2DayValueEmptyStyle}>—</div>
            </div>
          );
        }
        const dateStr = formatLocalDate(day);
        const att = attendanceMap[dateStr];

        let specialCode = null;
        let normalHours = 0;
        let overtimeHours = 0;

        if (att) {
          if (att.entry_code) {
            specialCode = att.entry_code;
          } else if (att.status && att.status !== 'presente' && att.status !== 'assente') {
            specialCode = att.status.charAt(0).toUpperCase();
          } else {
            normalHours = Number(att.hours_worked || 0);
          }
          overtimeHours = Number(att.overtime_hours || 0);
        }

        const markerMeta = getMarkerMeta(att?.marker_code, dayMarkers);
        const hasHours = normalHours > 0 || overtimeHours > 0;
        const hasContent = specialCode !== null || hasHours || !!markerMeta;

        return (
          <div key={dateStr} style={rp2DayCellStyle(isSunday)}>
            <div style={rp2DayHeaderStyle}>{day.getDate()} {DAY_ABBR_SHORT[colIndex]}</div>
            {!hasContent ? (
              <div style={rp2DayValueEmptyStyle}>—</div>
            ) : (
              <>
                {specialCode !== null ? (
                  <div style={rp2DayValueActiveStyle}>{specialCode}</div>
                ) : normalHours > 0 ? (
                  <div style={rp2DayValueActiveStyle}>{normalHours}h</div>
                ) : null}
                {overtimeHours > 0 && (
                  <div style={rp2DayOvertimeStyle}>+{overtimeHours}h</div>
                )}
                {markerMeta && (
                  <div style={rp2DayMarkerStyle(markerMeta.color)}>
                    {markerMeta.symbol || markerMeta.text || markerMeta.value}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function EmployeePrintArea({
  employee,
  currentMonth,
  attendanceBaseHours,
  hoursFormat,
  attendanceMap,
  dayMarkers,
  employeeTotals,
  dailyPay,
  overtimeHourlyRate,
  overtimeView,
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
    differenzaFinale > 0 ? "Resto da dare all'operaio" : differenzaFinale < 0 ? 'Resto da dare al datore' : 'Pareggio';
  const payslipDaysNum = Number(giornateBustaPaga || 0);
  const payrollDifference = totalCalculatedPay - importoBustaPagaNum;
  const payrollDifferenceLabel =
    payrollDifference > 0 ? 'Credito da integrare' : payrollDifference < 0 ? 'Debito da integrare' : 'Allineato';
  const totalTrattenute = totalAdvances + currentInstallmentTotal;
  const hasDeductions = visibleAdvances.length > 0 || currentInstallments.length > 0;

  return (
    <div className="print-area employee-print-area">
      <div className="print-sheet employee-print-sheet" style={printCardStyle}>

        {/* 1. Header */}
        <div style={rp2HeaderStyle}>
          <div>
            <div style={rp2NameStyle}>{employee.first_name} {employee.last_name}</div>
            <div style={rp2SubtitleStyle}>{employee.role || 'Nessuna mansione'} · {monthName} {yearStr}</div>
          </div>
          <div style={rp2BadgeStyle(isPagato)}>{isPagato ? 'PAGATO' : 'NON PAGATO'}</div>
        </div>

        {/* 2. Three summary cards */}
        <div style={{ ...rp2SummaryRowStyle, marginTop: 8 }}>
          <div style={rp2SummaryCardStyle}>
            <div style={rp2CardLabelStyle}>Giorni lavorati</div>
            <div style={rp2CardValueStyle}>{workedDays}</div>
            <div style={rp2CardSubStyle}>Giornate registrate</div>
          </div>
          <div style={rp2SummaryCardStyle}>
            <div style={rp2CardLabelStyle}>Ore totali</div>
            <div style={rp2CardValueStyle}>{formatHoursValue(employeeTotals.totalHours, hoursFormat)}</div>
            <div style={rp2CardSubStyle}>{formatWorkedSummary(employeeTotals.totalHours, attendanceBaseHours, hoursFormat)}</div>
          </div>
          <div style={rp2SummaryCardStyle}>
            <div style={rp2CardLabelStyle}>Retribuzione</div>
            <div style={rp2CardValueStyle}>{formatCurrency(totalCalculatedPay)}</div>
            <div style={rp2CardSubStyle}>Calcolata dal gestionale</div>
          </div>
        </div>

        {/* 3. Weekly attendance grid */}
        <div className="print-block employee-print-section" style={{ ...rp2SectionBoxStyle, marginTop: 6 }}>
          <div style={rp2SectionLabelStyle}>Presenze del mese</div>
          {weekGroups.map((week, i) => (
            <div key={`week-group-${i}`}>
              <div style={rp2WeekLabelStyle}>Settimana {i + 1}</div>
              <WeekGrid week={week} attendanceMap={attendanceMap} hoursFormat={hoursFormat} dayMarkers={dayMarkers} />
            </div>
          ))}
          <div style={rp2TariffRowStyle}>
            <div>
              <span style={rp2TariffLabelStyle}>Tariffa giornaliera</span>
              <strong>{formatCurrency(dailyPay)}</strong>
            </div>
            <div>
              <span style={rp2TariffLabelStyle}>Tariffa straordinario</span>
              <strong>
                {overtimeView?.showHourlyRate
                  ? overtimeHourlyRate > 0 ? `${formatCurrency(overtimeHourlyRate)} / h` : '—'
                  : '—'}
              </strong>
            </div>
          </div>
        </div>

        {/* 4. Riepilogo economico */}
        <div className="print-block employee-print-section" style={{ ...rp2SectionBoxStyle, marginTop: 6 }}>
          <div style={rp2SectionLabelStyle}>Riepilogo economico</div>

          <div style={rp2EconRowStyle}>
            <div>
              <div style={rp2EconLabelStyle}>Retribuzione calcolata</div>
              <div style={rp2EconSubStyle}>
                {overtimeView?.displayMode === 'separate'
                  ? `${formatCurrency(totalRegularPay)} ordinario + ${formatCurrency(totalOvertimePay)} straordinario`
                  : `${workedDays} gg · ${formatHoursValue(employeeTotals.totalHours, hoursFormat)}`}
              </div>
            </div>
            <div style={rp2EconAmountStyle('#111827')}>{formatCurrency(totalCalculatedPay)}</div>
          </div>

          <div style={rp2EconRowStyle}>
            <div>
              <div style={rp2EconLabelStyle}>Busta paga</div>
              <div style={rp2EconSubStyle}>{payslipDaysNum ? `${payslipDaysNum} gg inserite` : 'Non inserita'}</div>
            </div>
            <div style={rp2EconAmountStyle('#111827')}>{importoBustaPagaNum > 0 ? formatCurrency(importoBustaPagaNum) : '—'}</div>
          </div>

          {restoPrecedenteNum !== 0 ? (
            <div style={rp2EconRowStyle}>
              <div style={rp2EconLabelStyle}>Resto mese precedente</div>
              <div style={rp2EconAmountStyle(restoPrecedenteNum > 0 ? '#059669' : '#dc2626')}>{formatCurrency(restoPrecedenteNum)}</div>
            </div>
          ) : null}

          {trasportoAttivo && totaleTrasporto !== 0 ? (
            <div style={rp2EconRowStyle}>
              <div>
                <div style={rp2EconLabelStyle}>Trasporto</div>
                <div style={rp2EconSubStyle}>{nMacchineMeseNum} macchine × {formatCurrency(prezzoPerMacchinaNum)}</div>
              </div>
              <div style={rp2EconAmountStyle('#059669')}>{formatCurrency(totaleTrasporto)}</div>
            </div>
          ) : null}

          {giftAmountNum !== 0 ? (
            <div style={rp2EconRowStyle}>
              <div style={rp2EconLabelStyle}>{giftLabel || 'Regalo / Extra'}</div>
              <div style={rp2EconAmountStyle('#059669')}>{formatCurrency(giftAmountNum)}</div>
            </div>
          ) : null}

          {importoBustaPagaNum > 0 ? (
            payrollDifference > 0 ? (
              <div style={rp2CreditBoxStyle}>
                <span>Credito da integrare</span>
                <span>{formatCurrency(payrollDifference)}</span>
              </div>
            ) : payrollDifference < 0 ? (
              <div style={rp2DeductionBoxStyle}>
                <span>Debito da integrare</span>
                <span>{formatCurrency(Math.abs(payrollDifference))}</span>
              </div>
            ) : null
          ) : (
            totalCalculatedPay > 0 ? (
              <div style={rp2CreditBoxStyle}>
                <span>Totale da riconoscere</span>
                <span>{formatCurrency(totalCalculatedPay)}</span>
              </div>
            ) : null
          )}
        </div>

        {/* 5. Trattenute e recuperi */}
        {hasDeductions ? (
          <div className="print-block employee-print-section" style={{ ...rp2SectionBoxStyle, marginTop: 6 }}>
            <div style={rp2SectionLabelStyle}>Trattenute e recuperi</div>
            {visibleAdvances.map((advance, index) => (
              <div key={`print-adv-${index}`} style={rp2EconRowStyle}>
                <div>
                  <div style={rp2EconLabelStyle}>Acconto {visibleAdvances.length > 1 ? index + 1 : ''}</div>
                  <div style={rp2EconSubStyle}>{advance.date ? `Data: ${formatDateLabel(advance.date)}` : 'Senza data'}</div>
                </div>
                <div style={rp2EconAmountStyle('#dc2626')}>{formatCurrency(advance.amount)}</div>
              </div>
            ))}
            {currentInstallments.map((installment, index) => (
              <div key={`print-inst-${index}`} style={rp2EconRowStyle}>
                <div>
                  <div style={rp2EconLabelStyle}>Rata {installment.installmentNumber}</div>
                  <div style={rp2EconSubStyle}>{installment.planLabel} · Residuo {formatCurrency(installment.residualAfterCurrent)}</div>
                </div>
                <div style={rp2EconAmountStyle('#dc2626')}>{formatCurrency(installment.amount)}</div>
              </div>
            ))}
            {totalTrattenute > 0 ? (
              <div style={rp2DeductionBoxStyle}>
                <span>Totale trattenute</span>
                <span>{formatCurrency(totalTrattenute)}</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 6. Risultato finale */}
        <div className="print-block employee-print-section" style={{ ...rp2ResultCardStyle, marginTop: 6 }}>
          <div>
            <div style={rp2ResultLabelStyle}>{mainBalanceLabel}</div>
            <div style={rp2ResultFormulaStyle}>
              {differenzaFinale > 0 && restoPaid && restoPaidDate
                ? `Pagato il ${formatDateLabel(restoPaidDate)}`
                : 'Retribuzione − busta paga − trattenute'}
            </div>
          </div>
          <div style={rp2ResultValueStyle(differenzaFinale)}>
            {differenzaFinale !== 0 ? formatCurrency(Math.abs(differenzaFinale)) : '—'}
          </div>
        </div>

        {/* 7. Note */}
        {noteExtra ? (
          <div style={{ ...rp2NoteStyle, marginTop: 8 }}>{noteExtra}</div>
        ) : null}
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
              {value || '—'}
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
      <div style={{ marginLeft: 'auto', fontWeight: strong ? 800 : 700, whiteSpace: 'nowrap' }}>{value || '—'}</div>
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
                  {teamTransportEnabled ? `${formatCurrency(teamTransportTotal)}${teamTransportDescription ? ` · ${teamTransportDescription}` : ''}` : '—'}
                </td>
              </tr>
              <tr>
                <td style={tdLabel}>Acconti squadra</td>
                <td style={tdCenter}>{filteredTeamAdvances.length ? formatCurrency(teamAdvancesTotal) : '—'}</td>
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
                        {row.member.employee.role || '—'}
                        {row.member.manage_by_days ? ' · gestione a giornate' : ''}
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
                      {row.member.employee.role || 'Nessuna mansione'} · Periodo {teamPeriodLabel}
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

const fieldStyle = {
  width: '100%',
  padding: 10,
  border: '1px solid rgba(31, 41, 55, 0.12)',
  borderRadius: 8,
  background: 'rgba(255, 255, 255, 0.92)',
};

const readonlyBoxStyle = {
  width: '100%',
  padding: 10,
  border: '1px solid rgba(31, 41, 55, 0.12)',
  borderRadius: 8,
  background: 'rgba(244, 248, 243, 0.92)',
  fontWeight: 700,
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
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 12,
};

const fieldLabelStyle = {
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
};

const fieldSubtleStyle = {
  fontSize: 12,
  color: '#64748b',
};

function getBalanceBoxStyle(value) {
  return {
    padding: 10,
    borderRadius: 8,
    fontWeight: 700,
    border: '1px solid rgba(31, 41, 55, 0.12)',
    background: value > 0 ? 'rgba(239, 68, 68, 0.1)' : value < 0 ? 'rgba(22, 163, 74, 0.12)' : 'rgba(244, 248, 243, 0.92)',
    color: value > 0 ? '#b91c1c' : value < 0 ? '#14532d' : '#334155',
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
  alignItems: 'center',
  marginBottom: 8,
};

const advanceRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(160px, 1fr) minmax(170px, 1fr) minmax(180px, 1fr) auto',
  gap: 10,
  padding: 12,
  border: '1px solid rgba(31, 41, 55, 0.08)',
  borderRadius: 10,
  background: 'rgba(255, 255, 255, 0.96)',
};

const teamAdvanceRowStyle = {
  display: 'grid',
  gridTemplateColumns: 'minmax(130px, 1fr) minmax(150px, 1fr) minmax(220px, 1.2fr) auto',
  gap: 10,
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

const rp2SectionBoxStyle = { border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, background: '#fff' };
const rp2SectionLabelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 6 };
const rp2HeaderStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' };
const rp2NameStyle = { fontSize: 22, fontWeight: 500, color: '#111827', lineHeight: 1.2 };
const rp2SubtitleStyle = { fontSize: 11, color: '#6b7280', marginTop: 3 };
const rp2BadgeStyle = (isPaid) => ({ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 4, background: isPaid ? '#059669' : '#dc2626', color: '#fff', letterSpacing: '0.05em', textTransform: 'uppercase', whiteSpace: 'nowrap' });
const rp2SummaryRowStyle = { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 };
const rp2SummaryCardStyle = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '7px 10px', background: '#fff' };
const rp2CardLabelStyle = { fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 };
const rp2CardValueStyle = { fontSize: 17, fontWeight: 500, color: '#111827', lineHeight: 1.2 };
const rp2CardSubStyle = { fontSize: 10, color: '#6b7280', marginTop: 2 };
const rp2WeekLabelStyle = { fontSize: 9, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 2, marginTop: 5 };
const rp2WeekGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 3 };
const rp2DayCellStyle = (isSunday) => ({ border: '1px solid #e5e7eb', borderRadius: 4, padding: '3px 2px', textAlign: 'center', background: isSunday ? '#f9fafb' : '#fff', minWidth: 0 });
const rp2DayHeaderStyle = { fontSize: 8, color: '#9ca3af', marginBottom: 2 };
const rp2DayValueActiveStyle = { fontSize: 10, fontWeight: 600, color: '#2563eb' };
const rp2DayValueEmptyStyle = { fontSize: 10, color: '#d1d5db' };
const rp2TariffRowStyle = { display: 'flex', gap: 20, marginTop: 6, fontSize: 10 };
const rp2TariffLabelStyle = { color: '#6b7280', marginRight: 4 };
const rp2EconRowStyle = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, padding: '3px 0', borderBottom: '1px solid #f3f4f6' };
const rp2EconLabelStyle = { fontSize: 10, fontWeight: 600, color: '#111827' };
const rp2EconSubStyle = { fontSize: 9, color: '#6b7280', marginTop: 2 };
const rp2EconAmountStyle = (color) => ({ fontSize: 11, fontWeight: 700, color: color || '#111827', whiteSpace: 'nowrap', marginLeft: 'auto', flexShrink: 0 });
const rp2CreditBoxStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '5px 8px', marginTop: 5, fontSize: 11, fontWeight: 700, color: '#1d4ed8' };
const rp2DeductionBoxStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '5px 8px', marginTop: 5, fontSize: 11, fontWeight: 700, color: '#dc2626' };
const rp2ResultCardStyle = { border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };
const rp2ResultLabelStyle = { fontSize: 11, fontWeight: 600, color: '#374151', marginBottom: 2 };
const rp2ResultFormulaStyle = { fontSize: 10, color: '#6b7280' };
const rp2ResultValueStyle = (diff) => ({ fontSize: 22, fontWeight: 700, color: diff > 0 ? '#1d4ed8' : diff < 0 ? '#dc2626' : '#111827', lineHeight: 1, whiteSpace: 'nowrap', flexShrink: 0 });
const rp2NoteStyle = { fontSize: 10, color: '#6b7280', fontStyle: 'italic', padding: '4px 0' };
const rp2DayOvertimeStyle = { fontSize: 9, fontWeight: 600, color: '#d97706', marginTop: 1 };
const rp2DayMarkerStyle = (color) => ({ fontSize: 9, marginTop: 1, color: color || '#6b7280' });
