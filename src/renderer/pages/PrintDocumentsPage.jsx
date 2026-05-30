import React, { useEffect, useMemo, useState } from 'react';
import { dispatchRouteReady } from '../utils/navigationPerf';
import { PRINT_CATEGORIES, getCategoryById, getPrintTypeById } from '../printRegistry';

const PAGE_ICON = '\u{1F4C4}';
const TAB_OPTIONS = [
  { id: 'documents', label: 'Documenti allegati' },
  { id: 'prints', label: 'Stampe / Elenchi' },
];
const DOCUMENT_TYPE_OPTIONS = [
  { value: '', label: 'Tutti' },
  { value: 'hire_attachment', label: 'Assunzione' },
  { value: 'medical_visit_attachment', label: 'Visita medica' },
  { value: 'art37_attachment', label: 'Formazione Art. 37' },
  { value: 'dpi_delivery_attachment', label: 'DPI' },
  { value: 'payroll_slip', label: 'Busta paga' },
  { value: 'communication_pdf', label: 'Comunicazione PDF' },
  { value: 'communication_excel', label: 'Comunicazione Excel' },
];
const MONTH_OPTIONS = [
  { value: '01', label: 'Gennaio' },
  { value: '02', label: 'Febbraio' },
  { value: '03', label: 'Marzo' },
  { value: '04', label: 'Aprile' },
  { value: '05', label: 'Maggio' },
  { value: '06', label: 'Giugno' },
  { value: '07', label: 'Luglio' },
  { value: '08', label: 'Agosto' },
  { value: '09', label: 'Settembre' },
  { value: '10', label: 'Ottobre' },
  { value: '11', label: 'Novembre' },
  { value: '12', label: 'Dicembre' },
];

function normalizeSortText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function formatDate(value) {
  if (!value) return '-';
  const normalized = String(value).slice(0, 10);
  const parts = normalized.split('-');
  if (parts.length !== 3) return value;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatMonthLabel(monthReference) {
  const raw = String(monthReference || '').slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(raw)) return '-';
  const [, month] = raw.split('-');
  const monthLabel = MONTH_OPTIONS.find((item) => item.value === month)?.label || month;
  return `${monthLabel} ${raw.slice(0, 4)}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
  }).format(Number(value || 0));
}

function formatNumber(value) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) ? String(parsed) : parsed.toFixed(2).replace(/\.?0+$/, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getEmployeeLabel(employee) {
  return `${employee?.last_name || ''} ${employee?.first_name || ''}`.trim()
    || `${employee?.first_name || ''} ${employee?.last_name || ''}`.trim();
}

function getEmployeeTeamHistory(employee) {
  return Array.isArray(employee?.team_history) ? employee.team_history : [];
}

function employeeBelongsToTeam(employee, teamId) {
  if (!teamId) return true;
  return getEmployeeTeamHistory(employee).some((entry) => String(entry?.team_id) === String(teamId));
}

function getEmployeeHireDate(employee) {
  const currentPeriod = (employee?.employment_periods || []).find((period) => period?.is_current);
  const firstPeriod = Array.isArray(employee?.employment_periods) ? employee.employment_periods[0] : null;
  return (
    employee?.hire_date_from ||
    employee?.hire_date ||
    employee?.start_date ||
    employee?.contract_start_date ||
    employee?.data_assunzione ||
    employee?.assunzione ||
    currentPeriod?.hire_date_from ||
    currentPeriod?.start_date ||
    firstPeriod?.hire_date_from ||
    firstPeriod?.start_date ||
    ''
  );
}

function compareEmployees(a, b) {
  const lastCompare = normalizeSortText(a?.last_name).localeCompare(
    normalizeSortText(b?.last_name),
    'it',
    { sensitivity: 'base' }
  );
  if (lastCompare !== 0) return lastCompare;

  const firstCompare = normalizeSortText(a?.first_name).localeCompare(
    normalizeSortText(b?.first_name),
    'it',
    { sensitivity: 'base' }
  );
  if (firstCompare !== 0) return firstCompare;

  return normalizeSortText(getEmployeeLabel(a)).localeCompare(
    normalizeSortText(getEmployeeLabel(b)),
    'it',
    { sensitivity: 'base' }
  );
}

function compareTeams(a, b) {
  return normalizeSortText(a?.name).localeCompare(normalizeSortText(b?.name), 'it', {
    sensitivity: 'base',
  });
}

function compareDocuments(a, b) {
  const employeeCompare = normalizeSortText(a?.employee_name).localeCompare(
    normalizeSortText(b?.employee_name),
    'it',
    { sensitivity: 'base' }
  );
  if (employeeCompare !== 0) return employeeCompare;

  const typeCompare = normalizeSortText(a?.document_type_label).localeCompare(
    normalizeSortText(b?.document_type_label),
    'it',
    { sensitivity: 'base' }
  );
  if (typeCompare !== 0) return typeCompare;

  const dateCompare = String(b?.upload_date || '').localeCompare(String(a?.upload_date || ''));
  if (dateCompare !== 0) return dateCompare;

  return normalizeSortText(a?.file_name).localeCompare(normalizeSortText(b?.file_name), 'it', {
    sensitivity: 'base',
  });
}

function getCurrentYear() {
  return new Date().getFullYear();
}

function buildMonthKey(year, month) {
  return `${String(year)}-${String(month).padStart(2, '0')}`;
}

function normalizeDateKey(value) {
  return String(value || '').slice(0, 10);
}

function getBalanceStatusLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'saldato') return 'Saldato';
  if (normalized === 'parziale') return 'Parziale';
  return 'Non pagato';
}

function getPayrollPaymentStatusLabel(value) {
  return String(value || '').trim().toLowerCase() === 'pagato' ? 'Pagato' : 'Non pagato';
}

function getPayrollPaymentMethodLabel(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'assegno') return 'Assegno';
  if (normalized === 'contanti') return 'Contanti';
  return 'Bonifico';
}

function getPrintConnectionLabel(status) {
  return status === 'ready' ? 'Stampa collegata' : 'Stampa non ancora collegata';
}

function getEmployeeSelectionModeLabel(selectionMode) {
  if (selectionMode === 'single') return 'Selezione singola obbligatoria';
  if (selectionMode === 'single_optional') return 'Selezione singola facoltativa';
  if (selectionMode === 'multiple') return 'Selezione multipla obbligatoria';
  if (selectionMode === 'multiple_optional') return 'Selezione multipla facoltativa';
  return '';
}

function summarizeAttendanceEntries(entries = []) {
  const meaningfulEntries = entries.filter((entry) => {
    const hours = Number(entry?.hours_worked || 0);
    const overtime = Number(entry?.overtime_hours || 0);
    const status = String(entry?.status || '').trim().toLowerCase();
    return hours > 0 || overtime > 0 || (status && status !== 'assente');
  });

  return {
    presenceDays: meaningfulEntries.length,
    totalHours: meaningfulEntries.reduce((sum, entry) => sum + Number(entry?.hours_worked || 0), 0),
    totalOvertime: meaningfulEntries.reduce((sum, entry) => sum + Number(entry?.overtime_hours || 0), 0),
  };
}

function buildPrintHtml(preview, companyHeader) {
  const summaryCards = (preview.summaryCards || [])
    .map(
      (card) => `
        <div class="print-hub-card">
          <div class="print-hub-card__label">${escapeHtml(card.label)}</div>
          <div class="print-hub-card__value">${escapeHtml(card.value)}</div>
        </div>
      `
    )
    .join('');

  const headCells = (preview.columns || [])
    .map((column) => `<th class="align-${escapeHtml(column.align || 'left')}">${escapeHtml(column.label)}</th>`)
    .join('');

  const bodyRows = (preview.rows || [])
    .map((row) => `
      <tr>
        ${(preview.columns || [])
          .map((column) => `<td class="align-${escapeHtml(column.align || 'left')}">${escapeHtml(row[column.key] ?? '-')}</td>`)
          .join('')}
      </tr>
    `)
    .join('');

  return `
    <!doctype html>
    <html lang="it">
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(preview.title)}</title>
        <style>
          @page { size: ${preview.landscape ? 'A4 landscape' : 'A4 portrait'}; margin: 10mm; }
          body {
            margin: 0;
            font-family: "Segoe UI", Arial, sans-serif;
            color: #0f172a;
            background: #ffffff;
          }
          .print-hub {
            padding: 10px 4px 18px;
          }
          .print-hub__header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 20px;
            margin-bottom: 16px;
          }
          .print-hub__kicker {
            margin: 0 0 4px;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: #64748b;
            font-weight: 700;
          }
          .print-hub__title {
            margin: 0;
            font-size: 24px;
            line-height: 1.15;
          }
          .print-hub__subtitle {
            margin: 8px 0 0;
            color: #475569;
            font-size: 13px;
          }
          .print-hub__meta {
            text-align: right;
            font-size: 12px;
            color: #334155;
          }
          .print-hub__company {
            font-size: 13px;
            font-weight: 700;
            color: #0f172a;
          }
          .print-hub__summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
            gap: 10px;
            margin-bottom: 18px;
          }
          .print-hub-card {
            border: 1px solid #dbe4ee;
            border-radius: 14px;
            padding: 12px 14px;
            background: #f8fafc;
          }
          .print-hub-card__label {
            font-size: 11px;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 6px;
          }
          .print-hub-card__value {
            font-size: 18px;
            font-weight: 700;
            color: #0f172a;
          }
          .print-hub__table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
          }
          .print-hub__table thead th {
            text-align: left;
            padding: 9px 10px;
            border-bottom: 1px solid #cbd5e1;
            color: #334155;
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            background: #f8fafc;
            white-space: nowrap;
          }
          .print-hub__table tbody td {
            padding: 9px 10px;
            border-bottom: 1px solid #e2e8f0;
            vertical-align: top;
          }
          .align-center { text-align: center; }
          .align-right { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        </style>
      </head>
      <body>
        <div class="print-hub">
          <div class="print-hub__header">
            <div>
              <p class="print-hub__kicker">Stampa e Documenti</p>
              <h1 class="print-hub__title">${escapeHtml(preview.title)}</h1>
              <p class="print-hub__subtitle">${escapeHtml(preview.subtitle || '')}</p>
            </div>
            <div class="print-hub__meta">
              <div class="print-hub__company">${escapeHtml(companyHeader || 'GPA 1.0.5')}</div>
              <div>Stampato il ${escapeHtml(formatDate(new Date().toISOString().slice(0, 10)))}</div>
            </div>
          </div>
          ${summaryCards ? `<div class="print-hub__summary">${summaryCards}</div>` : ''}
          <table class="print-hub__table">
            <thead>
              <tr>${headCells}</tr>
            </thead>
            <tbody>
              ${bodyRows || '<tr><td colspan="99">Nessun dato disponibile.</td></tr>'}
            </tbody>
          </table>
        </div>
      </body>
    </html>
  `;
}

export default function PrintDocumentsPage() {
  const [activeTab, setActiveTab] = useState('documents');
  const [loading, setLoading] = useState(true);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [documents, setDocuments] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [teams, setTeams] = useState([]);
  const [settings, setSettings] = useState(null);

  const [employeeSearch, setEmployeeSearch] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [documentsFilters, setDocumentsFilters] = useState({
    documentType: '',
    monthReference: '',
    uploadDate: '',
  });

  const [selectedCategoryId, setSelectedCategoryId] = useState('attendance');
  const [selectedTypeId, setSelectedTypeId] = useState('attendance-month-selected');
  const [printFilters, setPrintFilters] = useState({
    year: String(getCurrentYear()),
    month: String(new Date().getMonth() + 1).padStart(2, '0'),
    date: '',
    dateFrom: '',
    dateTo: '',
    teamId: '',
    balanceStatus: '',
    payrollPaymentStatus: '',
  });
  const [printEmployeeSearch, setPrintEmployeeSearch] = useState('');
  const [attendanceDayTeamFilter, setAttendanceDayTeamFilter] = useState('');
  const [includeAttendanceDayHireDates, setIncludeAttendanceDayHireDates] = useState(false);
  const [selectedPrintEmployeeIds, setSelectedPrintEmployeeIds] = useState([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [printPreview, setPrintPreview] = useState(null);

  const sortedEmployees = useMemo(
    () => [...employees].filter((employee) => !employee.is_deleted).sort(compareEmployees),
    [employees]
  );
  const sortedTeams = useMemo(() => [...teams].sort(compareTeams), [teams]);
  const employeesById = useMemo(
    () => new Map(sortedEmployees.map((employee) => [Number(employee.id), employee])),
    [sortedEmployees]
  );
  const attendanceDayTeamOptions = useMemo(
    () => sortedTeams.filter((team) => !team.is_archived),
    [sortedTeams]
  );
  const selectedCategory = useMemo(() => getCategoryById(selectedCategoryId), [selectedCategoryId]);
  const selectedType = useMemo(() => getPrintTypeById(selectedTypeId), [selectedTypeId]);

  async function loadDocuments(filters = {}) {
    setDocumentsLoading(true);
    try {
      const data = await window.api.printDocuments.listDocuments(filters);
      setDocuments(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
      alert(error?.message || 'Errore caricamento documenti.');
    } finally {
      setDocumentsLoading(false);
    }
  }

  async function loadInitialData() {
    setLoading(true);
    try {
      const [employeesData, teamsData, settingsData] = await Promise.all([
        window.api.employees.listBasic({ includeTeamHistory: true }),
        window.api.teams.list({ includeArchived: true }),
        window.api.settings.get(),
      ]);
      setEmployees(Array.isArray(employeesData) ? employeesData : []);
      setTeams(Array.isArray(teamsData) ? teamsData : []);
      setSettings(settingsData || null);
    } catch (error) {
      console.error(error);
      alert(error?.message || 'Errore caricamento Stampa e Documenti.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (!loading) {
      dispatchRouteReady('/stampa-documenti');
    }
  }, [loading]);

  useEffect(() => {
    if (!selectedCategory?.types?.length) return;
    if (!selectedCategory.types.some((type) => type.id === selectedTypeId)) {
      setSelectedTypeId(selectedCategory.types[0].id);
    }
  }, [selectedCategory, selectedTypeId]);

  useEffect(() => {
    if (!selectedType) return;
    if (selectedType.employeeSelection === 'none') {
      setSelectedPrintEmployeeIds([]);
      setPrintEmployeeSearch('');
      return;
    }
    if (selectedType.employeeSelection === 'single' || selectedType.employeeSelection === 'single_optional') {
      setSelectedPrintEmployeeIds((current) => current.slice(0, 1));
    }
  }, [selectedType]);

  const employeeSearchResults = useMemo(() => {
    const query = normalizeSortText(employeeSearch);
    if (!query) {
      return sortedEmployees.slice(0, 12);
    }
    return sortedEmployees
      .filter((employee) => {
        const haystack = [
          getEmployeeLabel(employee),
          employee.first_name,
          employee.last_name,
          employee.fiscal_code,
          employee.role,
        ].map(normalizeSortText).join(' ');
        return haystack.includes(query);
      })
      .slice(0, 20);
  }, [employeeSearch, sortedEmployees]);

  const documentMonthOptions = useMemo(
    () =>
      [...new Set(documents.map((document) => document.month_reference).filter(Boolean))]
        .sort((a, b) => String(b).localeCompare(String(a)))
        .map((value) => ({ value, label: formatMonthLabel(value) })),
    [documents]
  );

  const filteredDocuments = useMemo(
    () =>
      [...documents]
        .filter((document) => !documentsFilters.documentType || document.document_type === documentsFilters.documentType)
        .filter((document) => !documentsFilters.monthReference || document.month_reference === documentsFilters.monthReference)
        .filter((document) => !documentsFilters.uploadDate || document.upload_date === documentsFilters.uploadDate)
        .sort(compareDocuments),
    [documents, documentsFilters]
  );

  useEffect(() => {
    if (!selectedEmployee?.id) {
      setDocuments([]);
      setDocumentsLoading(false);
      return;
    }
    loadDocuments({
      employeeId: selectedEmployee.id,
      documentType: documentsFilters.documentType,
      monthReference: documentsFilters.monthReference,
      uploadDate: documentsFilters.uploadDate,
    });
  }, [
    selectedEmployee?.id,
    documentsFilters.documentType,
    documentsFilters.monthReference,
    documentsFilters.uploadDate,
  ]);

  const printSearchBaseEmployees = useMemo(() => {
    if (selectedType?.id !== 'attendance-day' || !attendanceDayTeamFilter) {
      return sortedEmployees;
    }
    return sortedEmployees.filter((employee) => employeeBelongsToTeam(employee, attendanceDayTeamFilter));
  }, [attendanceDayTeamFilter, selectedType?.id, sortedEmployees]);

  const printSearchResults = useMemo(() => {
    const query = normalizeSortText(printEmployeeSearch);
    if (!query) {
      return printSearchBaseEmployees.slice(0, 16);
    }
    return printSearchBaseEmployees
      .filter((employee) => {
        const haystack = [
          getEmployeeLabel(employee),
          employee.first_name,
          employee.last_name,
          employee.fiscal_code,
          employee.role,
        ].map(normalizeSortText).join(' ');
        return haystack.includes(query);
      })
      .slice(0, 30);
  }, [printEmployeeSearch, printSearchBaseEmployees]);

  const selectedPrintEmployees = useMemo(
    () => sortedEmployees.filter((employee) => selectedPrintEmployeeIds.includes(Number(employee.id))),
    [selectedPrintEmployeeIds, sortedEmployees]
  );

  function handleSelectEmployee(employee) {
    setSelectedEmployee(employee);
    setEmployeeSearch(getEmployeeLabel(employee));
    setDocumentsFilters({
      documentType: '',
      monthReference: '',
      uploadDate: '',
    });
  }

  function handleResetDocumentSelection() {
    setSelectedEmployee(null);
    setEmployeeSearch('');
    setDocuments([]);
    setDocumentsFilters({
      documentType: '',
      monthReference: '',
      uploadDate: '',
    });
  }

  function togglePrintEmployeeSelection(employeeId) {
    if (!selectedType) return;
    const normalizedId = Number(employeeId);
    setSelectedPrintEmployeeIds((current) => {
      const exists = current.includes(normalizedId);
      if (selectedType.employeeSelection === 'single' || selectedType.employeeSelection === 'single_optional') {
        return exists ? [] : [normalizedId];
      }
      return exists ? current.filter((id) => id !== normalizedId) : [...current, normalizedId];
    });
  }

  function selectAllFilteredEmployees() {
    if (!selectedType || (selectedType.employeeSelection !== 'multiple' && selectedType.employeeSelection !== 'multiple_optional')) {
      return;
    }
    setSelectedPrintEmployeeIds(printSearchResults.map((employee) => Number(employee.id)));
  }

  function clearPrintEmployeeSelection() {
    setSelectedPrintEmployeeIds([]);
  }

  function updateAttendanceDayTeamFilter(teamId) {
    setAttendanceDayTeamFilter(teamId);
    if (!teamId) return;
    setSelectedPrintEmployeeIds((current) =>
      current.filter((employeeId) => employeeBelongsToTeam(employeesById.get(Number(employeeId)), teamId))
    );
  }

  function buildSelectionMeta() {
    if (!selectedType) return [];
    const meta = [
      { label: 'Categoria', value: selectedCategory?.label || '-' },
      { label: 'Tipo stampa', value: selectedType.label || '-' },
    ];

    if (selectedType.filters.includes('year') && selectedType.filters.includes('month')) {
      meta.push({ label: 'Periodo', value: formatMonthLabel(buildMonthKey(printFilters.year, printFilters.month)) });
    }
    if (selectedType.filters.includes('date') && printFilters.date) {
      meta.push({ label: 'Data', value: formatDate(printFilters.date) });
    }
    if (selectedType.filters.includes('teamId') && printFilters.teamId) {
      const team = sortedTeams.find((item) => Number(item.id) === Number(printFilters.teamId));
      meta.push({ label: 'Squadra', value: team?.name || '-' });
    }
    if (selectedType.id === 'attendance-day' && attendanceDayTeamFilter) {
      const team = sortedTeams.find((item) => Number(item.id) === Number(attendanceDayTeamFilter));
      meta.push({ label: 'Squadra dipendenti', value: team?.name || '-' });
    }
    if (selectedType.id === 'attendance-day') {
      meta.push({
        label: 'Date assunzione',
        value: includeAttendanceDayHireDates ? 'Incluse' : 'Non incluse',
      });
    }
    if (selectedType.filters.includes('balanceStatus') && printFilters.balanceStatus) {
      meta.push({ label: 'Stato saldo', value: getBalanceStatusLabel(printFilters.balanceStatus) });
    }
    if (selectedType.filters.includes('payrollPaymentStatus') && printFilters.payrollPaymentStatus) {
      meta.push({ label: 'Stato busta', value: getPayrollPaymentStatusLabel(printFilters.payrollPaymentStatus) });
    }
    if (selectedPrintEmployees.length) {
      meta.push({
        label: selectedPrintEmployees.length === 1 ? 'Dipendente' : 'Dipendenti',
        value:
          selectedPrintEmployees.length <= 3
            ? selectedPrintEmployees.map(getEmployeeLabel).join(', ')
            : `${selectedPrintEmployees.length} dipendenti selezionati`,
      });
    }

    return meta;
  }

  async function handleDocumentAction(action, document) {
    if (!document?.relative_path) return;
    setActionLoading(`${action}:${document.relative_path}`);
    try {
      if (action === 'open') {
        const result = await window.api.printDocuments.openDocument(document.relative_path);
        if (result?.success === false) {
          alert(result.message || 'Impossibile aprire il documento.');
        }
      } else if (action === 'print') {
        const result = await window.api.printDocuments.printDocument(document.relative_path);
        if (result?.success === false) {
          alert(result.message || 'Impossibile inviare il documento alla stampa.');
        }
      } else if (action === 'export') {
        const result = await window.api.printDocuments.exportDocument(document.relative_path, document.file_name);
        if (!result?.canceled && result?.file_path) {
          alert(`Documento esportato in:\n${result.file_path}`);
        }
      }
    } catch (error) {
      console.error(error);
      alert(error?.message || 'Operazione documento non riuscita.');
    } finally {
      setActionLoading('');
    }
  }

  async function loadPrintPreview() {
    if (!selectedType) {
      setPrintPreview(null);
      return;
    }

    if (selectedType.status !== 'ready') {
      setPrintPreview({
        status: 'disabled',
        title: selectedType.label,
        subtitle: 'Stampa non ancora collegata.',
        columns: [],
        rows: [],
        summaryCards: [],
      });
      return;
    }

    const employeeSelection = selectedType.employeeSelection || 'none';
    const requiresEmployees = employeeSelection === 'single' || employeeSelection === 'multiple';
    if (requiresEmployees && !selectedPrintEmployeeIds.length) {
      setPrintPreview({
        status: 'empty',
        title: selectedType.label,
        subtitle: 'Seleziona i dipendenti richiesti per generare questa stampa.',
        columns: [],
        rows: [],
        summaryCards: [],
      });
      return;
    }

    setPreviewLoading(true);
    try {
      const monthKey = buildMonthKey(printFilters.year, printFilters.month);
      const selectedTeam = sortedTeams.find((team) => Number(team.id) === Number(printFilters.teamId));
      const selectedEmployeesById = new Map(
        selectedPrintEmployees.map((employee) => [Number(employee.id), employee])
      );
      let nextPreview = null;

      switch (selectedType.id) {
        case 'attendance-month-selected': {
          const rows = await window.api.attendance.listByMonth(Number(printFilters.year), Number(printFilters.month));
          const rowsByEmployee = new Map();
          rows.forEach((row) => {
            const employeeId = Number(row.employee_id);
            if (!selectedEmployeesById.has(employeeId)) return;
            const list = rowsByEmployee.get(employeeId) || [];
            list.push(row);
            rowsByEmployee.set(employeeId, list);
          });

          nextPreview = {
            status: 'ready',
            title: `Presenze mensili ${formatMonthLabel(monthKey)}`,
            subtitle: 'Riepilogo mensile delle presenze per i dipendenti selezionati.',
            fileName: `presenze-dipendenti-${monthKey}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Periodo', value: formatMonthLabel(monthKey) },
              { label: 'Dipendenti', value: String(selectedPrintEmployees.length) },
            ],
            columns: [
              { label: 'Dipendente', key: 'employee', align: 'left' },
              { label: 'Mansione', key: 'role', align: 'left' },
              { label: 'Giorni presenza', key: 'days', align: 'center' },
              { label: 'Ore', key: 'hours', align: 'right' },
              { label: 'Straordinario', key: 'overtime', align: 'right' },
            ],
            rows: selectedPrintEmployees.map((employee) => {
              const totals = summarizeAttendanceEntries(rowsByEmployee.get(Number(employee.id)) || []);
              return {
                employee: getEmployeeLabel(employee),
                role: employee.role || '-',
                days: String(totals.presenceDays),
                hours: formatNumber(totals.totalHours),
                overtime: formatNumber(totals.totalOvertime),
              };
            }),
          };
          break;
        }

        case 'attendance-day': {
          if (!printFilters.date) {
            nextPreview = {
              status: 'empty',
              title: 'Presenze giornaliere',
              subtitle: 'Seleziona una data per generare questa stampa.',
              columns: [],
              rows: [],
              summaryCards: [],
            };
            break;
          }
          const [year, month] = String(printFilters.date).split('-');
          const rows = await window.api.attendance.listByMonth(Number(year), Number(month));
          let filtered = rows.filter((row) => normalizeDateKey(row.date) === normalizeDateKey(printFilters.date));
          if (attendanceDayTeamFilter) {
            filtered = filtered.filter((row) =>
              employeeBelongsToTeam(employeesById.get(Number(row.employee_id)), attendanceDayTeamFilter)
            );
          }
          if (selectedPrintEmployeeIds.length) {
            filtered = filtered.filter((row) => selectedPrintEmployeeIds.includes(Number(row.employee_id)));
          }
          const attendanceDayColumns = [
            { label: 'Dipendente', key: 'employee', align: 'left' },
            ...(includeAttendanceDayHireDates
              ? [{ label: 'Assunzione', key: 'hireDate', align: 'center' }]
              : []),
            { label: 'Mansione', key: 'role', align: 'left' },
            { label: 'Stato', key: 'status', align: 'center' },
            { label: 'Ore', key: 'hours', align: 'right' },
            { label: 'Straordinario', key: 'overtime', align: 'right' },
          ];

          nextPreview = {
            status: 'ready',
            title: `Presenze giornaliere ${formatDate(printFilters.date)}`,
            subtitle: 'Riepilogo presenze del giorno selezionato.',
            fileName: `presenze-giornaliere-${printFilters.date}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Data', value: formatDate(printFilters.date) },
              { label: 'Righe', value: String(filtered.length) },
            ],
            columns: attendanceDayColumns,
            rows: filtered.map((row) => {
              const employee = employeesById.get(Number(row.employee_id));
              return {
                employee: `${row.last_name || ''} ${row.first_name || ''}`.trim(),
                hireDate: formatDate(getEmployeeHireDate(employee)),
                role: row.role || '-',
                status: String(row.status || '').trim() || 'Presente',
                hours: formatNumber(row.hours_worked),
                overtime: formatNumber(row.overtime_hours),
              };
            }),
          };
          break;
        }

        case 'attendance-team': {
          if (!selectedTeam) {
            nextPreview = {
              status: 'empty',
              title: 'Presenze per squadra',
              subtitle: 'Seleziona una squadra per generare questa stampa.',
              columns: [],
              rows: [],
              summaryCards: [],
            };
            break;
          }
          const rows = await window.api.attendance.listTeamByMonth(Number(printFilters.year), Number(printFilters.month));
          const filtered = rows.filter((row) => Number(row.team_id) === Number(selectedTeam.id));
          nextPreview = {
            status: 'ready',
            title: `Presenze squadra ${selectedTeam.name}`,
            subtitle: `Riepilogo mensile presenze squadra ${selectedTeam.name}.`,
            fileName: `presenze-squadra-${normalizeSortText(selectedTeam.name) || 'squadra'}-${monthKey}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Periodo', value: formatMonthLabel(monthKey) },
              { label: 'Squadra', value: selectedTeam.name || '-' },
              { label: 'Giorni compilati', value: String(filtered.length) },
            ],
            columns: [
              { label: 'Data', key: 'date', align: 'center' },
              { label: 'Presenti', key: 'headcount', align: 'center' },
              { label: 'Ore per persona', key: 'hoursPerPerson', align: 'center' },
              { label: 'Ore totali', key: 'totalHours', align: 'right' },
              { label: 'Note', key: 'notes', align: 'left' },
            ],
            rows: filtered.map((row) => ({
              date: formatDate(row.date),
              headcount: formatNumber(row.headcount),
              hoursPerPerson: formatNumber(row.hours_per_person),
              totalHours: formatNumber(Number(row.headcount || 0) * Number(row.hours_per_person || 0)),
              notes: row.notes || '-',
            })),
          };
          break;
        }

        case 'report-employee-month':
        case 'report-employees-month': {
          const employeesToLoad =
            selectedType.id === 'report-employee-month'
              ? selectedPrintEmployees.slice(0, 1)
              : selectedPrintEmployees;
          const records = await Promise.all(
            employeesToLoad.map((employee) => window.api.payroll.getRecord(Number(employee.id), monthKey))
          );

          nextPreview = {
            status: 'ready',
            title:
              selectedType.id === 'report-employee-month'
                ? `Report mensile ${getEmployeeLabel(employeesToLoad[0])}`
                : `Report mensili dipendenti selezionati`,
            subtitle: 'Riepilogo economico dei report salvati nel mese selezionato.',
            fileName:
              selectedType.id === 'report-employee-month'
                ? `report-${normalizeSortText(getEmployeeLabel(employeesToLoad[0]))}-${monthKey}.pdf`
                : `report-dipendenti-${monthKey}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Periodo', value: formatMonthLabel(monthKey) },
              { label: 'Report', value: String(employeesToLoad.length) },
            ],
            columns: [
              { label: 'Dipendente', key: 'employee', align: 'left' },
              { label: 'Datore', key: 'employer', align: 'left' },
              { label: 'Giornate', key: 'days', align: 'center' },
              { label: 'Compenso mese', key: 'compensation', align: 'right' },
              { label: 'Importo busta', key: 'payrollAmount', align: 'right' },
              { label: 'Saldo finale', key: 'balance', align: 'right' },
              { label: 'Stato saldo', key: 'balanceStatus', align: 'center' },
            ],
            rows: employeesToLoad.map((employee, index) => {
              const record = records[index];
              return {
                employee: getEmployeeLabel(employee),
                employer: record?.datore || employee.hired_by || '-',
                days: formatNumber(record?.giornate_effettuate || 0),
                compensation: formatCurrency(record?.retribuzione_calcolata || 0),
                payrollAmount: formatCurrency(record?.importo_busta_paga || 0),
                balance: formatCurrency(record?.remaining_balance ?? record?.differenza_finale ?? 0),
                balanceStatus: getBalanceStatusLabel(record?.balance_status),
              };
            }),
          };
          break;
        }

        case 'report-team-month': {
          if (!selectedTeam) {
            nextPreview = {
              status: 'empty',
              title: 'Report mensile squadra',
              subtitle: 'Seleziona una squadra per generare questa stampa.',
              columns: [],
              rows: [],
              summaryCards: [],
            };
            break;
          }

          const [record, advances, components, teamAttendanceRows] = await Promise.all([
            window.api.teamPayroll.getReportRecord(Number(selectedTeam.id), monthKey),
            window.api.teamPayroll.listAdvances(Number(selectedTeam.id), monthKey),
            window.api.teamPayroll.listPayrollComponents(Number(selectedTeam.id), monthKey),
            window.api.attendance.listTeamByMonth(Number(printFilters.year), Number(printFilters.month)),
          ]);
          const filteredAttendance = teamAttendanceRows.filter((row) => Number(row.team_id) === Number(selectedTeam.id));
          const standardHours = Number(settings?.general?.standard_day_hours || 7) || 7;
          const equivalentDays = filteredAttendance.reduce((sum, row) => {
            const totalHours = Number(row.headcount || 0) * Number(row.hours_per_person || 0);
            return sum + (standardHours > 0 ? totalHours / standardHours : 0);
          }, 0);
          const grossCompensation = record?.report_snapshot_json?.gross_compensation
            ?? equivalentDays * Number(selectedTeam.team_daily_rate || 0);
          const transportAmount = Number(record?.transport_amount || 0);
          const advancesTotal = (advances || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
          const componentsTotal = (components || []).reduce((sum, item) => sum + Number(item.amount || 0), 0);
          const finalBalance = record?.report_snapshot_json?.final_balance
            ?? (grossCompensation + transportAmount - advancesTotal - componentsTotal);

          nextPreview = {
            status: 'ready',
            title: `Report mensile squadra ${selectedTeam.name}`,
            subtitle: 'Riepilogo squadra con compenso, acconti, componenti e saldo finale.',
            fileName: `report-squadra-${normalizeSortText(selectedTeam.name) || 'squadra'}-${monthKey}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Periodo', value: formatMonthLabel(monthKey) },
              { label: 'Squadra', value: selectedTeam.name || '-' },
              { label: 'Saldo finale', value: formatCurrency(finalBalance) },
            ],
            columns: [
              { label: 'Voce', key: 'label', align: 'left' },
              { label: 'Dettaglio', key: 'detail', align: 'left' },
              { label: 'Valore', key: 'value', align: 'right' },
            ],
            rows: [
              {
                label: 'Retribuzione calcolata',
                detail: `${formatNumber(equivalentDays)} gg x ${formatCurrency(selectedTeam.team_daily_rate || 0)}`,
                value: formatCurrency(grossCompensation),
              },
              {
                label: 'Trasporto squadra',
                detail: record?.transport_description || '-',
                value: formatCurrency(transportAmount),
              },
              {
                label: 'Acconti squadra',
                detail: `${(advances || []).length} movimenti`,
                value: formatCurrency(advancesTotal),
              },
              {
                label: 'Buste paga componenti',
                detail: `${(components || []).length} righe`,
                value: formatCurrency(componentsTotal),
              },
              {
                label: 'Saldo finale squadra',
                detail: getBalanceStatusLabel(record?.report_snapshot_json?.final_balance ? 'saldato' : 'non_pagato').replace('Non pagato', 'Calcolato'),
                value: formatCurrency(finalBalance),
              },
            ],
          };
          break;
        }

        case 'report-history-month':
        case 'payroll-list-month':
        case 'payroll-status-month': {
          const historyRows = await window.api.payroll.listHistory({
            year: Number(printFilters.year),
            month: monthKey,
            employee_id: selectedPrintEmployeeIds[0] || undefined,
          });
          let items = Array.isArray(historyRows?.items)
            ? historyRows.items
            : Array.isArray(historyRows)
            ? historyRows
            : [];

          if (selectedType.id === 'report-history-month' && printFilters.balanceStatus) {
            items = items.filter((item) => String(item.balance_status || '').toLowerCase() === String(printFilters.balanceStatus).toLowerCase());
          }
          if (selectedType.id === 'payroll-status-month' && printFilters.payrollPaymentStatus) {
            items = items.filter((item) => String(item.payroll_payment_status || '').toLowerCase() === String(printFilters.payrollPaymentStatus).toLowerCase());
          }

          nextPreview = {
            status: 'ready',
            title:
              selectedType.id === 'report-history-month'
                ? `Storico report ${formatMonthLabel(monthKey)}`
                : selectedType.id === 'payroll-list-month'
                ? `Elenco buste paga ${formatMonthLabel(monthKey)}`
                : `Stato buste paga ${formatMonthLabel(monthKey)}`,
            subtitle:
              selectedType.id === 'report-history-month'
                ? 'Riepilogo storico mensile con stato saldo.'
                : 'Riepilogo mensile delle buste paga salvate.',
            fileName:
              selectedType.id === 'report-history-month'
                ? `storico-report-${monthKey}.pdf`
                : selectedType.id === 'payroll-list-month'
                ? `buste-paga-${monthKey}.pdf`
                : `stato-buste-${monthKey}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Periodo', value: formatMonthLabel(monthKey) },
              { label: 'Righe', value: String(items.length) },
            ],
            columns:
              selectedType.id === 'report-history-month'
                ? [
                    { label: 'Dipendente', key: 'employee', align: 'left' },
                    { label: 'Datore', key: 'employer', align: 'left' },
                    { label: 'Compenso', key: 'compensation', align: 'right' },
                    { label: 'Busta', key: 'payrollAmount', align: 'right' },
                    { label: 'Residuo', key: 'remaining', align: 'right' },
                    { label: 'Stato saldo', key: 'balanceStatus', align: 'center' },
                  ]
                : [
                    { label: 'Dipendente', key: 'employee', align: 'left' },
                    { label: 'Datore', key: 'employer', align: 'left' },
                    { label: 'Importo busta', key: 'payrollAmount', align: 'right' },
                    { label: 'Modalita', key: 'method', align: 'center' },
                    { label: 'Data pagamento', key: 'paymentDate', align: 'center' },
                    { label: 'Stato busta', key: 'payrollStatus', align: 'center' },
                  ],
            rows: items.map((item) =>
              selectedType.id === 'report-history-month'
                ? {
                    employee: getEmployeeLabel(item.employee),
                    employer: item.datore || '-',
                    compensation: formatCurrency(item.retribuzione_calcolata || 0),
                    payrollAmount: formatCurrency(item.importo_busta_paga || 0),
                    remaining: formatCurrency(item.remaining_balance ?? item.differenza_finale ?? 0),
                    balanceStatus: getBalanceStatusLabel(item.balance_status),
                  }
                : {
                    employee: getEmployeeLabel(item.employee),
                    employer: item.datore || '-',
                    payrollAmount: formatCurrency(item.importo_busta_paga || 0),
                    method: getPayrollPaymentMethodLabel(item.payroll_payment_method),
                    paymentDate: formatDate(item.payroll_payment_date),
                    payrollStatus: getPayrollPaymentStatusLabel(item.payroll_payment_status),
                  }
            ),
          };
          break;
        }

        case 'employees-active':
        case 'employees-inactive': {
          const rows = sortedEmployees.filter((employee) =>
            selectedType.id === 'employees-active'
              ? String(employee.status || '').toLowerCase() === 'attivo'
              : String(employee.status || '').toLowerCase() !== 'attivo'
          );
          nextPreview = {
            status: 'ready',
            title: selectedType.id === 'employees-active' ? 'Elenco dipendenti attivi' : 'Elenco dipendenti inattivi',
            subtitle: 'Elenco anagrafico dipendenti con i dati principali.',
            fileName: selectedType.id === 'employees-active' ? 'elenco-dipendenti-attivi.pdf' : 'elenco-dipendenti-inattivi.pdf',
            landscape: true,
            summaryCards: [
              { label: 'Dipendenti', value: String(rows.length) },
            ],
            columns: [
              { label: 'Dipendente', key: 'employee', align: 'left' },
              { label: 'Mansione', key: 'role', align: 'left' },
              { label: 'Telefono', key: 'phone', align: 'left' },
              { label: 'Email', key: 'email', align: 'left' },
              { label: 'Datore', key: 'employer', align: 'left' },
            ],
            rows: rows.map((employee) => ({
              employee: getEmployeeLabel(employee),
              role: employee.role || '-',
              phone: employee.phone || '-',
              email: employee.email || '-',
              employer: employee.hired_by || '-',
            })),
          };
          break;
        }

        case 'teams-list': {
          nextPreview = {
            status: 'ready',
            title: 'Elenco squadre',
            subtitle: 'Anagrafica squadre con numero componenti e tariffa.',
            fileName: 'elenco-squadre.pdf',
            landscape: true,
            summaryCards: [
              { label: 'Squadre', value: String(sortedTeams.length) },
            ],
            columns: [
              { label: 'Squadra', key: 'team', align: 'left' },
              { label: 'Componenti', key: 'members', align: 'center' },
              { label: 'Tariffa', key: 'rate', align: 'right' },
              { label: 'Stato', key: 'status', align: 'center' },
            ],
            rows: sortedTeams.map((team) => ({
              team: team.name || '-',
              members: String((team.members || []).length),
              rate: formatCurrency(team.team_daily_rate || 0),
              status: team.is_archived ? 'Archiviata' : 'Attiva',
            })),
          };
          break;
        }

        case 'team-members': {
          if (!selectedTeam) {
            nextPreview = {
              status: 'empty',
              title: 'Elenco dipendenti per squadra',
              subtitle: 'Seleziona una squadra per generare questa stampa.',
              columns: [],
              rows: [],
              summaryCards: [],
            };
            break;
          }
          const members = [...(selectedTeam.members || [])].sort((left, right) => compareEmployees(left.employee, right.employee));
          nextPreview = {
            status: 'ready',
            title: `Dipendenti squadra ${selectedTeam.name}`,
            subtitle: 'Componenti associati alla squadra selezionata.',
            fileName: `dipendenti-squadra-${normalizeSortText(selectedTeam.name) || 'squadra'}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Squadra', value: selectedTeam.name || '-' },
              { label: 'Componenti', value: String(members.length) },
            ],
            columns: [
              { label: 'Dipendente', key: 'employee', align: 'left' },
              { label: 'Mansione', key: 'role', align: 'left' },
              { label: 'Compenso', key: 'compensation', align: 'right' },
              { label: 'Gestione giorni', key: 'manageByDays', align: 'center' },
            ],
            rows: members.map((member) => ({
              employee: getEmployeeLabel(member.employee),
              role: member.employee?.role || '-',
              compensation: member.compensation !== null && member.compensation !== undefined ? formatCurrency(member.compensation) : '-',
              manageByDays: member.manage_by_days ? 'Si' : 'No',
            })),
          };
          break;
        }

        case 'dpi-inventory': {
          const items = await window.api.dpi.listItems({ includeArchived: true });
          nextPreview = {
            status: 'ready',
            title: 'Magazzino DPI',
            subtitle: 'Situazione aggiornata del magazzino DPI.',
            fileName: 'magazzino-dpi.pdf',
            landscape: true,
            summaryCards: [
              { label: 'Articoli', value: String(Array.isArray(items) ? items.length : 0) },
            ],
            columns: [
              { label: 'Tipologia', key: 'type', align: 'left' },
              { label: 'Descrizione', key: 'description', align: 'left' },
              { label: 'Taglia', key: 'size', align: 'center' },
              { label: 'Disponibili', key: 'available', align: 'center' },
              { label: 'Assegnati', key: 'assigned', align: 'center' },
              { label: 'Acquistati', key: 'purchased', align: 'center' },
            ],
            rows: (Array.isArray(items) ? items : []).map((item) => ({
              type: item.type || '-',
              description: item.description || '-',
              size: item.size || '-',
              available: formatNumber(item.available_quantity),
              assigned: formatNumber(item.assigned_quantity),
              purchased: formatNumber(item.purchased_quantity),
            })),
          };
          break;
        }

        case 'dpi-assignments': {
          const assignments = await window.api.dpi.listAssignments();
          nextPreview = {
            status: 'ready',
            title: 'Assegnazioni DPI',
            subtitle: 'Storico assegnazioni DPI ordinate per data.',
            fileName: 'assegnazioni-dpi.pdf',
            landscape: true,
            summaryCards: [
              { label: 'Assegnazioni', value: String(Array.isArray(assignments) ? assignments.length : 0) },
            ],
            columns: [
              { label: 'Dipendente', key: 'employee', align: 'left' },
              { label: 'DPI', key: 'item', align: 'left' },
              { label: 'Taglia', key: 'size', align: 'center' },
              { label: 'Quantita', key: 'quantity', align: 'center' },
              { label: 'Data consegna', key: 'assignedDate', align: 'center' },
            ],
            rows: (Array.isArray(assignments) ? assignments : []).map((assignment) => ({
              employee: assignment.employee_name || '-',
              item: [assignment.item_type, assignment.item_description].filter(Boolean).join(' - ') || '-',
              size: assignment.item_size || '-',
              quantity: formatNumber(assignment.quantity),
              assignedDate: formatDate(assignment.assigned_date),
            })),
          };
          break;
        }

        case 'dpi-employee': {
          if (!selectedPrintEmployeeIds.length) {
            nextPreview = {
              status: 'empty',
              title: 'DPI per dipendente',
              subtitle: 'Seleziona un dipendente per generare questa stampa.',
              columns: [],
              rows: [],
              summaryCards: [],
            };
            break;
          }
          const employee = selectedPrintEmployees[0];
          const assignments = await window.api.dpi.getEmployeeAssignments(Number(employee.id));
          nextPreview = {
            status: 'ready',
            title: `DPI assegnati a ${getEmployeeLabel(employee)}`,
            subtitle: 'Storico DPI collegato al dipendente selezionato.',
            fileName: `dpi-${normalizeSortText(getEmployeeLabel(employee)) || 'dipendente'}.pdf`,
            landscape: true,
            summaryCards: [
              { label: 'Dipendente', value: getEmployeeLabel(employee) || '-' },
              { label: 'Assegnazioni', value: String(Array.isArray(assignments) ? assignments.length : 0) },
            ],
            columns: [
              { label: 'DPI', key: 'item', align: 'left' },
              { label: 'Taglia', key: 'size', align: 'center' },
              { label: 'Quantita', key: 'quantity', align: 'center' },
              { label: 'Data consegna', key: 'assignedDate', align: 'center' },
              { label: 'Note', key: 'notes', align: 'left' },
            ],
            rows: (Array.isArray(assignments) ? assignments : []).map((assignment) => ({
              item: [assignment.item_type, assignment.item_description].filter(Boolean).join(' - ') || '-',
              size: assignment.item_size || '-',
              quantity: formatNumber(assignment.quantity),
              assignedDate: formatDate(assignment.assigned_date),
              notes: assignment.notes || '-',
            })),
          };
          break;
        }

        default:
          nextPreview = {
            status: 'disabled',
            title: selectedType.label,
            subtitle: 'Stampa non ancora collegata.',
            columns: [],
            rows: [],
            summaryCards: [],
          };
      }

      setPrintPreview(nextPreview);
    } catch (error) {
      console.error(error);
      setPrintPreview({
        status: 'error',
        title: selectedType.label,
        subtitle: error?.message || 'Errore caricamento anteprima stampa.',
        columns: [],
        rows: [],
        summaryCards: [],
      });
    } finally {
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    if (activeTab !== 'prints') return;
    loadPrintPreview();
  }, [
    activeTab,
    selectedTypeId,
    printFilters.year,
    printFilters.month,
    printFilters.date,
    printFilters.teamId,
    printFilters.balanceStatus,
    printFilters.payrollPaymentStatus,
    attendanceDayTeamFilter,
    includeAttendanceDayHireDates,
    selectedPrintEmployeeIds,
  ]);

  async function handlePrintOutput(mode) {
    if (!printPreview || printPreview.status !== 'ready') return;
    const companyHeader = settings?.company?.document_header || settings?.company?.name || 'GPA 1.0.5';
    const html = buildPrintHtml(printPreview, companyHeader);
    const fileName = printPreview.fileName || 'stampa.pdf';

    try {
      if (mode === 'pdf') {
        await window.api.reports.savePdf({
          html,
          fileName,
          landscape: !!printPreview.landscape,
          debugRenderLabel: `print-hub:${selectedTypeId}`,
        });
      } else if (mode === 'print') {
        await window.api.reports.printHtml({
          html,
          fileName,
          landscape: !!printPreview.landscape,
        });
      } else if (mode === 'export') {
        const result = await window.api.reports.savePdfToFolder({
          html,
          fileName,
          monthFolderName: printPreview.folderName || 'Stampe e Documenti',
          landscape: !!printPreview.landscape,
        });
        if (!result?.canceled && result?.file_path) {
          alert(`Esportazione completata in:\n${result.file_path}`);
        }
      }
    } catch (error) {
      console.error(error);
      alert(error?.message || 'Generazione stampa non riuscita.');
    }
  }

  function renderPrintFilters() {
    if (!selectedType) return null;
    return (
      <div className="print-hub-filters print-hub-filters--wizard">
        {selectedType.filters.includes('year') ? (
          <label className="print-hub-field">
            <span>Anno</span>
            <input
              type="number"
              min="2000"
              max="2100"
              value={printFilters.year}
              onChange={(event) => setPrintFilters((current) => ({ ...current, year: event.target.value }))}
            />
          </label>
        ) : null}
        {selectedType.filters.includes('month') ? (
          <label className="print-hub-field">
            <span>Mese</span>
            <select
              value={printFilters.month}
              onChange={(event) => setPrintFilters((current) => ({ ...current, month: event.target.value }))}
            >
              {MONTH_OPTIONS.map((month) => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {selectedType.filters.includes('date') ? (
          <label className="print-hub-field">
            <span>Data</span>
            <input
              type="date"
              value={printFilters.date}
              onChange={(event) => setPrintFilters((current) => ({ ...current, date: event.target.value }))}
            />
          </label>
        ) : null}
        {selectedType.filters.includes('teamId') ? (
          <label className="print-hub-field">
            <span>Squadra</span>
            <select
              value={printFilters.teamId}
              onChange={(event) => setPrintFilters((current) => ({ ...current, teamId: event.target.value }))}
            >
              <option value="">Seleziona squadra</option>
              {sortedTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {selectedType.filters.includes('balanceStatus') ? (
          <label className="print-hub-field">
            <span>Stato saldo</span>
            <select
              value={printFilters.balanceStatus}
              onChange={(event) => setPrintFilters((current) => ({ ...current, balanceStatus: event.target.value }))}
            >
              <option value="">Tutti</option>
              <option value="non_pagato">Non pagato</option>
              <option value="parziale">Parziale</option>
              <option value="saldato">Saldato</option>
            </select>
          </label>
        ) : null}
        {selectedType.filters.includes('payrollPaymentStatus') ? (
          <label className="print-hub-field">
            <span>Stato busta</span>
            <select
              value={printFilters.payrollPaymentStatus}
              onChange={(event) => setPrintFilters((current) => ({ ...current, payrollPaymentStatus: event.target.value }))}
            >
              <option value="">Tutti</option>
              <option value="non_pagato">Non pagato</option>
              <option value="pagato">Pagato</option>
            </select>
          </label>
        ) : null}
      </div>
    );
  }

  function renderPrintEmployeePicker() {
    if (!selectedType || selectedType.employeeSelection === 'none') {
      return null;
    }

    const isMulti = selectedType.employeeSelection === 'multiple' || selectedType.employeeSelection === 'multiple_optional';
    const modeLabel = getEmployeeSelectionModeLabel(selectedType.employeeSelection);

    return (
      <section className="print-hub-wizard-card">
        <div className="section-header">
          <div>
            <h3 className="section-title">4. Dipendenti</h3>
            <p className="section-subtitle">
              Cerca i dipendenti interessati e costruisci la selezione da stampare.
            </p>
          </div>
          {modeLabel ? <span className="soft-chip">{modeLabel}</span> : null}
        </div>

        {selectedType.id === 'attendance-day' ? (
          <div className="print-hub-employee-options">
            <label className="print-hub-field">
              <span>Squadra</span>
              <select
                value={attendanceDayTeamFilter}
                onChange={(event) => updateAttendanceDayTeamFilter(event.target.value)}
              >
                <option value="">Tutte le squadre</option>
                {attendanceDayTeamOptions.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="print-hub-checkbox-option">
              <input
                type="checkbox"
                checked={includeAttendanceDayHireDates}
                onChange={(event) => setIncludeAttendanceDayHireDates(event.target.checked)}
              />
              <span>Includi date di assunzione</span>
            </label>
          </div>
        ) : null}

        <label className="print-hub-field print-hub-field--search">
          <span>Cerca dipendente</span>
          <input
            className="search-input print-hub-search-input"
            type="text"
            value={printEmployeeSearch}
            onChange={(event) => setPrintEmployeeSearch(event.target.value)}
            placeholder="Cerca dipendente..."
          />
        </label>

        <div className="print-hub-selection-toolbar">
          <span className="soft-chip soft-chip--success">
            {selectedPrintEmployeeIds.length} dipendenti selezionati
          </span>
          {isMulti ? (
            <button type="button" className="button-secondary" onClick={selectAllFilteredEmployees}>
              Seleziona tutti filtrati
            </button>
          ) : null}
            <button type="button" className="button-secondary" onClick={clearPrintEmployeeSelection}>
            Svuota selezione
          </button>
        </div>

        {selectedPrintEmployees.length ? (
          <div className="print-hub-selected-list">
            {selectedPrintEmployees.slice(0, 8).map((employee) => (
              <span key={employee.id} className="soft-chip">
                {getEmployeeLabel(employee)}
              </span>
            ))}
            {selectedPrintEmployees.length > 8 ? (
              <span className="soft-chip">+{selectedPrintEmployees.length - 8} altri</span>
            ) : null}
          </div>
        ) : null}

        <div className="print-hub-search-results">
          {printSearchResults.map((employee) => {
            const checked = selectedPrintEmployeeIds.includes(Number(employee.id));
            return (
              <label key={employee.id} className={`print-hub-check-card ${checked ? 'print-hub-check-card--active' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => togglePrintEmployeeSelection(employee.id)}
                />
                <div>
                  <strong>{getEmployeeLabel(employee)}</strong>
                  <span>{employee.role || 'Dipendente'}</span>
                </div>
              </label>
            );
          })}
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <div className="page print-hub-page">
        <section className="page-hero">
          <div>
            <span className="page-kicker">Centro operativo documenti</span>
            <h1 className="page-title">{PAGE_ICON} Stampa e Documenti</h1>
            <p className="page-subtitle">Caricamento dati in corso...</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="page print-hub-page">
      <section className="page-hero print-hub-page__hero">
        <div>
          <span className="page-kicker">Centro operativo documenti</span>
          <h1 className="page-title">{PAGE_ICON} Stampa e Documenti</h1>
          <p className="page-subtitle">
            Unica sezione per aprire allegati e gestire le stampe del gestionale.
          </p>
        </div>
      </section>

      <div className="print-hub-tabs">
        {TAB_OPTIONS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`print-hub-tab ${activeTab === tab.id ? 'print-hub-tab--active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'documents' ? (
        <div className="print-hub-documents">
          <section className="section-card print-hub-documents-card">
            <div className="section-header">
              <div>
                <h2 className="section-title">Documenti allegati</h2>
                <p className="section-subtitle">
                  Cerca un dipendente, scegli il tipo documento e lavora solo sugli allegati rilevanti.
                </p>
              </div>
              {selectedEmployee ? (
                <button className="button-secondary" type="button" onClick={handleResetDocumentSelection}>
                  Cambia dipendente
                </button>
              ) : null}
            </div>

            <div className="print-hub-search-panel">
              <label className="print-hub-field print-hub-field--search">
                <span>Cerca dipendente</span>
                <input
                  className="search-input print-hub-search-input"
                  type="text"
                  value={employeeSearch}
                  onChange={(event) => {
                    setEmployeeSearch(event.target.value);
                    if (
                      selectedEmployee &&
                      normalizeSortText(event.target.value) !== normalizeSortText(getEmployeeLabel(selectedEmployee))
                    ) {
                      setSelectedEmployee(null);
                      setDocuments([]);
                    }
                  }}
                  placeholder="Cerca dipendente..."
                />
              </label>

              {!selectedEmployee ? (
                <>
                  <div className="print-hub-search-help">
                    Cerca e seleziona un dipendente per visualizzare i documenti allegati.
                  </div>
                  {employeeSearchResults.length ? (
                    <div className="print-hub-search-results">
                      {employeeSearchResults.map((employee) => (
                        <button
                          key={employee.id}
                          type="button"
                          className="print-hub-search-result"
                          onClick={() => handleSelectEmployee(employee)}
                        >
                          <strong>{getEmployeeLabel(employee)}</strong>
                          <span>{employee.role || 'Dipendente'}</span>
                        </button>
                      ))}
                    </div>
                  ) : employeeSearch ? (
                    <div className="empty-state">Nessun dipendente trovato con questo criterio.</div>
                  ) : null}
                </>
              ) : null}
            </div>

            {selectedEmployee ? (
              <>
                <div className="print-hub-selected-employee">
                  <div>
                    <span className="page-kicker">Dipendente selezionato</span>
                    <h3>{getEmployeeLabel(selectedEmployee)}</h3>
                    <p>{selectedEmployee.role || 'Scheda dipendente'}</p>
                  </div>
                  <div className="print-hub-summary-strip">
                    <span className="soft-chip soft-chip--success">{filteredDocuments.length} documenti trovati</span>
                  </div>
                </div>

                <div className="print-hub-filters print-hub-filters--documents">
                  <label className="print-hub-field">
                    <span>Tipo documento</span>
                    <select
                      value={documentsFilters.documentType}
                      onChange={(event) => setDocumentsFilters((current) => ({ ...current, documentType: event.target.value }))}
                    >
                      {DOCUMENT_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="print-hub-field">
                    <span>Mese / anno</span>
                    <select
                      value={documentsFilters.monthReference}
                      onChange={(event) => setDocumentsFilters((current) => ({ ...current, monthReference: event.target.value }))}
                    >
                      <option value="">Tutti</option>
                      {documentMonthOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="print-hub-field">
                    <span>Data caricamento</span>
                    <input
                      type="date"
                      value={documentsFilters.uploadDate}
                      onChange={(event) => setDocumentsFilters((current) => ({ ...current, uploadDate: event.target.value }))}
                    />
                  </label>
                </div>

                {documentsLoading ? (
                  <div className="empty-state">Caricamento documenti del dipendente...</div>
                ) : filteredDocuments.length ? (
                  <div className="print-hub-document-cards">
                    {filteredDocuments.map((document) => (
                      <article
                        key={`${document.source_kind}-${document.source_id}-${document.relative_path}`}
                        className="print-hub-document-card"
                      >
                        <div className="print-hub-document-card__head">
                          <div>
                            <span className="page-kicker">{document.document_type_label}</span>
                            <h4>{document.file_name}</h4>
                          </div>
                          {!document.exists ? (
                            <span className="soft-chip soft-chip--danger">Mancante su disco</span>
                          ) : null}
                        </div>
                        <div className="print-hub-document-card__meta">
                          <div>
                            <span>Data</span>
                            <strong>{formatDate(document.upload_date)}</strong>
                          </div>
                          <div>
                            <span>Origine</span>
                            <strong>{document.origin_label}</strong>
                          </div>
                          <div>
                            <span>Mese</span>
                            <strong>{document.month_reference ? formatMonthLabel(document.month_reference) : '-'}</strong>
                          </div>
                        </div>
                        <div className="table-actions">
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => handleDocumentAction('open', document)}
                            disabled={actionLoading === `open:${document.relative_path}`}
                          >
                            Apri
                          </button>
                          <button
                            type="button"
                            className="button-secondary"
                            onClick={() => handleDocumentAction('print', document)}
                            disabled={actionLoading === `print:${document.relative_path}`}
                          >
                            Stampa
                          </button>
                          <button
                            type="button"
                            className="button"
                            onClick={() => handleDocumentAction('export', document)}
                            disabled={actionLoading === `export:${document.relative_path}`}
                          >
                            Esporta
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">Nessun documento disponibile per questo dipendente con i filtri correnti.</div>
                )}
              </>
            ) : null}
          </section>
        </div>
      ) : (
        <div className="print-hub-layout">
          <section className="section-card print-hub-sidebar-card">
            <div className="section-header">
              <div>
                <h2 className="section-title">Generatore stampe</h2>
                <p className="section-subtitle">
                  Scegli la categoria, definisci il tipo stampa, applica i filtri e seleziona i dipendenti solo quando servono.
                </p>
              </div>
            </div>

            <div className="print-hub-search-help print-hub-search-help--wizard">
              Segui i passaggi da sinistra a destra: categoria, tipo stampa, filtri e, se richiesto, selezione dipendenti.
            </div>

            <section className="print-hub-wizard-card">
              <div className="section-header">
                <div>
                  <h3 className="section-title">1. Cosa vuoi stampare?</h3>
                  <p className="section-subtitle">Scegli l'area del gestionale da cui partire.</p>
                </div>
              </div>
              <label className="print-hub-field">
                <span>Categoria stampa</span>
                <select
                  value={selectedCategoryId}
                  onChange={(event) => setSelectedCategoryId(event.target.value)}
                >
                  {PRINT_CATEGORIES.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section className="print-hub-wizard-card">
              <div className="section-header">
                <div>
                  <h3 className="section-title">2. Tipo stampa</h3>
                  <p className="section-subtitle">Il sistema adatta filtri e selezione in base alla stampa scelta.</p>
                </div>
              </div>
              <label className="print-hub-field">
                <span>Tipo</span>
                <select
                  value={selectedTypeId}
                  onChange={(event) => setSelectedTypeId(event.target.value)}
                >
                  {(selectedCategory?.types || []).map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className={`print-hub-inline-hint ${selectedType?.status === 'ready' ? 'print-hub-inline-hint--success' : 'print-hub-inline-hint--warning'}`}>
                {getPrintConnectionLabel(selectedType?.status)}
              </div>
            </section>

            <section className="print-hub-wizard-card">
              <div className="section-header">
                <div>
                  <h3 className="section-title">3. Filtri</h3>
                  <p className="section-subtitle">Mostriamo solo i campi utili per questa stampa.</p>
                </div>
              </div>
              {renderPrintFilters()}
            </section>

            {renderPrintEmployeePicker()}
          </section>

          <section className="section-card print-hub-preview-card">
            <div className="section-header">
              <div>
                <h2 className="section-title">Anteprima / riepilogo</h2>
                <p className="section-subtitle">
                  Qui vedi esattamente cosa verra stampato prima di generare il PDF.
                </p>
              </div>
            </div>

            <div className="print-hub-preview-selection">
              {buildSelectionMeta().map((item) => (
                <div key={item.label} className="print-hub-preview-selection__item">
                  <span>{item.label}</span>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>

            {previewLoading ? (
              <div className="empty-state">Aggiornamento anteprima in corso...</div>
            ) : printPreview?.status === 'ready' ? (
              <>
                <div className="print-hub-preview-head">
                  <div>
                    <h3>{printPreview.title}</h3>
                    <p>{printPreview.subtitle}</p>
                  </div>
                  <span className="soft-chip soft-chip--success">Collegata</span>
                </div>

                {printPreview.summaryCards?.length ? (
                  <div className="print-hub-preview-summary">
                    {printPreview.summaryCards.map((card) => (
                      <div key={card.label} className="print-hub-preview-stat">
                        <span>{card.label}</span>
                        <strong>{card.value}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="print-hub-preview-table-wrap">
                  <table className="print-hub-table print-hub-table--preview">
                    <thead>
                      <tr>
                        {printPreview.columns.map((column) => (
                          <th
                            key={column.key}
                            className={
                              column.align === 'right'
                                ? 'align-right'
                                : column.align === 'center'
                                ? 'align-center'
                                : ''
                            }
                          >
                            {column.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {printPreview.rows.length ? (
                        printPreview.rows.slice(0, 12).map((row, index) => (
                          <tr key={`${printPreview.title}-${index}`}>
                            {printPreview.columns.map((column) => (
                              <td
                                key={column.key}
                                className={
                                  column.align === 'right'
                                    ? 'align-right'
                                    : column.align === 'center'
                                    ? 'align-center'
                                    : ''
                                }
                              >
                                {row[column.key] ?? '-'}
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={printPreview.columns.length}>Nessun dato disponibile con i filtri correnti.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {printPreview.rows.length > 12 ? (
                  <div className="print-hub-inline-hint">
                    Anteprima ridotta alle prime 12 righe. PDF, stampa ed esportazione useranno l'intero set di dati.
                  </div>
                ) : null}
              </>
            ) : (
              <div className="empty-state print-hub-empty">
                <strong>{printPreview?.title || selectedType?.label || 'Anteprima non disponibile'}</strong>
                <p>{printPreview?.subtitle || 'Configura la stampa per vedere il riepilogo.'}</p>
              </div>
            )}

            <div className="toolbar">
              <div className="toolbar-group">
                <button
                  type="button"
                  className="button"
                  onClick={() => handlePrintOutput('pdf')}
                  disabled={printPreview?.status !== 'ready' || !printPreview?.rows?.length}
                >
                  Genera PDF
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => handlePrintOutput('print')}
                  disabled={printPreview?.status !== 'ready' || !printPreview?.rows?.length}
                >
                  Stampa
                </button>
                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => handlePrintOutput('export')}
                  disabled={printPreview?.status !== 'ready' || !printPreview?.rows?.length}
                >
                  Esporta
                </button>
              </div>
            </div>

            {printPreview?.status === 'disabled' ? (
              <div className="print-hub-disabled-hint">Stampa non ancora collegata.</div>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
